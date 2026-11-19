import { z } from "zod";
import { countryFromLocation, normalizeCountryCode } from "./geo";
import { capDescription, htmlToText } from "./text";
import {
  SourceError,
  type AdapterContext,
  type FetchResult,
  type RawPosting,
  type Salary,
  type SourceAdapter,
  type SourceProvider,
  type WorkplaceType,
} from "./types";

/**
 * Read-only adapters for official, documented public job endpoints.
 * Every response is validated with Zod; anything unexpected is skipped,
 * never guessed. Application-submission endpoints are never called.
 */

const str = z.string().nullish();

function workplaceFrom(value: unknown, remoteFlag?: boolean | null, hybridFlag?: boolean | null): WorkplaceType {
  if (hybridFlag) return "hybrid";
  if (remoteFlag) return "remote";
  const v = typeof value === "string" ? value.toLowerCase().replace(/[^a-z]/g, "") : "";
  if (v === "hybrid") return "hybrid";
  if (v === "remote") return "remote";
  if (v === "onsite" || v === "inoffice" || v === "office") return "onsite";
  return "unknown";
}

function finalize(posting: Omit<RawPosting, "descriptionTruncated"> & { descriptionTruncated?: boolean }): RawPosting {
  const capped = capDescription(posting.descriptionText);
  return {
    ...posting,
    title: posting.title.trim().slice(0, 300),
    companyName: posting.companyName.trim().slice(0, 200),
    descriptionText: capped.text,
    descriptionTruncated: Boolean(posting.descriptionTruncated) || capped.truncated,
    locationText: posting.locationText?.trim().slice(0, 300) || null,
  };
}

async function getOrThrow(ctx: AdapterContext, url: string): Promise<unknown> {
  const result = await ctx.fetchJson(url);
  if (!result.ok) {
    if (result.status === 404) throw new SourceError("board not found", "not_found");
    if (result.status === 429) throw new SourceError("rate limited", "rate_limited");
    throw new SourceError(result.error ?? `HTTP ${result.status}`, "http_error");
  }
  return result.data;
}

// ---------------------------------------------------------------------------
// Greenhouse Job Board API — GET /v1/boards/{token}/jobs?content=true
// ---------------------------------------------------------------------------

const GreenhouseSchema = z.object({
  jobs: z.array(
    z.object({
      id: z.union([z.number(), z.string()]),
      title: z.string(),
      absolute_url: z.string().url(),
      company_name: str,
      location: z.object({ name: str }).nullish(),
      content: str,
      updated_at: str,
      first_published: str,
      offices: z.array(z.object({ name: str, location: str })).nullish(),
    }),
  ),
});

export const greenhouseAdapter: SourceAdapter = {
  provider: "greenhouse",
  label: "Greenhouse",
  async fetchPostings(identifier, ctx) {
    const data = await getOrThrow(ctx, `https://boards-api.greenhouse.io/v1/boards/${encodeURIComponent(identifier)}/jobs?content=true`);
    const parsed = GreenhouseSchema.safeParse(data);
    if (!parsed.success) throw new SourceError("unexpected response", "invalid_response");

    const postings = parsed.data.jobs.map((job) => {
      const location = job.location?.name ?? job.offices?.map((o) => o.location ?? o.name).filter(Boolean).join("; ") ?? null;
      const description = htmlToText(job.content);
      return finalize({
        externalId: String(job.id),
        title: job.title,
        companyName: job.company_name || identifier,
        url: job.absolute_url,
        descriptionText: description,
        locationText: location,
        countryCode: countryFromLocation(location),
        workplaceType: workplaceFrom(null, /\bremote\b/i.test(location ?? ""), /\bhybrid\b/i.test(location ?? "")),
        employmentType: null,
        publishedAt: job.first_published ?? job.updated_at ?? null,
        salary: null,
      });
    });
    return { postings, seenIds: postings.map((p) => p.externalId), complete: true, requests: 1, notes: [] };
  },
};

// ---------------------------------------------------------------------------
// SmartRecruiters Posting API — list (country=nl) + detail for likely matches
// ---------------------------------------------------------------------------

