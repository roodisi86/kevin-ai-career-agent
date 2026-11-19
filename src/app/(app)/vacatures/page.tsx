import Link from "next/link";
import { getAppContext } from "@/lib/dal";
import { getDictionary } from "@/lib/i18n";
import { createSupabaseServerClient } from "@/lib/supabase/server";
import { SOURCE_LABELS, type JobListRow } from "@/lib/scanner/service";
import { trackIds, type TrackId } from "@/lib/preferences/schema";
import { formatDateTime } from "@/lib/time";
import { getServerEnv, isApiMatchingEnabled } from "@/lib/env";
import { pendingMatchJobIds, refreshMatches } from "@/lib/matching/service";
import { SUBSCRIPTION_MODEL, type MatchResult } from "@/lib/ai/match";
import { RULES_VERSION } from "@/lib/matching/rules";
import type { JobMatchRow, MatchFeedbackRow } from "@/lib/supabase/database.types";
import { setJobState } from "./actions";
import { startResearch } from "../reverse-recruiter/actions";
import { addJobToPipeline } from "../sollicitaties/actions";
import { ImportForm, ScanPanel } from "./components";
import { FeedbackControl, MatchPanel } from "./match-components";

const t = getDictionary();

type SearchParams = Promise<Record<string, string | string[] | undefined>>;

const one = (v: string | string[] | undefined) => (Array.isArray(v) ? v[0] : v) ?? "";

const GATE_STYLE = {
  pass: "bg-teal-100 text-teal-700",
  review_required: "bg-amber-100 text-amber-800",
  fail: "bg-rose-100 text-rose-800",
} as const;

const STATUS_STYLE = {
  open: "bg-teal-100 text-teal-700",
  uncertain: "bg-amber-100 text-amber-800",
  closed: "bg-sand-200 text-navy-600",
} as const;

function formatSalary(salary: Record<string, unknown>): string | null {
  const min = typeof salary.min === "number" ? salary.min : null;
  const max = typeof salary.max === "number" ? salary.max : null;
  if (!min && !max) return null;
  const fmt = (n: number) => new Intl.NumberFormat("nl-NL").format(n);
  const interval = salary.interval === "year" ? " per jaar" : salary.interval === "month" ? " per maand" : "";
  const range = min && max && min !== max ? `${fmt(min)} – ${fmt(max)}` : fmt((max ?? min)!);
  return `${String(salary.currency ?? "")} ${range}${interval}${salary.source === "text" ? " (uit tekst)" : ""}`.trim();
}

type MatchView = Pick<JobMatchRow, "job_id" | "score" | "classification" | "limited_evidence" | "result_json" | "scored_at" | "model">;
type FeedbackView = Pick<MatchFeedbackRow, "job_id" | "label" | "reasons" | "note">;

const CLASS_STYLE = {
  top_match: "bg-teal-600 text-white",
  stretch: "bg-teal-100 text-teal-700",
  research_needed: "bg-amber-100 text-amber-800",
  reject: "bg-sand-200 text-navy-600",
} as const;

function List({ title, items }: { title: string; items: string[] }) {
  if (items.length === 0) return null;
  return (
    <div>
      <p className="font-medium">{title}</p>
      <ul className="ml-5 list-disc text-navy-800">
        {items.map((item, i) => (
          <li key={i}>{item}</li>
        ))}
      </ul>
    </div>
  );
}

