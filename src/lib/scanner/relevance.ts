import { canonicalWords } from "@/lib/cv/text";
import type { Preferences, TrackId } from "@/lib/preferences/schema";
import { countryFromLocation, mentionsWiderRegion } from "./geo";
import type { RawPosting } from "./types";

/**
 * Deterministic relevance filter (build plan §6, step A). Decides which
 * postings are worth storing at all: a senior commercial/strategy/GM-type
 * title (from the user's search tracks) and a location that can work from
 * the Netherlands. Inclusive by design; AI matching comes later.
 */

const SENIORITY = [
  "director", "directeur", "head", "hoofd", "vp", "vice president", "chief", "general manager",
  "country manager", "managing director", "algemeen directeur", "lead", "leader", "manager",
];

const DOMAIN_TO_TRACK: Record<string, TrackId> = {
  "general manager": "general_management",
  "country manager": "general_management",
  "managing director": "general_management",
  "business unit": "general_management",
  "algemeen directeur": "general_management",
  "vestigingsdirecteur": "general_management",
  strategy: "strategy_transformation",
  strategic: "strategy_transformation",
  strategie: "strategy_transformation",
  transformation: "strategy_transformation",
  "chief of staff": "strategy_transformation",
  commercial: "commercial_leadership",
  commercieel: "commercial_leadership",
  commerciele: "commercial_leadership",
  sales: "commercial_leadership",
  wholesale: "commercial_leadership",
  growth: "commercial_leadership",
  revenue: "commercial_leadership",
  "key account": "commercial_leadership",
  partnership: "partnerships_market_development",
  partnerships: "partnerships_market_development",
  alliances: "partnerships_market_development",
  alliance: "partnerships_market_development",
  channel: "partnerships_market_development",
  "market development": "partnerships_market_development",
  "business development": "partnerships_market_development",
  ecosystem: "partnerships_market_development",
};

const TOO_JUNIOR = ["intern", "internship", "stagiair", "stage", "trainee", "junior", "werkstudent", "working student", "assistant", "graduate"];

// "manager" alone is too broad; it only counts together with a domain word
// that already implies leadership (e.g. "Wholesale Manager", "Channel Manager").
const STRONG_SENIORITY = SENIORITY.filter((s) => s !== "manager" && s !== "lead");

const NL_HINTS = ["netherlands", "nederland", "benelux", "holland"];

export interface Relevance {
  relevant: boolean;
  trackHits: TrackId[];
  reasons: string[];
  locationOk: boolean;
}

function has(words: string, phrase: string): boolean {
  return words.includes(canonicalWords(phrase));
}

export function titleTrackHits(title: string, prefs: Preferences): { hits: TrackId[]; reasons: string[] } {
  const words = canonicalWords(title);
  const hits = new Set<TrackId>();
  const reasons: string[] = [];

  for (const track of prefs.tracks) {
    if (!track.enabled) continue;
    const matched = track.titles.find((t) => has(words, t));
    if (matched) {
      hits.add(track.id);
      reasons.push(`titel bevat "${matched}"`);
    }
  }

  if (hits.size === 0) {
    const strong = STRONG_SENIORITY.some((s) => has(words, s));
    const manager = has(words, "manager");
    for (const [domain, track] of Object.entries(DOMAIN_TO_TRACK)) {
      const enabled = prefs.tracks.find((t) => t.id === track)?.enabled;
      if (!enabled || !has(words, domain)) continue;
      // Domains that are titles themselves ("general manager") count alone.
      const isTitle = ["general manager", "country manager", "managing director", "algemeen directeur", "chief of staff"].includes(domain);
      const managerDomains = ["wholesale", "channel", "partnership", "partnerships", "alliances", "market development", "business unit", "commercial", "commercieel", "commerciele"];
      if (isTitle || strong || (manager && managerDomains.includes(domain))) {
        hits.add(track);
        reasons.push(`seniore titel met "${domain}"`);
      }
    }
  }
  return { hits: [...hits], reasons };
}

export function isNegativeTitle(title: string, prefs: Preferences): string | null {
  const words = canonicalWords(title);
  const negative = prefs.negativeRoleSignals.find((s) => has(words, s));
  if (negative) return `negatief rolsignaal "${negative}"`;
  const junior = TOO_JUNIOR.find((s) => has(words, s));
  if (junior) return `te junior ("${junior}")`;
  return null;
}

export function locationAcceptable(
  posting: Pick<RawPosting, "locationText" | "countryCode" | "workplaceType">,
  prefs: Preferences,
): { ok: boolean; reason: string } {
  const country = posting.countryCode ?? countryFromLocation(posting.locationText);
  const words = canonicalWords(posting.locationText ?? "");

  if (country === "nl" || NL_HINTS.some((h) => words.includes(` ${h} `))) return { ok: true, reason: "Nederland" };

  const preferred = prefs.locations.preferred.find((p) => words.includes(canonicalWords(p)));
  if (preferred) return { ok: true, reason: `voorkeurslocatie "${preferred}"` };

  if (posting.workplaceType === "remote" && (!country || mentionsWiderRegion(posting.locationText))) {
    return { ok: true, reason: "remote (regio Europa/EMEA of onbekend)" };
  }
  if (!country && mentionsWiderRegion(posting.locationText)) return { ok: true, reason: "regio Europa/EMEA" };
  if (!posting.locationText) return { ok: true, reason: "locatie onbekend" };
  return { ok: false, reason: `standplaats ${country ?? posting.locationText}` };
}

export function assessRelevance(posting: RawPosting, prefs: Preferences): Relevance {
  const negative = isNegativeTitle(posting.title, prefs);
  if (negative) return { relevant: false, trackHits: [], reasons: [negative], locationOk: false };

  const { hits, reasons } = titleTrackHits(posting.title, prefs);
  if (hits.length === 0) return { relevant: false, trackHits: [], reasons: ["titel past niet bij je zoeksporen"], locationOk: false };

  const location = locationAcceptable(posting, prefs);
  return {
    relevant: location.ok,
    trackHits: hits,
    reasons: [...reasons, location.reason],
    locationOk: location.ok,
  };
}

/** Quick pre-filter used by adapters before fetching details. */
export function makeCandidateTitleFilter(prefs: Preferences): (title: string) => boolean {
  return (title) => !isNegativeTitle(title, prefs) && titleTrackHits(title, prefs).hits.length > 0;
}

/** Search phrases for aggregators: the first titles of each enabled track. */
export function searchPhrases(prefs: Preferences, perTrack = 3): string[] {
  const phrases = prefs.tracks.filter((t) => t.enabled).flatMap((t) => t.titles.slice(0, perTrack));
  return [...new Set(phrases)];
}
