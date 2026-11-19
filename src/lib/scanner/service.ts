import "server-only";
import { createHash } from "node:crypto";
import { dbFor } from "@/lib/supabase/db";
import type { AppContext } from "@/lib/dal";
import { audit } from "@/lib/audit";
import { normalizeEmployerName } from "@/lib/preferences/employers";
import { parseStoredPreferences, type Preferences } from "@/lib/preferences/schema";
import { asJson, type JobRow, type JobSourceRow } from "@/lib/supabase/database.types";
import { adapters } from "./adapters";
import { countryFromLocation } from "./geo";
import { createFetchJson } from "./http";
import { pickPrimary, refilterReason, regate, statusWhenMissing, toJobRecord, type CompanyContext } from "./process";
import { makeCandidateTitleFilter, searchPhrases } from "./relevance";
import { SUGGESTED_TARGETS } from "./suggested-targets";
import { capDescription } from "./text";
import { isAtsProvider, SourceError, type RawPosting, type SourceProvider } from "./types";
import { findBoards, parseCareersUrl, verifyKnownBoard, type BoardCandidate } from "./verify";

export const SOURCE_LABELS: Record<JobSourceRow["provider"] | "manual", string> = {
  greenhouse: "Greenhouse",
  smartrecruiters: "SmartRecruiters",
  lever: "Lever",
  lever_eu: "Lever (EU)",
  ashby: "Ashby",
  jobicy: "Jobicy (remote)",
  adzuna: "Adzuna NL",
  manual: "Handmatig",
};

export function adzunaConfigured(): boolean {
  return Boolean(process.env.ADZUNA_APP_ID?.trim() && process.env.ADZUNA_APP_KEY?.trim());
}

export async function loadPreferences(ctx: AppContext): Promise<Preferences> {
  const supabase = await dbFor(ctx);
  const { data } = await supabase
    .from("candidate_preferences")
    .select("preferences_json")
    .eq("candidate_id", ctx.candidateId)
    .maybeSingle();
  return parseStoredPreferences(data?.preferences_json).preferences;
}

function companyContext(target: { id: string; company_name: string; is_multinational: string; sector: string | null } | null): CompanyContext | null {
  if (!target) return null;
  const m = target.is_multinational;
  return { id: target.id, name: target.company_name, isMultinational: m === "yes" || m === "no" ? m : "unknown", sector: target.sector };
}

// ---------------------------------------------------------------------------
// Scans
// ---------------------------------------------------------------------------

export interface ScanPlan {
  scanId: string;
  reused: boolean;
  sources: { id: string; label: string }[];
}

/** Starts a scan, or returns the one already running (< 15 min) — idempotent. */
export async function startScan(
  ctx: AppContext,
  { trigger = "manual" }: { trigger?: "manual" | "scheduled" } = {},
): Promise<ScanPlan> {
  const supabase = await dbFor(ctx);
  const [{ data: sources }, { data: targets }] = await Promise.all([
    supabase
      .from("job_sources")
      .select("id, provider, identifier, display_name, company_target_id")
      .eq("tenant_id", ctx.tenantId)
      .eq("approved", true)
      .order("provider"),
    supabase.from("company_targets").select("id, company_name").eq("tenant_id", ctx.tenantId),
  ]);
  const names = new Map((targets ?? []).map((t) => [t.id, t.company_name]));
  const list = (sources ?? [])
    .filter((s) => s.provider !== "adzuna" || adzunaConfigured())
    .map((s) => {
      const company = s.company_target_id ? names.get(s.company_target_id) : undefined;
      return { id: s.id, label: `${company ?? s.display_name ?? s.identifier} · ${SOURCE_LABELS[s.provider]}` };
    });

  const since = new Date(Date.now() - 15 * 60_000).toISOString();
  const { data: running } = await supabase
    .from("scans")
    .select("id")
    .eq("tenant_id", ctx.tenantId)
    .eq("status", "running")
    .gte("started_at", since)
    .order("started_at", { ascending: false })
    .limit(1)
    .maybeSingle();
  if (running) return { scanId: running.id, reused: true, sources: list };

  const { data: scan, error } = await supabase
    .from("scans")
    .insert({ tenant_id: ctx.tenantId, created_by: ctx.userId, trigger })
    .select("id")
    .single();
  if (error || !scan) throw new Error("could not start scan");
  await audit(ctx, "scan.started", "scan", scan.id, { sources: list.length, trigger });
  return { scanId: scan.id, reused: false, sources: list };
}