const SrListSchema = z.object({
  totalFound: z.number(),
  content: z.array(
    z.object({
      id: z.string(),
      name: z.string(),
      releasedDate: str,
      company: z.object({ identifier: str, name: str }).nullish(),
      location: z
        .object({
          city: str,
          country: str,
          remote: z.boolean().nullish(),
          hybrid: z.boolean().nullish(),
          fullLocation: str,
        })
        .nullish(),
      typeOfEmployment: z.object({ label: str }).nullish(),
    }),
  ),
});

const SrDetailSchema = z.object({
  postingUrl: z.string().url().nullish(),
  jobAd: z
    .object({
      sections: z.record(z.string(), z.object({ title: str, text: str }).nullish()).nullish(),
    })
    .nullish(),
});

const SR_PAGE = 100;
const SR_MAX_PAGES = 10;
const SR_MAX_DETAILS = 30;

export const smartRecruitersAdapter: SourceAdapter = {
  provider: "smartrecruiters",
  label: "SmartRecruiters",
  async fetchPostings(identifier, ctx) {
    const base = `https://api.smartrecruiters.com/v1/companies/${encodeURIComponent(identifier)}/postings`;
    const all: z.infer<typeof SrListSchema>["content"] = [];
    let requests = 0;
    let total = Infinity;
    for (let page = 0; page < SR_MAX_PAGES && all.length < total; page++) {
      const data = await getOrThrow(ctx, `${base}?country=nl&limit=${SR_PAGE}&offset=${page * SR_PAGE}`);
      requests++;
      const parsed = SrListSchema.safeParse(data);
      if (!parsed.success) throw new SourceError("unexpected response", "invalid_response");
      total = parsed.data.totalFound;
      all.push(...parsed.data.content);
      if (parsed.data.content.length < SR_PAGE) break;
    }
    const complete = all.length >= total;
    const notes = complete ? [] : [`feed has ${total} NL postings; read the first ${all.length}`];

    const candidates = all.filter((p) => ctx.isCandidateTitle(p.name)).slice(0, SR_MAX_DETAILS);
    if (all.filter((p) => ctx.isCandidateTitle(p.name)).length > SR_MAX_DETAILS) notes.push("detail limit reached");

    const postings: RawPosting[] = [];
    for (const p of candidates) {
      const detailResult = await ctx.fetchJson(`${base}/${encodeURIComponent(p.id)}`);
      requests++;
      const detail = detailResult.ok ? SrDetailSchema.safeParse(detailResult.data) : null;
      const sections = detail?.success ? detail.data.jobAd?.sections ?? {} : {};
      const description = htmlToText(
        Object.values(sections)
          .map((s) => (s?.text ? `<h3>${s.title ?? ""}</h3>${s.text}` : ""))
          .join("\n"),
      );
      const companyId = p.company?.identifier ?? identifier;
      postings.push(
        finalize({
          externalId: p.id,
          title: p.name,
          companyName: p.company?.name ?? identifier,
          url:
            (detail?.success && detail.data.postingUrl) ||
            `https://jobs.smartrecruiters.com/${encodeURIComponent(companyId)}/${encodeURIComponent(p.id)}`,
          descriptionText: description,
          // Detail missing → we only have the title: flag as limited evidence.
          descriptionTruncated: !description,
          locationText: p.location?.fullLocation ?? p.location?.city ?? null,
          countryCode: normalizeCountryCode(p.location?.country),
          workplaceType: workplaceFrom(null, p.location?.remote, p.location?.hybrid),
          employmentType: p.typeOfEmployment?.label ?? null,
          publishedAt: p.releasedDate ?? null,
          salary: null,
        }),
      );
    }
    return { postings, seenIds: all.map((p) => p.id), complete, requests, notes };
  },
};

// ---------------------------------------------------------------------------
// Lever Postings API — GET /v0/postings/{site}?mode=json (global or EU host)
// ---------------------------------------------------------------------------

