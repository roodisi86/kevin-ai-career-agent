import "server-only";
import { NextResponse } from "next/server";
import { z } from "zod";
import { getAppContext, NotAllowedError, type AppContext } from "@/lib/dal";

/** Wraps a route handler: authenticated context, no caching, safe errors (no payloads in logs). */
export async function withContext(handler: (ctx: AppContext) => Promise<Response>): Promise<Response> {
  let ctx: AppContext;
  try {
    ctx = await getAppContext();
  } catch (error) {
    if (error instanceof NotAllowedError) return json({ error: "not_allowed" }, 403);
    throw error;
  }
  try {
    return await handler(ctx);
  } catch (error) {
    console.error(`api error: ${(error as Error).message?.slice(0, 80)}`);
    return json({ error: "server_error" }, 500);
  }
}

export function json(body: unknown, status = 200): Response {
  return NextResponse.json(body, { status, headers: { "Cache-Control": "no-store" } });
}

export const Uuid = z.uuid();
