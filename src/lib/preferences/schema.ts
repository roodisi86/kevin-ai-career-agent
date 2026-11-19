import { z } from "zod";

/**
 * Search preferences. Every value here is a user setting: nothing about
 * Kevin's personal situation is hard-coded. Defaults are deliberately neutral
 * (no salary, no locations, no excluded employers); only the search-track
 * title synonyms from the build plan are pre-filled as editable suggestions.
 */

const shortText = z.string().trim().min(1).max(120);

export const constraintModes = ["hard", "soft", "ignore"] as const;
export const ConstraintMode = z.enum(constraintModes);
export type ConstraintMode = z.infer<typeof ConstraintMode>;

export const trackIds = [
  "general_management",
  "strategy_transformation",
  "commercial_leadership",
  "partnerships_market_development",
] as const;
export const TrackId = z.enum(trackIds);
export type TrackId = z.infer<typeof TrackId>;

export const sectorPriorities = ["boost", "neutral", "lower", "exclude"] as const;
export const SectorPriority = z.enum(sectorPriorities);
export type SectorPriority = z.infer<typeof SectorPriority>;

export const seniorityLevels = ["manager", "director", "executive"] as const;
export const SeniorityLevel = z.enum(seniorityLevels);
export type SeniorityLevel = z.infer<typeof SeniorityLevel>;

/**
 * Title words that mark operational, site-level or assistant roles rather
 * than corporate leadership. Editable defaults (a user setting, not a rule).
 */
export const DEFAULT_EXCLUDED_TITLE_TERMS = [
  "assistant",
  "assistent",
  "deputy",
  "adjunct",
  "plaatsvervangend",
  "restaurant",
  "store",
  "winkel",
  "filiaal",
  "shop",
  "shift",
  "kitchen",
  "keuken",
  "supervisor",
  "teamleider",
  "team leader",
  "inside sales",
];

export const constraintKeys = ["dutchContract", "multinational", "companyCar", "remoteHybrid"] as const;
export type ConstraintKey = (typeof constraintKeys)[number];

const uniqueStrings = (max: number) =>
  z
    .array(shortText)
    .max(max)
    .transform((items) => Array.from(new Map(items.map((i) => [i.toLowerCase(), i])).values()));

export const PreferencesSchema = z.object({
  tracks: z
    .array(
      z.object({
        id: TrackId,
        enabled: z.boolean(),
        titles: uniqueStrings(40),
      }),
    )
    .length(trackIds.length)
    .refine((tracks) => new Set(tracks.map((t) => t.id)).size === tracks.length, "duplicate track"),
  constraints: z.object({
    dutchContract: ConstraintMode,
    multinational: ConstraintMode,
    companyCar: ConstraintMode,
    remoteHybrid: ConstraintMode,
  }),
  salary: z.object({
    minimumAnnualBase: z.number().int().positive().max(10_000_000).nullable(),
    currency: z.literal("EUR"),
    mode: ConstraintMode,
  }),
  locations: z.object({
    preferred: uniqueStrings(30),
    maxOneWayCommuteMinutes: z.number().int().min(0).max(600).nullable(),
    internationalTravel: z.enum(["welcome", "limited", "no", "unspecified"]),
  }),
  sectors: z
    .array(z.object({ name: shortText, priority: SectorPriority }))
    .max(80)
    .refine(
      (sectors) => new Set(sectors.map((s) => s.name.toLowerCase())).size === sectors.length,
      "duplicate sector",
    ),
  excludedEmployers: z
    .array(z.object({ name: shortText, aliases: uniqueStrings(10) }))
    .max(200),
  negativeRoleSignals: uniqueStrings(40),
  // Added after the first release: defaults keep older stored preferences valid.
  excludedTitleTerms: uniqueStrings(80).default(DEFAULT_EXCLUDED_TITLE_TERMS),
  excludeRecruitmentAgencies: z.boolean().default(true),
  minimumSeniority: SeniorityLevel.default("manager"),
  earliestStartDate: z
    .string()
    .regex(/^\d{4}-\d{2}-\d{2}$/)
    .nullable(),
});

export type Preferences = z.infer<typeof PreferencesSchema>;
export type PreferencesInput = z.input<typeof PreferencesSchema>;

/** Title synonyms from the build plan (section 5), editable by the user. */
const defaultTrackTitles: Record<TrackId, string[]> = {
  general_management: [
    "General Manager",
    "Algemeen directeur",
    "Country Manager",
    "Landenmanager",
    "Managing Director",
    "Business Unit Director",
    "Vestigingsdirecteur",
  ],
  strategy_transformation: [
    "Strategy Director",
    "Strategiedirecteur",
    "Business Transformation Director",
    "Chief of Staff",
    "Head of Strategy",
  ],
  commercial_leadership: [
    "Chief Commercial Officer",
    "Commercial Director",
    "Commercieel directeur",
    "VP Commercial",
    "Head of Commercial",
    "Channel Sales Director",
  ],
  partnerships_market_development: [
    "Head of Partnerships",
    "Strategic Alliances Director",
    "Market Development Director",
    "Business Development Director",
    "Head of Ecosystem",
  ],
};

export function defaultPreferences(): Preferences {
  return {
    tracks: trackIds.map((id) => ({ id, enabled: true, titles: [...defaultTrackTitles[id]] })),
    constraints: {
      dutchContract: "soft",
      multinational: "soft",
      companyCar: "soft",
      remoteHybrid: "soft",
    },
    salary: { minimumAnnualBase: null, currency: "EUR", mode: "soft" },
    locations: { preferred: [], maxOneWayCommuteMinutes: null, internationalTravel: "unspecified" },
    sectors: [],
    excludedEmployers: [],
    negativeRoleSignals: ["SDR", "BDR", "Account Executive", "100% new business", "quota-carrying hunter"],
    excludedTitleTerms: [...DEFAULT_EXCLUDED_TITLE_TERMS],
    excludeRecruitmentAgencies: true,
    minimumSeniority: "manager",
    earliestStartDate: null,
  };
}

/** Parses stored JSON; falls back to defaults (and reports it) when invalid or empty. */
export function parseStoredPreferences(value: unknown): { preferences: Preferences; isDefault: boolean } {
  if (value && typeof value === "object" && Object.keys(value).length > 0) {
    const parsed = PreferencesSchema.safeParse(value);
    if (parsed.success) return { preferences: parsed.data, isDefault: false };
  }
  return { preferences: defaultPreferences(), isDefault: true };
}
