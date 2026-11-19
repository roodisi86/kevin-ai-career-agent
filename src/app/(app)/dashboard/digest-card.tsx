import Link from "next/link";
import { getDictionary } from "@/lib/i18n";
import type { DailyDigestRow } from "@/lib/supabase/database.types";
import type { DigestContent } from "@/lib/pilot/digest";
import { amsterdamDate, formatDateTime, formatDayLabel } from "@/lib/time";
import { addJobToPipeline } from "../sollicitaties/actions";
import { generateDigestNow } from "./actions";

const t = getDictionary();
const d = t.digest;
const classLabel = t.jobs.match.classification as Record<string, string>;

export function DigestCard({ digest }: { digest: DailyDigestRow | null }) {
  const content = digest?.content_json as unknown as DigestContent | undefined;
  const stale = digest && digest.digest_date !== amsterdamDate();
  return (
    <section aria-labelledby="digest" className="card space-y-4" data-testid="digest">
      <div className="flex flex-wrap items-start justify-between gap-2">
        <div>
          <h2 id="digest" className="text-lg font-semibold">
            {d.title}
            {digest ? ` · ${formatDayLabel(digest.digest_date)}` : ""}
          </h2>
          {digest && (
            <p className="text-xs text-navy-600">
              {d.generatedAt}: {formatDateTime(digest.updated_at)}
            </p>
          )}
          {stale && <p className="text-xs text-amber-800">{d.stale(formatDayLabel(digest.digest_date))}</p>}
        </div>
        <form action={generateDigestNow}>
          <button type="submit" className="btn-secondary">{d.generate}</button>
        </form>
      </div>

      {!content ? (
        <p className="text-sm text-navy-600">{d.empty}</p>
      ) : (
        <>
          <div>
            <h3 className="mb-2 font-medium">{d.top}</h3>
            {content.top.length === 0 ? (
              <p className="text-sm text-navy-600">{d.noTop}</p>
            ) : (
              <ol className="space-y-3">
                {content.top.map((item, i) => (
                  <li key={item.jobId} className="rounded-lg bg-sand-100 p-3" data-testid="digest-top">
                    <div className="flex flex-wrap items-center gap-2">
                      <span className="font-semibold">{i + 1}.</span>
                      <Link href={`/vacatures#job-${item.jobId}`} className="font-semibold underline">{item.title}</Link>
                      <span className="text-navy-600">· {item.company}</span>
                      <span className="badge bg-teal-100 text-teal-700">
                        {item.score} · {classLabel[item.classification] ?? item.classification}
                      </span>
                      {item.isNew && <span className="badge bg-amber-100 text-amber-800">{d.isNew}</span>}
                      <span className="text-xs text-navy-600">{t.jobs.card.status[item.status]}</span>
                    </div>
                    {item.fitSummary && <p className="mt-1 text-sm">{item.fitSummary}</p>}
                    <div className="mt-2 flex flex-wrap gap-2 text-sm">
                      <a href={item.url} target="_blank" rel="noopener noreferrer" className="underline">{t.outreach.viewJob}</a>
                      <form action={addJobToPipeline}>
                        <input type="hidden" name="jobId" value={item.jobId} />
                        <button type="submit" className="underline">{t.applications.fromJob}</button>
                      </form>
                    </div>
                  </li>
                ))}
              </ol>
            )}
          </div>

          <div>
            <h3 className="mb-1 font-medium">{d.todo}</h3>
            <ul className="ml-5 list-disc space-y-1 text-sm">
              <li>{d.newJobs(content.counts.newJobs)}</li>
              {content.outreach.toReview > 0 && (
                <li><Link href="/reverse-recruiter" className="underline">{d.toReview(content.outreach.toReview)}</Link></li>
              )}
              {content.outreach.approvedNotSent > 0 && <li>{d.approvedNotSent(content.outreach.approvedNotSent)}</li>}
              {content.outreach.followUpDue > 0 && <li>{d.followUp(content.outreach.followUpDue)}</li>}
              {content.signals.fresh > 0 && (
                <li><Link href="/signalen" className="underline">{d.signals(content.signals.fresh)}</Link></li>
              )}
            </ul>
            {content.signals.headlines.length > 0 && (
              <ul className="ml-5 mt-1 text-sm text-navy-600">
                {content.signals.headlines.map((h, i) => (
                  <li key={i}>{h.company}: {h.headline}</li>
                ))}
              </ul>
            )}
          </div>

          {content.applications.actions.length > 0 && (
            <div>
              <h3 className="mb-1 font-medium">{d.actions}</h3>
              <ul className="space-y-1 text-sm">
                {content.applications.actions.map((act) => (
                  <li key={act.applicationId}>
                    <Link href={`/sollicitaties#app-${act.applicationId}`} className="underline">
                      {act.company} · {act.role}
                    </Link>
                    : {act.action} <span className="text-navy-600">({act.due})</span>
                  </li>
                ))}
              </ul>
            </div>
          )}
        </>
      )}
    </section>
  );
}
