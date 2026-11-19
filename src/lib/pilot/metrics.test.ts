import { describe, expect, it } from "vitest";
import { reachedStage, successfulRunDays } from "./metrics";

describe("pilot metrics helpers", () => {
  it("counts Amsterdam calendar days with a successful scheduled scan, once per day", () => {
    const days = successfulRunDays([
      { started_at: "2026-11-19T05:17:00Z", status: "completed" },
      { started_at: "2026-11-19T08:37:00Z", status: "partial" },
      { started_at: "2026-11-19T23:30:00Z", status: "completed" }, // already 20 Nov in Amsterdam
      { started_at: "2026-11-21T05:17:00Z", status: "failed" },
    ]);
    expect([...days].sort()).toEqual(["2026-11-19", "2026-11-20"]);
  });

  it("counts applications that ever reached a stage, also when later rejected", () => {
    const apps = [
      { id: "a", stage: "interviewing" },
      { id: "b", stage: "rejected" },
      { id: "c", stage: "applied" },
    ];
    const events = [
      { application_id: "b", metadata_json: { from: "applied", to: "screening" } },
      { application_id: "b", metadata_json: { from: "screening", to: "rejected" } },
      { application_id: "c", metadata_json: { stage: "applied" } },
    ];
    expect(reachedStage(apps, events, new Set(["screening", "interviewing", "final_round", "offer", "accepted"]))).toBe(2);
  });
});