export interface SourceRunCounts {
  fetched: number;
  relevant: number;
  new: number;
  updated: number;
  unchanged: number;
  missing: number;
  closed: number;
  requests: number;
  complete: boolean;
}

export type SourceRunResult =
  | { ok: true; counts: SourceRunCounts; notes: string[] }
  | { ok: false; error: string; code: string };

async function mergeScanJson(ctx: AppContext, scanId: string, key: "counts_json" | "errors_json", sourceId: string, value: unknown) {
  const supabase = await dbFor(ctx);
  const { data } = await supabase.from("scans").select("counts_json, errors_json").eq("tenant_id", ctx.tenantId).eq("id", scanId).single();
  const current = ((data?.[key] ?? {}) as Record<string, unknown>) ?? {};
  const next = asJson({ ...current, [sourceId]: value });
  await supabase
    .from("scans")
    .update(key === "counts_json" ? { counts_json: next } : { errors_json: next })
    .eq("id", scanId);
}

export async function runSourceInScan(ctx: AppContext, scanId: string, sourceId: string): Promise<SourceRunResult> {
  const supabase = await dbFor(ctx);
  const [{ data: scan }, { data: source }] = await Promise.all([
    supabase.from("scans").select("id, status").eq("id", scanId).maybeSingle(),
    supabase.from("job_sources").select("*").eq("id", sourceId).maybeSingle(),
  ]);
  if (!scan || scan.status !== "running") return { ok: false, error: "scan not running", code: "scan_not_running" };
  if (!source || !source.approved) return { ok: false, error: "source not approved", code: "not_approved" };

  const prefs = await loadPreferences(ctx);
  const { data: targetRow } = source.company_target_id
    ? await supabase
        .from("company_targets")
        .select("id, company_name, is_multinational, sector")
        .eq("id", source.company_target_id)
        .maybeSingle()
    : { data: null };
  const target = companyContext(targetRow ?? null);
  const provider = source.provider as SourceProvider;
  const now = new Date();

  let result;
  try {
    result = await adapters[provider].fetchPostings(source.identifier, {
      fetchJson: createFetchJson({ minIntervalMs: provider === "jobicy" ? 1100 : 0 }),
      isCandidateTitle: makeCandidateTitleFilter(prefs),
      searchPhrases: searchPhrases(prefs),
      env: { adzunaAppId: process.env.ADZUNA_APP_ID, adzunaAppKey: process.env.ADZUNA_APP_KEY },
    });
  } catch (error) {
    const code = error instanceof SourceError ? error.code : "unexpected";
    const message = error instanceof SourceError ? error.message : "unexpected error";
    await supabase
      .from("job_sources")
      .update({ last_polled_at: now.toISOString(), last_poll_status: "error", last_poll_error: message.slice(0, 300) })
      .eq("id", source.id);
    await mergeScanJson(ctx, scanId, "errors_json", source.id, { code, message });
    return { ok: false, error: message, code };
  }

  const records = result.postings
    .map((posting) => toJobRecord(posting, provider, prefs, target).record)
    .filter((r) => r !== null);

  const { data: existingRows } = await supabase
    .from("jobs")
    .select("id, external_job_id, raw_hash, provider, status, missed_polls, last_seen_at")
    .eq("tenant_id", ctx.tenantId)
    .eq("source_id", source.id);
  const existing = new Map((existingRows ?? []).map((r) => [r.external_job_id, r]));

  let created = 0;
  let updated = 0;
  let unchanged = 0;
  if (records.length > 0) {
    for (const r of records) {
      const prev = existing.get(r.external_job_id);
      if (!prev) created++;
      else if (prev.raw_hash !== r.raw_hash) updated++;
      else unchanged++;
    }
    const rows = records.map((r) => ({
      ...r,
      salary_json: asJson(r.salary_json),
      signals_json: asJson(r.signals_json),
      gate_json: asJson(r.gate_json),
      tenant_id: ctx.tenantId,
      source_id: source.id,
      last_seen_at: now.toISOString(),
      status_checked_at: now.toISOString(),
      missed_polls: 0,
    }));
    // Upsert is idempotent: a retried scan never creates a second logical job.
    const { error } = await supabase.from("jobs").upsert(rows, { onConflict: "tenant_id,provider,external_job_id" });
    if (error) {
      await mergeScanJson(ctx, scanId, "errors_json", source.id, { code: "db", message: error.code });
      return { ok: false, error: "could not store jobs", code: "db" };
    }
  }

  const seen = new Set(result.seenIds);
  let missing = 0;
  let closed = 0;
  for (const job of existingRows ?? []) {
    if (seen.has(job.external_job_id)) continue;
    const next = statusWhenMissing(job, result.complete, now);
    if (!next) continue;
    missing++;
    if (next.status === "closed") closed++;
    await supabase
      .from("jobs")
      .update({ ...next, status_checked_at: now.toISOString() })
      .eq("id", job.id);
  }

  const counts: SourceRunCounts = {
    fetched: result.seenIds.length,
    relevant: records.length,
    new: created,
    updated,
    unchanged,
    missing,
    closed,
    requests: result.requests,
    complete: result.complete,
  };
  await supabase
    .from("job_sources")
    .update({
      last_polled_at: now.toISOString(),
      last_poll_status: result.complete || !isAtsProvider(provider) ? "ok" : "partial",
      last_poll_error: null,
      last_poll_counts: asJson(counts),
    })
    .eq("id", source.id);
  await mergeScanJson(ctx, scanId, "counts_json", source.id, counts);
  return { ok: true, counts, notes: result.notes };
}

