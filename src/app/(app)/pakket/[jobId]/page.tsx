import Link from "next/link";
import { notFound } from "next/navigation";
import { z } from "zod";
import { getAppContext } from "@/lib/dal";
import { getDictionary } from "@/lib/i18n";
import { createSupabaseServerClient } from "@/lib/supabase/server";
import { loadPackage, processPackageAnswers } from "@/lib/packages/service";
import { grokFormInstruction, type VerifiedPackage } from "@/lib/packages/research";
import { CopyButton } from "../../copy-button";
import { createPackage, markAppliedAction, saveLetterAction } from "./actions";

const t = getDictionary();
const p = t.packages;

export default async function PackagePage({
  params,
  searchParams,
}: {
  params: Promise<{ jobId: string }>;
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  const ctx = await getAppContext();
  const { jobId } = await params;
  if (!z.uuid().safeParse(jobId).success) notFound();
  const status = (await searchParams).status;
  const supabase = await createSupabaseServerClient();
  const { data: job } = await supabase
    .from("jobs")
    .select("id, title, company_name, canonical_url, status, import_source")
    .eq("tenant_id", ctx.tenantId)
    .eq("id", jobId)
    .maybeSingle();
  if (!job) notFound();
  await processPackageAnswers(ctx);
  const pkg = await loadPackage(ctx, jobId);
  const content = pkg?.package_json as unknown as VerifiedPackage | null;
  const warnings = (pkg?.warnings_json ?? []) as string[];
  const statusText =
    typeof status === "string"
      ? status === "saved"
        ? p.saved
        : status === "applied"
          ? p.appliedDone
          : status === "confirm"
            ? p.regenerateConfirm
            : p.requested[status] ?? t.common.error
      : null;

  return (
    <div className="space-y-6">
      <div>
        <p className="text-sm"><Link href={`/vacatures#job-${job.id}`} className="underline">← {p.back}</Link></p>
        <h1 className="text-2xl font-semibold">{p.title}</h1>
        <p className="font-medium">{job.title} · {job.company_name}</p>
        <p className="text-xs text-navy-600">
          {t.jobs.card.status[job.status]}
          {job.import_source === "grok_bot" ? ` · ${t.grok.sourceLabel}` : ""} ·{" "}
          <a href={job.canonical_url} target="_blank" rel="noopener noreferrer nofollow" className="underline">{p.viewJob} ↗</a>
        </p>
        <p className="mt-2 max-w-3xl text-sm text-navy-600">{p.intro}</p>
      </div>

      {statusText && <p className="card text-sm" role="status">{statusText}</p>}

      {!pkg && (
        <form action={createPackage} className="card">
          <input type="hidden" name="jobId" value={job.id} />
          <button type="submit" className="btn-primary">{p.create}</button>
        </form>
      )}

      {pkg && (pkg.status === "pending" || pkg.status === "answered") && <p className="card text-sm" data-testid="package-pending">{p.pending}</p>}
      {pkg?.status === "rejected" && <p className="card text-sm">{p.rejected}</p>}

      {pkg?.status === "ready" && content && (
        <>
          <section aria-labelledby="letter" className="card space-y-3" data-testid="package-letter">
            <div className="flex flex-wrap items-center justify-between gap-2">
              <h2 id="letter" className="font-semibold">
                {p.letter} {pkg.letter_edited && <span className="badge bg-sand-100">{p.letterEdited}</span>}
              </h2>
              <CopyButton text={pkg.letter_text ?? ""} label={p.copy} copiedLabel={p.copied} />
            </div>
            {warnings.length > 0 && (
              <div className="rounded-lg bg-amber-100 p-3 text-sm text-amber-900" role="alert">
                <p className="font-medium">{p.warnings}</p>
                <ul className="ml-5 list-disc">{warnings.map((w) => <li key={w}>{w}</li>)}</ul>
              </div>
            )}
            <form action={saveLetterAction} className="space-y-2">
              <input type="hidden" name="jobId" value={job.id} />
              <label className="sr-only" htmlFor="letter-text">{p.letter}</label>
              <textarea id="letter-text" name="letter" rows={14} maxLength={8000} defaultValue={pkg.letter_text ?? ""} className="input font-serif" />
              <button type="submit" className="btn-secondary">{p.save}</button>
            </form>
          </section>

          {content.highlights.length > 0 && (
            <section aria-labelledby="highlights" className="card space-y-2">
              <h2 id="highlights" className="font-semibold">{p.highlights}</h2>
              <ul className="space-y-3 text-sm">
                {content.highlights.map((h, i) => (
                  <li key={i} className="rounded-lg bg-sand-100 p-3">
                    <p className="font-medium">{h.requirement}</p>
                    {h.jobQuote && <p className="text-xs text-navy-600">{p.fromVacancy}: “{h.jobQuote}”</p>}
                    <p className="mt-1">{h.text}</p>
                    <p className="mt-1 text-xs text-navy-600">{p.basedOn}: {h.facts.map((f) => f.statement).join(" · ")}</p>
                  </li>
                ))}
              </ul>
              {content.dropped.highlights > 0 && <p className="text-xs text-navy-600">{p.dropped(content.dropped.highlights)}</p>}
            </section>
          )}

          {content.screeningAnswers.length > 0 && (
            <section aria-labelledby="answers" className="card space-y-2">
              <h2 id="answers" className="font-semibold">{p.answers}</h2>
              <ul className="space-y-3 text-sm">
                {content.screeningAnswers.map((a, i) => (
                  <li key={i} className="space-y-1">
                    <div className="flex flex-wrap items-center justify-between gap-2">
                      <p className="font-medium">{a.question}</p>
                      <CopyButton text={a.answer} label={p.copy} copiedLabel={p.copied} className="text-xs underline" />
                    </div>
                    <p className="whitespace-pre-line">{a.answer}</p>
                    {a.warnings.map((w) => <p key={w} className="text-xs text-amber-800">⚠ {w}</p>)}
                  </li>
                ))}
              </ul>
            </section>
          )}

          {(content.gaps.length > 0 || content.formNotes.length > 0) && (
            <section className="card grid gap-4 text-sm md:grid-cols-2">
              {content.gaps.length > 0 && (
                <div>
                  <h2 className="font-semibold">{p.gaps}</h2>
                  <ul className="ml-5 list-disc">{content.gaps.map((g, i) => <li key={i}><span className="font-medium">{g.requirement}:</span> {g.advice}</li>)}</ul>
                </div>
              )}
              {content.formNotes.length > 0 && (
                <div>
                  <h2 className="font-semibold">{p.formNotes}</h2>
                  <ul className="ml-5 list-disc">{content.formNotes.map((n, i) => <li key={i}>{n}</li>)}</ul>
                </div>
              )}
            </section>
          )}

          <section aria-labelledby="grok-form" className="card space-y-2">
            <div className="flex flex-wrap items-center justify-between gap-2">
              <h2 id="grok-form" className="font-semibold">{p.grokTitle}</h2>
              <CopyButton
                text={grokFormInstruction({
                  url: job.canonical_url,
                  title: job.title,
                  company: job.company_name,
                  letter: pkg.letter_text ?? "",
                  answers: content.screeningAnswers,
                })}
                label={p.copy}
                copiedLabel={p.copied}
              />
            </div>
            <p className="text-sm text-navy-600">{p.grokHelp}</p>
          </section>

          <div className="flex flex-wrap gap-3">
            <form action={markAppliedAction}>
              <input type="hidden" name="jobId" value={job.id} />
              <button type="submit" className="btn-teal">{p.applied}</button>
            </form>
            <form action={createPackage} className="flex flex-wrap items-end gap-2">
              <input type="hidden" name="jobId" value={job.id} />
              <input type="hidden" name="regenerate" value="1" />
              <label className="block">
                <span className="label">{p.regenerateConfirm}</span>
                <input name="confirm" className="input" autoComplete="off" />
              </label>
              <button type="submit" className="btn-secondary">{p.regenerate}</button>
            </form>
          </div>
        </>
      )}
    </div>
  );
}
