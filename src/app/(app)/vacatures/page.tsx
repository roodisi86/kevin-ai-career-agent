import { getAppContext } from "@/lib/dal";
import { getDictionary } from "@/lib/i18n";
import { createSupabaseServerClient } from "@/lib/supabase/server";
import { SOURCE_LABELS, type JobListRow } from "@/lib/scanner/service";
import { trackIds, type TrackId } from "@/lib/preferences/schema";
import { formatDateTime } from "@/lib/time";
import { setJobState } from "./actions";
import { ImportForm, ScanPanel } from "./components";

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

function JobCard({ job, duplicates }: { job: JobListRow; duplicates: JobListRow[] }) {
  const signals = (job.signals_json ?? {}) as Record<string, { value?: string; evidence?: string } | unknown>;
  const checks = (((job.gate_json ?? {}) as { checks?: { key: string; mode: string; outcome: string; detail?: string }[] }).checks ?? []).filter(
    (c) => c.mode === "hard" && c.outcome !== "not_applicable",
  );
  const salary = formatSalary((job.salary_json ?? {}) as Record<string, unknown>);
  const relevance = Array.isArray((signals as { relevance?: unknown }).relevance) ? ((signals as { relevance: string[] }).relevance) : [];
  const states = ["interesting", "later", "not_relevant"] as const;

  return (
    <li className="card space-y-3" data-testid="job">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <h3 className="text-lg font-semibold">{job.title}</h3>
          <p className="text-sm text-navy-800">
            {job.company_name} · {t.jobs.card.location}: {job.location_text ?? t.common.unknown} ·{" "}
            {t.jobs.card.workplace[job.workplace_type]}
          </p>
        </div>
        <a href={job.canonical_url} target="_blank" rel="noopener noreferrer nofollow" className="btn-primary">
          {t.jobs.card.openOriginal} ↗
        </a>
      </div>

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

  const supabase = await createSupabaseServerClient();
  let query = supabase
    .from("jobs")
    .select(
      "id, provider, company_name, title, canonical_url, description_text, description_is_truncated, location_text, country_code, workplace_type, salary_json, signals_json, track_hits, gate_status, gate_json, status, status_reason, published_at, first_seen_at, last_seen_at, status_checked_at, user_state, duplicate_of",
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

  const [{ data: rows }, { data: lastScan }, { count: approvedSources }] = await Promise.all([
    query,
    supabase.from("scans").select("*").eq("tenant_id", ctx.tenantId).order("started_at", { ascending: false }).limit(1).maybeSingle(),
    supabase.from("job_sources").select("id", { count: "exact", head: true }).eq("tenant_id", ctx.tenantId).eq("approved", true),
  ]);

  const all = (rows ?? []) as JobListRow[];
  const needle = q.toLowerCase();
  const filtered = needle
    ? all.filter((j) => j.title.toLowerCase().includes(needle) || j.company_name.toLowerCase().includes(needle))
    : all;
  const primaries = filtered.filter((j) => !j.duplicate_of);
  const dupesOf = new Map<string, JobListRow[]>();
  for (const j of all) if (j.duplicate_of) dupesOf.set(j.duplicate_of, [...(dupesOf.get(j.duplicate_of) ?? []), j]);

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-2xl font-semibold">{t.jobs.title}</h1>
        <p className="max-w-3xl text-sm text-navy-600">{t.jobs.intro}</p>
      </div>

      <div className="grid gap-6 lg:grid-cols-2">
        <section aria-labelledby="scan" className="card space-y-3">
          <h2 id="scan" className="font-semibold">{t.jobs.scan.title}</h2>
          <p className="text-sm text-navy-600">
            {t.jobs.scan.last}:{" "}
            {lastScan
              ? `${formatDateTime(lastScan.started_at)} · ${t.jobs.scan.status[lastScan.status]}`
              : t.jobs.scan.never}
          </p>
          <ScanPanel hasSources={(approvedSources ?? 0) > 0} />
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

      <form className="card grid gap-3 md:grid-cols-5 md:items-end" aria-label={t.jobs.filters.title}>
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
        <div className="md:col-span-5 flex items-center gap-3">
          <button type="submit" className="btn-secondary">{t.jobs.filters.apply}</button>
          <span className="text-sm text-navy-600">{t.jobs.filters.count(primaries.length)}</span>
        </div>
      </form>

      {primaries.length === 0 ? (
        <p className="text-sm text-navy-600">{all.length === 0 && !q ? t.jobs.empty : t.jobs.emptyFiltered}</p>
      ) : (
        <ul className="space-y-4">
          {primaries.map((job) => (
            <JobCard key={job.id} job={job} duplicates={dupesOf.get(job.id) ?? []} />
          ))}
        </ul>
      )}
    </div>
  );
}
