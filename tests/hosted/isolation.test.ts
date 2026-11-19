import { randomUUID } from "node:crypto";
import { readFileSync, existsSync } from "node:fs";
import { createClient, type SupabaseClient } from "@supabase/supabase-js";
import { afterAll, beforeAll, describe, expect, it } from "vitest";

/**
 * Isolation checks against the REAL hosted Supabase (PostgREST + Storage),
 * signed in as the synthetic DEMO account. Read-mostly: the only write is a
 * tiny DEMO file in the demo tenant's own folder, removed afterwards.
 *
 * Requires: NEXT_PUBLIC_SUPABASE_URL, NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY,
 * E2E_EMAIL, E2E_PASSWORD (from .env.local / .env.e2e.local). Skipped otherwise.
 */
for (const file of [".env.local", ".env.e2e.local"]) {
  if (!existsSync(file)) continue;
  for (const line of readFileSync(file, "utf8").split("\n")) {
    const match = line.match(/^([A-Z0-9_]+)=(.*)$/);
    if (match && match[2] && !process.env[match[1]]) process.env[match[1]] = match[2];
  }
}

const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
const key = process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY;
const email = process.env.E2E_EMAIL;
const password = process.env.E2E_PASSWORD;
const enabled = Boolean(url && key && email && password);

const PRIVATE_TABLES = [
  "tenants",
  "memberships",
  "candidate_profiles",
  "candidate_documents",
  "candidate_facts",
  "candidate_preferences",
  "audit_events",
  "consent_records",
  "company_targets",
  "job_sources",
  "jobs",
  "scans",
] as const;

describe.skipIf(!enabled)("hosted Supabase isolation (DEMO account)", () => {
  let anon: SupabaseClient;
  let demo: SupabaseClient;
  let tenantId: string;
  const ownFile = () => `${tenantId}/isolation-test-${randomUUID()}.pdf`;
  const created: string[] = [];

  beforeAll(async () => {
    anon = createClient(url!, key!, { auth: { persistSession: false } });
    demo = createClient(url!, key!, { auth: { persistSession: false } });
    const { error } = await demo.auth.signInWithPassword({ email: email!, password: password! });
    if (error) throw new Error(`demo sign-in failed: ${error.message}`);
    const { data, error: rpcError } = await demo.rpc("bootstrap_tenant");
    if (rpcError || !data) throw new Error("bootstrap failed");
    tenantId = data as string;
  });

  afterAll(async () => {
    if (created.length) await demo.storage.from("cv-documents").remove(created);
    await demo?.auth.signOut();
  });

  it.each(PRIVATE_TABLES)("anonymous requests cannot read %s", async (table) => {
    const { data, error } = await anon.from(table).select("*").limit(1);
    expect(error !== null || (data ?? []).length === 0).toBe(true);
  });

  it("anonymous requests cannot call the bootstrap RPC", async () => {
    const { error } = await anon.rpc("bootstrap_tenant");
    expect(error).not.toBeNull();
  });

  it("RLS helper functions are not exposed via the API", async () => {
    const { error } = await demo.rpc("is_tenant_member" as never, { p_tenant: tenantId } as never);
    expect(error).not.toBeNull();
  });

  it("the allow-list is not readable for signed-in users", async () => {
    const { data, error } = await demo.from("allowed_owners" as never).select("*");
    expect(error !== null || (data ?? []).length === 0).toBe(true);
  });

  it.each(PRIVATE_TABLES.filter((t) => t !== "tenants"))(
    "an unfiltered select on %s only returns the demo tenant's rows",
    async (table) => {
      const { data, error } = await demo.from(table).select("tenant_id");
      expect(error).toBeNull();
      for (const row of (data ?? []) as { tenant_id: string }[]) expect(row.tenant_id).toBe(tenantId);
    },
  );

  it("cannot insert a fact into another tenant", async () => {
    const otherTenant = randomUUID();
    const { error } = await demo.from("candidate_facts").insert({
      tenant_id: otherTenant,
      candidate_id: randomUUID(),
      category: "other",
      statement: "DEMO cross-tenant attempt",
      origin: "user",
    });
    expect(error).not.toBeNull();
  });

  it("storage: can upload to its own folder, but not to another tenant's or a loose path", async () => {
    const pdf = new TextEncoder().encode("%PDF-1.4\n% DEMO isolation test\n");
    const own = ownFile();
    const ok = await demo.storage.from("cv-documents").upload(own, pdf, { contentType: "application/pdf" });
    expect(ok.error).toBeNull();
    created.push(own);

    const foreign = await demo.storage
      .from("cv-documents")
      .upload(`${randomUUID()}/intrusion.pdf`, pdf, { contentType: "application/pdf" });
    expect(foreign.error).not.toBeNull();

    const loose = await demo.storage.from("cv-documents").upload("loose.pdf", pdf, { contentType: "application/pdf" });
    expect(loose.error).not.toBeNull();
  });

  it("storage: anonymous users cannot list, download or sign URLs", async () => {
    const list = await anon.storage.from("cv-documents").list(tenantId);
    expect(list.error !== null || (list.data ?? []).length === 0).toBe(true);
    const signed = await anon.storage.from("cv-documents").createSignedUrl(`${tenantId}/whatever.pdf`, 60);
    expect(signed.error).not.toBeNull();
    const publicUrl = anon.storage.from("cv-documents").getPublicUrl(`${tenantId}/whatever.pdf`).data.publicUrl;
    const response = await fetch(publicUrl);
    expect(response.ok).toBe(false);
  });

  it("storage: the bucket refuses non-CV file types", async () => {
    const { error } = await demo.storage
      .from("cv-documents")
      .upload(`${tenantId}/script.html`, new TextEncoder().encode("<script>alert(1)</script>"), {
        contentType: "text/html",
      });
    expect(error).not.toBeNull();
  });
});
