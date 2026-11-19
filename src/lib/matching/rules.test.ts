import { describe, expect, it } from "vitest";
import { emptyAssessment, type AssessmentAnswers } from "@/lib/assessment/schema";
import { defaultPreferences, type Preferences } from "@/lib/preferences/schema";
import type { PromptFact } from "@/lib/ai/match";
import { buildQueuedPrompt, parseMatchOutput } from "@/lib/ai/match";
import { passage, scoreWithRules, titleFeedbackAdjustment, type RulesJob } from "./rules";

/* Synthetic DEMO data only. */

const FACTS: PromptFact[] = [
  { ref: "F1", id: "00000000-0000-4000-8000-000000000001", category: "role", statement: "Sales Director Benelux – DEMO Drinks (2019 – heden)" },
  { ref: "F2", id: "00000000-0000-4000-8000-000000000002", category: "achievement", statement: "Bouwde een distributeursnetwerk en partnerships op in de Benelux" },
];

const prefs: Preferences = {
  ...defaultPreferences(),
  sectors: [
    { name: "beverages", priority: "boost" },
    { name: "fintech", priority: "lower" },
  ],
};

const assessment: AssessmentAnswers = {
  ...emptyAssessment(),
  activities: { build_partnerships: "energy", cold_prospecting: "drain" },
  quotaPreference: "no_personal_quota",
};

const job = (overrides: Partial<RulesJob>): RulesJob => ({
  title: "Country Manager Benelux",
  company: "DEMO Beverages",
  location: "Amsterdam, Netherlands",
  countryCode: "nl",
  workplaceType: "hybrid",
  description:
    "As Country Manager you have full P&L responsibility for the Benelux beverages business. You build partnerships with distributors and lead the go-to-market strategy in an international environment.",
  sector: "beverages",
  signals: { companyCar: "yes", dutchContract: "yes", remoteHybrid: "yes", multinational: "yes" },
  salaryAnnualEur: null,
  gate: "pass",
  limitedEvidence: false,
  ...overrides,
});

describe("free rules assessment", () => {
  it("ranks a strategic country role far above a hunter role with a senior title", () => {
    const good = scoreWithRules({ job: job({}), facts: FACTS, prefs, assessment, feedback: [] });
    const hunter = scoreWithRules({
      job: job({
        title: "Sales Director",
        company: "DEMO Payments",
        sector: "fintech",
        description:
          "100% new business. You are a hunter with a personal quota, cold calling and prospecting every day. Attractive commission and OTE.",
        signals: { companyCar: "unknown", dutchContract: "unknown", remoteHybrid: "unknown", multinational: "unknown" },
      }),
      facts: FACTS,
      prefs,
      assessment,
      feedback: [],
    });
    expect(good.score).toBeGreaterThanOrEqual(70);
    expect(good.classification).toBe("top_match");
    expect(hunter.score).toBeLessThan(good.score - 20);
    expect(hunter.gaps.join(" ")).toMatch(/hunter- of quotumrol/);
    expect(hunter.gaps.join(" ")).toMatch(/Sector met lagere prioriteit/);
  });

  it("only cites literal vacancy passages and confirmed facts, and claims nothing as proven", () => {
    const result = scoreWithRules({ job: job({}), facts: FACTS, prefs, assessment, feedback: [] });
    const j = job({});
    const text = [j.title, j.company, j.location, j.description].join(" ").replace(/\s+/g, " ");
    for (const d of result.dimensions) for (const q of d.jobQuotes) expect(text).toContain(q);
    const factIds = new Set(FACTS.map((f) => f.id));
    for (const d of result.dimensions) for (const f of d.facts) expect(factIds.has(f.id)).toBe(true);
    expect(result.confirmedFit).toEqual([]);
    expect(result.pitchAngle).toBeNull();
  });

  it("treats missing information as unknown, not as a mismatch", () => {
    const result = scoreWithRules({
      job: job({ signals: { companyCar: "unknown", dutchContract: "unknown", remoteHybrid: "unknown", multinational: "unknown" } }),
      facts: FACTS,
      prefs,
      assessment,
      feedback: [],
    });
    expect(result.unknowns).toEqual(expect.arrayContaining(["Nederlands arbeidscontract: onbekend.", "Leaseauto: onbekend."]));
    expect(result.dimensions.find((d) => d.key === "salary_practical")!.rating).toBe(3);
  });

  it("a failed hard gate is always a reject", () => {
    expect(scoreWithRules({ job: job({ gate: "fail" }), facts: FACTS, prefs, assessment, feedback: [] }).classification).toBe("reject");
  });

  it("learns from thumbs up/down on similar titles and reasons", () => {
    const feedback = [
      { label: "bad" as const, reasons: ["small_company"], title: "Algemeen directeur Bouwbedrijf" },
      { label: "bad" as const, reasons: ["small_company"], title: "Algemeen directeur Installatiebedrijf" },
      { label: "good" as const, reasons: ["right_level"], title: "Country Manager Netherlands" },
    ];
    expect(titleFeedbackAdjustment("Algemeen directeur Transportbedrijf", feedback)).toBeLessThan(0);
    expect(titleFeedbackAdjustment("Country Manager Belgium", feedback)).toBeGreaterThan(0);
    const smallJob = job({ title: "Algemeen directeur", description: "Familiebedrijf in de regio, mkb, klein team." });
    const before = scoreWithRules({ job: smallJob, facts: FACTS, prefs, assessment, feedback: [] });
    const after = scoreWithRules({ job: smallJob, facts: FACTS, prefs, assessment, feedback });
    expect(after.score).toBeLessThan(before.score);
  });

  it("extracts a readable literal passage around a keyword", () => {
    expect(passage("Intro. You build partnerships with distributors. Outro.", "partnerships")).toBe("You build partnerships with distributors");
    expect(passage("no match here", "partnerships")).toBeNull();
  });
});

describe("subscription queue prompt", () => {
  it("is self-contained: instructions, output format and data", () => {
    const prompt = buildQueuedPrompt("Assess this vacancy for the candidate.\n<job>\nTitle: X\n</job>");
    expect(prompt).toContain("<instructions>");
    expect(prompt).toContain("UNTRUSTED DATA");
    expect(prompt).toContain('"dimensions"');
    expect(prompt).toContain("<job>");
  });

  it("answers are validated with the same parser as the API path", () => {
    expect(parseMatchOutput({ dimensions: [] }).ok).toBe(false);
    expect(parseMatchOutput("```json\n{}\n```").ok).toBe(false);
  });
});
