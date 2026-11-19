"use server";

import { revalidatePath } from "next/cache";
import { z } from "zod";
import { getAppContext } from "@/lib/dal";
import { audit } from "@/lib/audit";
import { createSupabaseServerClient } from "@/lib/supabase/server";
import { adzunaConfigured, companyKey, loadSuggestedTargets, verifyCompanyTarget } from "@/lib/scanner/service";

const Id = z.uuid();

function refresh() {
  revalidatePath("/bedrijven");
  revalidatePath("/vacatures");
  revalidatePath("/dashboard");
}

export async function loadSuggested(): Promise<void> {
  const ctx = await getAppContext();
  await loadSuggestedTargets(ctx);
  refresh();
}

export type AddCompanyState = { ok: boolean; code: string | null };

const AddSchema = z.object({
  name: z.string().trim().min(1).max(200),
  sector: z.string().trim().max(120),
  url: z.union([z.literal(""), z.url().max(500)]),
});

export async function addCompany(_prev: AddCompanyState, formData: FormData): Promise<AddCompanyState> {
  const ctx = await getAppContext();
  const parsed = AddSchema.safeParse({
    name: formData.get("name"),
    sector: formData.get("sector") ?? "",
    url: formData.get("url") ?? "",
  });
  if (!parsed.success) return { ok: false, code: "invalid" };

  const supabase = await createSupabaseServerClient();
  const { data, error } = await supabase
    .from("company_targets")
    .upsert(
      {
        tenant_id: ctx.tenantId,
        company_name: parsed.data.name,
        company_key: companyKey(parsed.data.name),
        sector: parsed.data.sector || null,
        origin: "user",
      },
      { onConflict: "tenant_id,company_key" },
    )
    .select("id")
    .single();
  if (error || !data) return { ok: false, code: "db" };
  await audit(ctx, "company.added", "company_target", data.id);

  if (parsed.data.url) {
    const result = await verifyCompanyTarget(ctx, data.id, parsed.data.url);
    refresh();
    if (result.urlNotSupported) return { ok: false, code: "url_not_supported" };
  }
  refresh();
  return { ok: true, code: null };
}

export async function removeCompany(formData: FormData): Promise<void> {
  const ctx = await getAppContext();
  const id = Id.safeParse(formData.get("id"));
  if (!id.success) return;
  const supabase = await createSupabaseServerClient();
  const { error } = await supabase.from("company_targets").delete().eq("id", id.data);
  if (!error) await audit(ctx, "company.removed", "company_target", id.data);
  refresh();
}

export async function setSourceApproval(formData: FormData): Promise<void> {
  const ctx = await getAppContext();
  const id = Id.safeParse(formData.get("id"));
  const approve = formData.get("approve") === "true";
  if (!id.success) return;
  const supabase = await createSupabaseServerClient();
  const { data: source } = await supabase
    .from("job_sources")
    .select("id, provider, verification_status")
    .eq("id", id.data)
    .maybeSingle();
  if (!source) return;
  // Only verified sources can be approved; Adzuna only with a configured key.
  if (approve && (source.verification_status !== "verified" || (source.provider === "adzuna" && !adzunaConfigured()))) return;
  const { error } = await supabase.from("job_sources").update({ approved: approve }).eq("id", source.id);
  if (!error) await audit(ctx, approve ? "source.approved" : "source.revoked", "job_source", source.id, { provider: source.provider });
  refresh();
}

export async function approveAllVerified(): Promise<void> {
  const ctx = await getAppContext();
  const supabase = await createSupabaseServerClient();
  const { data } = await supabase
    .from("job_sources")
    .update({ approved: true })
    .eq("tenant_id", ctx.tenantId)
    .eq("verification_status", "verified")
    .eq("approved", false)
    .not("company_target_id", "is", null)
    .select("id");
  await audit(ctx, "source.approved", "job_source", null, { bulk: true, count: data?.length ?? 0 });
  refresh();
}
