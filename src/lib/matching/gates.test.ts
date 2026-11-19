import { describe, expect, it } from "vitest";
import { defaultPreferences, type Preferences } from "@/lib/preferences/schema";
import { evaluateHardGates, type JobSignals } from "./gates";

function job(overrides: Partial<JobSignals> = {}): JobSignals {
  return {
    employerName: "DEMO Beverages B.V.",
    dutchContract: "yes",
    multinational: "yes",
    companyCar: "yes",
    remoteHybrid: "yes",
    annualBaseSalaryEur: null,
    sector: null,
    ...overrides,
  };
}

function prefs(mutate: (p: Preferences) => void): Preferences {
  const p = defaultPreferences();
  mutate(p);
  return p;
}

describe("hard gates", () => {
  it("unknown company car with a HARD requirement → review_required, not fail", () => {
    const result = evaluateHardGates(prefs((p) => (p.constraints.companyCar = "hard")), job({ companyCar: "unknown" }));
    expect(result.status).toBe("review_required");
    expect(result.checks.find((c) => c.key === "companyCar")?.outcome).toBe("unknown");
  });

  it("unknown Dutch payroll in a remote role with a HARD requirement → review_required", () => {
    const result = evaluateHardGates(
      prefs((p) => (p.constraints.dutchContract = "hard")),
      job({ dutchContract: "unknown", remoteHybrid: "yes" }),
    );
    expect(result.status).toBe("review_required");
  });

  it("Spanish payroll while NL contract is HARD → fail", () => {
    const result = evaluateHardGates(prefs((p) => (p.constraints.dutchContract = "hard")), job({ dutchContract: "no" }));
    expect(result.status).toBe("fail");
  });

  it("a SOFT requirement never blocks, even when not met", () => {
    const result = evaluateHardGates(prefs((p) => (p.constraints.companyCar = "soft")), job({ companyCar: "no" }));
    expect(result.status).toBe("pass");
  });

  it("an excluded employer under another spelling → fail with the matched entry", () => {
    const result = evaluateHardGates(
      prefs((p) => (p.excludedEmployers = [{ name: "London Stock Exchange Group", aliases: [] }])),
      job({ employerName: "LSEG" }),
    );
    expect(result.status).toBe("fail");
    expect(result.checks.find((c) => c.key === "excludedEmployer")?.detail).toBe("London Stock Exchange Group");
  });

  it("missing salary with a HARD floor → review_required; published salary below floor → fail", () => {
    const p = prefs((x) => {
      x.salary.minimumAnnualBase = 100_000;
      x.salary.mode = "hard";
    });
    expect(evaluateHardGates(p, job({ annualBaseSalaryEur: null })).status).toBe("review_required");
    expect(evaluateHardGates(p, job({ annualBaseSalaryEur: 80_000 })).status).toBe("fail");
    expect(evaluateHardGates(p, job({ annualBaseSalaryEur: 120_000 })).status).toBe("pass");
  });

  it("no salary floor set → salary is not applicable", () => {
    const result = evaluateHardGates(defaultPreferences(), job());
    expect(result.checks.find((c) => c.key === "salary")?.outcome).toBe("not_applicable");
  });

  it("an unknown sector never blocks; a known excluded sector does", () => {
    const p = prefs((x) => (x.sectors = [{ name: "Gambling", priority: "exclude" }]));
    expect(evaluateHardGates(p, job({ sector: null })).status).toBe("pass");
    expect(evaluateHardGates(p, job({ sector: "gambling" })).status).toBe("fail");
  });

  it("a fail outranks review_required", () => {
    const p = prefs((x) => {
      x.constraints.companyCar = "hard";
      x.constraints.dutchContract = "hard";
    });
    expect(evaluateHardGates(p, job({ companyCar: "unknown", dutchContract: "no" })).status).toBe("fail");
  });
});
