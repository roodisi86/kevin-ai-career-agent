import "server-only";
import { createHash } from "node:crypto";
import type { AppContext } from "@/lib/dal";
import { audit } from "@/lib/audit";
import { getServerEnv, isApiMatchingEnabled } from "@/lib/env";
import { refilterReason } from "@/lib/scanner/process";
import { dbFor } from "@/lib/supabase/db";
import { asJson, type JobRow } from "@/lib/supabase/database.types";
import { parseStoredAssessment, assessmentToPromptLines, PROMPT_LABELS, type AssessmentAnswers } from "@/lib/assessment/schema";
import type { Preferences } from "@/lib/preferences/schema";
import { RULES_VERSION, scoreWithRules, type RulesFeedback } from "./rules";
import { scoreJobWithClaude } from "@/lib/ai/claude";
import {
  buildMatchUserMessage,
  buildQueuedPrompt,
  jobEvidenceText,
  parseMatchOutput,
  SUBSCRIPTION_MODEL,
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
  prefs: Preferences;
  assessment: AssessmentAnswers;
  feedback: RulesFeedback[];
  /** Hash of the feedback (part of the rules cache key only). */
  feedbackDigest: string;
  facts: PromptFact[];
  profile: { headline: string | null; summary: string | null };
  assessmentLines: string[];
  preferenceLines: string[];
  feedbackLines: string[];
  candidateHash: string;
}

