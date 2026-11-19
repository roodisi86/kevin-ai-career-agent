import "server-only";
import type { AppContext } from "@/lib/dal";
import { audit } from "@/lib/audit";
import { dbFor } from "@/lib/supabase/db";
import { asJson, type CompanySignalRow } from "@/lib/supabase/database.types";
import { fetchPageText } from "@/lib/outreach/service";
import { loadPreferences } from "@/lib/scanner/service";
import { amsterdamDate, isoWeekKey } from "@/lib/time";
import { buildSignalsPrompt, pageMentionsCompany, parseSignalOutput, verifySignals } from "./research";

export const COMPANIES_PER_REQUEST = 5;
export const WEEKLY_REQUESTS = 4; // 4 × 5 = 20 companies per week

type Target = { id: string; company_name: string; sector: string | null; website: string | null };

/**
 * Who to research: companies Kevin follows first, then companies in his
 * pipeline, then companies with strong matches; least recently checked first.
 */
export async function selectSignalTargets(ctx: AppContext, limit: number): Promise<Target[]> {
  const supabase = await dbFor(ctx);
  const [{ data: watched }, { data: apps }, { data: strong }] = await Promise.all([
    supabase
      .from("company_targets")
      .select("id, company_name, sector, website, signals_checked_at")
      .eq("tenant_id", ctx.tenantId)
      .eq("watch_signals", true)
      .order("signals_checked_at", { ascending: true, nullsFirst: true })
      .limit(200),
    supabase
      .from("applications")
      .select("company_target_id")
      .eq("tenant_id", ctx.tenantId)
      .not("company_target_id", "is", null)
      .in("stage", ["prospect", "applied", "screening", "interviewing", "final_round", "offer", "on_hold"]),
    supabase.from("job_matches").select("job_id").eq("tenant_id", ctx.tenantId).in("classification", ["top_match", "stretch"]).limit(200),
  ]);

  const extraIds = new Set<string>((apps ?? []).map((a) => a.company_target_id!).filter(Boolean));
  const jobIds = (strong ?? []).map((m) => m.job_id);
  if (jobIds.length) {
    const { data: jobs } = await supabase
      .from("jobs")
      .select("company_target_id")
      .eq("tenant_id", ctx.tenantId)
      .in("id", jobIds.slice(0, 150))
      .not("company_target_id", "is", null);
    for (const j of jobs ?? []) if (j.company_target_id) extraIds.add(j.company_target_id);
  }
  const watchedIds = new Set((watched ?? []).map((w) => w.id));
  const extraIdList = [...extraIds].filter((id) => !watchedIds.has(id));
  const { data: extra } = extraIdList.length
    ? await supabase
        .from("company_targets")
        .select("id, company_name, sector, website, signals_checked_at")
        .eq("tenant_id", ctx.tenantId)
        .in("id", extraIdList.slice(0, 150))
    : { data: [] as (Target & { signals_checked_at: string | null })[] };

  const byOldest = (a: { signals_checked_at: string | null }, b: { signals_checked_at: string | null }) =>
    (a.signals_checked_at ?? "").localeCompare(b.signals_checked_at ?? "");
  // Watched companies first, but a company checked in the last 6 days waits its turn.
  const recent = new Date(Date.now() - 6 * 86_400_000).toISOString();
  const fresh = (t: { signals_checked_at: string | null }) => !t.signals_checked_at || t.signals_checked_at < recent;
  const ordered = [...(watched ?? []).filter(fresh), ...(extra ?? []).filter(fresh).sort(byOldest)];
  return ordered.slice(0, limit).map(({ id, company_name, sector, website }) => ({ id, company_name, sector, website }));
}

export type SignalRequestResult =
  | { ok: true; status: "queued"; requests: number; companies: number }
  | { ok: true; status: "already_queued" | "nothing_to_check" }
  | { ok: false; error: "db" };

/**
 * Queues research batches (answered by the scheduled Claude task).
 * Scheduled: once per ISO week (idempotent: retries never add a second batch).
 * Manual: one extra batch of followed companies, unless one is still waiting.
 */
