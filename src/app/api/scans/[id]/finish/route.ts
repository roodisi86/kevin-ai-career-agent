import { json, Uuid, withContext } from "@/lib/api";
import { finishScan } from "@/lib/scanner/service";

export const runtime = "nodejs";
export const maxDuration = 60;

/** POST /api/scans/:id/finish — dedupe, refresh hard gates, close the scan. */
export async function POST(_request: Request, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  if (!Uuid.safeParse(id).success) return json({ error: "not_found" }, 404);
  return withContext(async (ctx) => json(await finishScan(ctx, id)));
}
