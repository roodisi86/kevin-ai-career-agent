import { describe, expect, it } from "vitest";
import { buildDigest, digestPushText, pickTop, type DigestMatchCandidate } from "./digest";
import { addDays, amsterdamDate, formatDayLabel, isoWeekKey, isoWeekday } from "@/lib/time";

const base: DigestMatchCandidate = {
  jobId: "j0",
  title: "DEMO Commercial Director",
  company: "DEMO Co",
  url: "https://example.com/job",
  status: "open",
  score: 70,
  classification: "top_match",
  fitSummary: "DEMO",
  source: "claude",
  firstSeenAt: "2026-11-19T06:00:00Z",
  feedback: null,
  userState: "new",
  inPipeline: false,
};
const m = (over: Partial<DigestMatchCandidate>): DigestMatchCandidate => ({ ...base, title: `DEMO role ${over.jobId ?? "x"}`, ...over });
const NOW = "2026-11-20T06:00:00Z";

describe("digest top picks", () => {
  it("puts top matches before stretch roles, then by score", () => {
    const top = pickTop(
      [m({ jobId: "a", classification: "stretch", score: 90 }), m({ jobId: "b", score: 72 }), m({ jobId: "c", score: 80 }), m({ jobId: "d", score: 75 })],
      NOW,
    );
    expect(top.map((t) => t.jobId)).toEqual(["c", "d", "b"]);
  });

  it("skips closed jobs, bad feedback, not-relevant and jobs already in the pipeline", () => {
    const top = pickTop(
      [
        m({ jobId: "closed", status: "closed" }),
        m({ jobId: "bad", feedback: "bad" }),
        m({ jobId: "nr", userState: "not_relevant" }),
        m({ jobId: "pipe", inPipeline: true }),
        m({ jobId: "research", classification: "research_needed" }),
        m({ jobId: "ok", status: "uncertain" }),
      ],
      NOW,
    );
    expect(top.map((t) => t.jobId)).toEqual(["ok"]);
    expect(top[0].status).toBe("uncertain");
  });

  it("prefers Claude-checked verdicts over rules-only ones and lists a role posted twice once", () => {
    const top = pickTop(
      [
        m({ jobId: "rules", source: "rules", score: 95 }),
        m({ jobId: "claude", source: "claude", score: 74, title: "DEMO CCO" }),
        m({ jobId: "dup1", source: "rules", score: 90, title: "DEMO Twin", company: "DEMO Two" }),
        m({ jobId: "dup2", source: "rules", score: 90, title: "DEMO Twin", company: "DEMO Two" }),
      ],
      NOW,
    );
    expect(top.map((t) => t.jobId)).toEqual(["claude", "rules", "dup1"]);
  });

  it("marks vacancies first seen in the last 36 hours as new", () => {
    const top = pickTop([m({ jobId: "new" }), m({ jobId: "old", firstSeenAt: "2026-11-10T06:00:00Z", score: 60 })], NOW);
    expect(top.find((t) => t.jobId === "new")?.isNew).toBe(true);
    expect(top.find((t) => t.jobId === "old")?.isNew).toBe(false);
  });
});

describe("digest push text", () => {
  const input = {
    date: "2026-11-20",
    now: NOW,
    matches: [m({ jobId: "a", score: 81 }), m({ jobId: "b", classification: "stretch", score: 60 })],
    newJobs: 4,
    outreach: { toReview: 2, approvedNotSent: 0, followUpDue: 1 },
    applications: { active: 3, interviewing: 1, actions: [{ applicationId: "x", company: "DEMO", role: "DEMO", action: "Bel recruiter", due: "2026-11-20" }] },
    signals: { fresh: 2, headlines: [{ company: "DEMO", headline: "DEMO opent kantoor in Amsterdam" }] },
    lastScan: { startedAt: NOW, status: "completed" },
  };

  it("lists the top picks and the to-dos, without notes or fit text", () => {
    const content = buildDigest(input);
    const text = digestPushText(content);
    expect(text).toContain("dagoverzicht vr 20 nov");
    expect(text).toContain("1. DEMO role a · DEMO Co — 81 (topmatch, nieuw)");
    expect(text).toContain("2 concept(en) te controleren");
    expect(text).toContain("1 opvolging(en)");
    expect(text).toContain("1 sollicitatie-actie(s)");
    expect(text).not.toContain("Bel recruiter");
    expect(text.length).toBeLessThanOrEqual(1500);
    expect(content.counts).toEqual({ topMatches: 1, stretch: 1, newJobs: 4 });
  });

  it("says so when there are no recommendations", () => {
    const text = digestPushText(buildDigest({ ...input, matches: [] }));
    expect(text).toContain("Geen nieuwe topaanbevelingen vandaag.");
  });
});

describe("Europe/Amsterdam date helpers", () => {
  it("uses the Amsterdam calendar date around midnight", () => {
    expect(amsterdamDate(new Date("2026-11-19T23:30:00Z"))).toBe("2026-11-20");
    expect(amsterdamDate(new Date("2026-07-01T21:59:00Z"))).toBe("2026-07-01");
    expect(amsterdamDate(new Date("2026-07-01T22:01:00Z"))).toBe("2026-07-02");
  });
  it("computes ISO weeks and weekdays", () => {
    expect(isoWeekKey("2026-11-19")).toBe("2026-W47");
    expect(isoWeekKey("2027-01-01")).toBe("2026-W53");
    expect(isoWeekday("2026-11-23")).toBe(1);
    expect(addDays("2026-12-31", 1)).toBe("2027-01-01");
    expect(formatDayLabel("2026-11-23")).toBe("ma 23 nov");
  });
});