export async function requestSignals(ctx: AppContext, { manual = false, now = new Date() } = {}): Promise<SignalRequestResult> {
  const supabase = await dbFor(ctx);
  const week = isoWeekKey(amsterdamDate(now));
  if (manual) {
    const { count } = await supabase
      .from("signal_requests")
      .select("id", { count: "exact", head: true })
      .eq("tenant_id", ctx.tenantId)
      .eq("status", "pending")
      .like("batch_key", "manual-%");
    if ((count ?? 0) > 0) return { ok: true, status: "already_queued" };
  } else {
    const { count } = await supabase
      .from("signal_requests")
      .select("id", { count: "exact", head: true })
      .eq("tenant_id", ctx.tenantId)
      .like("batch_key", `${week}-%`);
    if ((count ?? 0) > 0) return { ok: true, status: "already_queued" };
  }

  const targets = await selectSignalTargets(ctx, manual ? COMPANIES_PER_REQUEST : COMPANIES_PER_REQUEST * WEEKLY_REQUESTS);
  if (targets.length === 0) return { ok: true, status: "nothing_to_check" };

  const prefs = await loadPreferences(ctx);
  const roleTitles = prefs.tracks.filter((t) => t.enabled).flatMap((t) => t.titles);
  const sectors = prefs.sectors.filter((s) => s.priority === "boost").map((s) => s.name);

  const groups: Target[][] = [];
  for (let i = 0; i < targets.length; i += COMPANIES_PER_REQUEST) groups.push(targets.slice(i, i + COMPANIES_PER_REQUEST));
  const stamp = now.toISOString().replace(/\D/g, "").slice(0, 12);
  const rows = groups.map((group, index) => {
    const companies = group.map((t, i) => ({ ref: `C${i + 1}`, name: t.company_name, sector: t.sector, website: t.website }));
    return {
      tenant_id: ctx.tenantId,
      batch_key: manual ? `manual-${stamp}` : `${week}-${index + 1}`,
      prompt_text: buildSignalsPrompt({ companies, roleTitles, sectors }).slice(0, 40_000),
      target_refs_json: asJson(Object.fromEntries(group.map((t, i) => [`C${i + 1}`, t.id]))),
      status: "pending" as const,
    };
  });
  const { error } = await supabase.from("signal_requests").upsert(rows, { onConflict: "tenant_id,batch_key", ignoreDuplicates: true });
  if (error) return { ok: false, error: "db" };
  await audit(ctx, "signals.requested", "signal_request", null, { requests: rows.length, companies: targets.length, manual });
  return { ok: true, status: "queued", requests: rows.length, companies: targets.length };
}

async function mapLimit<T, R>(items: T[], limit: number, fn: (item: T) => Promise<R>): Promise<R[]> {
  const out: R[] = new Array(items.length);
  let next = 0;
  await Promise.all(
    Array.from({ length: Math.min(limit, items.length) }, async () => {
      while (next < items.length) {
        const i = next++;
        out[i] = await fn(items[i]);
      }
    }),
  );
  return out;
}