const LeverSchema = z.array(
  z.object({
    id: z.string(),
    text: z.string(),
    hostedUrl: z.string().url(),
    categories: z
      .object({ location: str, commitment: str, allLocations: z.array(z.string()).nullish() })
      .nullish(),
    country: str,
    workplaceType: str,
    descriptionPlain: str,
    additionalPlain: str,
    lists: z.array(z.object({ text: str, content: str })).nullish(),
    createdAt: z.number().nullish(),
    salaryRange: z
      .object({ currency: str, interval: str, min: z.number().nullish(), max: z.number().nullish() })
      .nullish(),
  }),
);

function leverAdapter(provider: "lever" | "lever_eu", host: string): SourceAdapter {
  return {
    provider,
    label: provider === "lever" ? "Lever" : "Lever (EU)",
    async fetchPostings(identifier, ctx) {
      const all: z.infer<typeof LeverSchema> = [];
      let requests = 0;
      for (let page = 0; page < 10; page++) {
        const data = await getOrThrow(
          ctx,
          `https://${host}/v0/postings/${encodeURIComponent(identifier)}?mode=json&limit=200&skip=${page * 200}`,
        );
        requests++;
        const parsed = LeverSchema.safeParse(data);
        if (!parsed.success) throw new SourceError("unexpected response", "invalid_response");
        all.push(...parsed.data);
        if (parsed.data.length < 200) break;
      }
      const postings = all.map((job) => {
        const location = job.categories?.allLocations?.join("; ") || job.categories?.location || null;
        const lists = (job.lists ?? []).map((l) => `${l.text ?? ""}\n${htmlToText(l.content) ?? ""}`).join("\n");
        const salary: Salary | null =
          job.salaryRange && (job.salaryRange.min || job.salaryRange.max)
            ? {
                min: job.salaryRange.min ?? null,
                max: job.salaryRange.max ?? null,
                currency: (job.salaryRange.currency ?? "").toUpperCase(),
                interval: /year|annual/i.test(job.salaryRange.interval ?? "")
                  ? "year"
                  : /month/i.test(job.salaryRange.interval ?? "")
                    ? "month"
                    : /hour/i.test(job.salaryRange.interval ?? "")
                      ? "hour"
                      : "unknown",
                source: "structured",
              }
            : null;
        return finalize({
          externalId: job.id,
          title: job.text,
          companyName: identifier,
          url: job.hostedUrl,
          descriptionText: [job.descriptionPlain, lists, job.additionalPlain].filter(Boolean).join("\n\n") || null,
          locationText: location,
          countryCode: normalizeCountryCode(job.country) ?? countryFromLocation(location),
          workplaceType: workplaceFrom(job.workplaceType),
          employmentType: job.categories?.commitment ?? null,
          publishedAt: job.createdAt ? new Date(job.createdAt).toISOString() : null,
          salary,
        });
      });
      return { postings, seenIds: postings.map((p) => p.externalId), complete: true, requests, notes: [] };
    },
  };
}

// ---------------------------------------------------------------------------
// Ashby public job posting API — GET /posting-api/job-board/{name}
// ---------------------------------------------------------------------------

const AshbySchema = z.object({
  jobs: z.array(
    z.object({
      id: z.string(),
      title: z.string(),
      location: str,
      secondaryLocations: z.array(z.object({ location: str })).nullish(),
      workplaceType: str,
      isRemote: z.boolean().nullish(),
      employmentType: str,
      publishedAt: str,
      jobUrl: z.string().url(),
      descriptionPlain: str,
      isListed: z.boolean().nullish(),
      address: z.object({ postalAddress: z.object({ addressCountry: str }).nullish() }).nullish(),
      compensation: z
        .object({
          summaryComponents: z
            .array(
              z.object({
                compensationType: str,
                interval: str,
                currencyCode: str,
                minValue: z.number().nullish(),
                maxValue: z.number().nullish(),
              }),
            )
            .nullish(),
        })
        .nullish(),
    }),
  ),
});

