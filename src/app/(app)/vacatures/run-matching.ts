/**
 * Browser-side runner for AI assessments: one request per job, three in
 * parallel, so every request stays well within the function time limit.
 */
export interface MatchRunSummary {
  total: number;
  scored: number;
  failed: number;
  stopReason: string | null;
}

const STOP_STATUSES = new Set(["not_configured", "cap_reached", "no_facts"]);

export async function runMatching({
  force = false,
  onProgress,
  shouldStop = () => false,
}: {
  force?: boolean;
  onProgress?: (done: number, total: number) => void;
  shouldStop?: () => boolean;
}): Promise<MatchRunSummary> {
  const response = await fetch(`/api/matches/pending${force ? "?force=1" : ""}`);
  if (!response.ok) throw new Error("pending");
  const { pending: ids } = (await response.json()) as { pending: string[] };
  const summary: MatchRunSummary = { total: ids.length, scored: 0, failed: 0, stopReason: null };
  const queue = [...ids];
  let done = 0;
  onProgress?.(0, ids.length);

  async function worker() {
    while (queue.length > 0 && !shouldStop() && !summary.stopReason) {
      const id = queue.shift()!;
      try {
        const res = await fetch(`/api/jobs/${id}/match`, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ force }),
        });
        const outcome = (await res.json()) as { status: string };
        if (outcome.status === "scored" || outcome.status === "cached") summary.scored++;
        else if (STOP_STATUSES.has(outcome.status)) summary.stopReason = outcome.status;
        else summary.failed++;
      } catch {
        summary.failed++;
      }
      done++;
      onProgress?.(done, ids.length);
    }
  }
  await Promise.all([worker(), worker(), worker()]);
  return summary;
}
