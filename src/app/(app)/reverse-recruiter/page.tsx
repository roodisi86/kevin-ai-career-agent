import Link from "next/link";
import { getAppContext } from "@/lib/dal";
import { getDictionary } from "@/lib/i18n";
import { loadWorkspace, processOutreachAnswers } from "@/lib/outreach/service";
import type { VerifiedBrief } from "@/lib/outreach/research";
import { formatDateTime } from "@/lib/time";
import { confirmContact, deleteDraft, removeContact, startResearch } from "./actions";
import { AddContactForm, DraftEditor } from "./components";

const t = getDictionary();
const o = t.outreach;

export default async function ReverseRecruiterPage({ searchParams }: { searchParams: Promise<Record<string, string | string[] | undefined>> }) {
  const ctx = await getAppContext();
  const params = await searchParams;
  const started = typeof params.started === "string" ? params.started : null;
  // Verify and store any answers from the Claude task before showing the workspace.
  await processOutreachAnswers(ctx);
  const items = await loadWorkspace(ctx);

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-2xl font-semibold">{o.title}</h1>
        <p className="max-w-3xl text-sm text-navy-600">{o.intro}</p>
        <p className="mt-1 text-xs text-navy-600">{o.howItWorks}</p>
      </div>

      {started && (
        <p className="card text-sm" role="status">
          {started === "queued" ? o.started : started === "already_queued" ? o.alreadyQueued : o.startErrors[started] ?? t.common.error}
        </p>
      )}

      {items.length === 0 && <p className="card text-sm">{o.empty}</p>}

      {items.map(({ request, job, contacts, drafts }) => {
        const brief = request.brief_json as unknown as VerifiedBrief | null;
        return (
          <section key={request.id} id={`job-${request.job_id}`} className="card space-y-4" aria-labelledby={`h-${request.id}`}>
            <div className="flex flex-wrap items-start justify-between gap-2">
              <div>
                <h2 id={`h-${request.id}`} className="text-lg font-semibold">
                  {job ? `${job.title} · ${job.company_name}` : "—"}
                </h2>
                <p className="text-xs text-navy-600">
                  {o.status[request.status]} · {formatDateTime(request.processed_at ?? request.created_at)}
                  {job && (
                    <>
                      {" · "}
                      <a href={job.canonical_url} target="_blank" rel="noopener noreferrer" className="underline">
                        {o.viewJob}
                      </a>
                    </>
                  )}
                </p>
              </div>
              {request.status !== "pending" && (
                <form action={startResearch}>
                  <input type="hidden" name="jobId" value={request.job_id} />
                  <button type="submit" className="btn-secondary">{o.restart}</button>
                </form>
              )}
            </div>

            {brief && (
              <div className="space-y-2 text-sm">
                <h3 className="font-medium">{o.brief}</h3>
                {brief.businessModel && (
                  <p><span className="font-medium">{o.businessModel}: </span>{brief.businessModel}</p>
                )}
                {brief.strategicChallenge && (
                  <p><span className="font-medium">{o.challenge}: </span>{brief.strategicChallenge}</p>
                )}
                {brief.angles.length > 0 && (
                  <div>
                    <p className="font-medium">{o.angles}</p>
                    <ul className="ml-5 list-disc">{brief.angles.map((a, i) => <li key={i}>{a}</li>)}</ul>
                  </div>
                )}
                <div>
                  <p className="font-medium">{o.news}</p>
                  {brief.recentNews.length === 0 ? (
                    <p className="text-navy-600">{o.noNews}</p>
                  ) : (
                    <ul className="ml-5 list-disc">
                      {brief.recentNews.map((n, i) => (
                        <li key={i}>
                          <a href={n.url} target="_blank" rel="noopener noreferrer" className="underline">{n.title}</a>
                          {n.published ? <span className="text-navy-600"> · {n.published}</span> : null}
                        </li>
                      ))}
                    </ul>
                  )}
                </div>
                {brief.droppedSources > 0 && <p className="text-xs text-navy-600">{o.droppedSources(brief.droppedSources)}</p>}
              </div>
            )}

            {request.status !== "pending" && (
              <div className="space-y-2">
                <h3 className="font-medium">{o.contacts}</h3>
                {contacts.length === 0 && <p className="text-sm text-navy-600">{o.noContacts}</p>}
                <ul className="space-y-2">
                  {contacts.map((c) => (
                    <li key={c.id} className="flex flex-wrap items-center gap-2 text-sm" data-testid="contact">
                      <span className="font-medium">{c.name}</span>
                      {c.role && <span>– {c.role}</span>}
                      {c.organisation && <span className="text-navy-600">({c.organisation})</span>}
                      <span className={`badge ${c.verification_status === "source_mismatch" ? "bg-rose-100 text-rose-800" : c.verification_status === "unverified" ? "bg-amber-100 text-amber-800" : "bg-teal-100 text-teal-700"}`}>
                        {o.verification[c.verification_status]}
                      </span>
                      {c.source_url && (
                        <a href={c.source_url} target="_blank" rel="noopener noreferrer" className="underline">{o.source}</a>
                      )}
                      {c.email && <span className="text-navy-600">{c.email}</span>}
                      {c.verification_status !== "user_confirmed" && (
                        <form action={confirmContact}>
                          <input type="hidden" name="id" value={c.id} />
                          <button type="submit" className="text-xs underline">{o.confirmContact}</button>
                        </form>
                      )}
                      <form action={removeContact}>
                        <input type="hidden" name="id" value={c.id} />
                        <button type="submit" className="text-xs text-rose-800 underline">{o.removeContact}</button>
                      </form>
                    </li>
                  ))}
                </ul>
                <AddContactForm jobId={request.job_id} />
              </div>
            )}

            {request.status !== "pending" && (
              <div className="space-y-3">
                <h3 className="font-medium">{o.drafts}</h3>
                {drafts.length === 0 && <p className="text-sm text-navy-600">{o.noDrafts}</p>}
                {drafts.map((d) => (
                  <div key={d.id} className="space-y-1">
                    <DraftEditor key={`${d.id}-${d.version}-${d.state}`} draft={d} contacts={contacts} />
                    {(d.state === "draft" || d.state === "reviewed") && (
                      <form action={deleteDraft}>
                        <input type="hidden" name="id" value={d.id} />
                        <button type="submit" className="text-xs text-rose-800 underline">{o.deleteDraft}</button>
                      </form>
                    )}
                  </div>
                ))}
              </div>
            )}
          </section>
        );
      })}

      <p className="text-xs text-navy-600">
        <Link href="/vacatures" className="underline">{t.nav.jobs}</Link>
      </p>
    </div>
  );
}
