import Link from "next/link";
import { getAppContext } from "@/lib/dal";
import { getDictionary } from "@/lib/i18n";
import { isAiConfigured } from "@/lib/env";
import { loadProfileData } from "@/lib/profile/queries";
import { countByStatus } from "@/lib/profile/summary";
import { parseStoredPreferences, constraintKeys } from "@/lib/preferences/schema";
import { formatDateTime } from "@/lib/time";
import { createSupabaseServerClient } from "@/lib/supabase/server";

const t = getDictionary();

export default async function DashboardPage() {
  const ctx = await getAppContext();
  const data = await loadProfileData(ctx);
  const counts = countByStatus(data.facts);
  const { preferences, isDefault } = parseStoredPreferences(data.preferences?.preferences_json);
  const aiConfigured = isAiConfigured();
  const supabase = await createSupabaseServerClient();
  const [
    { data: lastScan },
    { count: activeJobs },
    { count: reviewJobs },
    { count: interestingJobs },
    { count: topMatches },
    { count: stretchMatches },
    { data: assessment },
  ] = await Promise.all([
    supabase.from("scans").select("started_at, status").eq("tenant_id", ctx.tenantId).order("started_at", { ascending: false }).limit(1).maybeSingle(),
    supabase.from("jobs").select("id", { count: "exact", head: true }).eq("tenant_id", ctx.tenantId).neq("status", "closed").is("duplicate_of", null).neq("gate_status", "fail"),
    supabase.from("jobs").select("id", { count: "exact", head: true }).eq("tenant_id", ctx.tenantId).neq("status", "closed").is("duplicate_of", null).eq("gate_status", "review_required"),
    supabase.from("jobs").select("id", { count: "exact", head: true }).eq("tenant_id", ctx.tenantId).eq("user_state", "interesting"),
    supabase.from("job_matches").select("id", { count: "exact", head: true }).eq("tenant_id", ctx.tenantId).eq("classification", "top_match"),
    supabase.from("job_matches").select("id", { count: "exact", head: true }).eq("tenant_id", ctx.tenantId).eq("classification", "stretch"),
    supabase.from("candidate_assessments").select("completed_at").eq("candidate_id", ctx.candidateId).maybeSingle(),
  ]);

  const activeTracks = preferences.tracks.filter((tr) => tr.enabled).map((tr) => t.preferences.tracks[tr.id]);
  const hardFilters = constraintKeys
    .filter((key) => preferences.constraints[key] === "hard")
    .map((key) => t.preferences.constraints[key]);

  let nextStep: { text: string; href: string; label: string };
  if (data.documents.length === 0 && counts.confirmed === 0) {
    nextStep = { text: t.dashboard.nextStepUpload, href: "/profiel", label: t.nav.profile };
  } else if (counts.suggested > 0) {
    nextStep = { text: t.dashboard.nextStepReview, href: "/profiel", label: t.nav.profile };
  } else if (isDefault) {
    nextStep = { text: t.dashboard.nextStepPreferences, href: "/voorkeuren", label: t.nav.preferences };
  } else if (!assessment?.completed_at) {
    nextStep = { text: t.dashboard.nextStepAssessment, href: "/loopbaanprofiel", label: t.nav.assessment };
  } else if ((topMatches ?? 0) + (stretchMatches ?? 0) === 0) {
    nextStep = { text: t.dashboard.nextStepMatch, href: "/vacatures", label: t.nav.jobs };
  } else {
    nextStep = { text: t.dashboard.nextStepDone, href: "/vacatures", label: t.nav.jobs };
  }

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-2xl font-semibold">{t.dashboard.title}</h1>
        <p className="text-sm text-navy-600">{t.dashboard.intro}</p>
      </div>

      <section aria-labelledby="next-step" className="card border-teal-600/40 bg-teal-100/40">
        <h2 id="next-step" className="text-sm font-semibold uppercase tracking-wide text-teal-700">
          {t.dashboard.nextStep}
        </h2>
        <p className="mt-1 text-navy-900">{nextStep.text}</p>
        <Link href={nextStep.href} className="btn-teal mt-3">
          {t.dashboard.goTo} {nextStep.label}
        </Link>
      </section>

      <div className="grid gap-4 md:grid-cols-2">
        <section aria-labelledby="profile-card" className="card">
          <h2 id="profile-card" className="mb-3 font-semibold">
            {t.dashboard.profileCard}
          </h2>
          <dl className="grid grid-cols-3 gap-3 text-center">
            <div className="rounded-lg bg-sand-100 p-3">
              <dt className="text-xs text-navy-600">{t.dashboard.confirmedFacts}</dt>
              <dd className="text-2xl font-semibold" data-testid="count-confirmed">
                {counts.confirmed}
              </dd>
            </div>
            <div className="rounded-lg bg-sand-100 p-3">
              <dt className="text-xs text-navy-600">{t.dashboard.pendingSuggestions}</dt>
              <dd className="text-2xl font-semibold">{counts.suggested}</dd>
            </div>
            <div className="rounded-lg bg-sand-100 p-3">
              <dt className="text-xs text-navy-600">{t.dashboard.documents}</dt>
              <dd className="text-2xl font-semibold">{data.documents.length}</dd>
            </div>
          </dl>
          <p className="mt-3 text-xs text-navy-600">
            {t.common.lastUpdated}: {formatDateTime(data.profile.updated_at)}
          </p>
        </section>

        <section aria-labelledby="prefs-card" className="card">
          <h2 id="prefs-card" className="mb-3 font-semibold">
            {t.dashboard.preferencesCard}
          </h2>
          {isDefault ? (
            <p className="text-sm text-navy-600">{t.dashboard.preferencesDefault}</p>
          ) : (
            <dl className="space-y-2 text-sm">
              <div>
                <dt className="font-medium">{t.dashboard.activeTracks}</dt>
                <dd className="text-navy-600">{activeTracks.join(" · ") || t.dashboard.none}</dd>
              </div>
              <div>
                <dt className="font-medium">{t.dashboard.hardFilters}</dt>
                <dd className="text-navy-600">{hardFilters.join(" · ") || t.dashboard.none}</dd>
              </div>
            </dl>
          )}
        </section>

        <section aria-labelledby="ai-card" className="card">
          <h2 id="ai-card" className="mb-2 font-semibold">
            {t.dashboard.aiCard}
          </h2>
          <p className="text-sm text-navy-600">
            {aiConfigured ? t.dashboard.aiConfigured : t.dashboard.aiNotConfigured}
          </p>
        </section>

        <section aria-labelledby="scanner-card" className="card">
          <h2 id="scanner-card" className="mb-2 font-semibold">
            {t.dashboard.scannerCard}
          </h2>
          {lastScan ? (
            <>
              <p className="text-sm text-navy-600">
                {t.jobs.scan.last}: {formatDateTime(lastScan.started_at)} · {t.jobs.scan.status[lastScan.status]}
              </p>
              <p className="mt-1 text-sm" data-testid="scanner-stats">
                {t.dashboard.scannerStats(activeJobs ?? 0, reviewJobs ?? 0, interestingJobs ?? 0)}
              </p>
              <p className="mt-1 text-sm" data-testid="match-stats">
                {t.dashboard.matchStats(topMatches ?? 0, stretchMatches ?? 0)}
              </p>
            </>
          ) : (
            <p className="text-sm text-navy-600">{t.dashboard.scannerEmpty}</p>
          )}
          <Link href="/vacatures" className="btn-secondary mt-3">
            {t.dashboard.goTo} {t.nav.jobs}
          </Link>
        </section>
      </div>
    </div>
  );
}
