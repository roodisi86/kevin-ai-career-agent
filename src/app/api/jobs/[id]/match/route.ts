import { z } from "zod";
import { json, Uuid, withContext } from "@/lib/api";
import { scoreJob } from "@/lib/matching/service";

export const runtime = "nodejs";
export const maxDuration = 60;

const Body = z.object({ force: z.boolean().optional() }).default({});

/** POST /api/jobs/:id/match — evidence-based Claude assessment of one job (cached). */
export async function POST(request: Request, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  if (!Uuid.safeParse(id).success) return json({ error: "not_found" }, 404);
  const raw = await request.json().catch(() => ({}));
  const body = Body.safeParse(raw);
  if (!body.success) return json({ error: "invalid" }, 400);
  return withContext(async (ctx) => {
    const outcome = await scoreJob(ctx, id, { force: body.data.force ?? false });
    return json(outcome, outcome.status === "not_found" ? 404 : 200);
  });
}
