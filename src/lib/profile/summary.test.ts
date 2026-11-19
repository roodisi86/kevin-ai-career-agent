import { describe, expect, it } from "vitest";
import { countByStatus, missingCategories } from "./summary";

describe("profile summary", () => {
  it("treats suggested-only categories as missing (inferred is not confirmed)", () => {
    const missing = missingCategories([
      { category: "role", status: "confirmed" },
      { category: "achievement", status: "suggested" },
      { category: "language", status: "rejected" },
    ]);
    expect(missing).toContain("achievement");
    expect(missing).toContain("language");
    expect(missing).not.toContain("role");
  });

  it("counts facts by status", () => {
    expect(
      countByStatus([{ status: "confirmed" }, { status: "suggested" }, { status: "suggested" }, { status: "rejected" }]),
    ).toEqual({ confirmed: 1, suggested: 2, rejected: 1 });
  });
});
