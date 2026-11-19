import type { ConstraintKey, Preferences } from "@/lib/preferences/schema";
import { constraintKeys } from "@/lib/preferences/schema";
import { findExcludedEmployer } from "@/lib/preferences/employers";

/**
 * Deterministic hard-gate evaluation (build plan §6, step B). Runs before any
 * AI scoring. Core rule: UNKNOWN IS NOT FALSE. A hard requirement that a
 * vacancy does not mention leads to `review_required`, never to `fail`.
 */

export type TriState = "yes" | "no" | "unknown";

export interface JobSignals {
  employerName: string;
  dutchContract: TriState;
  multinational: TriState;
  companyCar: TriState;
  remoteHybrid: TriState;
  /** Explicitly published annual base salary in EUR; null when not published. */
  annualBaseSalaryEur: number | null;
  /** Normalised sector name when known; null when unknown. */
  sector: string | null;
}

export type CheckOutcome = "pass" | "fail" | "unknown" | "not_applicable";

export interface GateCheck {
  key: ConstraintKey | "salary" | "excludedEmployer" | "excludedSector";
  mode: "hard" | "soft" | "ignore";
  outcome: CheckOutcome;
  detail?: string;
}

export type GateStatus = "pass" | "fail" | "review_required";

export interface GateResult {
  status: GateStatus;
  checks: GateCheck[];
}

function triToOutcome(value: TriState): CheckOutcome {
  return value === "yes" ? "pass" : value === "no" ? "fail" : "unknown";
}

export function evaluateHardGates(prefs: Preferences, job: JobSignals): GateResult {
  const checks: GateCheck[] = [];

  for (const key of constraintKeys) {
    const mode = prefs.constraints[key];
    checks.push({ key, mode, outcome: mode === "ignore" ? "not_applicable" : triToOutcome(job[key]) });
  }

  const salaryMode = prefs.salary.minimumAnnualBase === null ? "ignore" : prefs.salary.mode;
  let salaryOutcome: CheckOutcome = "not_applicable";
  if (salaryMode !== "ignore" && prefs.salary.minimumAnnualBase !== null) {
    salaryOutcome =
      job.annualBaseSalaryEur === null
        ? "unknown"
        : job.annualBaseSalaryEur >= prefs.salary.minimumAnnualBase
          ? "pass"
          : "fail";
  }
  checks.push({ key: "salary", mode: salaryMode, outcome: salaryOutcome });

  const excluded = findExcludedEmployer(job.employerName, prefs.excludedEmployers);
  checks.push({
    key: "excludedEmployer",
    mode: "hard",
    outcome: excluded ? "fail" : "pass",
    ...(excluded ? { detail: excluded.name } : {}),
  });

  const excludedSectors = prefs.sectors.filter((s) => s.priority === "exclude").map((s) => s.name.toLowerCase());
  let sectorOutcome: CheckOutcome = "not_applicable";
  if (excludedSectors.length > 0) {
    sectorOutcome = job.sector === null ? "unknown" : excludedSectors.includes(job.sector.toLowerCase()) ? "fail" : "pass";
  }
  // An unknown sector never blocks a job; only a known excluded sector does.
  checks.push({ key: "excludedSector", mode: "hard", outcome: sectorOutcome === "unknown" ? "not_applicable" : sectorOutcome });

  const hard = checks.filter((c) => c.mode === "hard");
  const status: GateStatus = hard.some((c) => c.outcome === "fail")
    ? "fail"
    : hard.some((c) => c.outcome === "unknown")
      ? "review_required"
      : "pass";

  return { status, checks };
}
