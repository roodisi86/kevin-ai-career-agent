import { NextResponse } from "next/server";
import { createClient } from "@supabase/supabase-js";
import { bearerToken, LeadBatchSchema } from "@/lib/leads/tokens";
import type { Database } from "@/lib/supabase/database.types";
import { getPublicEnv } from "@/lib/env";

/**
 * Job leads from the user's own Grok Bot. Authenticated with a personal import
 * key (Bearer). The key can do one thing: add leads through the database
 * function submit_job_leads, which checks the key, caps volume and writes only
 * job_leads. The app imports them later as not-verified manual vacancies.
 */
export const dynamic = "force-dynamic";

const MAX_BODY_BYTES = 600_000;

export async function POST(request: Request) {
  const token = bearerToken(request.headers.get("authorization"));
  if (!token) return NextResponse.json({ error: "unauthorized" }, { status: 401 });

  const length = Number(request.headers.get("content-length") ?? "0");
  if (length > MAX_BODY_BYTES) return NextResponse.json({ error: "too_large" }, { status: 413 });
  const raw = await request.text();
  if (raw.length > MAX_BODY_BYTES) return NextResponse.json({ error: "too_large" }, { status: 413 });

  let body: unknown;
  try {
    body = JSON.parse(raw);
  } catch {
    return NextResponse.json({ error: "invalid_json" }, { status: 400 });
  }
  const parsed = LeadBatchSchema.safeParse(body);
  if (!parsed.success) {
    return NextResponse.json(
      { error: "invalid_body", hint: "Send {\"jobs\":[{\"title\",\"company\",\"url\",...}]} with 1 to 25 jobs." },
      { status: 400 },
    );
  }

  let env: ReturnType<typeof getPublicEnv>;
  try {
    env = getPublicEnv();
  } catch {
    return NextResponse.json({ error: "not_configured" }, { status: 503 });
  }
  const supabase = createClient<Database>(env.NEXT_PUBLIC_SUPABASE_URL, env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY, {
    auth: { persistSession: false, autoRefreshToken: false },
  });
  const { data, error } = await supabase.rpc("submit_job_leads", { p_token: token, p_leads: parsed.data.jobs });
  if (error) {
    const status = error.code === "28000" ? 401 : error.code === "54000" ? 429 : error.code === "22023" ? 400 : 500;
    return NextResponse.json({ error: status === 401 ? "unauthorized" : status === 429 ? "daily_limit" : status === 400 ? "invalid_body" : "error" }, { status });
  }
  return NextResponse.json({ ok: true, ...(data as Record<string, number>) });
}
