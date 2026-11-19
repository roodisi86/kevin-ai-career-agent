import { json, Uuid, withContext } from "@/lib/api";
import { runSourceInScan } from "@/lib/scanner/service";

export const runtime = "nodejs";
export const maxDuration = 60;

/** POST /api/scans/:id/sources/:sourceId — scans one approved source within a running scan. */
export async function POST(_request: Request, { params }: { params: Promise<{ id: string; sourceId: string }> }) {
  const { id, sourceId } = await params;
  if (!Uuid.safeParse(id).success || !Uuid.safeParse(sourceId).success) return json({ error: "not_found" }, 404);
  return withContext(async (ctx) => json(await runSourceInScan(ctx, id, sourceId)));
}
