import "server-only";
import { createHash } from "node:crypto";
import type { AppContext } from "@/lib/dal";
import { audit } from "@/lib/audit";
import { getServerEnv } from "@/lib/env";
import { createSupabaseServerClient } from "@/lib/supabase/server";
import { asJson, type JobRow } from "@/lib/supabase/database.types";
import { parseStoredAssessment, assessmentToPromptLines, PROMPT_LABELS } from "@/lib/assessment/schema";
import { scoreJobWithClaude } from "@/lib/ai/claude";
import {
  buildMatchUserMessage,
  jobEvidenceText,
  MATCH_PROMPT_VERSION,
  matchInputHash,
  verifyMatch,
  type PromptFact,
} from "@/lib/ai/match";
import { loadPreferences } from "@/lib/scanner/service";
import { feedbackLines, gateLines, jobSignalLines, preferenceLines } from "./context";

/**
 * Everything about the candidate that goes into a match prompt, plus a hash
 * of it: when any of it changes, cached matches become stale.
 */
export interface CandidateMatchInput {
  facts: PromptFact[];
  profile: { headline: string | null; summary: string | null };
  assessmentLines: string[];
  preferenceLines: string[];
  feedbackLines: string[];
  candidateHash: string;
}

export async function loadCandidateMatchInput(ctx: AppContext): Promise<CandidateMatchInput> {
  const supabase = await createSupabaseServerClient();
  const [{ data: facts }, { data: profile }, { data: assessment }, prefs, { data: feedback }] = await Promise.all([
    supabase
      .from("candidate_facts")
      .select("id, category, statement")
      .eq("candidate_id", ctx.candidateId)
      .eq("status", "confirmed")
      .order("created_at", { ascending: true })
      .limit(150),
    supabase.from("candidate_profiles").select("headline, summary").eq("id", ctx.candidateId).single(),
    supabase.from("candidate_assessments").select("answers_json").eq("candidate_id", ctx.candidateId).maybeSingle(),
    loadPreferences(ctx),
    supabase
      .from("match_feedback")
      .select("label, reasons, note, job_id")
      .eq("tenant_id", ctx.tenantId)
      .order("updated_at", { ascending: false })
      .limit(20),
  ]);

  // Job titles for feedback examples (separate query: no embedded joins).
  const jobIds = (feedback ?? []).map((f) => f.job_id);
  const { data: feedbackJobs } = jobIds.length
    ? await supabase.from("jobs").select("id, title, company_name").in("id", jobIds)
    : { data: [] as { id: string; title: string; company_name: string }[] };
  const jobById = new Map((feedbackJobs ?? []).map((j) => [j.id, j]));

  const promptFacts: PromptFact[] = (facts ?? []).map((f, i) => ({
    ref: `F${i + 1}`,
    id: f.id,
    category: f.category,
    statement: f.statement,
  }));
  const answers = parseStoredAssessment(assessment?.answers_json);
  const prefLines = preferenceLines(prefs);
  const assessmentLines = assessmentToPromptLines(answers, PROMPT_LABELS);
  const profileInput = { headline: profile?.headline ?? null, summary: profile?.summary ?? null };

  // Feedback is deliberately not part of the cache key: one thumbs-up should
  // not invalidate every score. It calibrates the next (re-)assessments.
  const candidateHash = createHash("sha256")
    .update(JSON.stringify([promptFacts.map((f) => [f.id, f.category, f.statement]), profileInput, assessmentLines, prefLines]))
    .digest("hex");

  return {
    facts: promptFacts,
    profile: profileInput,
    assessmentLines,
    preferenceLines: prefLines,
    feedbackLines: feedbackLines(
      (feedback ?? []).flatMap((f) => {
        const job = jobById.get(f.job_id);
        return job ? [{ label: f.label, reasons: f.reasons, note: f.note, title: job.title, company: job.company_name }] : [];
      }),
    ),
    candidateHash,
  };
}

type MatchableJob = Pick<
  JobRow,
  | "id" | "title" | "company_name" | "location_text" | "workplace_type" | "provider" | "description_text"
  | "description_is_truncated" | "signals_json" | "salary_json" | "gate_status" | "gate_json" | "raw_hash"
>;

const MATCHABLE_COLUMNS =
  "id, title, company_name, location_text, workplace_type, provider, description_text, description_is_truncated, signals_json, salary_json, gate_status, gate_json, raw_hash";

function hashFor(job: Pick<MatchableJob, "raw_hash" | "gate_status">, input: CandidateMatchInput, model: string): string {
  return matchInputHash({ model, candidate: input.candidateHash, jobRawHash: job.raw_hash, gate: job.gate_status });
}

