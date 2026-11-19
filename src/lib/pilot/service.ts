import "server-only";
import type { AppContext } from "@/lib/dal";
import { audit } from "@/lib/audit";
import { dbFor } from "@/lib/supabase/db";
import { asJson, type DailyDigestRow } from "@/lib/supabase/database.types";
import { SUBSCRIPTION_MODEL } from "@/lib/ai/match";
import { isRulesModel } from "@/lib/matching/rules";
import { addDays, amsterdamDate } from "@/lib/time";
import { buildDigest, digestPushText, type DigestContent, type DigestMatchCandidate } from "./digest";

const ACTIVE_STAGES = ["prospect", "applied", "screening", "interviewing", "final_round", "offer", "on_hold"] as const;
const FOLLOW_UP_DAYS = 7;

function chunks<T>(items: T[], size: number): T[][] {
  const out: T[][] = [];
  for (let i = 0; i < items.length; i += size) out.push(items.slice(i, i + size));
  return out;
}

/** Builds today's digest from current data and stores it (one row per day). */
export async function generateDigest(
  ctx: AppContext,
  { generatedBy = "scheduled" as DailyDigestRow["generated_by"], now = new Date() } = {},
): Promise<{ date: string; content: DigestContent; pushText: string }> {
  const supabase = await dbFor(ctx);
  const date = amsterdamDate(now);
  const since = new Date(now.getTime() - 24 * 3_600_000).toISOString();
  const followUpBefore = new Date(now.getTime() - FOLLOW_UP_DAYS * 86_400_000).toISOString();
  const actionHorizon = addDays(date, 2);

  const [matchRes, feedbackRes, appsRes, newJobsRes, toReview, approved, followUp, signalsRes, scanRes] = await Promise.all([
    supabase
      .from("job_matches")
      .select("job_id, score, classification, model, result_json")
      .eq("tenant_id", ctx.tenantId)
      .in("classification", ["top_match", "stretch"]),
    supabase.from("match_feedback").select("job_id, label").eq("tenant_id", ctx.tenantId),
    supabase
      .from("applications")
      .select("id, job_id, company_name, role_title, stage, next_action, next_action_due")
      .eq("tenant_id", ctx.tenantId)
      .in("stage", [...ACTIVE_STAGES]),
    supabase
      .from("jobs")
      .select("id", { count: "exact", head: true })
      .eq("tenant_id", ctx.tenantId)
      .gte("first_seen_at", since)
      .is("duplicate_of", null)
      .is("filtered_out_reason", null)
      .neq("gate_status", "fail"),
    supabase.from("outreach_drafts").select("id", { count: "exact", head: true }).eq("tenant_id", ctx.tenantId).in("state", ["draft", "reviewed"]),
    supabase.from("outreach_drafts").select("id", { count: "exact", head: true }).eq("tenant_id", ctx.tenantId).eq("state", "approved"),
    supabase
      .from("outreach_drafts")
      .select("id", { count: "exact", head: true })
      .eq("tenant_id", ctx.tenantId)
      .eq("state", "sent")
      .lt("sent_at", followUpBefore),
    supabase
      .from("company_signals")
      .select("headline, company_target_id, created_at")
      .eq("tenant_id", ctx.tenantId)
      .neq("user_state", "dismissed")
      .neq("verification_status", "source_mismatch")
      .gte("created_at", new Date(now.getTime() - 7 * 86_400_000).toISOString())
      .order("created_at", { ascending: false })
      .limit(20),
    supabase.from("scans").select("started_at, status").eq("tenant_id", ctx.tenantId).order("started_at", { ascending: false }).limit(1).maybeSingle(),
  ]);

  const matches = matchRes.data ?? [];
  const jobIds = matches.map((m) => m.job_id);
  const jobs = new Map<string, { id: string; title: string; company_name: string; canonical_url: string; status: "open" | "uncertain" | "closed"; first_seen_at: string; user_state: DigestMatchCandidate["userState"] }>();
  for (const ids of chunks(jobIds, 150)) {
    const { data } = await supabase
      .from("jobs")
      .select("id, title, company_name, canonical_url, status, first_seen_at, user_state")
      .eq("tenant_id", ctx.tenantId)
      .in("id", ids)
      .is("duplicate_of", null)
      .is("filtered_out_reason", null)
      .neq("gate_status", "fail");
    for (const j of data ?? []) jobs.set(j.id, j);
  }

  const feedback = new Map((feedbackRes.data ?? []).map((f) => [f.job_id, f.label]));
  const apps = appsRes.data ?? [];
  const inPipeline = new Set(apps.map((a) => a.job_id).filter((id): id is string => Boolean(id)));

  const candidates: DigestMatchCandidate[] = matches.flatMap((m) => {
    const job = jobs.get(m.job_id);
    if (!job) return [];
    const result = (m.result_json ?? {}) as { fitSummary?: unknown };
    return [
      {
        jobId: job.id,
        title: job.title,
        company: job.company_name,
        url: job.canonical_url,
        status: job.status,
        score: m.score,
        classification: m.classification,
        fitSummary: typeof result.fitSummary === "string" ? result.fitSummary.slice(0, 400) : null,
        source: isRulesModel(m.model) ? "rules" : m.model === SUBSCRIPTION_MODEL ? "claude" : "api",
        firstSeenAt: job.first_seen_at,
        feedback: feedback.get(job.id) ?? null,
        userState: job.user_state,
        inPipeline: inPipeline.has(job.id),
      },
    ];
  });

  // Company names for the signal headlines.
  const signalRows = signalsRes.data ?? [];
  const targetIds = [...new Set(signalRows.slice(0, 3).map((s) => s.company_target_id))];
  const { data: targets } = targetIds.length
    ? await supabase.from("company_targets").select("id, company_name").eq("tenant_id", ctx.tenantId).in("id", targetIds)
    : { data: [] as { id: string; company_name: string }[] };
  const targetName = new Map((targets ?? []).map((t) => [t.id, t.company_name]));

  const content = buildDigest({
    date,
    now: now.toISOString(),
    matches: candidates,
    newJobs: newJobsRes.count ?? 0,
    outreach: { toReview: toReview.count ?? 0, approvedNotSent: approved.count ?? 0, followUpDue: followUp.count ?? 0 },
    applications: {
      active: apps.length,
      interviewing: apps.filter((a) => a.stage === "interviewing" || a.stage === "final_round" || a.stage === "offer").length,
      actions: apps
        .filter((a) => a.next_action && a.next_action_due && a.next_action_due <= actionHorizon)
        .sort((a, b) => (a.next_action_due ?? "").localeCompare(b.next_action_due ?? ""))
        .map((a) => ({ applicationId: a.id, company: a.company_name, role: a.role_title, action: a.next_action!, due: a.next_action_due! })),
    },
    signals: {
      fresh: signalRows.length,
      headlines: signalRows.slice(0, 3).map((s) => ({ company: targetName.get(s.company_target_id) ?? "—", headline: s.headline })),
    },
    lastScan: scanRes.data ? { startedAt: scanRes.data.started_at, status: scanRes.data.status } : null,
  });
  const pushText = digestPushText(content);

  const { error } = await supabase.from("daily_digests").upsert(
    { tenant_id: ctx.tenantId, digest_date: date, content_json: asJson(content), push_text: pushText, generated_by: generatedBy },
    { onConflict: "tenant_id,digest_date" },
  );
  if (error) throw new Error(`digest upsert ${error.code}`);
  await audit(ctx, "digest.generated", "daily_digest", null, { date, top: content.top.length, by: generatedBy });
  return { date, content, pushText };
}

export async function loadLatestDigest(ctx: AppContext): Promise<DailyDigestRow | null> {
  const supabase = await dbFor(ctx);
  const { data } = await supabase
    .from("daily_digests")
    .select("*")
    .eq("tenant_id", ctx.tenantId)
    .order("digest_date", { ascending: false })
    .limit(1)
    .maybeSingle();
  return data;
}