/** Verifies answered batches and stores the signals that survive. */
export async function processSignalAnswers(ctx: AppContext, { now = new Date() } = {}): Promise<{ processed: number; stored: number; rejected: number }> {
  const supabase = await dbFor(ctx);
  const { data: answered } = await supabase
    .from("signal_requests")
    .select("id, output_json, target_refs_json")
    .eq("tenant_id", ctx.tenantId)
    .eq("status", "answered")
    .limit(10);
  const summary = { processed: 0, stored: 0, rejected: 0 };
  const today = amsterdamDate(now);

  for (const req of answered ?? []) {
    const parsed = parseSignalOutput(req.output_json);
    if (!parsed.ok) {
      summary.rejected++;
      await supabase
        .from("signal_requests")
        .update({ status: "rejected", error: "invalid_output", processed_at: now.toISOString() })
        .eq("id", req.id);
      continue;
    }
    const refIds = (req.target_refs_json ?? {}) as Record<string, string>;
    const ids = Object.values(refIds);
    const { data: targets } = ids.length
      ? await supabase.from("company_targets").select("id, company_name").eq("tenant_id", ctx.tenantId).in("id", ids)
      : { data: [] as { id: string; company_name: string }[] };
    const nameById = new Map((targets ?? []).map((t) => [t.id, t.company_name]));
    const refs = Object.fromEntries(
      Object.entries(refIds).flatMap(([ref, id]) => (nameById.has(id) ? [[ref, { id, name: nameById.get(id)! }]] : [])),
    );
    const verified = verifySignals(parsed.output, refs, today);

    // Fetch each cited page: it must mention the company.
    const checks = await mapLimit(verified.signals, 4, async (s) => {
      const page = await fetchPageText(s.sourceUrl);
      if (page === null) return "unverified" as const;
      return pageMentionsCompany(page, s.companyName) ? ("source_checked" as const) : ("source_mismatch" as const);
    });
    const keep = verified.signals.flatMap((s, i) => (checks[i] === "source_mismatch" ? [] : [{ s, status: checks[i] }]));
    const mismatches = checks.filter((c) => c === "source_mismatch").length;

    if (keep.length) {
      const { error } = await supabase.from("company_signals").upsert(
        keep.map(({ s, status }) => ({
          tenant_id: ctx.tenantId,
          company_target_id: s.targetId,
          request_id: req.id,
          signal_type: s.type,
          headline: s.headline,
          summary: s.summary,
          relevance: s.relevance,
          suggested_action: s.suggestedAction,
          source_url: s.sourceUrl,
          source_title: s.sourceTitle,
          published_on: s.publishedOn,
          verification_status: status,
          dedupe_key: s.dedupeKey,
        })),
        { onConflict: "tenant_id,dedupe_key", ignoreDuplicates: true },
      );
      if (error) {
        console.error(`signals insert failed: ${error.code}`);
        continue;
      }
    }
    if (verified.checkedTargetIds.length) {
      await supabase
        .from("company_targets")
        .update({ signals_checked_at: now.toISOString() })
        .eq("tenant_id", ctx.tenantId)
        .in("id", verified.checkedTargetIds);
    }
    const counts = { stored: keep.length, mismatch: mismatches, ...verified.dropped };
    await supabase
      .from("signal_requests")
      .update({ status: "processed", processed_at: now.toISOString(), result_counts: asJson(counts) })
      .eq("id", req.id);
    await audit(ctx, "signals.processed", "signal_request", req.id, counts);
    summary.processed++;
    summary.stored += keep.length;
  }
  return summary;
}

export type SignalWithCompany = CompanySignalRow & { company_name: string };

export async function loadSignals(ctx: AppContext, { includeDismissed = false } = {}): Promise<SignalWithCompany[]> {
  const supabase = await dbFor(ctx);
  let query = supabase.from("company_signals").select("*").eq("tenant_id", ctx.tenantId).order("created_at", { ascending: false }).limit(200);
  if (!includeDismissed) query = query.neq("user_state", "dismissed");
  const { data: signals } = await query;
  const ids = [...new Set((signals ?? []).map((s) => s.company_target_id))];
  const { data: targets } = ids.length
    ? await supabase.from("company_targets").select("id, company_name").eq("tenant_id", ctx.tenantId).in("id", ids)
    : { data: [] as { id: string; company_name: string }[] };
  const names = new Map((targets ?? []).map((t) => [t.id, t.company_name]));
  return (signals ?? []).map((s) => ({ ...s, company_name: names.get(s.company_target_id) ?? "—" }));
}

export async function signalQueueStatus(ctx: AppContext): Promise<{ pending: number; lastProcessedAt: string | null; watched: number }> {
  const supabase = await dbFor(ctx);
  const [{ count: pending }, { data: last }, { count: watched }] = await Promise.all([
    supabase.from("signal_requests").select("id", { count: "exact", head: true }).eq("tenant_id", ctx.tenantId).eq("status", "pending"),
    supabase
      .from("signal_requests")
      .select("processed_at")
      .eq("tenant_id", ctx.tenantId)
      .eq("status", "processed")
      .order("processed_at", { ascending: false })
      .limit(1)
      .maybeSingle(),
    supabase.from("company_targets").select("id", { count: "exact", head: true }).eq("tenant_id", ctx.tenantId).eq("watch_signals", true),
  ]);
  return { pending: pending ?? 0, lastProcessedAt: last?.processed_at ?? null, watched: watched ?? 0 };
}
