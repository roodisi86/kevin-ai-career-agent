"use client";

import { useRef, useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { getDictionary } from "@/lib/i18n";
import { feedbackReasons, type FeedbackLabel } from "@/lib/matching/context";
import { saveFeedback } from "./actions";
import { runMatching, type MatchRunSummary } from "./run-matching";

export function matchSummaryText(summary: MatchRunSummary): string {
  if (summary.stopReason) return m.errors[summary.stopReason];
  if (summary.failed > 0) return `${m.done(summary.scored)} ${m.errors.failed}`;
  return m.done(summary.scored);
}

const t = getDictionary();
const m = t.jobs.match;

/** Runs AI assessments one request per job, three at a time, with progress. */
export function MatchPanel({
  pending,
  total,
  aiConfigured,
  cap,
  hasAssessment,
  queued,
}: {
  pending: number;
  total: number;
  aiConfigured: boolean;
  cap: number;
  hasAssessment: boolean;
  queued: number;
}) {
  const router = useRouter();
  const [running, setRunning] = useState(false);
  const [progress, setProgress] = useState<{ done: number; total: number } | null>(null);
  const [message, setMessage] = useState<string | null>(null);
  const stopRef = useRef(false);

  async function run(force: boolean) {
    setRunning(true);
    setMessage(null);
    stopRef.current = false;
    try {
      let lastRefresh = 0;
      const summary = await runMatching({
        force,
        shouldStop: () => stopRef.current,
        onProgress: (done, total) => {
          setProgress({ done, total });
          // Refresh every few results so the list fills while the run continues.
          if (done - lastRefresh >= 5) {
            lastRefresh = done;
            router.refresh();
          }
        },
      });
      setMessage(matchSummaryText(summary));
      router.refresh();
    } catch {
      setMessage(t.common.error);
    } finally {
      setRunning(false);
    }
  }

  if (!aiConfigured) {
    return (
      <div className="space-y-2" data-testid="free-matching">
        <p className="text-sm text-navy-800">{m.freeIntro}</p>
        {!hasAssessment && <p className="text-sm text-amber-800">{m.noAssessment}</p>}
        <p className="text-sm text-navy-600">{m.queued(queued)}</p>
      </div>
    );
  }

  return (
    <div className="space-y-3">
      <p className="text-sm text-navy-800">{m.panelIntro}</p>
      {!hasAssessment && <p className="text-sm text-amber-800">{m.noAssessment}</p>}
      <p className="text-sm text-navy-600">{pending > 0 ? m.pending(pending, total) : m.upToDate}</p>
      <div className="flex flex-wrap items-center gap-3">
        <button
          type="button"
          className="btn-teal"
          onClick={() => run(false)}
          disabled={running || !aiConfigured || pending === 0}
        >
          {running && progress ? m.running(progress.done, progress.total) : m.run(pending)}
        </button>
        {running ? (
          <button type="button" className="btn-secondary" onClick={() => (stopRef.current = true)}>
            {m.stop}
          </button>
        ) : (
          <button type="button" className="btn-secondary" onClick={() => run(true)} disabled={!aiConfigured || total === 0}>
            {m.rerunAll}
          </button>
        )}
      </div>
      <p aria-live="polite" className="text-sm">{message}</p>
      <p className="help">{m.costNote(cap)}</p>
    </div>
  );
}

export function FeedbackControl({
  jobId,
  current,
}: {
  jobId: string;
  current: { label: FeedbackLabel; reasons: string[]; note: string | null } | null;
}) {
  const router = useRouter();
  const [label, setLabel] = useState<FeedbackLabel | null>(current?.label ?? null);
  const [reasons, setReasons] = useState<string[]>(current?.reasons ?? []);
  const [note, setNote] = useState(current?.note ?? "");
  const [open, setOpen] = useState(false);
  const [saved, setSaved] = useState(false);
  const [pending, startTransition] = useTransition();

  function submit(nextLabel: FeedbackLabel | "clear", nextReasons = reasons) {
    setSaved(false);
    startTransition(async () => {
      const result = await saveFeedback({ jobId, label: nextLabel, reasons: nextReasons, note });
      if (result.ok) {
        setSaved(nextLabel !== "clear");
        if (nextLabel === "clear") {
          setLabel(null);
          setReasons([]);
          setNote("");
          setOpen(false);
        }
        router.refresh();
      }
    });
  }

  function choose(next: FeedbackLabel) {
    const keep = next === label ? reasons : [];
    setLabel(next);
    setReasons(keep);
    setOpen(true);
    submit(next, keep);
  }

  return (
    <div className="space-y-2 rounded-lg border border-sand-200 p-3">
      <div className="flex flex-wrap items-center gap-2">
        <span className="text-sm font-medium">{m.feedbackQuestion}</span>
        <button
          type="button"
          className={label === "good" ? "btn-primary" : "btn-secondary"}
          aria-pressed={label === "good"}
          disabled={pending}
          onClick={() => choose("good")}
        >
          {m.good}
        </button>
        <button
          type="button"
          className={label === "bad" ? "btn-primary" : "btn-secondary"}
          aria-pressed={label === "bad"}
          disabled={pending}
          onClick={() => choose("bad")}
        >
          {m.bad}
        </button>
        {label && (
          <button type="button" className="text-sm text-navy-600 underline" disabled={pending} onClick={() => submit("clear")}>
            {m.clear}
          </button>
        )}
      </div>
      {label && open && (
        <div className="space-y-2">
          <p className="text-xs text-navy-600">{m.reasonsTitle}</p>
          <div className="flex flex-wrap gap-2">
            {feedbackReasons[label].map((reason) => {
              const checked = reasons.includes(reason);
              return (
                <label key={reason} className={`chip text-xs ${checked ? "chip-active" : ""}`}>
                  <input
                    type="checkbox"
                    className="sr-only"
                    checked={checked}
                    onChange={(e) =>
                      setReasons((r) => (e.target.checked ? [...r, reason] : r.filter((x) => x !== reason)))
                    }
                  />
                  {m.reasons[reason]}
                </label>
              );
            })}
          </div>
          <label className="sr-only" htmlFor={`note-${jobId}`}>{m.notePlaceholder}</label>
          <input
            id={`note-${jobId}`}
            className="input"
            maxLength={500}
            placeholder={m.notePlaceholder}
            value={note}
            onChange={(e) => setNote(e.target.value)}
          />
          <button type="button" className="btn-secondary" disabled={pending} onClick={() => submit(label)}>
            {m.saveFeedback}
          </button>
        </div>
      )}
      {saved && <p aria-live="polite" className="text-xs text-teal-700">{m.feedbackSaved}</p>}
    </div>
  );
}