function MatchBlock({ match, feedback, jobId }: { match: MatchView | undefined; feedback: FeedbackView | undefined; jobId: string }) {
  const mt = t.jobs.match;
  if (!match) {
    return <p className="text-sm text-navy-600">{mt.notScored}</p>;
  }
  const r = match.result_json as unknown as MatchResult & { feedbackAdjustment?: number };
  const feedbackAdjustment = r.feedbackAdjustment ?? 0;
  const removed = r.dropped ? r.dropped.quotes + r.dropped.claims + r.dropped.texts : 0;
  return (
    <div className="space-y-3 rounded-lg bg-sand-50 p-3" data-testid="match">
      <div className="flex flex-wrap items-center gap-3">
        <span className="text-2xl font-semibold" aria-label={`${mt.scoreLabel}: ${match.score}`}>
          {match.score}
          <span className="text-sm font-normal text-navy-600">/100</span>
        </span>
        <span className={`badge ${CLASS_STYLE[match.classification]}`}>{mt.classification[match.classification]}</span>
        <span className="badge bg-sand-200 text-navy-800" data-testid="match-source">
          {match.model === RULES_VERSION ? mt.sourceRules : match.model === SUBSCRIPTION_MODEL ? mt.sourceSubscription : mt.sourceApi}
        </span>
        {match.limited_evidence && <span className="badge bg-amber-100 text-amber-800">{mt.limited}</span>}
        {feedback && <span className="badge bg-navy-800 text-white">{mt.feedbackGiven[feedback.label]}</span>}
        {feedbackAdjustment !== 0 && <span className="text-xs text-navy-600">{mt.feedbackAdjusted(feedbackAdjustment)}</span>}
      </div>
      {r.fitSummary && <p className="text-sm text-navy-800">{r.fitSummary}</p>}
      <details>
        <summary className="cursor-pointer text-sm font-medium">{mt.details}</summary>
        <div className="mt-3 space-y-4 text-sm">
          <table className="w-full text-left">
            <tbody>
              {r.dimensions.map((d) => (
                <tr key={d.key} className="border-t border-sand-200 align-top">
                  <th scope="row" className="py-2 pr-3 font-medium">
                    {mt.dimensions[d.key]}
                    <span className="block text-xs font-normal text-navy-600">{mt.weight(d.weight)}</span>
                  </th>
                  <td className="py-2 pr-3 whitespace-nowrap">
                    <span aria-label={`${d.rating} van 5`}>{"●".repeat(d.rating)}{"○".repeat(5 - d.rating)}</span>
                    {d.modelRating !== undefined && <span className="block text-xs text-amber-800">{mt.lowered(d.modelRating)}</span>}
                  </td>
                  <td className="py-2">
                    {d.note && <p>{d.note}</p>}
                    {d.jobQuotes.length > 0 && (
                      <p className="text-xs text-navy-600">
                        {mt.fromJob}: {d.jobQuotes.map((q) => `“${q}”`).join(" · ")}
                      </p>
                    )}
                    {d.facts.length > 0 && (
                      <p className="text-xs text-navy-600">
                        {mt.fromProfile}: {d.facts.map((f) => f.statement).join(" · ")}
                      </p>
                    )}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
          {r.confirmedFit.length > 0 && (
            <div>
              <p className="font-medium">{mt.confirmedFit}</p>
              <ul className="ml-5 list-disc">
                {r.confirmedFit.map((c, i) => (
                  <li key={i}>
                    {c.claim} <span className="text-xs text-navy-600">({c.facts.map((f) => f.statement).join("; ")})</span>
                  </li>
                ))}
              </ul>
            </div>
          )}
          {r.transferable.length > 0 && (
            <div>
              <p className="font-medium">{mt.transferable}</p>
              <ul className="ml-5 list-disc">
                {r.transferable.map((c, i) => (
                  <li key={i}>
                    {c.claim} <span className="text-xs text-navy-600">({c.facts.map((f) => f.statement).join("; ")})</span>
                  </li>
                ))}
              </ul>
            </div>
          )}
          <List title={mt.gaps} items={r.gaps} />
          <List title={mt.unknowns} items={r.unknowns} />
          <List title={mt.recruiterDoubts} items={r.recruiterDoubts} />
          {r.pitchAngle && (
            <div>
              <p className="font-medium">{mt.pitchAngle}</p>
              <p className="text-navy-800">{r.pitchAngle}</p>
            </div>
          )}
          <p className="text-xs text-navy-600">
            {removed > 0 && `${mt.removed(removed)} `}
            {mt.scoredAt}: {formatDateTime(match.scored_at)} · {mt.disclaimer}
          </p>
        </div>
      </details>
      {(match.classification === "top_match" || match.classification === "stretch") && (
        <form action={startResearch}>
          <input type="hidden" name="jobId" value={jobId} />
          <button type="submit" className="btn-teal">{t.outreach.start}</button>
        </form>
      )}
      <FeedbackControl
        jobId={jobId}
        current={feedback ? { label: feedback.label, reasons: feedback.reasons, note: feedback.note } : null}
      />
    </div>
  );
}

function JobCard({
  job,
  duplicates,
  match,
  feedback,
  inPipeline,
}: {
  job: JobListRow;
  duplicates: JobListRow[];
  match: MatchView | undefined;
  feedback: FeedbackView | undefined;
  inPipeline: boolean;
}) {
  const signals = (job.signals_json ?? {}) as Record<string, { value?: string; evidence?: string } | unknown>;
  const checks = (((job.gate_json ?? {}) as { checks?: { key: string; mode: string; outcome: string; detail?: string }[] }).checks ?? []).filter(
    (c) => c.mode === "hard" && c.outcome !== "not_applicable",
  );
  const salary = formatSalary((job.salary_json ?? {}) as Record<string, unknown>);
  const relevance = Array.isArray((signals as { relevance?: unknown }).relevance) ? ((signals as { relevance: string[] }).relevance) : [];
  const states = ["interesting", "later", "not_relevant"] as const;

  return (
    <li id={`job-${job.id}`} className="card space-y-3" data-testid="job">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <h3 className="text-lg font-semibold">{job.title}</h3>
          <p className="text-sm text-navy-800">
            {job.company_name} · {t.jobs.card.location}: {job.location_text ?? t.common.unknown} ·{" "}
            {t.jobs.card.workplace[job.workplace_type]}
          </p>
        </div>
        <div className="flex flex-wrap items-center gap-2">
          {inPipeline ? (
            <Link href="/sollicitaties" className="badge bg-teal-100 text-teal-700">{t.applications.inPipeline}</Link>
          ) : (
            <form action={addJobToPipeline}>
              <input type="hidden" name="jobId" value={job.id} />
              <button type="submit" className="btn-secondary">{t.applications.fromJob}</button>
            </form>
          )}
          <a href={job.canonical_url} target="_blank" rel="noopener noreferrer nofollow" className="btn-primary">
            {t.jobs.card.openOriginal} ↗
          </a>
        </div>
      </div>

      <MatchBlock match={match} feedback={feedback} jobId={job.id} />

      {job.filtered_out_reason && (
        <p className="text-xs text-rose-800">
          {t.jobs.filters.filteredReason}: {job.filtered_out_reason}
        </p>
      )}

      <div className="flex flex-wrap gap-2 text-xs">
        <span className={`badge ${STATUS_STYLE[job.status]}`}>
          {t.jobs.card.status[job.status]}
          {job.status_reason && t.jobs.card.statusReason[job.status_reason] ? ` — ${t.jobs.card.statusReason[job.status_reason]}` : ""}
        </span>
        {job.gate_status && <span className={`badge ${GATE_STYLE[job.gate_status]}`}>{t.jobs.card.gate[job.gate_status]}</span>}
        {job.description_is_truncated && <span className="badge bg-amber-100 text-amber-800">{t.jobs.card.limitedEvidence}</span>}
        {job.track_hits.map((track) => (
          <span key={track} className="badge bg-sand-200 text-navy-800">
            {t.preferences.tracks[track as TrackId] ?? track}
          </span>
        ))}
        {job.user_state !== "new" && <span className="badge bg-navy-800 text-white">{t.jobs.card.states[job.user_state]}</span>}
      </div>

      <p className="text-xs text-navy-600">
        {t.jobs.card.source}: {SOURCE_LABELS[job.provider]}
        {job.provider === "jobicy" && ` · ${t.jobs.card.attributionJobicy}`}
        {job.provider === "adzuna" && (
          <>
            {" · "}
            <a href="https://www.adzuna.nl" target="_blank" rel="noopener noreferrer" className="underline">Jobs</a> by Adzuna
          </>
        )}
        {" · "}
        {t.jobs.card.lastChecked}: {formatDateTime(job.status_checked_at)} · {t.jobs.card.firstSeen}: {formatDateTime(job.first_seen_at)}
        {job.published_at ? ` · ${t.jobs.card.published}: ${formatDateTime(job.published_at)}` : ""}
      </p>

      <dl className="grid gap-2 text-sm md:grid-cols-2">
        <div>
          <dt className="font-medium">{t.jobs.card.salary}</dt>
          <dd className="text-navy-600">{salary ?? t.jobs.card.salaryUnknown}</dd>
        </div>
        {(["companyCar", "dutchContract", "remoteHybrid", "multinational"] as const).map((key) => {
          const s = signals[key] as { value?: "yes" | "no" | "unknown"; evidence?: string } | undefined;
          const value = s?.value ?? "unknown";
          return (
            <div key={key}>
              <dt className="font-medium">{t.jobs.card.signalLabels[key]}</dt>
              <dd className={value === "unknown" ? "text-navy-600" : value === "yes" ? "text-teal-700" : "text-rose-800"}>
                {t.jobs.card.values[value]}
                {s?.evidence ? <span className="block text-xs text-navy-600">“{s.evidence}”</span> : null}
              </dd>
            </div>
          );
        })}
      </dl>

      {checks.length > 0 && (
        <div className="text-sm">
          <p className="font-medium">{t.jobs.card.checks}</p>
          <ul className="flex flex-wrap gap-2">
            {checks.map((c) => (
              <li key={c.key} className="badge bg-sand-100 text-navy-800">
                {t.jobs.card.checkKey[c.key] ?? c.key}: {t.jobs.card.checkOutcome[c.outcome] ?? c.outcome}
                {c.detail ? ` (${c.detail})` : ""}
              </li>
            ))}
          </ul>
        </div>
      )}

      {relevance.length > 0 && (
        <p className="text-xs text-navy-600">
          {t.jobs.card.whyShown}: {relevance.join(" · ")}
        </p>
      )}

      {duplicates.length > 0 && (
        <p className="text-xs text-navy-600">
          {t.jobs.card.duplicates}:{" "}
          {duplicates.map((d, i) => (
            <span key={d.id}>
              {i > 0 && ", "}
              <a href={d.canonical_url} target="_blank" rel="noopener noreferrer nofollow" className="underline">
                {SOURCE_LABELS[d.provider]}
              </a>
            </span>
          ))}
        </p>
      )}

      {job.description_text && (
        <details className="rounded-lg bg-sand-100 p-3">
          <summary className="cursor-pointer text-sm font-medium">{t.jobs.card.description}</summary>
          <p className="mt-2 max-h-96 overflow-auto whitespace-pre-wrap text-sm text-navy-800">{job.description_text}</p>
        </details>
      )}

      <div className="flex flex-wrap gap-2">
        {states.map((state) => (
          <form key={state} action={setJobState}>
            <input type="hidden" name="id" value={job.id} />
            <input type="hidden" name="state" value={job.user_state === state ? "new" : state} />
            <button type="submit" className={job.user_state === state ? "btn-primary" : "btn-secondary"} aria-pressed={job.user_state === state}>
              {t.jobs.card.states[state]}
            </button>
          </form>
        ))}
      </div>
    </li>
  );
}

export default async function JobsPage({ searchParams }: { searchParams: SearchParams }) {
  const ctx = await getAppContext();
  const params = await searchParams;
  const status = one(params.status) || "active";
  const gate = one(params.gate) || "visible";
  const track = one(params.track);
  const state = one(params.state);
  const q = one(params.q).slice(0, 100);
  const viewParam = one(params.view);

  // Process answers from the Claude task and score any new jobs before listing.
  const refresh = await refreshMatches(ctx);
  const supabase = await createSupabaseServerClient();
  let query = supabase
    .from("jobs")
    .select(
      "id, provider, company_name, title, canonical_url, description_text, description_is_truncated, location_text, country_code, workplace_type, salary_json, signals_json, track_hits, gate_status, gate_json, status, status_reason, published_at, first_seen_at, last_seen_at, status_checked_at, user_state, duplicate_of, filtered_out_reason",
    )
    .eq("tenant_id", ctx.tenantId)
    .order("first_seen_at", { ascending: false })
    .limit(300);
  if (status === "active") query = query.neq("status", "closed");
  if (status === "closed") query = query.eq("status", "closed");
  if (gate === "visible") query = query.neq("gate_status", "fail");
  if (["pass", "review_required", "fail"].includes(gate)) query = query.eq("gate_status", gate as "pass");
  if ((trackIds as readonly string[]).includes(track)) query = query.contains("track_hits", [track]);
  if (["new", "interesting", "later", "not_relevant"].includes(state)) query = query.eq("user_state", state as "new");
  else query = query.neq("user_state", "not_relevant");
  if (viewParam === "filtered") query = query.not("filtered_out_reason", "is", null);
  else if (viewParam !== "all") query = query.is("filtered_out_reason", null);

  const [
    { data: rows },
    { data: lastScan },
    { count: approvedSources },
    { data: matchRows },
    { data: feedbackRows },
    { data: assessment },
    pendingInfo,
    { data: lastScheduled },
    { data: pipelineRows },
  ] = await Promise.all([
      query,
      supabase.from("scans").select("*").eq("tenant_id", ctx.tenantId).order("started_at", { ascending: false }).limit(1).maybeSingle(),
      supabase.from("job_sources").select("id", { count: "exact", head: true }).eq("tenant_id", ctx.tenantId).eq("approved", true),
      supabase
        .from("job_matches")
        .select("job_id, score, classification, limited_evidence, result_json, scored_at, model")
        .eq("tenant_id", ctx.tenantId),
      supabase.from("match_feedback").select("job_id, label, reasons, note").eq("tenant_id", ctx.tenantId),
      supabase.from("candidate_assessments").select("completed_at").eq("candidate_id", ctx.candidateId).maybeSingle(),
      pendingMatchJobIds(ctx),
      supabase
        .from("scans")
        .select("started_at")
        .eq("tenant_id", ctx.tenantId)
        .eq("trigger", "scheduled")
        .order("started_at", { ascending: false })
        .limit(1)
        .maybeSingle(),
      supabase.from("applications").select("job_id").eq("tenant_id", ctx.tenantId).not("job_id", "is", null),
    ]);

  const inPipeline = new Set((pipelineRows ?? []).map((r) => r.job_id));
  const matches = new Map((matchRows ?? []).map((row) => [row.job_id, row as MatchView]));
  const feedbackByJob = new Map((feedbackRows ?? []).map((row) => [row.job_id, row as FeedbackView]));
  // Default: recommended when there are assessments, otherwise everything.
  const view = viewParam || (matches.size > 0 ? "recommended" : "all");

  const all = (rows ?? []) as JobListRow[];
  const needle = q.toLowerCase();
  const filtered = needle
    ? all.filter((j) => j.title.toLowerCase().includes(needle) || j.company_name.toLowerCase().includes(needle))
    : all;
  const inView = (j: JobListRow) => {
    const match = matches.get(j.id);
    // Recommended = not rejected, plus anything the user chose or marked themselves.
    if (view === "recommended") {
      return Boolean(match && match.classification !== "reject") || j.provider === "manual" || j.user_state === "interesting" || j.user_state === "later";
    }
    if (view === "unscored") return !match;
    if (view === "rejected") return match?.classification === "reject";
    return true;
  };
  const primaries = filtered
    .filter((j) => !j.duplicate_of && inView(j))
    .sort((a, b) => (matches.get(b.id)?.score ?? -1) - (matches.get(a.id)?.score ?? -1));
  const dupesOf = new Map<string, JobListRow[]>();
  for (const j of all) if (j.duplicate_of) dupesOf.set(j.duplicate_of, [...(dupesOf.get(j.duplicate_of) ?? []), j]);

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-2xl font-semibold">{t.jobs.title}</h1>
        <p className="max-w-3xl text-sm text-navy-600">{t.jobs.intro}</p>
      </div>

      <section aria-labelledby="ai-match" className="card space-y-2">
        <h2 id="ai-match" className="font-semibold">{t.jobs.match.panelTitle}</h2>
        <MatchPanel
          pending={pendingInfo.pending.length}
          total={pendingInfo.total}
          aiConfigured={isApiMatchingEnabled()}
          cap={getServerEnv().AI_DAILY_MATCH_CAP}
          hasAssessment={Boolean(assessment?.completed_at)}
          queued={refresh.pendingInQueue}
        />
      </section>

      <div className="grid gap-6 lg:grid-cols-2">
        <section aria-labelledby="scan" className="card space-y-3">
          <h2 id="scan" className="font-semibold">{t.jobs.scan.title}</h2>
          <p className="text-sm text-navy-600">
            {t.jobs.scan.last}:{" "}
            {lastScan
              ? `${formatDateTime(lastScan.started_at)} · ${t.jobs.scan.status[lastScan.status]}${lastScan.trigger === "scheduled" ? ` · ${t.jobs.scan.triggerScheduled}` : ""}`
              : t.jobs.scan.never}
          </p>
          <ScanPanel hasSources={(approvedSources ?? 0) > 0} aiConfigured={isApiMatchingEnabled()} />
          <p className="text-sm text-navy-600" data-testid="scheduled-status">
            {lastScheduled ? t.jobs.scan.scheduledActive(formatDateTime(lastScheduled.started_at)) : t.jobs.scan.scheduledInactive}
          </p>
          <p className="help">{t.jobs.scan.scheduledNote}</p>
        </section>

        <section aria-labelledby="import" className="card">
          <details>
            <summary id="import" className="cursor-pointer font-semibold">{t.jobs.import.title}</summary>
            <div className="mt-3">
              <ImportForm />
            </div>
          </details>
        </section>
      </div>

      <form className="card grid gap-3 md:grid-cols-6 md:items-end" aria-label={t.jobs.filters.title}>
        <div>
          <label htmlFor="f-view" className="label">{t.jobs.filters.view}</label>
          <select id="f-view" name="view" defaultValue={view} className="input">
            <option value="recommended">{t.jobs.filters.viewRecommended}</option>
            <option value="unscored">{t.jobs.filters.viewUnscored}</option>
            <option value="rejected">{t.jobs.filters.viewRejected}</option>
            <option value="filtered">{t.jobs.filters.viewFiltered}</option>
            <option value="all">{t.jobs.filters.viewAll}</option>
          </select>
        </div>
        <div>
          <label htmlFor="f-status" className="label">{t.jobs.filters.status}</label>
          <select id="f-status" name="status" defaultValue={status} className="input">
            <option value="active">{t.jobs.filters.statusActive}</option>
            <option value="all">{t.jobs.filters.statusAll}</option>
            <option value="closed">{t.jobs.filters.statusClosed}</option>
          </select>
        </div>
        <div>
          <label htmlFor="f-gate" className="label">{t.jobs.filters.gate}</label>
          <select id="f-gate" name="gate" defaultValue={gate} className="input">
            <option value="visible">{t.jobs.filters.gatePass} + {t.jobs.filters.gateReview}</option>
            <option value="pass">{t.jobs.filters.gatePass}</option>
            <option value="review_required">{t.jobs.filters.gateReview}</option>
            <option value="fail">{t.jobs.filters.gateFail}</option>
            <option value="all">{t.jobs.filters.gateAll}</option>
          </select>
        </div>
        <div>
          <label htmlFor="f-track" className="label">{t.jobs.filters.track}</label>
          <select id="f-track" name="track" defaultValue={track} className="input">
            <option value="">{t.jobs.filters.trackAll}</option>
            {trackIds.map((id) => (
              <option key={id} value={id}>{t.preferences.tracks[id]}</option>
            ))}
          </select>
        </div>
        <div>
          <label htmlFor="f-state" className="label">{t.jobs.filters.state}</label>
          <select id="f-state" name="state" defaultValue={state} className="input">
            <option value="">{t.jobs.filters.stateAll}</option>
            <option value="new">Nieuw</option>
            <option value="interesting">{t.jobs.card.states.interesting}</option>
            <option value="later">{t.jobs.card.states.later}</option>
            <option value="not_relevant">{t.jobs.card.states.not_relevant}</option>
          </select>
        </div>
        <div>
          <label htmlFor="f-q" className="label">{t.jobs.filters.search}</label>
          <input id="f-q" name="q" defaultValue={q} className="input" />
        </div>
        <div className="md:col-span-6 flex items-center gap-3">
          <button type="submit" className="btn-secondary">{t.jobs.filters.apply}</button>
          <span className="text-sm text-navy-600">{t.jobs.filters.count(primaries.length)}</span>
        </div>
      </form>

      {primaries.length === 0 ? (
        <p className="text-sm text-navy-600">{all.length === 0 && !q ? t.jobs.empty : t.jobs.emptyFiltered}</p>
      ) : (
        <ul className="space-y-4">
          {primaries.map((job) => (
            <JobCard
              key={job.id}
              job={job}
              duplicates={dupesOf.get(job.id) ?? []}
              match={matches.get(job.id)}
              feedback={feedbackByJob.get(job.id)}
              inPipeline={inPipeline.has(job.id)}
            />
          ))}
        </ul>
      )}
    </div>
  );
}
