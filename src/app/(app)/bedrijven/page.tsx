import { getAppContext } from "@/lib/dal";
import { getDictionary } from "@/lib/i18n";
import { createSupabaseServerClient } from "@/lib/supabase/server";
import { adzunaConfigured, ensurePlatformSources, loadAllTargets, SOURCE_LABELS } from "@/lib/scanner/service";
import { formatDateTime } from "@/lib/time";
import type { JobSourceRow } from "@/lib/supabase/database.types";
import { approveAllVerified, loadSuggested, removeCompany, setSourceApproval, setWatchSignals } from "./actions";
import { AddCompanyForm, VerifyAllButton, VerifyButton } from "./components";

const t = getDictionary();

function ApprovalToggle({ source, disabled = false }: { source: JobSourceRow; disabled?: boolean }) {
  if (source.approved) {
    return (
      <form action={setSourceApproval} className="inline-flex items-center gap-2">
        <input type="hidden" name="id" value={source.id} />
        <input type="hidden" name="approve" value="false" />
        <span className="badge bg-teal-100 text-teal-700">{t.companies.approved}</span>
        <button type="submit" className="btn-secondary">{t.companies.revoke}</button>
      </form>
    );
  }
  if (source.verification_status !== "verified" || disabled) return null;
  return (
    <form action={setSourceApproval}>
      <input type="hidden" name="id" value={source.id} />
      <input type="hidden" name="approve" value="true" />
      <button type="submit" className="btn-teal">{t.companies.approve}</button>
    </form>
  );
}

function PollInfo({ source }: { source: JobSourceRow }) {
  if (!source.last_polled_at) return null;
  const counts = (source.last_poll_counts ?? {}) as { fetched?: number };
  return (
    <span className="text-xs text-navy-600">
      {t.companies.lastPoll}: {formatDateTime(source.last_polled_at)}
      {source.last_poll_status === "error" ? ` · ${source.last_poll_error ?? t.common.error}` : ""}
      {typeof counts.fetched === "number" ? ` · ${t.companies.jobsCount(counts.fetched)}` : ""}
    </span>
  );
}