/** Dedupe across sources, refresh hard gates from current preferences, close the scan. */
export async function finishScan(ctx: AppContext, scanId: string) {
  const supabase = await dbFor(ctx);
  const prefs = await loadPreferences(ctx);

  const { data: jobs } = await supabase
    .from("jobs")
    .select(
      "id, provider, first_seen_at, dedupe_key, duplicate_of, company_name, title, location_text, country_code, workplace_type, signals_json, salary_json, gate_status, status, filtered_out_reason",
    )
    .eq("tenant_id", ctx.tenantId)
    .neq("status", "closed");

  const groups = new Map<string, NonNullable<typeof jobs>>();
  for (const job of jobs ?? []) {
    const list = groups.get(job.dedupe_key) ?? [];
    list.push(job);
    groups.set(job.dedupe_key, list);
  }
  let duplicates = 0;
  for (const group of groups.values()) {
    const primary = pickPrimary(group);
    for (const job of group) {
      const want = job.id === primary.id ? null : primary.id;
      if (want) duplicates++;
      const gate = regate(prefs, job);
      const filtered = refilterReason(prefs, job);
      if (job.duplicate_of !== want || job.gate_status !== gate.status || job.filtered_out_reason !== filtered) {
        await supabase
          .from("jobs")
          .update({
            duplicate_of: want,
            gate_status: gate.status,
            gate_json: asJson({ checks: gate.checks }),
            filtered_out_reason: filtered,
          })
          .eq("id", job.id);
      }
    }
  }

  const { data: scan } = await supabase.from("scans").select("counts_json, errors_json").eq("id", scanId).single();
  const okCount = Object.keys((scan?.counts_json as object) ?? {}).length;
  const errCount = Object.keys((scan?.errors_json as object) ?? {}).length;
  const status = errCount === 0 ? "completed" : okCount === 0 ? "failed" : "partial";
  await supabase.from("scans").update({ status, finished_at: new Date().toISOString() }).eq("id", scanId);
  await audit(ctx, "scan.finished", "scan", scanId, { status, sources_ok: okCount, sources_failed: errCount, duplicates });
  return { status, duplicates, sourcesOk: okCount, sourcesFailed: errCount };
}

// ---------------------------------------------------------------------------
// Companies and sources
// ---------------------------------------------------------------------------

export function companyKey(name: string): string {
  return normalizeEmployerName(name) || name.trim().toLowerCase();
}

export async function loadSuggestedTargets(ctx: AppContext): Promise<number> {
  const supabase = await dbFor(ctx);
  const rows = SUGGESTED_TARGETS.flatMap((group) =>
    group.companies.map((company_name) => ({
      tenant_id: ctx.tenantId,
      company_name,
      company_key: companyKey(company_name),
      sector: group.sector,
      is_multinational: "yes" as const,
      origin: "suggested_list" as const,
    })),
  );
  const { data, error } = await supabase
    .from("company_targets")
    .upsert(rows, { onConflict: "tenant_id,company_key", ignoreDuplicates: true })
    .select("id");
  if (error) throw new Error("could not load suggested targets");
  await audit(ctx, "company.added", "company_target", null, { suggested: data?.length ?? 0 });
  return data?.length ?? 0;
}

