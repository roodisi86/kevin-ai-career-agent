import Link from "next/link";
import { getAppContext } from "@/lib/dal";
import { getDictionary } from "@/lib/i18n";
import { loadSignals, processSignalAnswers, signalQueueStatus } from "@/lib/signals/service";
import { formatDateTime } from "@/lib/time";
import { addSignalToPipeline } from "../sollicitaties/actions";
import { requestSignalsNow, setSignalState } from "./actions";

const t = getDictionary();
const s = t.signals;

export default async function SignalsPage({ searchParams }: { searchParams: Promise<Record<string, string | string[] | undefined>> }) {
  const ctx = await getAppContext();
  const params = await searchParams;
  const requested = typeof params.requested === "string" ? params.requested : null;
  const showDismissed = params.all === "1";
  // Verify and store any answers from the Claude task before showing the list.
  await processSignalAnswers(ctx);
  const [signals, queue] = await Promise.all([loadSignals(ctx, { includeDismissed: showDismissed }), signalQueueStatus(ctx)]);

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-2xl font-semibold">{s.title}</h1>
        <p className="max-w-3xl text-sm text-navy-600">{s.intro}</p>
        <p className="mt-1 text-xs text-navy-600">{s.howItWorks}</p>
      </div>

      <section className="card flex flex-wrap items-center justify-between gap-3">
        <p className="text-sm" data-testid="signal-queue">
          {s.queueStatus(queue.pending, queue.watched)}
          {queue.lastProcessedAt ? ` · ${s.lastProcessed}: ${formatDateTime(queue.lastProcessedAt)}` : ""}
        </p>
        <form action={requestSignalsNow}>
          <button type="submit" className="btn-secondary">{s.requestNow}</button>
        </form>
      </section>

      {requested && (
        <p className="card text-sm" role="status">{s.requested[requested] ?? t.common.error}</p>
      )}

      {signals.length === 0 && <p className="card text-sm">{s.empty}</p>}

      <ul className="space-y-3">
        {signals.map((sig) => (
          <li key={sig.id} className={`card space-y-2 ${sig.user_state === "dismissed" ? "opacity-60" : ""}`} data-testid="signal">
            <div className="flex flex-wrap items-center gap-2">
              <span className="badge bg-navy-800 text-white">{s.type[sig.signal_type]}</span>
              <span className="font-semibold">{sig.company_name}</span>
              <span className={`badge ${sig.verification_status === "source_checked" ? "bg-teal-100 text-teal-700" : "bg-amber-100 text-amber-800"}`}>
                {s.verification[sig.verification_status]}
              </span>
              {sig.user_state === "useful" && <span className="badge bg-teal-100 text-teal-700">{s.useful}</span>}
            </div>
            <p className="font-medium">{sig.headline}</p>
            {sig.summary && <p className="text-sm">{sig.summary}</p>}
            {sig.relevance && <p className="text-sm text-navy-600">{sig.relevance}</p>}
            {sig.suggested_action && (
              <p className="text-sm"><span className="font-medium">→ </span>{sig.suggested_action}</p>
            )}
            <p className="text-xs text-navy-600">
              <a href={sig.source_url} target="_blank" rel="noopener noreferrer" className="underline">
                {s.source}: {sig.source_title ?? new URL(sig.source_url).hostname}
              </a>
              {" · "}
              {s.published}: {sig.published_on ?? s.unknownDate} · {formatDateTime(sig.created_at)}
            </p>
            <div className="flex flex-wrap gap-2">
              <form action={addSignalToPipeline}>
                <input type="hidden" name="signalId" value={sig.id} />
                <button type="submit" className="btn-teal">{s.toPipeline}</button>
              </form>
              {sig.user_state !== "useful" && (
                <form action={setSignalState}>
                  <input type="hidden" name="id" value={sig.id} />
                  <input type="hidden" name="state" value="useful" />
                  <button type="submit" className="btn-secondary">{s.useful}</button>
                </form>
              )}
              <form action={setSignalState}>
                <input type="hidden" name="id" value={sig.id} />
                <input type="hidden" name="state" value={sig.user_state === "dismissed" ? "new" : "dismissed"} />
                <button type="submit" className="btn-secondary">{sig.user_state === "dismissed" ? s.restore : s.dismiss}</button>
              </form>
            </div>
          </li>
        ))}
      </ul>

      <p className="text-xs">
        <Link href={showDismissed ? "/signalen" : "/signalen?all=1"} className="underline">
          {showDismissed ? s.hideDismissed : s.showDismissed}
        </Link>
      </p>
    </div>
  );
}
