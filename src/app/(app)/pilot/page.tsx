import { getAppContext } from "@/lib/dal";
import { getDictionary } from "@/lib/i18n";
import { loadPilotMetrics } from "@/lib/pilot/metrics";
import { formatDateTime } from "@/lib/time";

const t = getDictionary();
const p = t.pilot;

export default async function PilotPage() {
  const ctx = await getAppContext();
  const m = await loadPilotMetrics(ctx);
  const steps = Object.entries(m.funnel) as [keyof typeof p.funnelSteps, number][];

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-2xl font-semibold">{p.title}</h1>
        <p className="max-w-3xl text-sm text-navy-600">{p.intro}</p>
        <p className="mt-1 font-medium" data-testid="pilot-day">{m.day ? p.day(m.day) : p.notStarted}</p>
      </div>

      <div className="grid gap-4 md:grid-cols-2">
        <section aria-labelledby="pilot-reliability" className="card space-y-2 text-sm">
          <h2 id="pilot-reliability" className="font-semibold">{p.reliability}</h2>
          {m.day && <p>{p.scheduledRuns(m.runDays, m.daysElapsed)}</p>}
          <p>
            {p.lastRun}: {m.lastScheduled ? `${formatDateTime(m.lastScheduled.startedAt)} · ${t.jobs.scan.status[m.lastScheduled.status as keyof typeof t.jobs.scan.status] ?? m.lastScheduled.status}` : "—"}
          </p>
          <p>{p.sourceErrors(m.sourceErrors)}</p>
          <p>
            <span className="font-medium">{p.queues}: </span>
            {p.queueLine(m.queues.match, m.queues.outreach, m.queues.signals)}
          </p>
          <p>{p.digests(m.digests)}</p>
        </section>

        <section aria-labelledby="pilot-quality" className="card space-y-2 text-sm">
          <h2 id="pilot-quality" className="font-semibold">{p.quality}</h2>
          <p data-testid="pilot-precision">{p.precision(m.quality.good, m.quality.total)}</p>
          {m.quality.total > 0 && <p>{p.falsePositives(m.quality.falsePositives)}</p>}
          <p className="text-xs text-navy-600">{p.feedbackHint}</p>
        </section>

        <section aria-labelledby="pilot-funnel" className="card space-y-2 text-sm md:col-span-2">
          <h2 id="pilot-funnel" className="font-semibold">{p.funnel}</h2>
          <dl className="grid grid-cols-2 gap-2 md:grid-cols-3 lg:grid-cols-5">
            {steps.map(([key, value]) => (
              <div key={key} className={`rounded-lg p-3 ${key === "conversations" ? "bg-teal-100" : "bg-sand-100"}`}>
                <dt className="text-xs text-navy-600">{p.funnelSteps[key]}</dt>
                <dd className="text-2xl font-semibold" data-testid={`funnel-${key}`}>{value}</dd>
              </div>
            ))}
          </dl>
          <p className="text-xs text-navy-600">{p.kpiNote}</p>
        </section>

        <section aria-labelledby="pilot-costs" className="card space-y-2 text-sm">
          <h2 id="pilot-costs" className="font-semibold">{p.costs}</h2>
          <p>{p.costSubscription}</p>
          <p>{m.costs.apiEnabled || m.costs.apiAssessments > 0 ? p.costApi(m.costs.apiAssessments) : p.costApiOff}</p>
          <p>{p.costSources}</p>
          <p className="text-navy-600">{p.costHosting}</p>
        </section>

        <section aria-labelledby="pilot-privacy" className="card space-y-2 text-sm">
          <h2 id="pilot-privacy" className="font-semibold">{p.privacy}</h2>
          <ul className="ml-5 list-disc space-y-1">
            {p.privacyItems.map((item) => (
              <li key={item}>{item}</li>
            ))}
          </ul>
          <p className="text-xs text-navy-600">{p.reviewDoc}</p>
        </section>
      </div>
    </div>
  );
}
