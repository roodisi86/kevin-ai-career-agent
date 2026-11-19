import { describe, expect, it } from "vitest";
import { defaultPreferences, parseStoredPreferences, PreferencesSchema } from "./schema";
import { acronymOf, findExcludedEmployer, normalizeEmployerName } from "./employers";

describe("preferences schema", () => {
  it("accepts the neutral defaults", () => {
    expect(PreferencesSchema.safeParse(defaultPreferences()).success).toBe(true);
  });

  it("has no fictional personal defaults (salary, locations, exclusions)", () => {
    const prefs = defaultPreferences();
    expect(prefs.salary.minimumAnnualBase).toBeNull();
    expect(prefs.locations.preferred).toEqual([]);
    expect(prefs.excludedEmployers).toEqual([]);
    expect(prefs.sectors).toEqual([]);
    expect(prefs.earliestStartDate).toBeNull();
  });

  it("supports hard and soft toggles per constraint", () => {
    const prefs = defaultPreferences();
    prefs.constraints.companyCar = "hard";
    prefs.constraints.multinational = "soft";
    const parsed = PreferencesSchema.parse(prefs);
    expect(parsed.constraints.companyCar).toBe("hard");
  });

  it("rejects unknown constraint modes and negative salaries", () => {
    const prefs = defaultPreferences() as unknown as Record<string, unknown>;
    expect(
      PreferencesSchema.safeParse({ ...prefs, constraints: { ...(prefs.constraints as object), companyCar: "maybe" } })
        .success,
    ).toBe(false);
    expect(
      PreferencesSchema.safeParse({ ...prefs, salary: { minimumAnnualBase: -5, currency: "EUR", mode: "hard" } })
        .success,
    ).toBe(false);
  });

  it("rejects duplicate sectors", () => {
    const prefs = defaultPreferences();
    prefs.sectors = [
      { name: "FMCG", priority: "boost" },
      { name: "fmcg", priority: "lower" },
    ];
    expect(PreferencesSchema.safeParse(prefs).success).toBe(false);
  });

  it("de-duplicates titles case-insensitively", () => {
    const prefs = defaultPreferences();
    prefs.tracks[0].titles = ["Country Manager", "country manager"];
    expect(PreferencesSchema.parse(prefs).tracks[0].titles).toHaveLength(1);
  });

  it("falls back to defaults for empty or corrupt stored JSON", () => {
    expect(parseStoredPreferences({}).isDefault).toBe(true);
    expect(parseStoredPreferences({ tracks: "nope" }).isDefault).toBe(true);
    expect(parseStoredPreferences(defaultPreferences()).isDefault).toBe(false);
  });
});

describe("excluded employers", () => {
  const excluded = [
    { name: "London Stock Exchange Group", aliases: [] },
    { name: "Thomson Reuters", aliases: ["TR"] },
    { name: "Moody's", aliases: [] },
  ];

  it("normalises legal suffixes, accents and punctuation", () => {
    expect(normalizeEmployerName("Acme Nederland B.V.")).toBe("acme");
    expect(normalizeEmployerName("Société Générale S.A.")).toBe("societe generale");
    expect(normalizeEmployerName("Moody's Corporation")).toBe("moodys");
  });

  it("builds acronyms without stop words", () => {
    expect(acronymOf("london stock exchange group")).toBe("lseg");
  });

  it("matches an acronym against the full name (LSEG)", () => {
    expect(findExcludedEmployer("LSEG", excluded)?.name).toBe("London Stock Exchange Group");
  });

  it("matches alias spellings and legal-entity variants", () => {
    expect(findExcludedEmployer("Thomson Reuters Holdings Inc.", excluded)?.name).toBe("Thomson Reuters");
    expect(findExcludedEmployer("Moody's Analytics", excluded)).toBeNull();
    expect(findExcludedEmployer("MOODY'S", excluded)?.name).toBe("Moody's");
  });

  it("does not match unrelated employers", () => {
    expect(findExcludedEmployer("Heineken", excluded)).toBeNull();
    expect(findExcludedEmployer("", excluded)).toBeNull();
  });
});