export default async function CompaniesPage() {
  const ctx = await getAppContext();
  await ensurePlatformSources(ctx);
  const supabase = await createSupabaseServerClient();
  const [targets, { data: sources }] = await Promise.all([
    loadAllTargets(ctx),
    supabase.from("job_sources").select("*").eq("tenant_id", ctx.tenantId).order("provider").limit(1000),
  ]);

  const platform = (sources ?? []).filter((s) => !s.company_target_id);
  const byTarget = new Map<string, JobSourceRow[]>();
  for (const s of sources ?? []) {
    if (!s.company_target_id) continue;
    byTarget.set(s.company_target_id, [...(byTarget.get(s.company_target_id) ?? []), s]);
  }
  const unchecked = (targets ?? []).filter((tg) => !tg.board_checked_at && !byTarget.has(tg.id)).map((tg) => tg.id);
  const withVerified = (targets ?? []).filter((tg) => (byTarget.get(tg.id) ?? []).some((s) => s.verification_status === "verified")).length;
  const approvedCount = (sources ?? []).filter((s) => s.approved).length;
  const pendingApproval = (sources ?? []).some((s) => s.company_target_id && s.verification_status === "verified" && !s.approved);
  const adzunaReady = adzunaConfigured();

  const checkedCount = (targets ?? []).filter((tg) => tg.board_checked_at).length;
  const sectors = new Map<string, NonNullable<typeof targets>>();
  for (const tg of targets ?? []) {
    const key = tg.sector ?? "Overig";
    sectors.set(key, [...(sectors.get(key) ?? []), tg]);
  }

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-2xl font-semibold">{t.companies.title}</h1>
        <p className="max-w-3xl text-sm text-navy-600">{t.companies.intro}</p>
        <p className="mt-2 text-sm font-medium">
          {t.companies.summary(targets?.length ?? 0, withVerified, approvedCount)}
        </p>
      </div>

      <section aria-labelledby="platforms" className="card space-y-3">
        <h2 id="platforms" className="font-semibold">{t.companies.platformsTitle}</h2>
        <ul className="divide-y divide-sand-200">
          {platform.map((source) => (
            <li key={source.id} className="flex flex-wrap items-center justify-between gap-3 py-3">
              <div>
                <p className="font-medium">{SOURCE_LABELS[source.provider]}</p>
                <p className="help">{source.provider === "jobicy" ? t.companies.jobicyHelp : t.companies.adzunaHelp}</p>
                {source.provider === "adzuna" && !adzunaReady && (
                  <p className="text-sm text-amber-800">{t.companies.adzunaMissing}</p>
                )}
                <PollInfo source={source} />
              </div>
              <ApprovalToggle source={source} disabled={source.provider === "adzuna" && !adzunaReady} />
            </li>
          ))}
        </ul>
      </section>

      <section aria-labelledby="add-company" className="card space-y-3">
        <h2 id="add-company" className="font-semibold">{t.companies.addTitle}</h2>
        <AddCompanyForm />
      </section>

      <section aria-labelledby="targets" className="card space-y-4">
        <div className="flex flex-wrap items-center justify-between gap-3">
          <h2 id="targets" className="font-semibold">{t.companies.targetsTitle}</h2>
          <div className="flex flex-wrap gap-2">
            {pendingApproval && (
              <form action={approveAllVerified}>
                <button type="submit" className="btn-primary">{t.companies.approveAll}</button>
              </form>
            )}
          </div>
        </div>

        {(targets?.length ?? 0) === 0 ? (
          <div className="space-y-2">
            <p className="text-sm text-navy-600">{t.companies.empty}</p>
            <form action={loadSuggested}>
              <button type="submit" className="btn-teal">{t.companies.loadSuggested}</button>
            </form>
            <p className="help">{t.companies.loadSuggestedHelp}</p>
          </div>
        ) : (
          <>
            <p className="text-sm text-navy-600" data-testid="verify-progress">
              {t.companies.autoVerify(checkedCount, targets?.length ?? 0)}
            </p>
            <VerifyAllButton ids={unchecked.slice(0, 50)} />
            {[...sectors.entries()].map(([sector, list]) => {
              const sectorVerified = list.filter((tg) => (byTarget.get(tg.id) ?? []).some((s) => s.verification_status === "verified")).length;
              return (
              <details key={sector} open={sectors.size <= 3 || sectorVerified > 0}>
                <summary className="mb-2 mt-4 cursor-pointer text-sm font-semibold uppercase tracking-wide text-teal-700">
                  {sector} · {t.companies.sectorCount(list.length, sectorVerified)}
                </summary>
                <ul className="divide-y divide-sand-200">
                  {list.map((target) => {
                    const found = byTarget.get(target.id) ?? [];
                    const checked = Boolean(target.board_checked_at) || found.length > 0;
                    return (
                      <li key={target.id} className="space-y-2 py-3" data-testid="company">
                        <div className="flex flex-wrap items-center justify-between gap-2">
                          <p className="font-medium">
                            {target.company_name}
                            {target.watch_signals && <span className="badge ml-2 bg-teal-100 text-teal-700">{t.signals.watched}</span>}
                          </p>
                          <div className="flex flex-wrap gap-2">
                            <form action={setWatchSignals}>
                              <input type="hidden" name="id" value={target.id} />
                              <input type="hidden" name="watch" value={target.watch_signals ? "false" : "true"} />
                              <button type="submit" className="btn-secondary" aria-pressed={target.watch_signals}>
                                {target.watch_signals ? `★ ${t.signals.unwatch}` : `☆ ${t.signals.watch}`}
                              </button>
                            </form>
                            <VerifyButton id={target.id} />
                            <form action={removeCompany}>
                              <input type="hidden" name="id" value={target.id} />
                              <button type="submit" className="btn-secondary">{t.companies.remove}</button>
                            </form>
                          </div>
                        </div>
                        {found.length === 0 ? (
                          <p className="text-sm text-navy-600">{checked ? t.companies.noBoard : t.companies.notChecked}</p>
                        ) : (
                          <ul className="space-y-2">
                            {found.map((source) => (
                              <li key={source.id} className="flex flex-wrap items-center justify-between gap-2 rounded-lg bg-sand-100 px-3 py-2 text-sm">
                                <span>
                                  <span className="font-medium">{SOURCE_LABELS[source.provider]}</span> · {source.identifier}
                                  {source.display_name ? ` (${source.display_name})` : ""} ·{" "}
                                  <span className={source.verification_status === "verified" ? "text-teal-700" : "text-amber-800"}>
                                    {source.verification_status === "verified" ? t.companies.verified : t.companies.failed}
                                  </span>
                                  {source.verification_detail ? ` — ${source.verification_detail}` : ""}
                                  <br />
                                  <PollInfo source={source} />
                                </span>
                                <ApprovalToggle source={source} />
                              </li>
                            ))}
                          </ul>
                        )}
                      </li>
                    );
                  })}
                </ul>
              </details>
              );
            })}
          </>
        )}
      </section>
    </div>
  );
}
