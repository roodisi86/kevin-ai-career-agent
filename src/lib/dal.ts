import "server-only";
import { cache } from "react";
import { redirect } from "next/navigation";
import { createSupabaseServerClient } from "@/lib/supabase/server";
import type { Db } from "@/lib/supabase/db";

export interface AppContext {
  userId: string;
  email: string | null;
  tenantId: string;
  tenantName: string;
  isDemoTenant: boolean;
  candidateId: string;
  profileVersion: number;
  /** Set only by the daily automation; the web app uses the cookie session. */
  db?: Db;
}

export class NotAllowedError extends Error {
  constructor() {
    super("account not allowed");
  }
}

/**
 * Data Access Layer entry point. Verifies the session with Supabase Auth,
 * makes sure the user's tenant exists (allow-listed accounts only) and
 * returns the narrow context every page and action needs.
 *
 * Throws NotAllowedError for authenticated users that are not allow-listed;
 * redirects to /login when there is no valid session.
 */
export const getAppContext = cache(async (): Promise<AppContext> => {
  const supabase = await createSupabaseServerClient();
  const { data: claimsData } = await supabase.auth.getClaims();
  const claims = claimsData?.claims;
  if (!claims?.sub) {
    redirect("/login");
  }

  const { data: tenantId, error: bootstrapError } = await supabase.rpc("bootstrap_tenant");
  if (bootstrapError || !tenantId) {
    if (bootstrapError?.code === "42501") {
      throw new NotAllowedError();
    }
    throw new Error(`Could not load workspace (${bootstrapError?.code ?? "unknown"})`);
  }

  const [{ data: tenant }, { data: candidate }] = await Promise.all([
    supabase.from("tenants").select("id, name, is_demo").eq("id", tenantId).single(),
    supabase
      .from("candidate_profiles")
      .select("id, profile_version")
      .eq("tenant_id", tenantId)
      .eq("owner_user_id", claims.sub)
      .single(),
  ]);

  if (!tenant || !candidate) {
    throw new Error("Workspace is incomplete");
  }

  return {
    userId: claims.sub,
    email: typeof claims.email === "string" ? claims.email : null,
    tenantId: tenant.id,
    tenantName: tenant.name,
    isDemoTenant: tenant.is_demo,
    candidateId: candidate.id,
    profileVersion: candidate.profile_version,
  };
});
