import { json, withContext } from "@/lib/api";
import { pendingMatchJobIds } from "@/lib/matching/service";

export const runtime = "nodejs";

/** GET /api/matches/pending[?force=1] — job ids whose AI assessment is missing or out of date. */
export async function GET(request: Request) {
  const force = new URL(request.url).searchParams.get("force") === "1";
  return withContext(async (ctx) => json(await pendingMatchJobIds(ctx, { force })));
}
