"use client";

import { useActionState, useState } from "react";
import { useRouter } from "next/navigation";
import { getDictionary } from "@/lib/i18n";
import { importJob, type ImportState } from "./actions";
import { matchSummaryText } from "./match-components";
import { runMatching } from "./run-matching";

const t = getDictionary();

interface ScanPlan {
  scanId: string;
  sources: { id: string; label: string }[];
}

type SourceResult = { ok: true; counts: { relevant: number; new: number } } | { ok: false; error: string };

export function ScanPanel({ hasSources, aiConfigured }: { hasSources: boolean; aiConfigured: boolean }) {
  const router = useRouter();
  const [running, setRunning] = useState(false);
  const [log, setLog] = useState<{ label: string; text: string; ok: boolean }[]>([]);
  const [progress, setProgress] = useState<{ done: number; total: number } | null>(null);
  const [message, setMessage] = useState<string | null>(null);

  async function run() {
    setRunning(true);
    setLog([]);
    setMessage(null);
    try {
      const start = await fetch("/api/scans", { method: "POST" });
      if (!start.ok) throw new Error("start");
      const plan = (await start.json()) as ScanPlan;
      if (plan.sources.length === 0) {
        setMessage(t.jobs.scan.noSources);
        return;
      }
      setProgress({ done: 0, total: plan.sources.length });
      // Sequential and polite: one source per request keeps every call well under the function time limit.
      for (let i = 0; i < plan.sources.length; i++) {
        const source = plan.sources[i];
        let entry: { label: string; text: string; ok: boolean };
        try {
          const response = await fetch(`/api/scans/${plan.scanId}/sources/${source.id}`, { method: "POST" });
          const result = (await response.json()) as SourceResult;
          entry = result.ok
            ? { label: source.label, text: t.jobs.scan.sourceOk(result.counts.relevant, result.counts.new), ok: true }
            : { label: source.label, text: `${t.jobs.scan.sourceError}: ${result.error}`, ok: false };
        } catch {
          entry = { label: source.label, text: t.jobs.scan.sourceError, ok: false };
        }
        setLog((l) => [...l, entry]);
        setProgress({ done: i + 1, total: plan.sources.length });
      }
      await fetch(`/api/scans/${plan.scanId}/finish`, { method: "POST" });
      router.refresh();
      // Then assess new or changed vacancies right away: one click, ranked list.
      if (aiConfigured) {
        setMessage(t.jobs.scan.matching);
        const summary = await runMatching({
          onProgress: (done, total) => setMessage(`${t.jobs.scan.matching} ${t.jobs.match.running(done, total)}`),
        });
        setMessage(`${t.jobs.scan.done} ${matchSummaryText(summary)}`);
      } else {
        setMessage(t.jobs.scan.done);
      }
      router.refresh();
    } catch {
      setMessage(t.common.error);
    } finally {
      setRunning(false);
    }
  }

  return (
    <div className="space-y-3">
      <div className="flex flex-wrap items-center gap-3">
        <button type="button" className="btn-teal" onClick={run} disabled={running || !hasSources}>
          {running ? t.jobs.scan.running : t.jobs.scan.button}
        </button>
        <span aria-live="polite" className="text-sm text-navy-600">
          {progress && t.jobs.scan.progress(progress.done, progress.total)} {message}
        </span>
      </div>
      {!hasSources && <p className="text-sm text-navy-600">{t.jobs.scan.noSources}</p>}
      {log.length > 0 && (
        <ul className="max-h-48 overflow-auto rounded-lg bg-sand-100 p-3 text-xs">
          {log.map((entry, i) => (
            <li key={i} className={entry.ok ? "text-navy-800" : "text-rose-800"}>
              {entry.label}: {entry.text}
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}

export function ImportForm() {
  const [state, action, pending] = useActionState<ImportState, FormData>(importJob, { ok: false, code: null });
  return (
    <form action={action} className="space-y-3">
      <p className="help">{t.jobs.import.help}</p>
      <div className="grid gap-3 md:grid-cols-2">
        <div className="md:col-span-2">
          <label htmlFor="import-url" className="label">{t.jobs.import.url}</label>
          <input id="import-url" name="url" type="url" required className="input" placeholder="https://" />
        </div>
        <div>
          <label htmlFor="import-title" className="label">{t.jobs.import.jobTitle}</label>
          <input id="import-title" name="title" required maxLength={300} className="input" />
        </div>
        <div>
          <label htmlFor="import-company" className="label">{t.jobs.import.company}</label>
          <input id="import-company" name="company" required maxLength={200} className="input" />
        </div>
        <div className="md:col-span-2">
          <label htmlFor="import-location" className="label">{t.jobs.import.location}</label>
          <input id="import-location" name="location" maxLength={300} className="input" />
        </div>
        <div className="md:col-span-2">
          <label htmlFor="import-text" className="label">{t.jobs.import.text}</label>
          <textarea id="import-text" name="text" rows={6} maxLength={60000} className="input" />
        </div>
      </div>
      <button type="submit" className="btn-primary" disabled={pending}>{pending ? t.common.saving : t.jobs.import.submit}</button>
      <div aria-live="polite">
        {state.ok && <p className="text-sm text-teal-700">{state.code === "updated" ? t.jobs.import.updated : t.jobs.import.done}</p>}
        {state.code === "invalid" && <p role="alert" className="text-sm text-rose-800">{t.jobs.import.invalid}</p>}
        {state.code === "error" && <p role="alert" className="text-sm text-rose-800">{t.common.error}</p>}
      </div>
    </form>
  );
}
