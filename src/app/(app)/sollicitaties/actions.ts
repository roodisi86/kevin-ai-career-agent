"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { z } from "zod";
import { getAppContext } from "@/lib/dal";
import { audit } from "@/lib/audit";
import { createSupabaseServerClient } from "@/lib/supabase/server";

const stages = ["prospect", "applied", "screening", "interviewing", "final_round", "offer", "accepted", "rejected", "withdrawn", "on_hold"] as const;
const channels = ["direct", "recruiter", "referral", "reverse_recruiting", "agency", "other", "unknown"] as const;

const optionalText = (max: number) =>
  z
    .string()
    .trim()
    .max(max)
    .optional()
    .transform((v) => (v ? v : null));
const optionalDate = z
  .union([z.literal(""), z.string().regex(/^\d{4}-\d{2}-\d{2}$/)])
  .optional()
  .transform((v) => (v ? v : null));
const optionalUrl = z
  .union([z.literal(""), z.string().trim().max(2000).regex(/^https?:\/\/\S+$/)])
  .optional()
  .transform((v) => (v ? v : null));

const ApplicationInput = z.object({
  companyName: z.string().trim().min(1).max(200),
  roleTitle: z.string().trim().min(1).max(300),
  stage: z.enum(stages),
  channel: z.enum(channels),
  contactName: optionalText(200),
  jobUrl: optionalUrl,
  appliedOn: optionalDate,
  nextAction: optionalText(300),
  nextActionDue: optionalDate,
  notes: optionalText(4000),
});

function toRow(data: z.infer<typeof ApplicationInput>) {
  return {
    company_name: data.companyName,
    role_title: data.roleTitle,
    stage: data.stage,
    channel: data.channel,
    contact_name: data.contactName,
    job_url: data.jobUrl,
    applied_on: data.appliedOn,
    next_action: data.nextAction,
    next_action_due: data.nextActionDue,
    notes: data.notes,
  };
}

