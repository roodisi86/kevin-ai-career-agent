import { z } from "zod";

/**
 * Career assessment ("loopbaanprofiel"). Everything here is stated by the
 * candidate. Nothing is inferred, scored or typed: the answers are matching
 * input only. Every field is optional, because an unanswered question is
 * unknown, not "no".
 */

export const ASSESSMENT_SCHEMA_VERSION = 1;

export const activityIds = [
  "set_strategy",
  "build_teams",
  "build_partnerships",
  "long_relationships",
  "open_markets",
  "own_results",
  "design_gtm",
  "lead_change",
  "negotiate_deals",
  "cold_prospecting",
  "daily_operations",
  "analysis_reporting",
  "represent_external",
  "travel_international",
] as const;
export type ActivityId = (typeof activityIds)[number];

export const energyValues = ["energy", "neutral", "drain"] as const;
export type EnergyValue = (typeof energyValues)[number];

export const employerTypeIds = [
  "multinational",
  "corporate_nl",
  "scaleup",
  "startup",
  "pe_backed",
  "family_owned",
  "public_nonprofit",
] as const;
export type EmployerTypeId = (typeof employerTypeIds)[number];
export const employerTypeValues = ["wanted", "ok", "avoid"] as const;

export const cultureIds = [
  "entrepreneurial",
  "structured",
  "international",
  "data_driven",
  "people_first",
  "fast_paced",
  "autonomy",
  "mission_driven",
  "stable",
] as const;

export const reportingIds = ["ceo_board", "regional_global", "country_leadership", "no_preference"] as const;
export const scopeIds = ["nl", "benelux", "europe", "global"] as const;
export const languageIds = ["nl", "en", "fr", "es", "de"] as const;

export const choiceOptions = {
  newBusinessShareMax: ["0_20", "20_40", "40_60", "60_plus"],
  quotaPreference: ["no_personal_quota", "team_target_ok", "personal_quota_ok"],
  cycleLength: ["short", "medium", "long", "no_preference"],
  teamSize: ["none", "1_5", "6_15", "16_50", "50_plus", "no_preference"],
  resultsResponsibility: ["must", "wanted", "not_needed"],
  minCompanySize: ["any", "50", "250", "1000", "5000"],
  travelMax: ["travel_none", "travel_10", "travel_25", "travel_50", "travel_more"],
} as const;
export type ChoiceKey = keyof typeof choiceOptions;

export const textKeys = [
  "idealRole",
  "mustHaves",
  "dealBreakers",
  "strengthsOwnWords",
  "whatDifferent",
  "sectorsEnergy",
] as const;
export type TextKey = (typeof textKeys)[number];

const scale = z.number().int().min(1).max(5);
const text = z.string().trim().max(1500);

const choice = <K extends ChoiceKey>(key: K) => z.enum(choiceOptions[key]).optional();

const uniqueEnumArray = <T extends readonly [string, ...string[]]>(values: T, max: number) =>
  z
    .array(z.enum(values))
    .max(max)
    .transform((items) => [...new Set(items)]);

export const AssessmentAnswersSchema = z.object({
  activities: z.partialRecord(z.enum(activityIds), z.enum(energyValues)).default({}),
  newBusinessShareMax: choice("newBusinessShareMax"),
  quotaPreference: choice("quotaPreference"),
  cycleLength: choice("cycleLength"),
  strategicVsOperational: scale.optional(),
  handsOnVsThroughOthers: scale.optional(),
  teamSize: choice("teamSize"),
  resultsResponsibility: choice("resultsResponsibility"),
  reportingLines: uniqueEnumArray(reportingIds, reportingIds.length).default([]),
  geographicScope: uniqueEnumArray(scopeIds, scopeIds.length).default([]),
  employerTypes: z.partialRecord(z.enum(employerTypeIds), z.enum(employerTypeValues)).default({}),
  minCompanySize: choice("minCompanySize"),
  travelMax: choice("travelMax"),
  officeDaysMax: z.number().int().min(0).max(5).optional(),
  culture: uniqueEnumArray(cultureIds, 5).default([]),
  workLanguages: uniqueEnumArray(languageIds, languageIds.length).default([]),
  texts: z.partialRecord(z.enum(textKeys), text).default({}),
});

