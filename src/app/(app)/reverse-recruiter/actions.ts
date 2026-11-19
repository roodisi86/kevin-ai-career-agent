"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { z } from "zod";
import { getAppContext } from "@/lib/dal";
import { audit } from "@/lib/audit";
import { createSupabaseServerClient } from "@/lib/supabase/server";
import { requestOutreach, warningsForEdit } from "@/lib/outreach/service";
import { allowedSourceUrl } from "@/lib/outreach/research";

export type ActionResult = { ok: boolean; error: string | null };

export async function startResearch(formData: FormData): Promise<void> {
  const ctx = await getAppContext();
  const jobId = z.uuid().safeParse(formData.get("jobId"));
  if (!jobId.success) return;
  const result = await requestOutreach(ctx, jobId.data);
  revalidatePath("/reverse-recruiter");
  revalidatePath("/vacatures");
  redirect(`/reverse-recruiter?started=${result.ok ? result.status : result.error}#job-${jobId.data}`);
}

const DraftEdit = z.object({
  id: z.uuid(),
  subject: z.string().trim().max(300),
  body: z.string().trim().min(1).max(6000),
  language: z.enum(["nl", "en", "fr", "es", "de"]),
  contactId: z.uuid().nullable(),
});

/** Saving creates a new version (database trigger) and revokes any approval. */
export async function saveDraft(input: unknown): Promise<ActionResult> {
  const ctx = await getAppContext();
  const parsed = DraftEdit.safeParse(input);
  if (!parsed.success) return { ok: false, error: "invalid" };
  const supabase = await createSupabaseServerClient();
  const { data: draft } = await supabase
    .from("outreach_drafts")
    .select("id, job_id, evidence_json")
    .eq("tenant_id", ctx.tenantId)
    .eq("id", parsed.data.id)
    .maybeSingle();
  if (!draft) return { ok: false, error: "not_found" };
  const warnings = await warningsForEdit(ctx, draft, `${parsed.data.subject}\n${parsed.data.body}`);
  const { error } = await supabase
    .from("outreach_drafts")
    .update({
      subject: parsed.data.subject,
      body: parsed.data.body,
      language: parsed.data.language,
      contact_id: parsed.data.contactId,
      warnings,
      origin: "user",
    })
    .eq("tenant_id", ctx.tenantId)
    .eq("id", parsed.data.id);
  if (error) return { ok: false, error: error.code === "42501" ? "state" : "db" };
  await audit(ctx, "outreach.draft_saved", "outreach_draft", parsed.data.id, { warnings: warnings.length });
  revalidatePath("/reverse-recruiter");
  return { ok: true, error: null };
}

const StateChange = z.object({
  id: z.uuid(),
  state: z.enum(["draft", "reviewed", "approved", "sent", "replied", "no_reply", "closed"]),
  acknowledgedWarnings: z.boolean().optional(),
});

/** State changes are validated again by the database (exact-version approval). */
export async function changeDraftState(input: unknown): Promise<ActionResult> {
  const ctx = await getAppContext();
  const parsed = StateChange.safeParse(input);
  if (!parsed.success) return { ok: false, error: "invalid" };
  const supabase = await createSupabaseServerClient();
  if (parsed.data.state === "approved") {
    const { data: draft } = await supabase
      .from("outreach_drafts")
      .select("warnings")
      .eq("tenant_id", ctx.tenantId)
      .eq("id", parsed.data.id)
      .maybeSingle();
    if (draft && draft.warnings.length > 0 && !parsed.data.acknowledgedWarnings) return { ok: false, error: "warnings" };
  }
  const { error } = await supabase
    .from("outreach_drafts")
    .update({ state: parsed.data.state })
    .eq("tenant_id", ctx.tenantId)
    .eq("id", parsed.data.id);
  if (error) return { ok: false, error: error.code === "42501" ? "state" : "db" };
  await audit(ctx, "outreach.state_changed", "outreach_draft", parsed.data.id, { state: parsed.data.state });
  revalidatePath("/reverse-recruiter");
  return { ok: true, error: null };
}

export async function deleteDraft(formData: FormData): Promise<void> {
  const ctx = await getAppContext();
  const id = z.uuid().safeParse(formData.get("id"));
  if (!id.success) return;
  const supabase = await createSupabaseServerClient();
  await supabase.from("outreach_drafts").delete().eq("tenant_id", ctx.tenantId).eq("id", id.data).in("state", ["draft", "reviewed"]);
  revalidatePath("/reverse-recruiter");
}

const ContactInput = z.object({
  jobId: z.uuid(),
  name: z.string().trim().min(2).max(200),
  role: z.string().trim().max(200).optional(),
  organisation: z.string().trim().max(200).optional(),
  sourceUrl: z.string().trim().max(500).optional(),
  email: z.union([z.literal(""), z.email()]).optional(),
});

export async function addContact(_prev: ActionResult, formData: FormData): Promise<ActionResult> {
  const ctx = await getAppContext();
  const parsed = ContactInput.safeParse(Object.fromEntries(formData));
  if (!parsed.success) return { ok: false, error: "invalid" };
  const url = parsed.data.sourceUrl || null;
  if (url && !allowedSourceUrl(url)) return { ok: false, error: "source" };
  const supabase = await createSupabaseServerClient();
  const { data, error } = await supabase
    .from("contacts")
    .insert({
      tenant_id: ctx.tenantId,
      job_id: parsed.data.jobId,
      name: parsed.data.name,
      role: parsed.data.role || null,
      organisation: parsed.data.organisation || null,
      source_url: url,
      source_type: "user",
      email: parsed.data.email || null,
      verification_status: "user_confirmed",
      lawful_basis_note: "Door de gebruiker zelf toegevoegd.",
      origin: "user",
    })
    .select("id")
    .single();
  if (error) return { ok: false, error: "db" };
  await audit(ctx, "outreach.contact_added", "contact", data.id, {});
  revalidatePath("/reverse-recruiter");
  return { ok: true, error: null };
}

export async function confirmContact(formData: FormData): Promise<void> {
  const ctx = await getAppContext();
  const id = z.uuid().safeParse(formData.get("id"));
  if (!id.success) return;
  const supabase = await createSupabaseServerClient();
  await supabase.from("contacts").update({ verification_status: "user_confirmed" }).eq("tenant_id", ctx.tenantId).eq("id", id.data);
  revalidatePath("/reverse-recruiter");
}

export async function removeContact(formData: FormData): Promise<void> {
  const ctx = await getAppContext();
  const id = z.uuid().safeParse(formData.get("id"));
  if (!id.success) return;
  const supabase = await createSupabaseServerClient();
  // A contact that already received a message stays, as part of the history.
  const { count } = await supabase
    .from("outreach_drafts")
    .select("id", { count: "exact", head: true })
    .eq("tenant_id", ctx.tenantId)
    .eq("contact_id", id.data)
    .in("state", ["sent", "replied", "no_reply", "closed"]);
  if ((count ?? 0) > 0) return;
  // Drafts addressed to this contact lose their recipient (and thereby any approval).
  await supabase.from("outreach_drafts").update({ contact_id: null }).eq("tenant_id", ctx.tenantId).eq("contact_id", id.data).in("state", ["draft", "reviewed", "approved"]);
  await supabase.from("contacts").delete().eq("tenant_id", ctx.tenantId).eq("id", id.data);
  await audit(ctx, "outreach.contact_removed", "contact", id.data, {});
  revalidatePath("/reverse-recruiter");
}
