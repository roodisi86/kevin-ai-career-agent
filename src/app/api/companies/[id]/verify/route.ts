import { z } from "zod";
import { json, Uuid, withContext } from "@/lib/api";
import { verifyCompanyTarget } from "@/lib/scanner/service";

export const runtime = "nodejs";
export const maxDuration = 60;

const Body = z.object({ url: z.url().max(500).optional() }).default({});

/** POST /api/companies/:id/verify — looks for the company's public job board (read-only). */
export async function POST(request: Request, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  if (!Uuid.safeParse(id).success) return json({ error: "not_found" }, 404);
  const raw = await request.json().catch(() => ({}));
  const body = Body.safeParse(raw);
  if (!body.success) return json({ error: "invalid" }, 400);
  return withContext(async (ctx) => json(await verifyCompanyTarget(ctx, id, body.data.url)));
}