export type AssessmentAnswers = z.infer<typeof AssessmentAnswersSchema>;

export function emptyAssessment(): AssessmentAnswers {
  return AssessmentAnswersSchema.parse({});
}

export function parseStoredAssessment(value: unknown): AssessmentAnswers {
  const parsed = AssessmentAnswersSchema.safeParse(value ?? {});
  return parsed.success ? parsed.data : emptyAssessment();
}

/** Number of answered questions and total, for the progress indicator. */
export function assessmentProgress(a: AssessmentAnswers): { answered: number; total: number } {
  const singles: unknown[] = [
    a.newBusinessShareMax,
    a.quotaPreference,
    a.cycleLength,
    a.strategicVsOperational,
    a.handsOnVsThroughOthers,
    a.teamSize,
    a.resultsResponsibility,
    a.minCompanySize,
    a.travelMax,
    a.officeDaysMax,
  ];
  const lists = [a.reportingLines, a.geographicScope, a.culture, a.workLanguages];
  const answered =
    Object.keys(a.activities).length +
    Object.keys(a.employerTypes).length +
    singles.filter((v) => v !== undefined).length +
    lists.filter((l) => l.length > 0).length +
    textKeys.filter((k) => (a.texts[k] ?? "").length > 0).length;
  const total =
    activityIds.length + employerTypeIds.length + singles.length + lists.length + textKeys.length;
  return { answered, total };
}

/**
 * Renders the answers as plain lines for the matching prompt. Unanswered
 * questions are left out (the prompt treats them as unknown).
 */
export function assessmentToPromptLines(a: AssessmentAnswers, labels: AssessmentPromptLabels): string[] {
  const lines: string[] = [];
  const byEnergy = (v: EnergyValue) =>
    activityIds.filter((id) => a.activities[id] === v).map((id) => labels.activities[id]);
  const energy = byEnergy("energy");
  const drain = byEnergy("drain");
  if (energy.length) lines.push(`Gives energy: ${energy.join("; ")}`);
  if (drain.length) lines.push(`Costs energy: ${drain.join("; ")}`);
  const choices: [string, string | undefined][] = [
    ["Maximum share of new-business acquisition", a.newBusinessShareMax],
    ["Quota", a.quotaPreference],
    ["Preferred sales/decision cycle", a.cycleLength],
    ["Desired team size", a.teamSize],
    ["Results/P&L responsibility in next role", a.resultsResponsibility],
    ["Minimum company size (employees)", a.minCompanySize],
    ["Maximum travel (% of time)", a.travelMax],
  ];
  for (const [label, value] of choices) if (value) lines.push(`${label}: ${labels.choice(value)}`);
  if (a.strategicVsOperational) lines.push(`Strategic vs operational (1 = operational, 5 = strategic): ${a.strategicVsOperational}`);
  if (a.handsOnVsThroughOthers) lines.push(`Hands-on vs leading through others (1 = hands-on, 5 = through others): ${a.handsOnVsThroughOthers}`);
  if (a.officeDaysMax !== undefined) lines.push(`Maximum office days per week: ${a.officeDaysMax}`);
  if (a.reportingLines.length) lines.push(`Preferred reporting line: ${a.reportingLines.map(labels.choice).join("; ")}`);
  if (a.geographicScope.length) lines.push(`Geographic scope: ${a.geographicScope.map(labels.choice).join("; ")}`);
  const employer = (v: (typeof employerTypeValues)[number]) =>
    employerTypeIds.filter((id) => a.employerTypes[id] === v).map((id) => labels.employerTypes[id]);
  if (employer("wanted").length) lines.push(`Employer types wanted: ${employer("wanted").join("; ")}`);
  if (employer("avoid").length) lines.push(`Employer types to avoid: ${employer("avoid").join("; ")}`);
  if (a.culture.length) lines.push(`Culture that fits: ${a.culture.map(labels.choice).join("; ")}`);
  if (a.workLanguages.length) lines.push(`Working languages: ${a.workLanguages.map(labels.choice).join("; ")}`);
  for (const key of textKeys) {
    const value = (a.texts[key] ?? "").replace(/\s+/g, " ").trim();
    if (value) lines.push(`${labels.texts[key]}: ${value}`);
  }
  return lines;
}