function done(status: string, id?: string): never {
  revalidatePath("/sollicitaties");
  revalidatePath("/dashboard");
  redirect(`/sollicitaties?status=${status}${id ? `#app-${id}` : ""}`);
}

export async function createApplication(formData: FormData): Promise<void> {
  const ctx = await getAppContext();
  const parsed = ApplicationInput.safeParse(Object.fromEntries(formData));
  if (!parsed.success) done("invalid");
  const supabase = await createSupabaseServerClient();
  const { data, error } = await supabase
    .from("applications")
    .insert({ tenant_id: ctx.tenantId, candidate_id: ctx.candidateId, ...toRow(parsed.data) })
    .select("id")
    .single();
  if (error) done("db");
  await audit(ctx, "application.created", "application", data.id, { stage: parsed.data.stage, source: "manual" });
  done("added", data.id);
}

export async function updateApplication(formData: FormData): Promise<void> {
  const ctx = await getAppContext();
  const id = z.uuid().safeParse(formData.get("id"));
  const parsed = ApplicationInput.safeParse(Object.fromEntries(formData));
  if (!id.success || !parsed.success) done("invalid");
  const supabase = await createSupabaseServerClient();
  const { error } = await supabase.from("applications").update(toRow(parsed.data)).eq("tenant_id", ctx.tenantId).eq("id", id.data);
  if (error) done("db");
  await audit(ctx, "application.updated", "application", id.data, { stage: parsed.data.stage });
  done("saved", id.data);
}

const StageInput = z.object({ id: z.uuid(), stage: z.enum(stages) });

/** Quick stage change from the list. */
export async function moveApplication(formData: FormData): Promise<void> {
  const ctx = await getAppContext();
  const parsed = StageInput.safeParse(Object.fromEntries(formData));
  if (!parsed.success) done("invalid");
  const supabase = await createSupabaseServerClient();
  const { error } = await supabase.from("applications").update({ stage: parsed.data.stage }).eq("tenant_id", ctx.tenantId).eq("id", parsed.data.id);
  if (error) done("db");
  await audit(ctx, "application.updated", "application", parsed.data.id, { stage: parsed.data.stage });
  done("saved", parsed.data.id);
}

export async function deleteApplication(formData: FormData): Promise<void> {
  const ctx = await getAppContext();
  const id = z.uuid().safeParse(formData.get("id"));
  if (!id.success || formData.get("confirm") !== "VERWIJDER") done("invalid");
  const supabase = await createSupabaseServerClient();
  const { error } = await supabase.from("applications").delete().eq("tenant_id", ctx.tenantId).eq("id", id.data);
  if (error) done("db");
  await audit(ctx, "application.deleted", "application", id.data, {});
  done("saved");
}

/** "Toevoegen aan sollicitaties" from a vacancy: one application per job. */
export async function addJobToPipeline(formData: FormData): Promise<void> {
  const ctx = await getAppContext();
  const jobId = z.uuid().safeParse(formData.get("jobId"));
  if (!jobId.success) done("invalid");
  const supabase = await createSupabaseServerClient();
  const { data: existing } = await supabase.from("applications").select("id").eq("tenant_id", ctx.tenantId).eq("job_id", jobId.data).limit(1).maybeSingle();
  if (existing) done("added", existing.id);
  const { data: job } = await supabase
    .from("jobs")
    .select("id, title, company_name, canonical_url, company_target_id")
    .eq("tenant_id", ctx.tenantId)
    .eq("id", jobId.data)
    .maybeSingle();
  if (!job) done("invalid");
  const { data, error } = await supabase
    .from("applications")
    .insert({
      tenant_id: ctx.tenantId,
      candidate_id: ctx.candidateId,
      job_id: job.id,
      company_target_id: job.company_target_id,
      company_name: job.company_name.slice(0, 200),
      role_title: job.title.slice(0, 300),
      job_url: job.canonical_url,
      stage: "prospect",
    })
    .select("id")
    .single();
  if (error) done("db");
  await audit(ctx, "application.created", "application", data.id, { stage: "prospect", source: "job" });
  revalidatePath("/vacatures");
  done("added", data.id);
}

/** "Toevoegen aan sollicitaties" from a company signal (a lead without a vacancy). */
export async function addSignalToPipeline(formData: FormData): Promise<void> {
  const ctx = await getAppContext();
  const signalId = z.uuid().safeParse(formData.get("signalId"));
  if (!signalId.success) done("invalid");
  const supabase = await createSupabaseServerClient();
  const { data: existing } = await supabase.from("applications").select("id").eq("tenant_id", ctx.tenantId).eq("signal_id", signalId.data).limit(1).maybeSingle();
  if (existing) done("added", existing.id);
  const { data: signal } = await supabase
    .from("company_signals")
    .select("id, company_target_id, headline, source_url")
    .eq("tenant_id", ctx.tenantId)
    .eq("id", signalId.data)
    .maybeSingle();
  if (!signal) done("invalid");
  const { data: target } = await supabase.from("company_targets").select("company_name").eq("id", signal.company_target_id).maybeSingle();
  const { data, error } = await supabase
    .from("applications")
    .insert({
      tenant_id: ctx.tenantId,
      candidate_id: ctx.candidateId,
      company_target_id: signal.company_target_id,
      signal_id: signal.id,
      company_name: (target?.company_name ?? "—").slice(0, 200),
      role_title: "Kans (nog geen vacature)",
      stage: "prospect",
      channel: "reverse_recruiting",
      notes: `Signaal: ${signal.headline}\nBron: ${signal.source_url}`.slice(0, 4000),
    })
    .select("id")
    .single();
  if (error) done("db");
  await supabase.from("company_signals").update({ user_state: "useful" }).eq("tenant_id", ctx.tenantId).eq("id", signal.id);
  await audit(ctx, "application.created", "application", data.id, { stage: "prospect", source: "signal" });
  revalidatePath("/signalen");
  done("added", data.id);
}
