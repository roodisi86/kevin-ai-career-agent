import type { SupabaseClient } from "@supabase/supabase-js";
import type { Database } from "@/lib/supabase/database.types";
import { createSupabaseServerClient } from "@/lib/supabase/server";

export type Db = SupabaseClient<Database>;

/**
 * The database client for a context: the signed-in user's cookie session in
 * the web app, or an explicitly signed-in client for the daily automation
 * (scripts/daily-run.ts). Both are user sessions, so RLS always applies.
 */
export async function dbFor(ctx: { db?: Db }): Promise<Db> {
  return ctx.db ?? (await createSupabaseServerClient());
}
