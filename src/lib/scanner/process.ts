import { createHash } from "node:crypto";
import { canonicalWords } from "@/lib/cv/text";
import { evaluateHardGates, type GateResult, type TriState } from "@/lib/matching/gates";
import { normalizeEmployerName } from "@/lib/preferences/employers";
import type { Preferences, TrackId } from "@/lib/preferences/schema";
import { countryFromLocation } from "./geo";
import { assessRelevance } from "./relevance";
import { extractSignals, type JobSignalSet } from "./signals";
import { isAtsProvider, type JobProvider, type RawPosting } from "./types";

export interface CompanyContext {
  id: string;
  name: string;
  isMultinational: TriState;
  sector: string | null;
}

/** Row shape written to public.jobs (without tenant/user-owned columns). */
export interface JobRecord {
  provider: JobProvider;
  external_job_id: string;
  company_name: string;
  company_target_id: string | null;
  title: string;
  canonical_url: string;
  description_text: string | null;
  description_is_truncated: boolean;
  location_text: string | null;
  country_code: string | null;
  workplace_type: RawPosting["workplaceType"];
  employment_type: string | null;
  salary_json: Record<string, unknown>;
  signals_json: Record<string, unknown>;
  track_hits: TrackId[];
  gate_status: GateResult["status"];
  gate_json: Record<string, unknown>;
  status: "open" | "uncertain";
  status_reason: string;
  published_at: string | null;
  raw_hash: string;
  dedupe_key: string;
  filtered_out_reason: string | null;
}

export function dedupeKey(companyName: string, title: string, country: string | null): string {
  const company = normalizeEmployerName(companyName).replace(/\s+/g, " ");
  const normalizedTitle = canonicalWords(title.replace(/\(.*?\)/g, " ")).trim();
  return `${company}|${normalizedTitle}|${country ?? "?"}`.slice(0, 600);
}

export function rawHash(p: RawPosting): string {
  return createHash("sha256")
    .update([p.title, p.companyName, p.url, p.locationText ?? "", p.descriptionText ?? ""].join("\u0000"))
    .digest("hex");
}

export function gateFor(prefs: Preferences, posting: RawPosting, signals: JobSignalSet, company: CompanyContext | null): GateResult {
  return evaluateHardGates(prefs, {
    employerName: posting.companyName,
    dutchContract: signals.dutchContract.value,
    multinational: signals.multinational.value,
    companyCar: signals.companyCar.value,
    remoteHybrid: signals.remoteHybrid.value,
    annualBaseSalaryEur: signals.salary?.annualEur ?? null,
    sector: company?.sector ?? null,
  });
}

/**
 * Turns a raw posting into a job record, or null when it is not relevant.
 * The posting text is untrusted data: it is stored and shown as text only.
 */
export function toJobRecord(
  posting: RawPosting,
  provider: JobProvider,
  prefs: Preferences,
  company: CompanyContext | null,
  { force = false }: { force?: boolean } = {},
): { record: JobRecord | null; reasons: string[] } {
  const relevance = assessRelevance(posting, prefs);
  // Manual imports are stored even when the filter would skip them: the user chose them.
  if (!relevance.relevant && !force) return { record: null, reasons: relevance.reasons };

  const companyName = company?.name && provider !== "jobicy" && provider !== "adzuna" ? company.name : posting.companyName;
  const normalized: RawPosting = { ...posting, companyName };
  const signals = extractSignals(normalized, company);
  const gate = gateFor(prefs, normalized, signals, company);
  const country = posting.countryCode ?? countryFromLocation(posting.locationText);

  const status = isAtsProvider(provider)
    ? { status: "open" as const, reason: "in_employer_feed" }
    : provider === "manual"
      ? { status: "uncertain" as const, reason: "manual_not_verified" }
      : { status: "uncertain" as const, reason: "aggregator_not_verified" };

  return {
    reasons: relevance.reasons,
    record: {
      provider,
      external_job_id: posting.externalId.slice(0, 200),
      company_name: companyName,
      company_target_id: company?.id ?? null,
      title: posting.title,
      canonical_url: posting.url,
      description_text: posting.descriptionText,
      description_is_truncated: posting.descriptionTruncated,
      location_text: posting.locationText,
      country_code: country,
      workplace_type: posting.workplaceType,
      employment_type: posting.employmentType?.slice(0, 100) ?? null,
      salary_json: signals.salary ? { ...signals.salary } : {},
      signals_json: {
        companyCar: signals.companyCar,
        dutchContract: signals.dutchContract,
        remoteHybrid: signals.remoteHybrid,
        multinational: signals.multinational,
        sector: company?.sector ?? null,
        relevance: relevance.reasons,
        relevant: relevance.relevant,
      },
      track_hits: relevance.trackHits,
      gate_status: gate.status,
      gate_json: { checks: gate.checks },
      status: status.status,
      status_reason: status.reason,
      published_at: posting.publishedAt,
      raw_hash: rawHash(posting),
      dedupe_key: dedupeKey(companyName, posting.title, country),
      filtered_out_reason: null,
    },
  };
}

