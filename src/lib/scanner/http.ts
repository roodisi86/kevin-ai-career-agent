import type { FetchJson, FetchJsonResult } from "./types";

const USER_AGENT = "KevinAICareerAgent/0.1 (private job search tool; read-only)";

const sleep = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));

/**
 * JSON GET with timeout and polite retries (429/5xx, exponential backoff,
 * Retry-After honoured up to 5 s). Never throws; returns a result object.
 */
export function createFetchJson({
  timeoutMs = 12_000,
  retries = 2,
  minIntervalMs = 0,
}: { timeoutMs?: number; retries?: number; minIntervalMs?: number } = {}): FetchJson {
  let lastRequestAt = 0;

  return async function fetchJson(url: string): Promise<FetchJsonResult> {
    for (let attempt = 0; attempt <= retries; attempt++) {
      if (minIntervalMs > 0) {
        const wait = lastRequestAt + minIntervalMs - Date.now();
        if (wait > 0) await sleep(wait);
      }
      lastRequestAt = Date.now();

      try {
        const response = await fetch(url, {
          headers: { Accept: "application/json", "User-Agent": USER_AGENT },
          signal: AbortSignal.timeout(timeoutMs),
          cache: "no-store",
        });

        if ((response.status === 429 || response.status >= 500) && attempt < retries) {
          const retryAfter = Number(response.headers.get("retry-after"));
          await sleep(Number.isFinite(retryAfter) && retryAfter > 0 ? Math.min(retryAfter * 1000, 5000) : 500 * 2 ** attempt);
          continue;
        }

        if (!response.ok) return { ok: false, status: response.status, data: null, error: `HTTP ${response.status}` };

        const text = await response.text();
        try {
          return { ok: true, status: response.status, data: JSON.parse(text) };
        } catch {
          return { ok: false, status: response.status, data: null, error: "invalid JSON" };
        }
      } catch (error) {
        if (attempt < retries) {
          await sleep(500 * 2 ** attempt);
          continue;
        }
        return { ok: false, status: 0, data: null, error: (error as Error).name === "TimeoutError" ? "timeout" : "network" };
      }
    }
    return { ok: false, status: 0, data: null, error: "exhausted" };
  };
}