/** Active, visible, primary jobs whose match is missing or stale. */
export async function pendingMatchJobIds(ctx: AppContext, { force = false } = {}): Promise<{ pending: string[]; total: number }> {
  const supabase = await createSupabaseServerClient();
  const env = getServerEnv();
  const [{ data: jobs }, { data: matches }, input] = await Promise.all([
    supabase
      .from("jobs")
      .select("id, raw_hash, gate_status, first_seen_at")
      .eq("tenant_id", ctx.tenantId)
      .neq("status", "closed")
      .is("duplicate_of", null)
      .is("filtered_out_reason", null)
      .neq("user_state", "not_relevant")
      .order("first_seen_at", { ascending: false })
      .limit(500),
    supabase.from("job_matches").select("job_id, input_hash").eq("tenant_id", ctx.tenantId),
    loadCandidateMatchInput(ctx),
  ]);
  const hashes = new Map((matches ?? []).map((m) => [m.job_id, m.input_hash]));
  const eligible = (jobs ?? []).filter((j) => j.gate_status !== "fail");
  const pending = eligible
    .filter((j) => force || hashes.get(j.id) !== hashFor(j, input, env.ANTHROPIC_MODEL))
    .map((j) => j.id);
  return { pending, total: eligible.length };
}

export type ScoreOutcome =
  | { status: "scored" | "cached"; score: number; classification: string }
  | { status: "not_found" | "not_configured" | "cap_reached" | "no_facts" }
  | { status: "failed"; reason: string };

function limitedEvidence(job: MatchableJob): boolean {
  return job.description_is_truncated || (job.description_text ?? "").length < 600;
}

export async function scoreJob(ctx: AppContext, jobId: string, { force = false } = {}): Promise<ScoreOutcome> {
  const supabase = await createSupabaseServerClient();
  const env = getServerEnv();
  if (!env.ANTHROPIC_API_KEY) return { status: "not_configured" };

  const [{ data: job }, { data: existing }, input] = await Promise.all([
    supabase.from("jobs").select(MATCHABLE_COLUMNS).eq("tenant_id", ctx.tenantId).eq("id", jobId).maybeSingle(),
    supabase.from("job_matches").select("id, input_hash, score, classification").eq("tenant_id", ctx.tenantId).eq("job_id", jobId).maybeSingle(),
    loadCandidateMatchInput(ctx),
  ]);
  if (!job) return { status: "not_found" };
  if (input.facts.length === 0) return { status: "no_facts" };

  const inputHash = hashFor(job, input, env.ANTHROPIC_MODEL);
  if (!force && existing?.input_hash === inputHash) {
    return { status: "cached", score: existing.score, classification: existing.classification };
  }

  // Daily cost cap per tenant.
  const startOfDay = new Date();
  startOfDay.setUTCHours(0, 0, 0, 0);
  const { count } = await supabase
    .from("audit_events")
    .select("id", { count: "exact", head: true })
    .eq("tenant_id", ctx.tenantId)
    .eq("action", "match.scored")
    .gte("occurred_at", startOfDay.toISOString());
  if ((count ?? 0) >= env.AI_DAILY_MATCH_CAP) return { status: "cap_reached" };

  const limited = limitedEvidence(job);
  const message = buildMatchUserMessage({
    profile: input.profile,
    facts: input.facts,
    assessmentLines: input.assessmentLines,
    preferenceLines: input.preferenceLines,
    feedbackLines: input.feedbackLines,
    job: {
      title: job.title,
      company: job.company_name,
      location: job.location_text,
      workplaceType: job.workplace_type,
      provider: job.provider,
      descriptionTruncated: limited,
      signalLines: jobSignalLines((job.signals_json ?? {}) as Record<string, unknown>, (job.salary_json ?? {}) as Record<string, unknown>),
      gateLines: gateLines((job.gate_json ?? {}) as { checks?: { key: string; mode: string; outcome: string }[] }),
      description: job.description_text,
    },
  });

  const result = await scoreJobWithClaude(message);
  if (result.status === "not_configured") return { status: "not_configured" };
  if (result.status === "failed") {
    await audit(ctx, "match.scored", "job", job.id, { outcome: result.reason, prompt_version: MATCH_PROMPT_VERSION });
    return { status: "failed", reason: result.reason };
  }

  const verified = verifyMatch(result.output, {
    jobText: jobEvidenceText({
      title: job.title,
      company: job.company_name,
      location: job.location_text,
      description: job.description_text,
    }),
    facts: input.facts,
    gate: job.gate_status,
    limitedEvidence: limited,
  });

  const { error } = await supabase.from("job_matches").upsert(
    {
      tenant_id: ctx.tenantId,
      job_id: job.id,
      score: verified.score,
      classification: verified.classification,
      hard_gate_status: job.gate_status,
      limited_evidence: verified.limitedEvidence,
      result_json: asJson(verified),
      input_hash: inputHash,
      profile_version: ctx.profileVersion,
      model: result.model,
      prompt_version: MATCH_PROMPT_VERSION,
      scored_at: new Date().toISOString(),
    },
    { onConflict: "tenant_id,job_id" },
  );
  if (error) return { status: "failed", reason: "db" };

  await audit(ctx, "match.scored", "job", job.id, {
    outcome: "completed",
    score: verified.score,
    classification: verified.classification,
    dropped_quotes: verified.dropped.quotes,
    dropped_claims: verified.dropped.claims,
    capped_ratings: verified.dropped.cappedRatings,
    model: result.model,
    prompt_version: MATCH_PROMPT_VERSION,
  });
  return { status: "scored", score: verified.score, classification: verified.classification };
}
