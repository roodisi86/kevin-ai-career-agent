import "server-only";
import type { AppContext } from "@/lib/dal";
import { audit } from "@/lib/audit";
import { dbFor } from "@/lib/supabase/db";
import { asJson, type ApplicationPackageRow } from "@/lib/supabase/database.types";
import { jobEvidenceText, type MatchResult, type PromptFact } from "@/lib/ai/match";
import { loadCandidateMatchInput } from "@/lib/matching/service";
import { amsterdamDate } from "@/lib/time";
import { buildPackagePrompt, letterWarnings, PACKAGE_PROMPT_VERSION, parsePackageOutput, verifyPackage } from "./research";

export type PackageRequestResult =
  | { ok: true; status: "queued" | "already_queued" }
  | { ok: false; error: "not_found" | "no_facts" | "db" };

export async function requestPackage(ctx: AppContext, jobId: string): Promise<PackageRequestResult> {
  const supabase = await dbFor(ctx);
  const [{ data: job }, { data: match }, { data: existing }, input] = await Promise.all([
    supabase
      .from("jobs")
      .select("id, title, company_name, location_text, canonical_url, description_text")
      .eq("tenant_id", ctx.tenantId)
      .eq("id", jobId)
      .maybeSingle(),
    supabase.from("job_matches").select("result_json").eq("tenant_id", ctx.tenantId).eq("job_id", jobId).maybeSingle(),
    supabase.from("application_packages").select("status").eq("tenant_id", ctx.tenantId).eq("job_id", jobId).maybeSingle(),
    loadCandidateMatchInput(ctx),
  ]);
  if (!job) return { ok: false, error: "not_found" };
  if (input.facts.length === 0) return { ok: false, error: "no_facts" };
  if (existing?.status === "pending" || existing?.status === "answered") return { ok: true, status: "already_queued" };

  const result = match?.result_json as unknown as MatchResult | undefined;
  const prompt = buildPackagePrompt({
    facts: input.facts,
    profile: input.profile,
    preferenceLines: input.preferenceLines,
    job: { title: job.title, company: job.company_name, location: job.location_text, url: job.canonical_url, description: job.description_text },
    fitSummary: result?.fitSummary ?? null,
  });
  const { error } = await supabase.from("application_packages").upsert(
    {
      tenant_id: ctx.tenantId,
      candidate_id: ctx.candidateId,
      job_id: job.id,
      status: "pending",
      prompt_text: prompt.slice(0, 40_000),
      fact_refs_json: asJson(Object.fromEntries(input.facts.map((f) => [f.ref, f.id]))),
      prompt_version: PACKAGE_PROMPT_VERSION,
      output_json: null,
      package_json: null,
      letter_text: null,
      letter_edited: false,
      warnings_json: asJson([]),
      error: null,
      requested_by: ctx.userId,
      answered_at: null,
      processed_at: null,
    },
    { onConflict: "tenant_id,job_id" },
  );
  if (error) return { ok: false, error: "db" };
  await audit(ctx, "package.requested", "job", job.id, {});
  return { ok: true, status: "queued" };
}

async function factsFor(ctx: AppContext, refs: Record<string, string>): Promise<PromptFact[]> {
  const supabase = await dbFor(ctx);
  const ids = Object.values(refs);
  if (ids.length === 0) return [];
  const { data } = await supabase
    .from("candidate_facts")
    .select("id, category, statement")
    .eq("candidate_id", ctx.candidateId)
    .eq("status", "confirmed")
    .in("id", ids);
  const byId = new Map((data ?? []).map((f) => [f.id, f]));
  return Object.entries(refs).flatMap(([ref, id]) => {
    const f = byId.get(id);
    return f ? [{ ref, id, category: f.category, statement: f.statement }] : [];
  });
}

async function jobTextFor(ctx: AppContext, jobId: string): Promise<string | null> {
  const supabase = await dbFor(ctx);
  const { data: job } = await supabase
    .from("jobs")
    .select("title, company_name, location_text, description_text")
    .eq("tenant_id", ctx.tenantId)
    .eq("id", jobId)
    .maybeSingle();
  return job ? jobEvidenceText({ title: job.title, company: job.company_name, location: job.location_text, description: job.description_text }) : null;
}