export const ashbyAdapter: SourceAdapter = {
  provider: "ashby",
  label: "Ashby",
  async fetchPostings(identifier, ctx) {
    const data = await getOrThrow(
      ctx,
      `https://api.ashbyhq.com/posting-api/job-board/${encodeURIComponent(identifier)}?includeCompensation=true`,
    );
    const parsed = AshbySchema.safeParse(data);
    if (!parsed.success) throw new SourceError("unexpected response", "invalid_response");

    const postings = parsed.data.jobs
      .filter((job) => job.isListed !== false)
      .map((job) => {
        const locations = [job.location, ...(job.secondaryLocations ?? []).map((l) => l.location)].filter(Boolean);
        const locationText = locations.join("; ") || null;
        const salaryPart = job.compensation?.summaryComponents?.find((c) => /salary/i.test(c.compensationType ?? ""));
        const salary: Salary | null = salaryPart
          ? {
              min: salaryPart.minValue ?? null,
              max: salaryPart.maxValue ?? null,
              currency: (salaryPart.currencyCode ?? "").toUpperCase(),
              interval: /year/i.test(salaryPart.interval ?? "") ? "year" : /month/i.test(salaryPart.interval ?? "") ? "month" : "unknown",
              source: "structured",
            }
          : null;
        return finalize({
          externalId: job.id,
          title: job.title,
          companyName: identifier,
          url: job.jobUrl,
          descriptionText: job.descriptionPlain ?? null,
          locationText,
          countryCode:
            normalizeCountryCode(job.address?.postalAddress?.addressCountry) ?? countryFromLocation(locationText),
          workplaceType: workplaceFrom(job.workplaceType, job.isRemote && !job.workplaceType ? true : null),
          employmentType: job.employmentType ?? null,
          publishedAt: job.publishedAt ?? null,
          salary,
        });
      });
    return { postings, seenIds: postings.map((p) => p.externalId), complete: true, requests: 1, notes: [] };
  },
};

// ---------------------------------------------------------------------------
// Jobicy (remote jobs aggregator, free API with attribution; ≤1 req/s)
// ---------------------------------------------------------------------------

const JobicySchema = z.object({
  jobs: z
    .array(
      z.object({
        id: z.union([z.number(), z.string()]),
        url: z.string().url(),
        jobTitle: z.string(),
        companyName: z.string(),
        jobGeo: str,
        jobType: z.union([z.array(z.string()), z.string()]).nullish(),
        jobDescription: str,
        jobExcerpt: str,
        pubDate: str,
        salaryMin: z.union([z.number(), z.string()]).nullish(),
        salaryMax: z.union([z.number(), z.string()]).nullish(),
        salaryCurrency: str,
        salaryPeriod: str,
      }),
    )
    .default([]),
});

export const jobicyAdapter: SourceAdapter = {
  provider: "jobicy",
  label: "Jobicy (remote)",
  async fetchPostings(identifier, ctx) {
    const data = await getOrThrow(ctx, `https://jobicy.com/api/v2/remote-jobs?count=100&geo=${encodeURIComponent(identifier)}`);
    const parsed = JobicySchema.safeParse(data);
    if (!parsed.success) throw new SourceError("unexpected response", "invalid_response");
    const postings = parsed.data.jobs.map((job) => {
      const num = (v: unknown) => (v === null || v === undefined || v === "" ? null : Number(v));
      const min = num(job.salaryMin);
      const max = num(job.salaryMax);
      return finalize({
        externalId: String(job.id),
        title: job.jobTitle,
        companyName: job.companyName,
        url: job.url, // Jobicy terms: link to the Jobicy page and credit Jobicy.
        descriptionText: htmlToText(job.jobDescription) ?? job.jobExcerpt ?? null,
        locationText: job.jobGeo ? `Remote (${job.jobGeo})` : "Remote",
        countryCode: null,
        workplaceType: "remote",
        employmentType: Array.isArray(job.jobType) ? job.jobType.join(", ") : (job.jobType ?? null),
        publishedAt: job.pubDate ?? null,
        salary:
          min || max
            ? {
                min: Number.isFinite(min) ? min : null,
                max: Number.isFinite(max) ? max : null,
                currency: (job.salaryCurrency ?? "").toUpperCase(),
                interval: /year/i.test(job.salaryPeriod ?? "") ? "year" : /month/i.test(job.salaryPeriod ?? "") ? "month" : "unknown",
                source: "structured",
              }
            : null,
      });
    });
    // Jobicy only returns recent postings: the feed is never "complete" for closing purposes.
    return { postings, seenIds: postings.map((p) => p.externalId), complete: false, requests: 1, notes: ["Jobs by Jobicy"] };
  },
};