export async function verifyCompanyTarget(
  ctx: AppContext,
  targetId: string,
  careersUrl?: string,
): Promise<{ boards: BoardCandidate[]; urlNotSupported: boolean }> {
  const supabase = await dbFor(ctx);
  const { data: target } = await supabase.from("company_targets").select("id, company_name").eq("id", targetId).maybeSingle();
  if (!target) throw new Error("not found");

  const fetchJson = createFetchJson({ retries: 1, timeoutMs: 8000 });
  let boards: BoardCandidate[] = [];
  let urlNotSupported = false;
  if (careersUrl) {
    const parsed = parseCareersUrl(careersUrl);
    if (!parsed) urlNotSupported = true;
    else {
      const found = await verifyKnownBoard(parsed.provider, parsed.identifier, target.company_name, { fetchJson });
      boards = found ? [{ ...found, verified: true, detail: "door jou opgegeven vacaturepagina" }] : [];
    }
  } else {
    boards = await findBoards(target.company_name, { fetchJson });
  }

  const now = new Date().toISOString();
  for (const board of boards) {
    await supabase.from("job_sources").upsert(
      {
        tenant_id: ctx.tenantId,
        company_target_id: target.id,
        provider: board.provider,
        identifier: board.identifier,
        display_name: board.displayName,
        verification_status: board.verified ? "verified" : "failed",
        verification_detail: board.detail.slice(0, 300),
        verified_at: now,
      },
      { onConflict: "tenant_id,provider,identifier" },
    );
  }
  await supabase.from("company_targets").update({ board_checked_at: now }).eq("id", target.id);
  await audit(ctx, "source.verified", "company_target", target.id, {
    found: boards.length,
    verified: boards.filter((b) => b.verified).length,
  });
  return { boards, urlNotSupported };
}

export async function ensurePlatformSources(ctx: AppContext): Promise<void> {
  const supabase = await dbFor(ctx);
  await supabase.from("job_sources").upsert(
    [
      { tenant_id: ctx.tenantId, provider: "jobicy" as const, identifier: "europe", display_name: "Jobicy remote (Europa)", verification_status: "verified" as const, verification_detail: "officiële openbare API (bronvermelding verplicht)" },
      { tenant_id: ctx.tenantId, provider: "adzuna" as const, identifier: "nl", display_name: "Adzuna Nederland", verification_status: "verified" as const, verification_detail: "officiële API, sleutel vereist" },
    ],
    { onConflict: "tenant_id,provider,identifier", ignoreDuplicates: true },
  );
}

// ---------------------------------------------------------------------------
// Manual import
// ---------------------------------------------------------------------------

export interface ManualJobInput {
  url: string;
  title: string;
  company: string;
  location: string;
  text: string;
}

export async function importManualJob(ctx: AppContext, input: ManualJobInput): Promise<{ id: string; duplicate: boolean }> {
  const supabase = await dbFor(ctx);
  const prefs = await loadPreferences(ctx);
  const key = companyKey(input.company);
  const { data: target } = await supabase
    .from("company_targets")
    .select("id, company_name, is_multinational, sector")
    .eq("tenant_id", ctx.tenantId)
    .eq("company_key", key)
    .maybeSingle();

  const description = capDescription(input.text.trim() || null);
  const words = input.text.toLowerCase();
  const posting: RawPosting = {
    externalId: createHash("sha256").update(input.url.trim()).digest("hex").slice(0, 40),
    title: input.title.trim(),
    companyName: input.company.trim(),
    url: input.url.trim(),
    descriptionText: description.text,
    descriptionTruncated: description.truncated,
    locationText: input.location.trim() || null,
    countryCode: countryFromLocation(input.location),
    workplaceType: /\bremote\b/.test(words) && !/\bhybri/.test(words) ? "remote" : /\bhybri|thuiswerk/.test(words) ? "hybrid" : "unknown",
    employmentType: null,
    publishedAt: null,
    salary: null,
  };
  const { record } = toJobRecord(posting, "manual", prefs, companyContext(target), { force: true });
  if (!record) throw new Error("could not build record");

  const { data: existing } = await supabase
    .from("jobs")
    .select("id")
    .eq("tenant_id", ctx.tenantId)
    .eq("provider", "manual")
    .eq("external_job_id", record.external_job_id)
    .maybeSingle();

  const { data, error } = await supabase
    .from("jobs")
    .upsert(
      {
        ...record,
        salary_json: asJson(record.salary_json),
        signals_json: asJson(record.signals_json),
        gate_json: asJson(record.gate_json),
        tenant_id: ctx.tenantId,
        last_seen_at: new Date().toISOString(),
      },
      { onConflict: "tenant_id,provider,external_job_id" },
    )
    .select("id")
    .single();
  if (error || !data) throw new Error("could not store job");

  // Link to an employer-feed duplicate if one exists.
  const { data: twins } = await supabase
    .from("jobs")
    .select("id, provider, first_seen_at")
    .eq("tenant_id", ctx.tenantId)
    .eq("dedupe_key", record.dedupe_key)
    .neq("status", "closed");
  if (twins && twins.length > 1) {
    const primary = pickPrimary(twins);
    for (const t of twins) {
      await supabase.from("jobs").update({ duplicate_of: t.id === primary.id ? null : primary.id }).eq("id", t.id);
    }
  }
  await audit(ctx, "job.imported", "job", data.id, { updated: Boolean(existing) });
  return { id: data.id, duplicate: Boolean(existing) };
}

