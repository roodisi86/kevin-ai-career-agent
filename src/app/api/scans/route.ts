import { json, withContext } from "@/lib/api";
import { startScan } from "@/lib/scanner/service";

export const runtime = "nodejs";

/** POST /api/scans — starts a manual scan (or returns the running one). */
export async function POST() {
  return withContext(async (ctx) => json(await startScan(ctx)));
}