// ---------------------------------------------------------------------------
// Adzuna (licensed aggregator; needs ADZUNA_APP_ID/ADZUNA_APP_KEY)
// ---------------------------------------------------------------------------

const AdzunaSchema = z.object({
  results: z.array(
    z.object({
      id: z.union([z.string(), z.number()]),
      title: z.string(),
      description: str,
      redirect_url: z.string().url(),
      created: str,
      company: z.object({ display_name: str }).nullish(),
      location: z.object({ display_name: str }).nullish(),
      salary_min: z.number().nullish(),
      salary_max: z.number().nullish(),
      salary_is_predicted: z.union([z.string(), z.number()]).nullish(),
      contract_type: str,
      contract_time: str,
    }),
  ),
});

const ADZUNA_MAX_QUERIES = 10;

export const adzunaAdapter: SourceAdapter = {
  provider: "adzuna",
  label: "Adzuna NL",
  async fetchPostings(identifier, ctx) {
    const { adzunaAppId, adzunaAppKey } = ctx.env;
    if (!adzunaAppId || !adzunaAppKey) throw new SourceError("Adzuna API key not configured", "not_configured");
    const country = identifier === "nl" ? "nl" : identifier;
    const byId = new Map<string, RawPosting>();
    let requests = 0;
    for (const phrase of ctx.searchPhrases.slice(0, ADZUNA_MAX_QUERIES)) {
      const params = new URLSearchParams({
        app_id: adzunaAppId,
        app_key: adzunaAppKey,
        results_per_page: "50",
        what_phrase: phrase,
        max_days_old: "30",
        sort_by: "date",
        "content-type": "application/json",
      });
      const data = await getOrThrow(ctx, `https://api.adzuna.com/v1/api/jobs/${country}/search/1?${params}`);
      requests++;
      const parsed = AdzunaSchema.safeParse(data);
      if (!parsed.success) throw new SourceError("unexpected response", "invalid_response");
      for (const job of parsed.data.results) {
        const predicted = String(job.salary_is_predicted ?? "0") === "1";
        byId.set(
          String(job.id),
          finalize({
            externalId: String(job.id),
            title: job.title.replace(/<\/?strong>/g, ""),
            companyName: job.company?.display_name ?? "Onbekende werkgever",
            url: job.redirect_url,
            descriptionText: htmlToText(job.description),
            // Adzuna only returns an excerpt.
            descriptionTruncated: true,
            locationText: job.location?.display_name ?? null,
            countryCode: country,
            workplaceType: "unknown",
            employmentType: [job.contract_type, job.contract_time].filter(Boolean).join(", ") || null,
            publishedAt: job.created ?? null,
            // Predicted salaries are estimates, not published facts: ignored.
            salary:
              !predicted && (job.salary_min || job.salary_max)
                ? { min: job.salary_min ?? null, max: job.salary_max ?? null, currency: "EUR", interval: "year", source: "structured" }
                : null,
          }),
        );
      }
    }
    const postings = [...byId.values()];
    return { postings, seenIds: postings.map((p) => p.externalId), complete: false, requests, notes: ["Jobs by Adzuna"] };
  },
};

export const adapters: Record<SourceProvider, SourceAdapter> = {
  greenhouse: greenhouseAdapter,
  smartrecruiters: smartRecruitersAdapter,
  lever: leverAdapter("lever", "api.lever.co"),
  lever_eu: leverAdapter("lever_eu", "api.eu.lever.co"),
  ashby: ashbyAdapter,
  jobicy: jobicyAdapter,
  adzuna: adzunaAdapter,
};

export type { FetchResult };
