import type { Preferences } from "@/lib/preferences/schema";

/** Pure helpers that turn stored data into prompt lines for matching. */

export const feedbackReasons = {
  good: ["right_level", "right_content", "right_sector", "right_employer", "right_conditions"],
  bad: [
    "too_junior",
    "too_operational",
    "hunter_quota",
    "wrong_sector",
    "small_company",
    "location_contract",
    "not_my_expertise",
    "unclear_employer",
  ],
} as const;
export type FeedbackLabel = keyof typeof feedbackReasons;
export const allFeedbackReasons: readonly string[] = [...feedbackReasons.good, ...feedbackReasons.bad];

const REASON_TEXT: Record<string, string> = {
  right_level: "right level",
  right_content: "right content",
  right_sector: "right sector",
  right_employer: "right employer",
  right_conditions: "right conditions",
  too_junior: "too junior",
  too_operational: "too operational",
  hunter_quota: "hunter / quota role",
  wrong_sector: "wrong sector",
  small_company: "company too small",
  location_contract: "location or contract does not fit",
  not_my_expertise: "outside my expertise",
  unclear_employer: "employer unclear",
};

export function preferenceLines(prefs: Preferences): string[] {
  const lines: string[] = [];
  const tracks = prefs.tracks.filter((t) => t.enabled);
  if (tracks.length) {
    lines.push(`Target roles: ${tracks.map((t) => t.titles.slice(0, 8).join(", ")).join(" | ")}`);
  }
  lines.push(`Minimum title level: ${prefs.minimumSeniority}`);
  const modes = Object.entries(prefs.constraints).map(([k, v]) => `${k}=${v}`);
  lines.push(`Conditions (hard = knock-out, soft = counts in score, ignore): ${modes.join(", ")}`);
  if (prefs.salary.minimumAnnualBase) {
    lines.push(`Minimum gross annual base salary: EUR ${prefs.salary.minimumAnnualBase} (${prefs.salary.mode})`);
  }
  if (prefs.locations.preferred.length) lines.push(`Preferred locations: ${prefs.locations.preferred.join(", ")}`);
  if (prefs.locations.maxOneWayCommuteMinutes) lines.push(`Maximum one-way commute: ${prefs.locations.maxOneWayCommuteMinutes} minutes`);
  if (prefs.locations.internationalTravel !== "unspecified") lines.push(`International travel: ${prefs.locations.internationalTravel}`);
  const sectors = (p: string) => prefs.sectors.filter((s) => s.priority === p).map((s) => s.name);
  if (sectors("boost").length) lines.push(`Sectors with priority: ${sectors("boost").join(", ")}`);
  if (sectors("lower").length) lines.push(`Sectors with lower priority (rank lower, do not hide): ${sectors("lower").join(", ")}`);
  if (sectors("exclude").length) lines.push(`Excluded sectors: ${sectors("exclude").join(", ")}`);
  if (prefs.negativeRoleSignals.length) lines.push(`Negative role signals: ${prefs.negativeRoleSignals.join(", ")}`);
  if (prefs.earliestStartDate) lines.push(`Earliest start date: ${prefs.earliestStartDate}`);
  return lines;
}

export function feedbackLines(
  rows: { label: "good" | "bad"; reasons: string[]; note: string | null; title: string; company: string }[],
): string[] {
  return rows.slice(0, 20).map((r) => {
    const reasons = r.reasons.map((x) => REASON_TEXT[x] ?? x).join(", ");
    const note = r.note ? `; note: ${r.note.replace(/\s+/g, " ").slice(0, 200)}` : "";
    return `${r.label === "good" ? "GOOD FIT" : "BAD FIT"}: "${r.title.slice(0, 150)}" at ${r.company.slice(0, 100)}${reasons ? ` (${reasons})` : ""}${note}`;
  });
}

type Signal = { value?: string; evidence?: string } | undefined;

export function jobSignalLines(signals: Record<string, unknown>, salary: Record<string, unknown>): string[] {
  const label: Record<string, string> = {
    companyCar: "Company car",
    dutchContract: "Dutch employment contract",
    remoteHybrid: "Remote/hybrid",
    multinational: "Multinational",
  };
  const lines = Object.entries(label).map(([key, name]) => {
    const s = signals[key] as Signal;
    const value = s?.value === "yes" || s?.value === "no" ? s.value : "unknown";
    return `${name}: ${value}${s?.evidence ? ` (vacancy: "${String(s.evidence).slice(0, 160)}")` : ""}`;
  });
  if (typeof signals.sector === "string") lines.push(`Sector (from company list): ${signals.sector}`);
  const min = typeof salary.min === "number" ? salary.min : null;
  const max = typeof salary.max === "number" ? salary.max : null;
  lines.push(
    min || max
      ? `Published salary: ${String(salary.currency ?? "")} ${min ?? "?"}–${max ?? "?"} per ${String(salary.interval ?? "unknown")}`
      : "Published salary: none",
  );
  return lines;
}

export function gateLines(gate: { checks?: { key: string; mode: string; outcome: string }[] }): string[] {
  const hard = (gate.checks ?? []).filter((c) => c.mode === "hard" && c.outcome !== "not_applicable");
  return hard.length ? [`Hard requirement checks: ${hard.map((c) => `${c.key}=${c.outcome}`).join(", ")}`] : [];
}
