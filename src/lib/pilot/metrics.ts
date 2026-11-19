import "server-only";
import type { AppContext } from "@/lib/dal";
import { dbFor } from "@/lib/supabase/db";
import { SUBSCRIPTION_MODEL } from "@/lib/ai/match";
import { RULES_VERSION } from "@/lib/matching/rules";
import { isApiMatchingEnabled } from "@/lib/env";
import { amsterdamDate, daysBetween } from "@/lib/time";

export const PILOT_DAYS = 30;
const CONVERSATION_STAGES = new Set(["screening", "interviewing", "final_round", "offer", "accepted"]);
const OFFER_STAGES = new Set(["offer", "accepted"]);

/** Distinct Amsterdam calendar days with a successful scheduled scan. */
export function successfulRunDays(scans: { started_at: string; status: string }[]): Set<string> {
  return new Set(scans.filter((s) => s.status === "completed" || s.status === "partial").map((s) => amsterdamDate(new Date(s.started_at))));
}

/** Applications that ever reached a stage in `stages` (current stage or history). */
export function reachedStage(
  apps: { id: string; stage: string }[],
  events: { application_id: string; metadata_json: unknown }[],
  stages: Set<string>,
): number {
  const ids = new Set(apps.filter((a) => stages.has(a.stage)).map((a) => a.id));
  for (const e of events) {
    const meta = (e.metadata_json ?? {}) as { to?: string; stage?: string };
    if ((meta.to && stages.has(meta.to)) || (meta.stage && stages.has(meta.stage))) ids.add(e.application_id);
  }
  return ids.size;
}

export interface PilotMetrics {
  start: string | null;
  day: number | null;
  daysElapsed: number;
  runDays: number;
  lastScheduled: { startedAt: string; status: string } | null;
  sourceErrors: number;
  queues: { match: number; outreach: number; signals: number };
  digests: number;
  quality: { good: number; total: number; falsePositives: number };
  funnel: {
    relevant: number;
    strong: number;
    dossiers: number;
    approved: number;
    sent: number;
    replied: number;
    applications: number;
    conversations: number;
    offers: number;
  };
  costs: { apiEnabled: boolean; apiAssessments: number };
}

export async function loadPilotMetrics(ctx: AppContext, now = new Date()): Promise<PilotMetrics> {
  const supabase = await dbFor(ctx);
  const t = ctx.tenantId;
  const since30 = new Date(now.getTime() - PILOT_DAYS * 86_400_000).toISOString();
  const count = (r: { count: number | null }) => r.count ?? 0;

  const [
    firstDigest,
    digests,
    scans,
    sourceErrors,
    matchQueue,
    outreachQueue,
    signalQueue,
    strongMatches,
    feedback,
    relevant,
    dossiers,
    approved,
    sent,
    repliedEvents,
    apps,
    appEvents,
    apiAssessments,
  ] = await Promise.all([
    supabase.from("daily_digests").select("digest_date").eq("tenant_id", t).order("digest_date", { ascending: true }).limit(1).maybeSingle(),
    supabase.from("daily_digests").select("id", { count: "exact", head: true }).eq("tenant_id", t),
    supabase.from("scans").select("started_at, status").eq("tenant_id", t).eq("trigger", "scheduled").gte("started_at", since30).order("started_at", { ascending: false }),
    supabase.from("job_sources").select("id", { count: "exact", head: true }).eq("tenant_id", t).eq("approved", true).eq("last_poll_status", "error"),
    supabase.from("ai_match_requests").select("id", { count: "exact", head: true }).eq("tenant_id", t).eq("status", "pending"),
    supabase.from("outreach_requests").select("id", { count: "exact", head: true }).eq("tenant_id", t).eq("status", "pending"),
    supabase.from("signal_requests").select("id", { count: "exact", head: true }).eq("tenant_id", t).eq("status", "pending"),
    supabase.from("job_matches").select("job_id").eq("tenant_id", t).in("classification", ["top_match", "stretch"]),
    supabase.from("match_feedback").select("job_id, label").eq("tenant_id", t),
    supabase
      .from("jobs")
      .select("id", { count: "exact", head: true })
      .eq("tenant_id", t)
      .is("duplicate_of", null)
      .is("filtered_out_reason", null)
      .neq("gate_status", "fail"),
    supabase.from("outreach_requests").select("id", { count: "exact", head: true }).eq("tenant_id", t).eq("status", "processed"),
    supabase.from("outreach_drafts").select("id", { count: "exact", head: true }).eq("tenant_id", t).in("state", ["approved", "sent", "replied", "no_reply", "closed"]),
    supabase.from("outreach_drafts").select("id", { count: "exact", head: true }).eq("tenant_id", t).in("state", ["sent", "replied", "no_reply", "closed"]),
    supabase.from("outreach_events").select("outreach_draft_id").eq("tenant_id", t).eq("event_type", "state_replied"),
    supabase.from("applications").select("id, stage").eq("tenant_id", t),
    supabase.from("application_events").select("application_id, metadata_json").eq("tenant_id", t).limit(5000),
    supabase
      .from("job_matches")
      .select("id", { count: "exact", head: true })
      .eq("tenant_id", t)
      .gte("scored_at", since30)
      .not("model", "in", `(${RULES_VERSION},${SUBSCRIPTION_MODEL})`),
  ]);

  const today = amsterdamDate(now);
  const start = firstDigest.data?.digest_date ?? null;
  const elapsed = start ? Math.min(PILOT_DAYS, daysBetween(start, today) + 1) : 0;
  const scanRows = scans.data ?? [];
  const runDays = start ? [...successfulRunDays(scanRows)].filter((d) => d >= start).length : 0;

  const strong = new Set((strongMatches.data ?? []).map((m) => m.job_id));
  const rated = (feedback.data ?? []).filter((f) => strong.has(f.job_id));
  const appRows = apps.data ?? [];
  const events = appEvents.data ?? [];

  return {
    start,
    day: start ? elapsed : null,
    daysElapsed: elapsed,
    runDays: Math.min(runDays, elapsed),
    lastScheduled: scanRows[0] ? { startedAt: scanRows[0].started_at, status: scanRows[0].status } : null,
    sourceErrors: count(sourceErrors),
    queues: { match: count(matchQueue), outreach: count(outreachQueue), signals: count(signalQueue) },
    digests: count(digests),
    quality: {
      good: rated.filter((f) => f.label === "good").length,
      total: rated.length,
      falsePositives: rated.filter((f) => f.label === "bad").length,
    },
    funnel: {
      relevant: count(relevant),
      strong: strong.size,
      dossiers: count(dossiers),
      approved: count(approved),
      sent: count(sent),
      replied: new Set((repliedEvents.data ?? []).map((e) => e.outreach_draft_id)).size,
      applications: appRows.length,
      conversations: reachedStage(appRows, events, CONVERSATION_STAGES) + new Set((repliedEvents.data ?? []).map((e) => e.outreach_draft_id)).size,
      offers: reachedStage(appRows, events, OFFER_STAGES),
    },
    costs: { apiEnabled: isApiMatchingEnabled(), apiAssessments: count(apiAssessments) },
  };
}