export async function loadCandidateMatchInput(ctx: AppContext): Promise<CandidateMatchInput> {
  const supabase = await dbFor(ctx);
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
      .limit(50),
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

  const feedbackRows = (feedback ?? []).flatMap((f) => {
    const job = jobById.get(f.job_id);
    return job ? [{ label: f.label, reasons: f.reasons, note: f.note, title: job.title, company: job.company_name }] : [];
  });

  return {
    prefs,
    assessment: answers,
    feedback: feedbackRows.map((f) => ({ label: f.label, reasons: f.reasons, title: f.title })),
    feedbackDigest: createHash("sha256").update(JSON.stringify(feedbackRows.map((f) => [f.label, f.reasons, f.title]))).digest("hex"),
    facts: promptFacts,
    profile: profileInput,
    assessmentLines,
    preferenceLines: prefLines,
    feedbackLines: feedbackLines(feedbackRows),
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
  const supabase = await dbFor(ctx);
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

function messageFor(job: MatchableJob, input: CandidateMatchInput, options?: { maxDescriptionChars?: number }): string {
  return buildMatchUserMessage(
    {
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
        descriptionTruncated: limitedEvidence(job),
        signalLines: jobSignalLines((job.signals_json ?? {}) as Record<string, unknown>, (job.salary_json ?? {}) as Record<string, unknown>),
        gateLines: gateLines((job.gate_json ?? {}) as { checks?: { key: string; mode: string; outcome: string }[] }),
        description: job.description_text,
      },
    },
    options,
  );
}

function limitedEvidence(job: MatchableJob): boolean {
  return job.description_is_truncated || (job.description_text ?? "").length < 600;
}

export async function scoreJob(ctx: AppContext, jobId: string, { force = false } = {}): Promise<ScoreOutcome> {
  const supabase = await dbFor(ctx);
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
  const message = messageFor(job, input);

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

// ---------------------------------------------------------------------------
// Free path: rules for every job, Claude (via the user's subscription) for
// the promising ones. Runs after scans, preference/assessment/feedback
// changes and when the jobs page opens. Pure CPU plus a few upserts.
// ---------------------------------------------------------------------------

const QUEUE_LIMIT = 20;
const QUEUE_MIN_SCORE = 45;
const QUEUE_DESCRIPTION_CHARS = 6000;

function rulesHashFor(job: Pick<MatchableJob, "raw_hash" | "gate_status">, input: CandidateMatchInput): string {
  return matchInputHash({
    model: RULES_VERSION,
    candidate: `${input.candidateHash}|${input.feedbackDigest}`,
    jobRawHash: job.raw_hash,
    gate: job.gate_status,
  });
}

function matchIsCurrent(match: { model: string; input_hash: string }, job: MatchableJob, input: CandidateMatchInput): boolean {
  return match.model === RULES_VERSION
    ? match.input_hash === rulesHashFor(job, input)
    : match.input_hash === hashFor(job, input, match.model);
}

export interface RefreshSummary {
  filteredOut: number;
  rulesScored: number;
  aiProcessed: number;
  aiRejected: number;
  queued: number;
  pendingInQueue: number;
}

export async function refreshMatches(ctx: AppContext): Promise<RefreshSummary> {
  const supabase = await dbFor(ctx);
  const aiByApi = isApiMatchingEnabled();
  const [{ data: jobRows }, { data: matches }, { data: requests }, input] = await Promise.all([
    supabase
      .from("jobs")
      .select(`${MATCHABLE_COLUMNS}, country_code, company_name, location_text`)
      .eq("tenant_id", ctx.tenantId)
      .neq("status", "closed")
      .is("duplicate_of", null)
      .is("filtered_out_reason", null)
      .neq("user_state", "not_relevant")
      .limit(500),
    supabase.from("job_matches").select("job_id, input_hash, model, score, classification").eq("tenant_id", ctx.tenantId),
    supabase.from("ai_match_requests").select("id, job_id, input_hash, status, output_json").eq("tenant_id", ctx.tenantId),
    loadCandidateMatchInput(ctx),
  ]);
  const summary: RefreshSummary = { filteredOut: 0, rulesScored: 0, aiProcessed: 0, aiRejected: 0, queued: 0, pendingInQueue: 0 };
  if (!jobRows) return summary;
  let jobs = jobRows;

  // 0. Apply the current title filter to stored jobs (cheap; catches jobs
  //    stored before the filter was tightened). Filtered jobs are not scored.
  const filteredIds = new Set<string>();
  for (const job of jobs) {
    const reason = refilterReason(input.prefs, job);
    if (reason) {
      filteredIds.add(job.id);
      await supabase.from("jobs").update({ filtered_out_reason: reason }).eq("tenant_id", ctx.tenantId).eq("id", job.id);
    }
  }
  if (filteredIds.size) {
    await supabase.from("ai_match_requests").delete().eq("tenant_id", ctx.tenantId).eq("status", "pending").in("job_id", [...filteredIds]);
    jobs = jobs.filter((j) => !filteredIds.has(j.id));
  }
  summary.filteredOut = filteredIds.size;

  const matchByJob = new Map((matches ?? []).map((m) => [m.job_id, m]));
  const jobById = new Map(jobs.map((j) => [j.id, j]));

  // 1. Answers from the subscription task: validate + verify exactly like the API path.
  for (const req of (requests ?? []).filter((r) => r.status === "answered")) {
    const job = jobById.get(req.job_id);
    if (!job || req.input_hash !== hashFor(job, input, SUBSCRIPTION_MODEL)) {
      await supabase.from("ai_match_requests").update({ status: "stale", processed_at: new Date().toISOString() }).eq("id", req.id);
      continue;
    }
    const parsed = parseMatchOutput(req.output_json);
    if (!parsed.ok) {
      summary.aiRejected++;
      await supabase
        .from("ai_match_requests")
        .update({ status: "rejected", error: "invalid_output", processed_at: new Date().toISOString() })
        .eq("id", req.id);
      await audit(ctx, "match.scored", "job", job.id, { outcome: "invalid_output", model: SUBSCRIPTION_MODEL });
      continue;
    }
    const limited = limitedEvidence(job);
    const verified = verifyMatch(parsed.output, {
      jobText: jobEvidenceText({ title: job.title, company: job.company_name, location: job.location_text, description: job.description_text }),
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
        input_hash: req.input_hash,
        profile_version: ctx.profileVersion,
        model: SUBSCRIPTION_MODEL,
        prompt_version: MATCH_PROMPT_VERSION,
        scored_at: new Date().toISOString(),
      },
      { onConflict: "tenant_id,job_id" },
    );
    if (error) continue;
    matchByJob.set(job.id, { job_id: job.id, input_hash: req.input_hash, model: SUBSCRIPTION_MODEL, score: verified.score, classification: verified.classification });
    await supabase.from("ai_match_requests").update({ status: "processed", processed_at: new Date().toISOString() }).eq("id", req.id);
    await audit(ctx, "match.scored", "job", job.id, {
      outcome: "completed",
      score: verified.score,
      classification: verified.classification,
      dropped_quotes: verified.dropped.quotes,
      dropped_claims: verified.dropped.claims,
      model: SUBSCRIPTION_MODEL,
      prompt_version: MATCH_PROMPT_VERSION,
    });
    summary.aiProcessed++;
  }

  // 2. Rules for every job without a current assessment (AI results stay while current).
  for (const job of jobs) {
    const existing = matchByJob.get(job.id);
    if (existing && matchIsCurrent(existing, job, input)) continue;
    const signals = (job.signals_json ?? {}) as Record<string, { value?: string } | string | null>;
    const value = (key: string) => {
      const v = signals[key];
      return typeof v === "object" && v && (v.value === "yes" || v.value === "no") ? v.value : "unknown";
    };
    const salary = (job.salary_json ?? {}) as { annualEur?: number };
    const result = scoreWithRules({
      job: {
        title: job.title,
        company: job.company_name,
        location: job.location_text,
        countryCode: job.country_code,
        workplaceType: job.workplace_type,
        description: job.description_text,
        sector: typeof signals.sector === "string" ? signals.sector : null,
        signals: {
          companyCar: value("companyCar"),
          dutchContract: value("dutchContract"),
          remoteHybrid: value("remoteHybrid"),
          multinational: value("multinational"),
        },
        salaryAnnualEur: typeof salary.annualEur === "number" ? salary.annualEur : null,
        gate: job.gate_status,
        limitedEvidence: limitedEvidence(job),
      },
      facts: input.facts,
      prefs: input.prefs,
      assessment: input.assessment,
      feedback: input.feedback,
    });
    const inputHash = rulesHashFor(job, input);
    const { error } = await supabase.from("job_matches").upsert(
      {
        tenant_id: ctx.tenantId,
        job_id: job.id,
        score: result.score,
        classification: result.classification,
        hard_gate_status: job.gate_status,
        limited_evidence: result.limitedEvidence,
        result_json: asJson(result),
        input_hash: inputHash,
        profile_version: ctx.profileVersion,
        model: RULES_VERSION,
        prompt_version: RULES_VERSION,
        scored_at: new Date().toISOString(),
      },
      { onConflict: "tenant_id,job_id" },
    );
    if (!error) {
      matchByJob.set(job.id, { job_id: job.id, input_hash: inputHash, model: RULES_VERSION, score: result.score, classification: result.classification });
      summary.rulesScored++;
    }
  }

  // 3. Queue the promising rules-scored jobs for Claude (only without an API key).
  if (!aiByApi && input.facts.length > 0) {
    const reqByJob = new Map((requests ?? []).map((r) => [r.job_id, r]));
    const candidates = jobs
      .map((job) => ({ job, match: matchByJob.get(job.id) }))
      .filter(({ job, match }) => match && match.model === RULES_VERSION && match.score >= QUEUE_MIN_SCORE && job.gate_status !== "fail")
      .sort((a, b) => b.match!.score - a.match!.score)
      .slice(0, QUEUE_LIMIT);
    for (const { job, match } of candidates) {
      const aiHash = hashFor(job, input, SUBSCRIPTION_MODEL);
      const req = reqByJob.get(job.id);
      if (req && req.input_hash === aiHash && (req.status === "pending" || req.status === "answered" || req.status === "rejected")) continue;
      const { error } = await supabase.from("ai_match_requests").upsert(
        {
          tenant_id: ctx.tenantId,
          job_id: job.id,
          input_hash: aiHash,
          priority: match!.score,
          prompt_text: buildQueuedPrompt(messageFor(job, input, { maxDescriptionChars: QUEUE_DESCRIPTION_CHARS })).slice(0, 40_000),
          status: "pending",
          output_json: null,
          error: null,
          answered_at: null,
          processed_at: null,
        },
        { onConflict: "tenant_id,job_id" },
      );
      if (!error) summary.queued++;
    }
  }
  const { count } = await supabase
    .from("ai_match_requests")
    .select("id", { count: "exact", head: true })
    .eq("tenant_id", ctx.tenantId)
    .eq("status", "pending");
  summary.pendingInQueue = count ?? 0;
  return summary;
}