export interface AssessmentPromptLabels {
  activities: Record<ActivityId, string>;
  employerTypes: Record<EmployerTypeId, string>;
  texts: Record<TextKey, string>;
  choice: (value: string) => string;
}

/** English labels for the prompt (the UI labels live in i18n). */
export const PROMPT_LABELS: AssessmentPromptLabels = {
  activities: {
    set_strategy: "setting strategy and direction",
    build_teams: "building and coaching teams",
    build_partnerships: "building partnerships and alliances",
    long_relationships: "long-term client relationships / key accounts",
    open_markets: "opening new markets or countries",
    own_results: "owning a P&L or business result",
    design_gtm: "designing go-to-market and commercial processes",
    lead_change: "leading change and transformation",
    negotiate_deals: "negotiating large, complex deals",
    cold_prospecting: "cold acquisition / prospecting",
    daily_operations: "running day-to-day operations",
    analysis_reporting: "analysis, forecasting and reporting",
    represent_external: "representing the company externally (events, media)",
    travel_international: "international travel",
  },
  employerTypes: {
    multinational: "multinational",
    corporate_nl: "Dutch corporate",
    scaleup: "scale-up",
    startup: "start-up",
    pe_backed: "private-equity backed",
    family_owned: "family-owned",
    public_nonprofit: "public sector / non-profit",
  },
  texts: {
    idealRole: "Ideal role (own words)",
    mustHaves: "Must-haves",
    dealBreakers: "Deal-breakers",
    strengthsOwnWords: "Strengths (own words, not verified)",
    whatDifferent: "What should be different from the last role",
    sectorsEnergy: "Sectors/products that energise",
  },
  choice: (value) =>
    ({
      "0_20": "0-20%",
      "20_40": "20-40%",
      "40_60": "40-60%",
      "60_plus": "more than 60%",
      no_personal_quota: "no personal quota",
      team_target_ok: "team target is fine, no personal hunter quota",
      personal_quota_ok: "personal quota is fine",
      short: "short",
      medium: "medium",
      long: "long",
      no_preference: "no preference",
      none: "no team",
      "1_5": "1-5",
      "6_15": "6-15",
      "16_50": "16-50",
      "50_plus": "more than 50",
      must: "must have",
      wanted: "wanted",
      not_needed: "not needed",
      any: "any size",
      "50": "50+",
      "250": "250+",
      "1000": "1,000+",
      "5000": "5,000+",
      travel_none: "no travel",
      travel_10: "up to 10%",
      travel_25: "up to 25%",
      travel_50: "up to 50%",
      travel_more: "more than 50%",
      ceo_board: "CEO / board",
      regional_global: "regional or global leadership",
      country_leadership: "country leadership",
      nl: "Netherlands / Dutch",
      benelux: "Benelux",
      europe: "Europe",
      global: "global",
      en: "English",
      fr: "French",
      es: "Spanish",
      de: "German",
      entrepreneurial: "entrepreneurial",
      structured: "structured",
      international: "international",
      data_driven: "data-driven",
      people_first: "people first",
      fast_paced: "fast-paced",
      autonomy: "autonomy",
      mission_driven: "mission-driven",
      stable: "stable",
    })[value] ?? value,
};
