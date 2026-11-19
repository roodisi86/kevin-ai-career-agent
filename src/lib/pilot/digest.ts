/**
 * Daily digest: a pure builder (testable) that turns already-loaded data into
 * the stored digest content and a short push text. Push text holds job titles,
 * companies and counts only — never CV facts, notes or contact details.
 */
import { formatDayLabel } from "@/lib/time";

export const DIGEST_VERSION = "digest-v1";

export interface DigestMatchCandidate {
  jobId: string;
  title: string;
  company: string;
  url: string;
  status: "open" | "uncertain" | "closed";
  score: number;
  classification: "top_match" | "stretch" | "research_needed" | "reject";
  fitSummary: string | null;
  source: "rules" | "claude" | "api";
  firstSeenAt: string;
  feedback: "good" | "bad" | null;
  userState: "new" | "interesting" | "later" | "not_relevant";
  inPipeline: boolean;
}

export interface DigestAction {
  applicationId: string;
  company: string;
  role: string;
  action: string;
  due: string;
}

export interface DigestInput {
  date: string; // YYYY-MM-DD, Europe/Amsterdam
  now: string; // ISO timestamp
  matches: DigestMatchCandidate[];
  newJobs: number;
  outreach: { toReview: number; approvedNotSent: number; followUpDue: number };
  applications: { active: number; interviewing: number; actions: DigestAction[] };
  signals: { fresh: number; headlines: { company: string; headline: string }[] };
  lastScan: { startedAt: string; status: string } | null;
}

export interface DigestTopItem {
  jobId: string;
  title: string;
  company: string;
  url: string;
  status: DigestMatchCandidate["status"];
  score: number;
  classification: DigestMatchCandidate["classification"];
  fitSummary: string | null;
  source: DigestMatchCandidate["source"];
  isNew: boolean;
}

export interface DigestContent {
  version: string;
  date: string;
  top: DigestTopItem[];
  counts: { topMatches: number; stretch: number; newJobs: number };
  outreach: DigestInput["outreach"];
  applications: DigestInput["applications"];
  signals: DigestInput["signals"];
  lastScan: DigestInput["lastScan"];
}

const NEW_WINDOW_MS = 36 * 3_600_000;

/** Top recommendations: strong matches Kevin has not acted on or rejected. */
export function pickTop(matches: DigestMatchCandidate[], now: string, limit = 3): DigestTopItem[] {
  const nowMs = new Date(now).getTime();
  return matches
    .filter(
      (m) =>
        (m.classification === "top_match" || m.classification === "stretch") &&
        m.status !== "closed" &&
        m.feedback !== "bad" &&
        m.userState !== "not_relevant" &&
        !m.inPipeline,
    )
    .sort((a, b) => {
      // Top matches before stretch roles, then score, then the newest vacancy.
      const cls = (m: DigestMatchCandidate) => (m.classification === "top_match" ? 1 : 0);
      if (cls(b) !== cls(a)) return cls(b) - cls(a);
      if (b.score !== a.score) return b.score - a.score;
      return b.firstSeenAt.localeCompare(a.firstSeenAt);
    })
    .slice(0, limit)
    .map((m) => ({
      jobId: m.jobId,
      title: m.title,
      company: m.company,
      url: m.url,
      status: m.status,
      score: m.score,
      classification: m.classification,
      fitSummary: m.fitSummary,
      source: m.source,
      isNew: nowMs - new Date(m.firstSeenAt).getTime() <= NEW_WINDOW_MS,
    }));
}

export function buildDigest(input: DigestInput): DigestContent {
  return {
    version: DIGEST_VERSION,
    date: input.date,
    top: pickTop(input.matches, input.now),
    counts: {
      topMatches: input.matches.filter((m) => m.classification === "top_match" && m.status !== "closed").length,
      stretch: input.matches.filter((m) => m.classification === "stretch" && m.status !== "closed").length,
      newJobs: input.newJobs,
    },
    outreach: input.outreach,
    applications: { ...input.applications, actions: input.applications.actions.slice(0, 5) },
    signals: { fresh: input.signals.fresh, headlines: input.signals.headlines.slice(0, 3) },
    lastScan: input.lastScan,
  };
}

const CLASS_LABEL: Record<DigestTopItem["classification"], string> = {
  top_match: "topmatch",
  stretch: "stretch",
  research_needed: "onderzoeken",
  reject: "past niet",
};

const clip = (s: string, n: number) => (s.length > n ? `${s.slice(0, n - 1)}…` : s);

/** Short Dutch push text (≤1500 chars): titles, companies and counts only. */
export function digestPushText(d: DigestContent): string {
  const lines = [`Career Agent — dagoverzicht ${formatDayLabel(d.date)}`];
  if (d.top.length === 0) {
    lines.push("Geen nieuwe topaanbevelingen vandaag.");
  } else {
    lines.push(`Top ${d.top.length}:`);
    d.top.forEach((t, i) =>
      lines.push(`${i + 1}. ${clip(t.title, 70)} · ${clip(t.company, 40)} — ${t.score} (${CLASS_LABEL[t.classification]}${t.isNew ? ", nieuw" : ""})`),
    );
  }
  const todo: string[] = [];
  if (d.outreach.toReview) todo.push(`${d.outreach.toReview} concept(en) te controleren`);
  if (d.outreach.approvedNotSent) todo.push(`${d.outreach.approvedNotSent} goedgekeurd, nog niet verstuurd`);
  if (d.outreach.followUpDue) todo.push(`${d.outreach.followUpDue} opvolging(en)`);
  if (d.applications.actions.length) todo.push(`${d.applications.actions.length} sollicitatie-actie(s)`);
  lines.push(`Nieuw: ${d.counts.newJobs} vacature(s)${d.signals.fresh ? ` · ${d.signals.fresh} bedrijfssignaal/-signalen` : ""}`);
  if (todo.length) lines.push(`Te doen: ${todo.join(" · ")}`);
  lines.push("Open het Dashboard in de app.");
  return lines.join("\n").slice(0, 1500);
}
