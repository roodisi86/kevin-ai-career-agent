import { canonicalWords } from "@/lib/cv/text";
import type { Preferences } from "@/lib/preferences/schema";
import { AssessmentAnswersSchema, type AssessmentAnswers } from "./schema";

/**
 * Rule-based proposal for the career assessment, derived only from what the
 * candidate already stated: their preferences and their confirmed facts.
 * It is a proposal: the form fills only unanswered questions with it, marks
 * them as proposed, and nothing is used until the candidate saves.
 */
export function suggestAssessment(prefs: Preferences, confirmedFacts: { category: string; statement: string }[]): AssessmentAnswers {
  const tracks = new Set(prefs.tracks.filter((t) => t.enabled).map((t) => t.id));
  const negative = canonicalWords(prefs.negativeRoleSignals.join(" "));
  const has = (w: string) => negative.includes(` ${canonicalWords(w).trim()} `);
  const activities: AssessmentAnswers["activities"] = {};
  const answers: Record<string, unknown> = { activities };

  if (tracks.has("general_management")) {
    activities.own_results = "energy";
    activities.build_teams = "energy";
  }
  if (tracks.has("strategy_transformation")) {
    activities.set_strategy = "energy";
    activities.lead_change = "energy";
  }
  if (tracks.has("commercial_leadership")) {
    activities.design_gtm = "energy";
    activities.long_relationships = "energy";
  }
  if (tracks.has("partnerships_market_development")) {
    activities.build_partnerships = "energy";
    activities.open_markets = "energy";
  }

  const huntingIsNegative = ["SDR", "BDR", "hunter", "quota-carrying hunter", "100% new business", "cold calling"].some(has);
  if (huntingIsNegative) {
    activities.cold_prospecting = "drain";
    answers.quotaPreference = "team_target_ok";
    answers.newBusinessShareMax = "20_40";
    answers.cycleLength = "long";
  }

  if (prefs.constraints.multinational !== "ignore") {
    answers.employerTypes = { multinational: "wanted" };
    answers.minCompanySize = "1000";
  }
  if (prefs.locations.internationalTravel === "welcome") {
    activities.travel_international = "energy";
    answers.travelMax = "travel_25";
    answers.geographicScope = ["benelux", "europe"];
  } else if (prefs.locations.internationalTravel === "limited") {
    answers.travelMax = "travel_10";
  } else if (prefs.locations.internationalTravel === "no") {
    answers.travelMax = "travel_none";
  }
  if (prefs.constraints.remoteHybrid !== "ignore") answers.officeDaysMax = 3;

  // Working languages: only from confirmed language facts.
  const languageText = canonicalWords(
    confirmedFacts.filter((f) => f.category === "language").map((f) => f.statement).join(" "),
  );
  const languageWords: Record<string, string[]> = {
    nl: ["nederlands", "dutch", "vlaams", "flemish"],
    en: ["engels", "english"],
    fr: ["frans", "french", "francais"],
    es: ["spaans", "spanish", "espanol", "castellano"],
    de: ["duits", "german", "deutsch"],
  };
  const languages = Object.entries(languageWords)
    .filter(([, words]) => words.some((w) => languageText.includes(` ${w} `)))
    .map(([code]) => code);
  if (languages.length) answers.workLanguages = languages;

  const titles = prefs.tracks.filter((t) => t.enabled).flatMap((t) => t.titles.slice(0, 2));
  if (titles.length) {
    answers.texts = { idealRole: `Een rol als ${titles.slice(0, 6).join(", ")}.` };
  }
  return AssessmentAnswersSchema.parse(answers);
}

/** Keys of top-level questions that are unanswered in `current`. */
export function mergeProposal(current: AssessmentAnswers, proposal: AssessmentAnswers): { merged: AssessmentAnswers; filled: string[] } {
  const merged: AssessmentAnswers = structuredClone(current);
  const filled: string[] = [];
  const target = merged as Record<string, unknown>;
  const source = proposal as Record<string, unknown>;

  for (const [key, value] of Object.entries(source)) {
    if (key === "activities" || key === "employerTypes" || key === "texts") {
      const into = (target[key] ?? {}) as Record<string, unknown>;
      for (const [sub, v] of Object.entries((value ?? {}) as Record<string, unknown>)) {
        if (into[sub] === undefined || into[sub] === "") {
          into[sub] = v;
          filled.push(`${key}.${sub}`);
        }
      }
      target[key] = into;
    } else if (Array.isArray(value)) {
      if (((target[key] as unknown[]) ?? []).length === 0 && value.length > 0) {
        target[key] = value;
        filled.push(key);
      }
    } else if (value !== undefined && target[key] === undefined) {
      target[key] = value;
      filled.push(key);
    }
  }
  return { merged: AssessmentAnswersSchema.parse(merged), filled };
}