const PROVIDER_RANK: Record<JobProvider, number> = {
  greenhouse: 0,
  smartrecruiters: 0,
  lever: 0,
  lever_eu: 0,
  ashby: 0,
  manual: 1,
  jobicy: 2,
  adzuna: 3,
};

/** Picks the primary record among duplicates: employer source first, then oldest. */
export function pickPrimary<T extends { id: string; provider: JobProvider; first_seen_at: string }>(group: T[]): T {
  return [...group].sort(
    (a, b) => PROVIDER_RANK[a.provider] - PROVIDER_RANK[b.provider] || a.first_seen_at.localeCompare(b.first_seen_at),
  )[0];
}

export interface LifecycleInput {
  provider: JobProvider;
  status: "open" | "uncertain" | "closed";
  missed_polls: number;
  last_seen_at: string;
}

/**
 * Status for a stored job that was NOT in the latest poll of its source.
 * Employer feeds: missing once → uncertain, twice → closed (only when the
 * feed was read completely). Aggregators: closed after 14 days unseen.
 */
export function statusWhenMissing(
  job: LifecycleInput,
  feedComplete: boolean,
  now: Date,
): { status: "open" | "uncertain" | "closed"; status_reason: string; missed_polls: number } | null {
  if (job.status === "closed" || job.provider === "manual") return null;
  if (isAtsProvider(job.provider)) {
    if (!feedComplete) return null;
    const missed = job.missed_polls + 1;
    return missed >= 2
      ? { status: "closed", status_reason: "removed_from_employer_feed", missed_polls: missed }
      : { status: "uncertain", status_reason: "missing_from_latest_feed", missed_polls: missed };
  }
  const ageDays = (now.getTime() - new Date(job.last_seen_at).getTime()) / 86_400_000;
  return ageDays >= 14 ? { status: "closed", status_reason: "not_seen_14_days", missed_polls: job.missed_polls + 1 } : null;
}

/** Re-evaluates hard gates from stored signals (e.g. after the user changed preferences). */
export function regate(
  prefs: Preferences,
  job: { company_name: string; signals_json: unknown; salary_json: unknown },
): GateResult {
  const signals = (job.signals_json ?? {}) as Record<string, { value?: TriState } | string | null | undefined>;
  const value = (key: string): TriState => {
    const v = signals[key];
    return typeof v === "object" && v && (v.value === "yes" || v.value === "no") ? v.value : "unknown";
  };
  const salary = (job.salary_json ?? {}) as { annualEur?: number | null };
  return evaluateHardGates(prefs, {
    employerName: job.company_name,
    dutchContract: value("dutchContract"),
    multinational: value("multinational"),
    companyCar: value("companyCar"),
    remoteHybrid: value("remoteHybrid"),
    annualBaseSalaryEur: typeof salary.annualEur === "number" ? salary.annualEur : null,
    sector: typeof signals.sector === "string" ? signals.sector : null,
  });
}

export interface StoredJobForRefilter {
  provider: JobProvider;
  title: string;
  company_name: string;
  location_text: string | null;
  country_code: string | null;
  workplace_type: RawPosting["workplaceType"];
  /** Set for imports; Grok Bot leads go through the same filter as feeds. */
  import_source?: "user" | "grok_bot" | null;
}

/**
 * Re-runs the relevance filter on a stored job (after the user tightened the
 * filter). Returns the reason it is now filtered out, or null when it stays.
 * Jobs the user imported himself are never filtered: he chose them. Leads
 * from Grok Bot are filtered like any feed.
 */
export function refilterReason(prefs: Preferences, job: StoredJobForRefilter): string | null {
  if (job.provider === "manual" && job.import_source !== "grok_bot") return null;
  const relevance = assessRelevance(
    {
      externalId: "stored",
      title: job.title,
      companyName: job.company_name,
      url: "https://stored.invalid",
      locationText: job.location_text,
      countryCode: job.country_code,
      workplaceType: job.workplace_type,
      employmentType: null,
      descriptionText: null,
      descriptionTruncated: false,
      publishedAt: null,
      salary: null,
    },
    prefs,
  );
  return relevance.relevant ? null : relevance.reasons.join(" · ").slice(0, 200);
}
