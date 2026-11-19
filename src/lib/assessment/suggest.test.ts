import { describe, expect, it } from "vitest";
import { defaultPreferences } from "@/lib/preferences/schema";
import { emptyAssessment } from "./schema";
import { mergeProposal, suggestAssessment } from "./suggest";

describe("assessment proposal (rules)", () => {
  it("derives a proposal only from stated preferences and confirmed language facts", () => {
    const prefs = { ...defaultPreferences(), locations: { ...defaultPreferences().locations, internationalTravel: "welcome" as const } };
    const proposal = suggestAssessment(prefs, [
      { category: "language", statement: "Spreekt Nederlands, Engels en Frans" },
      { category: "role", statement: "DEMO Spanish market lead" }, // not a language fact: ignored
    ]);
    expect(proposal.activities.build_partnerships).toBe("energy");
    expect(proposal.activities.cold_prospecting).toBe("drain"); // SDR/hunter are negative signals by default
    expect(proposal.quotaPreference).toBe("team_target_ok");
    expect(proposal.employerTypes.multinational).toBe("wanted");
    expect(proposal.travelMax).toBe("travel_25");
    expect(proposal.workLanguages).toEqual(["nl", "en", "fr"]);
  });

  it("fills only unanswered questions and reports what it filled", () => {
    const current = { ...emptyAssessment(), quotaPreference: "personal_quota_ok" as const, activities: { cold_prospecting: "energy" as const } };
    const proposal = suggestAssessment(defaultPreferences(), []);
    const { merged, filled } = mergeProposal(current, proposal);
    expect(merged.quotaPreference).toBe("personal_quota_ok");
    expect(merged.activities.cold_prospecting).toBe("energy");
    expect(merged.activities.build_partnerships).toBe("energy");
    expect(filled).toContain("activities.build_partnerships");
    expect(filled).not.toContain("quotaPreference");
    expect(mergeProposal(merged, proposal).filled).toEqual([]);
  });
});