export type JobListRow = Pick<
  JobRow,
  | "id" | "provider" | "company_name" | "title" | "canonical_url" | "description_text" | "description_is_truncated"
  | "location_text" | "country_code" | "workplace_type" | "salary_json" | "signals_json" | "track_hits" | "gate_status"
  | "gate_json" | "status" | "status_reason" | "published_at" | "first_seen_at" | "last_seen_at" | "status_checked_at"
  | "user_state" | "duplicate_of" | "filtered_out_reason"
>;

/** Re-applies hard gates to all active jobs (after the user changed preferences). */
export async function regateAll(ctx: AppContext): Promise<number> {
  const supabase = await dbFor(ctx);
  const prefs = await loadPreferences(ctx);
  const { data: jobs } = await supabase
    .from("jobs")
    .select("id, provider, title, company_name, location_text, country_code, workplace_type, signals_json, salary_json, gate_status, filtered_out_reason")
    .eq("tenant_id", ctx.tenantId)
    .neq("status", "closed");
  let changed = 0;
  for (const job of jobs ?? []) {
    const gate = regate(prefs, job);
    const filtered = refilterReason(prefs, job);
    if (gate.status !== job.gate_status || filtered !== job.filtered_out_reason) {
      changed++;
      await supabase
        .from("jobs")
        .update({ gate_status: gate.status, gate_json: asJson({ checks: gate.checks }), filtered_out_reason: filtered })
        .eq("id", job.id);
    }
  }
  return changed;
}

/**
 * Daily automation: check up to `limit` not-yet-checked company targets for a
 * public ATS board (Greenhouse, SmartRecruiters, Lever, Ashby) and approve the
 * boards that pass verification, so they are scanned from then on. The user
 * can revoke any source on the Companies page.
 */
export async function verifyPendingTargets(ctx: AppContext, limit = 150): Promise<{ checked: number; found: number; approved: number }> {
  const supabase = await dbFor(ctx);
  const { data: targets } = await supabase
    .from("company_targets")
    .select("id")
    .eq("tenant_id", ctx.tenantId)
    .is("board_checked_at", null)
    .order("created_at")
    .limit(limit);
  let checked = 0;
  let found = 0;
  const ids: string[] = [];
  for (const target of targets ?? []) {
    try {
      const result = await verifyCompanyTarget(ctx, target.id);
      checked++;
      if (result.boards.some((b) => b.verified)) {
        found++;
        ids.push(target.id);
      }
    } catch {
      // Network hiccup: leave unchecked, it is retried next run.
    }
  }
  let approved = 0;
  if (ids.length) {
    const { data } = await supabase
      .from("job_sources")
      .update({ approved: true })
      .eq("tenant_id", ctx.tenantId)
      .in("company_target_id", ids)
      .eq("verification_status", "verified")
      .eq("approved", false)
      .select("id");
    approved = data?.length ?? 0;
    if (approved) await audit(ctx, "source.approved", "company_target", null, { count: approved, automatic: true });
  }
  return { checked, found, approved };
}

/** All company targets (PostgREST returns at most 1000 rows per request). */
export async function loadAllTargets(ctx: AppContext) {
  const supabase = await dbFor(ctx);
  const rows: Awaited<ReturnType<typeof fetchPage>> = [];
  async function fetchPage(from: number) {
    const { data } = await supabase
      .from("company_targets")
      .select("*")
      .eq("tenant_id", ctx.tenantId)
      .order("sector")
      .order("company_name")
      .range(from, from + 999);
    return data ?? [];
  }
  for (let from = 0; ; from += 1000) {
    const page = await fetchPage(from);
    rows.push(...page);
    if (page.length < 1000) break;
  }
  return rows;
}
