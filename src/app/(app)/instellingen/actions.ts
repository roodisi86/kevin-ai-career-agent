"use server";

import { revalidatePath } from "next/cache";
import { getAppContext } from "@/lib/dal";
import { audit } from "@/lib/audit";
import { createSupabaseServerClient } from "@/lib/supabase/server";

export type DeleteState = { ok: boolean; error: "mismatch" | "storage" | "db" | null };

/**
 * Wipes all candidate data (CV files, extracted text, facts, preferences,
 * profile fields). The audit log is kept as evidence of the deletion.
 */
export async function deleteAllCandidateData(_prev: DeleteState, formData: FormData): Promise<DeleteState> {
  if (formData.get("confirm") !== "VERWIJDER") return { ok: false, error: "mismatch" };
  const ctx = await getAppContext();
  const supabase = await createSupabaseServerClient();

  const { data: docs, error: listError } = await supabase
    .from("candidate_documents")
    .select("id, storage_path")
    .eq("candidate_id", ctx.candidateId);
  if (listError) return { ok: false, error: "db" };

  if (docs.length > 0) {
    const { error: storageError } = await supabase.storage
      .from("cv-documents")
      .remove(docs.map((d) => d.storage_path));
    if (storageError) return { ok: false, error: "storage" };
  }

  const results = await Promise.all([
    supabase.from("candidate_facts").delete().eq("candidate_id", ctx.candidateId),
    supabase
      .from("candidate_preferences")
      .update({ preferences_json: {} })
      .eq("candidate_id", ctx.candidateId),
    supabase
      .from("candidate_profiles")
      .update({
        headline: null,
        summary: null,
        desired_seniority: null,
        suggested_headline: null,
        suggested_summary: null,
        suggestion_document_id: null,
        suggestion_created_at: null,
      })
      .eq("id", ctx.candidateId),
  ]);
  const docDelete = await supabase.from("candidate_documents").delete().eq("candidate_id", ctx.candidateId);
  // Search activity is personal too: jobs, sources and target companies.
  const scannerResults = await Promise.all([
    // Matches and feedback cascade with the jobs; the assessment goes explicitly.
    supabase.from("candidate_assessments").delete().eq("candidate_id", ctx.candidateId),
    // Outreach drafts, contacts and research cascade with the jobs; drafts without a job go explicitly.
    supabase.from("outreach_drafts").delete().eq("tenant_id", ctx.tenantId),
    // Pipeline (events cascade), digests and signal research are personal too.
    supabase.from("applications").delete().eq("tenant_id", ctx.tenantId),
    supabase.from("daily_digests").delete().eq("tenant_id", ctx.tenantId),
    supabase.from("signal_requests").delete().eq("tenant_id", ctx.tenantId),
    supabase.from("jobs").delete().eq("tenant_id", ctx.tenantId),
    supabase.from("job_sources").delete().eq("tenant_id", ctx.tenantId),
    supabase.from("company_targets").delete().eq("tenant_id", ctx.tenantId),
  ]);
  if (scannerResults.some((r) => r.error)) return { ok: false, error: "db" };
  if (results.some((r) => r.error) || docDelete.error) return { ok: false, error: "db" };

  await audit(ctx, "data.deleted", "candidate_profile", ctx.candidateId, { documents: docs.length });
  revalidatePath("/", "layout");
  return { ok: true, error: null };
}
