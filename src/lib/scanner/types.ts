export const atsProviders = ["greenhouse", "smartrecruiters", "lever", "lever_eu", "ashby"] as const;
export const aggregatorProviders = ["jobicy", "adzuna"] as const;
export type AtsProvider = (typeof atsProviders)[number];
export type AggregatorProvider = (typeof aggregatorProviders)[number];
export type SourceProvider = AtsProvider | AggregatorProvider;
export type JobProvider = SourceProvider | "manual";

export function isAtsProvider(p: string): p is AtsProvider {
  return (atsProviders as readonly string[]).includes(p);
}

export type WorkplaceType = "onsite" | "hybrid" | "remote" | "unknown";

export interface Salary {
  min: number | null;
  max: number | null;
  currency: string;
  interval: "year" | "month" | "hour" | "unknown";
  source: "structured" | "text";
  evidence?: string;
}

/** A posting as returned by a source, normalised to one shape. Untrusted content. */
export interface RawPosting {
  externalId: string;
  title: string;
  companyName: string;
  url: string;
  descriptionText: string | null;
  descriptionTruncated: boolean;
  locationText: string | null;
  countryCode: string | null;
  workplaceType: WorkplaceType;
  employmentType: string | null;
  publishedAt: string | null;
  salary: Salary | null;
}

export interface FetchJsonResult {
  ok: boolean;
  status: number;
  data: unknown;
  error?: string;
}

export type FetchJson = (url: string) => Promise<FetchJsonResult>;

export interface AdapterContext {
  fetchJson: FetchJson;
  /** Cheap title pre-filter so adapters only fetch details for likely matches. */
  isCandidateTitle: (title: string) => boolean;
  /** Search phrases for aggregators (from the user's search tracks). */
  searchPhrases: string[];
  env: { adzunaAppId?: string; adzunaAppKey?: string };
}

export interface FetchResult {
  postings: RawPosting[];
  /** Every external id seen in the feed (also the ones not returned in `postings`). */
  seenIds: string[];
  /** True when the whole feed was read; only then may missing jobs be closed. */
  complete: boolean;
  requests: number;
  notes: string[];
}

export interface SourceAdapter {
  provider: SourceProvider;
  label: string;
  fetchPostings(identifier: string, ctx: AdapterContext): Promise<FetchResult>;
}

export class SourceError extends Error {
  constructor(
    message: string,
    readonly code: "not_found" | "http_error" | "invalid_response" | "not_configured" | "rate_limited",
  ) {
    super(message);
  }
}