/** Verifies answered packages from the Claude task. */
export async function processPackageAnswers(ctx: AppContext): Promise<{ processed: number; rejected: number }> {
  const supabase = await dbFor(ctx);
  const { data: answered } = await supabase
    .from("application_packages")
    .select("id, job_id, output_json, fact_refs_json")
    .eq("tenant_id", ctx.tenantId)
    .eq("status", "answered")
    .limit(10);
  const summary = { processed: 0, rejected: 0 };
  for (const row of answered ?? []) {
    const now = new Date().toISOString();
    const parsed = parsePackageOutput(row.output_json);
    const jobText = await jobTextFor(ctx, row.job_id);
    if (!parsed.ok || !jobText) {
      summary.rejected++;
      await supabase.from("application_packages").update({ status: "rejected", error: "invalid_output", processed_at: now }).eq("id", row.id);
      continue;
    }
    const facts = await factsFor(ctx, (row.fact_refs_json ?? {}) as Record<string, string>);
    const verified = verifyPackage(parsed.output, { facts, jobText });
    const warnings = letterWarnings(parsed.output.coverLetter, { facts, jobText });
    await supabase
      .from("application_packages")
      .update({
        status: "ready",
        package_json: asJson(verified),
        letter_text: parsed.output.coverLetter,
        warnings_json: asJson(warnings),
        processed_at: now,
      })
      .eq("id", row.id);
    await audit(ctx, "package.processed", "application_package", row.id, { highlights: verified.highlights.length, dropped: verified.dropped.highlights });
    summary.processed++;
  }
  return summary;
}

export async function loadPackage(ctx: AppContext, jobId: string): Promise<ApplicationPackageRow | null> {
  const supabase = await dbFor(ctx);
  const { data } = await supabase.from("application_packages").select("*").eq("tenant_id", ctx.tenantId).eq("job_id", jobId).maybeSingle();
  return data;
}

/** Saves the candidate's own edit of the letter and re-checks it. */
export async function saveLetter(ctx: AppContext, jobId: string, letter: string): Promise<boolean> {
  const supabase = await dbFor(ctx);
  const { data: row } = await supabase
    .from("application_packages")
    .select("id, fact_refs_json, status")
    .eq("tenant_id", ctx.tenantId)
    .eq("job_id", jobId)
    .maybeSingle();
  if (!row || row.status !== "ready") return false;
  const jobText = (await jobTextFor(ctx, jobId)) ?? "";
  const facts = await factsFor(ctx, (row.fact_refs_json ?? {}) as Record<string, string>);
  const { error } = await supabase
    .from("application_packages")
    .update({ letter_text: letter.slice(0, 8000), letter_edited: true, warnings_json: asJson(letterWarnings(letter, { facts, jobText })) })
    .eq("id", row.id);
  if (!error) await audit(ctx, "package.edited", "application_package", row.id, {});
  return !error;
}

/** "Ik heb gesolliciteerd": the candidate submitted it himself — record it in the pipeline. */
export async function markApplied(ctx: AppContext, jobId: string): Promise<string | null> {
  const supabase = await dbFor(ctx);
  const today = amsterdamDate();
  const { data: job } = await supabase
    .from("jobs")
    .select("id, title, company_name, canonical_url, company_target_id")
    .eq("tenant_id", ctx.tenantId)
    .eq("id", jobId)
    .maybeSingle();
  if (!job) return null;
  const { data: existing } = await supabase.from("applications").select("id, stage, applied_on").eq("tenant_id", ctx.tenantId).eq("job_id", jobId).limit(1).maybeSingle();
  let id: string | null = null;
  if (existing) {
    const forward = existing.stage === "prospect" || existing.stage === "on_hold";
    const { error } = await supabase
      .from("applications")
      .update({ ...(forward ? { stage: "applied" as const } : {}), applied_on: existing.applied_on ?? today })
      .eq("id", existing.id);
    if (!error) id = existing.id;
  } else {
    const { data, error } = await supabase
      .from("applications")
      .insert({
        tenant_id: ctx.tenantId,
        candidate_id: ctx.candidateId,
        job_id: job.id,
        company_target_id: job.company_target_id,
        company_name: job.company_name.slice(0, 200),
        role_title: job.title.slice(0, 300),
        job_url: job.canonical_url,
        stage: "applied",
        channel: "direct",
        applied_on: today,
      })
      .select("id")
      .single();
    if (!error) id = data.id;
  }
  if (id) await audit(ctx, "package.applied", "application", id, {});
  return id;
}
