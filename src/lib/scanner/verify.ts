import { acronymOf, normalizeEmployerName } from "@/lib/preferences/employers";
import type { AtsProvider, FetchJson } from "./types";

/**
 * Finds a company's official public job board on the supported ATS systems.
 * A board only counts as "verified" when the board's own company name
 * matches (SmartRecruiters/Greenhouse) or the identifier is an exact slug of
 * the company name (Lever/Ashby expose no company name). Results always need
 * the user's approval before they are scanned.
 */

export interface BoardCandidate {
  provider: AtsProvider;
  identifier: string;
  displayName: string | null;
  jobCount: number | null;
  verified: boolean;
  detail: string;
}

const URL_PATTERNS: { provider: AtsProvider; pattern: RegExp }[] = [
  { provider: "greenhouse", pattern: /^https?:\/\/(?:job-)?boards(?:\.eu)?\.greenhouse\.io\/(?:embed\/job_board\?for=)?([A-Za-z0-9._-]+)/i },
  { provider: "smartrecruiters", pattern: /^https?:\/\/(?:jobs|careers)\.smartrecruiters\.com\/([A-Za-z0-9._-]+)/i },
  { provider: "lever_eu", pattern: /^https?:\/\/jobs\.eu\.lever\.co\/([A-Za-z0-9._-]+)/i },
  { provider: "lever", pattern: /^https?:\/\/jobs\.lever\.co\/([A-Za-z0-9._-]+)/i },
  { provider: "ashby", pattern: /^https?:\/\/jobs\.ashbyhq\.com\/([A-Za-z0-9._-]+)/i },
];

/** Recognises a careers URL of a supported ATS and returns provider + identifier. */
export function parseCareersUrl(url: string): { provider: AtsProvider; identifier: string } | null {
  for (const { provider, pattern } of URL_PATTERNS) {
    const match = pattern.exec(url.trim());
    if (match?.[1]) return { provider, identifier: match[1] };
  }
  return null;
}

export function slugCandidates(companyName: string): { exact: string[]; extended: string[] } {
  const base = normalizeEmployerName(companyName);
  const words = base.split(" ").filter(Boolean);
  const joined = words.join("");
  const hyphen = words.join("-");
  const exact = [...new Set([joined, hyphen])].filter((s) => /^[a-z0-9-]{2,60}$/.test(s));
  const extended = [...new Set([`${joined}group`, `${joined}company`, `the${joined}company`, `${joined}careers`])].filter(
    (s) => /^[a-z0-9-]{2,80}$/.test(s),
  );
  return { exact, extended };
}

export function namesMatch(companyName: string, boardName: string | null | undefined): boolean {
  if (!boardName) return false;
  const a = normalizeEmployerName(companyName).replace(/\s+/g, "");
  const b = normalizeEmployerName(boardName).replace(/\s+/g, "");
  if (!a || !b) return false;
  // The board may add a suffix ("Bosch Group" for "Bosch"), never drop words.
  if (a === b || b.startsWith(a)) return true;
  const acronym = acronymOf(normalizeEmployerName(boardName));
  return acronym.length >= 2 && acronym === a;
}

interface ProbeDeps {
  fetchJson: FetchJson;
}

async function probe(provider: AtsProvider, slug: string, companyName: string, exactSlug: boolean, deps: ProbeDeps) {
  const { fetchJson } = deps;
  switch (provider) {
    case "smartrecruiters": {
      const r = await fetchJson(`https://api.smartrecruiters.com/v1/companies/${slug}/postings?limit=1`);
      const d = r.data as { totalFound?: number; content?: { company?: { name?: string; identifier?: string } }[] } | null;
      // SmartRecruiters answers 200 with 0 results for unknown companies.
      if (!r.ok || !d || !d.totalFound) return null;
      const name = d.content?.[0]?.company?.name ?? null;
      const identifier = d.content?.[0]?.company?.identifier ?? slug;
      const verified = namesMatch(companyName, name);
      return { provider, identifier, displayName: name, jobCount: d.totalFound, verified, detail: verified ? "bedrijfsnaam komt overeen" : `andere bedrijfsnaam: ${name ?? "onbekend"}` };
    }
    case "greenhouse": {
      const r = await fetchJson(`https://boards-api.greenhouse.io/v1/boards/${slug}`);
      const d = r.data as { name?: string } | null;
      if (!r.ok || !d?.name) return null;
      const verified = namesMatch(companyName, d.name);
      return { provider, identifier: slug, displayName: d.name, jobCount: null, verified, detail: verified ? "bedrijfsnaam komt overeen" : `andere bedrijfsnaam: ${d.name}` };
    }
    case "lever":
    case "lever_eu": {
      const host = provider === "lever" ? "api.lever.co" : "api.eu.lever.co";
      const r = await fetchJson(`https://${host}/v0/postings/${slug}?mode=json&limit=1`);
      if (!r.ok || !Array.isArray(r.data)) return null;
      return { provider, identifier: slug, displayName: null, jobCount: null, verified: exactSlug, detail: exactSlug ? "identifier is exact de bedrijfsnaam" : "identifier wijkt af van bedrijfsnaam" };
    }
    case "ashby": {
      const r = await fetchJson(`https://api.ashbyhq.com/posting-api/job-board/${slug}`);
      const d = r.data as { jobs?: unknown[] } | null;
      if (!r.ok || !Array.isArray(d?.jobs)) return null;
      return { provider, identifier: slug, displayName: null, jobCount: d.jobs.length, verified: exactSlug, detail: exactSlug ? "identifier is exact de bedrijfsnaam" : "identifier wijkt af van bedrijfsnaam" };
    }
  }
}

export async function findBoards(companyName: string, deps: ProbeDeps): Promise<BoardCandidate[]> {
  const { exact, extended } = slugCandidates(companyName);
  const tasks: Promise<BoardCandidate | null>[] = [];
  for (const slug of exact) {
    for (const provider of ["smartrecruiters", "greenhouse", "lever", "lever_eu", "ashby"] as const) {
      tasks.push(probe(provider, slug, companyName, true, deps));
    }
  }
  // Extended variants only for providers that return a company name to check.
  for (const slug of extended) {
    for (const provider of ["smartrecruiters", "greenhouse"] as const) {
      tasks.push(probe(provider, slug, companyName, false, deps));
    }
  }
  const results = (await Promise.all(tasks)).filter((r): r is BoardCandidate => r !== null);
  const unique = new Map<string, BoardCandidate>();
  for (const r of results) {
    const key = `${r.provider}:${r.identifier.toLowerCase()}`;
    if (!unique.has(key) || (r.verified && !unique.get(key)!.verified)) unique.set(key, r);
  }
  return [...unique.values()];
}

export async function verifyKnownBoard(
  provider: AtsProvider,
  identifier: string,
  companyName: string,
  deps: ProbeDeps,
): Promise<BoardCandidate | null> {
  // A URL the user supplied counts as exact for Lever/Ashby.
  return probe(provider, identifier, companyName, true, deps);
}
