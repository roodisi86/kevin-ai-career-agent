"use server";

import { revalidatePath } from "next/cache";
import { z } from "zod";
import { getAppContext } from "@/lib/dal";
import { audit } from "@/lib/audit";
import { createSupabaseServerClient } from "@/lib/supabase/server";
import { isSensitiveClaim } from "@/lib/cv/text";
import {
  bulkConfirmable,
  factCategories,
  verifyProfileSummary,
  verifySuggestions,
  PROMPT_VERSION,
} from "@/lib/ai/cv-facts";
import { suggestCvFacts } from "@/lib/ai/claude";
import { getServerEnv } from "@/lib/env";

export type ActionState = { ok: boolean; message: string | null; code?: string };

const Id = z.uuid();
const Category = z.enum(factCategories);
const Statement = z.string().trim().min(3).max(1000);

function refresh() {
  revalidatePath("/profiel");
  revalidatePath("/dashboard");
}

// ---------------------------------------------------------------------------
// Profile basics
// ---------------------------------------------------------------------------

const BasicsSchema = z.object({
  headline: z.string().trim().max(300),
  desired_seniority: z.string().trim().max(200),
  summary: z.string().trim().max(5000),
});

export async function updateBasics(_prev: ActionState, formData: FormData): Promise<ActionState> {
  const ctx = await getAppContext();
  const parsed = BasicsSchema.safeParse({
    headline: formData.get("headline") ?? "",
    desired_seniority: formData.get("desired_seniority") ?? "",
    summary: formData.get("summary") ?? "",
  });
  if (!parsed.success) return { ok: false, message: null, code: "invalid" };

  const supabase = await createSupabaseServerClient();
  const { error } = await supabase
    .from("candidate_profiles")
    .update({
      headline: parsed.data.headline || null,
      desired_seniority: parsed.data.desired_seniority || null,
      summary: parsed.data.summary || null,
    })
    .eq("id", ctx.candidateId);
  if (error) return { ok: false, message: null, code: "db" };

  await audit(ctx, "profile.updated", "candidate_profile", ctx.candidateId);
  refresh();
  return { ok: true, message: null };
}

// ---------------------------------------------------------------------------
// Facts
// ---------------------------------------------------------------------------

export async function addFact(_prev: ActionState, formData: FormData): Promise<ActionState> {
  const ctx = await getAppContext();
  const parsed = z
    .object({ category: Category, statement: Statement })
    .safeParse({ category: formData.get("category"), statement: formData.get("statement") });
  if (!parsed.success) return { ok: false, message: null, code: "invalid" };

  const supabase = await createSupabaseServerClient();
  const { data, error } = await supabase
    .from("candidate_facts")
    .insert({
      tenant_id: ctx.tenantId,
      candidate_id: ctx.candidateId,
      category: parsed.data.category,
      statement: parsed.data.statement,
      origin: "user",
      // Entered by the user themselves = confirmed by the user. The database
      // trigger records who confirmed it and when.
      status: "confirmed",
      is_sensitive: isSensitiveClaim(parsed.data.statement),
    })
    .select("id")
    .single();
  if (error) return { ok: false, message: null, code: "db" };

  await audit(ctx, "fact.created", "candidate_fact", data.id, { origin: "user" });
  refresh();
  return { ok: true, message: null };
}

/** Confirms a suggestion, optionally with an edited statement/category. */
export async function confirmFact(_prev: ActionState, formData: FormData): Promise<ActionState> {
  const ctx = await getAppContext();
  const parsed = z
    .object({
      id: Id,
      statement: Statement.optional(),
      category: Category.optional(),
      sensitive_ack: z.literal("on").optional(),
    })
    .safeParse({
      id: formData.get("id"),
      statement: formData.get("statement") ?? undefined,
      category: formData.get("category") ?? undefined,
      sensitive_ack: formData.get("sensitive_ack") ?? undefined,
    });
  if (!parsed.success) return { ok: false, message: null, code: "invalid" };

  const supabase = await createSupabaseServerClient();
  const { data: fact, error: loadError } = await supabase
    .from("candidate_facts")
    .select("id, statement, is_sensitive, status")
    .eq("id", parsed.data.id)
    .single();
  if (loadError || !fact) return { ok: false, message: null, code: "not_found" };

  const statement = parsed.data.statement ?? fact.statement;
  const sensitive = fact.is_sensitive || isSensitiveClaim(statement);
  if (sensitive && parsed.data.sensitive_ack !== "on") {
    return { ok: false, message: null, code: "sensitive_ack_required" };
  }

  const edited = statement !== fact.statement;
  const { error } = await supabase
    .from("candidate_facts")
    .update({
      status: "confirmed",
      statement,
      is_sensitive: sensitive,
      ...(parsed.data.category ? { category: parsed.data.category } : {}),
    })
    .eq("id", fact.id);
  if (error) return { ok: false, message: null, code: "db" };

  await audit(ctx, "fact.confirmed", "candidate_fact", fact.id, { edited, sensitive });
  refresh();
  return { ok: true, message: null };
}

async function setFactStatus(formData: FormData, status: "rejected" | "suggested") {
  const ctx = await getAppContext();
  const id = Id.safeParse(formData.get("id"));
  if (!id.success) return;
  const supabase = await createSupabaseServerClient();
  const { error } = await supabase.from("candidate_facts").update({ status }).eq("id", id.data);
  if (!error) {
    await audit(ctx, status === "rejected" ? "fact.rejected" : "fact.updated", "candidate_fact", id.data, { status });
  }
  refresh();
}

export async function rejectFact(formData: FormData): Promise<void> {
  await setFactStatus(formData, "rejected");
}

export async function restoreFact(formData: FormData): Promise<void> {
  await setFactStatus(formData, "suggested");
}

export async function deleteFact(formData: FormData): Promise<void> {
  const ctx = await getAppContext();
  const id = Id.safeParse(formData.get("id"));
  if (!id.success) return;
  const supabase = await createSupabaseServerClient();
  const { error } = await supabase.from("candidate_facts").delete().eq("id", id.data);
  if (!error) await audit(ctx, "fact.deleted", "candidate_fact", id.data);
  refresh();
}

// ---------------------------------------------------------------------------
// Documents
// ---------------------------------------------------------------------------

export async function deleteDocument(formData: FormData): Promise<void> {
  const ctx = await getAppContext();
  const id = Id.safeParse(formData.get("id"));
  if (!id.success) return;

  const supabase = await createSupabaseServerClient();
  const { data: doc } = await supabase
    .from("candidate_documents")
    .select("id, storage_path")
    .eq("id", id.data)
    .single();
  if (!doc) return;

  const { error: storageError } = await supabase.storage.from("cv-documents").remove([doc.storage_path]);
  if (storageError) {
    console.error("cv storage removal failed");
    return;
  }
  // Unconfirmed suggestions from this document go with it; confirmed facts
  // stay (the user vouched for them) but lose the document link.
  await supabase
    .from("candidate_facts")
    .delete()
    .eq("source_document_id", doc.id)
    .neq("status", "confirmed");
  await supabase.from("candidate_documents").delete().eq("id", doc.id);

  await audit(ctx, "document.deleted", "candidate_document", doc.id);
  refresh();
}

// ---------------------------------------------------------------------------
// AI suggestions (explicit user action per document)
// ---------------------------------------------------------------------------

export async function suggestFactsFromDocument(_prev: ActionState, formData: FormData): Promise<ActionState> {
  const ctx = await getAppContext();
  const id = Id.safeParse(formData.get("id"));
  if (!id.success) return { ok: false, message: null, code: "invalid" };

  const supabase = await createSupabaseServerClient();
  const { data: doc } = await supabase
    .from("candidate_documents")
    .select("id, extracted_text, document_kind")
    .eq("id", id.data)
    .single();
  if (!doc?.extracted_text) return { ok: false, message: null, code: "no_text" };

  // Facts already in the profile: sent to Claude so it only proposes new
  // ones, and used again below to drop exact duplicates.
  const { data: existingFacts } = await supabase
    .from("candidate_facts")
    .select("statement, status")
    .eq("candidate_id", ctx.candidateId);
  const knownStatements = (existingFacts ?? []).filter((f) => f.status !== "rejected").map((f) => f.statement);

  // Daily request cap per tenant (cost control).
  const startOfDay = new Date();
  startOfDay.setUTCHours(0, 0, 0, 0);
  const { count } = await supabase
    .from("audit_events")
    .select("id", { count: "exact", head: true })
    .eq("tenant_id", ctx.tenantId)
    .eq("action", "ai.facts_suggested")
    .gte("occurred_at", startOfDay.toISOString());
  if ((count ?? 0) >= getServerEnv().AI_DAILY_REQUEST_CAP) {
    return { ok: false, message: null, code: "cap_reached" };
  }

  const result = await suggestCvFacts(doc.extracted_text, {
    kind: doc.document_kind,
    knownFacts: knownStatements,
  });
  if (result.status === "not_configured") {
    await supabase.from("candidate_documents").update({ ai_status: "not_configured" }).eq("id", doc.id);
    refresh();
    return { ok: false, message: null, code: "not_configured" };
  }
  if (result.status === "failed") {
    await supabase.from("candidate_documents").update({ ai_status: "failed" }).eq("id", doc.id);
    await audit(ctx, "ai.facts_suggested", "candidate_document", doc.id, { outcome: result.reason });
    refresh();
    return { ok: false, message: null, code: result.reason };
  }

  const { kept, dropped, duplicates } = verifySuggestions(
    result.facts,
    doc.extracted_text,
    (existingFacts ?? []).map((f) => f.statement),
  );
  if (kept.length > 0) {
    const { error } = await supabase.from("candidate_facts").insert(
      kept.map((fact) => ({
        tenant_id: ctx.tenantId,
        candidate_id: ctx.candidateId,
        category: fact.category,
        statement: fact.statement,
        evidence_excerpt: fact.evidence_excerpt,
        is_sensitive: fact.is_sensitive,
        origin: "ai_suggestion" as const,
        status: "suggested" as const,
        source_document_id: doc.id,
      })),
    );
    if (error) return { ok: false, message: null, code: "db" };
  }

  // The proposed headline/summary is stored next to (not over) the user's own
  // text and only used after explicit acceptance.
  const summaryCheck =
    doc.document_kind === "assessment"
      ? ({ ok: false, reason: "empty" } as const)
      : verifyProfileSummary(result.profileSummary, doc.extracted_text);
  if (summaryCheck.ok) {
    await supabase
      .from("candidate_profiles")
      .update({
        suggested_headline: summaryCheck.summary.headline || null,
        suggested_summary: summaryCheck.summary.summary,
        suggestion_document_id: doc.id,
        suggestion_created_at: new Date().toISOString(),
      })
      .eq("id", ctx.candidateId);
  }

  await supabase.from("candidate_documents").update({ ai_status: "completed" }).eq("id", doc.id);
  await audit(ctx, "ai.facts_suggested", "candidate_document", doc.id, {
    outcome: "completed",
    kept: kept.length,
    dropped,
    duplicates,
    summary: summaryCheck.ok ? "suggested" : summaryCheck.reason,
    model: result.model,
    prompt_version: PROMPT_VERSION,
  });
  refresh();
  return { ok: true, message: `${kept.length}|${dropped}|${summaryCheck.ok ? 1 : 0}` };
}

// ---------------------------------------------------------------------------
// AI-proposed headline/summary: explicit accept or discard
// ---------------------------------------------------------------------------

const clearedSuggestion = {
  suggested_headline: null,
  suggested_summary: null,
  suggestion_document_id: null,
  suggestion_created_at: null,
};

export async function acceptSummarySuggestion(): Promise<void> {
  const ctx = await getAppContext();
  const supabase = await createSupabaseServerClient();
  const { data: profile } = await supabase
    .from("candidate_profiles")
    .select("headline, suggested_headline, suggested_summary")
    .eq("id", ctx.candidateId)
    .single();
  if (!profile?.suggested_summary) return;

  const { error } = await supabase
    .from("candidate_profiles")
    .update({
      headline: profile.suggested_headline ?? profile.headline,
      summary: profile.suggested_summary,
      ...clearedSuggestion,
    })
    .eq("id", ctx.candidateId);
  if (!error) await audit(ctx, "profile.updated", "candidate_profile", ctx.candidateId, { source: "ai_summary_accepted" });
  refresh();
}

export async function discardSummarySuggestion(): Promise<void> {
  const ctx = await getAppContext();
  const supabase = await createSupabaseServerClient();
  const { error } = await supabase.from("candidate_profiles").update(clearedSuggestion).eq("id", ctx.candidateId);
  if (!error) await audit(ctx, "profile.updated", "candidate_profile", ctx.candidateId, { source: "ai_summary_discarded" });
  refresh();
}

// ---------------------------------------------------------------------------
// Bulk confirmation (non-sensitive suggestions only) and auto-analysis consent
// ---------------------------------------------------------------------------

export async function confirmAllNonSensitive(): Promise<void> {
  const ctx = await getAppContext();
  const supabase = await createSupabaseServerClient();
  const { data: facts } = await supabase
    .from("candidate_facts")
    .select("id, status, is_sensitive")
    .eq("candidate_id", ctx.candidateId)
    .eq("status", "suggested");
  const ids = bulkConfirmable(facts ?? []).map((f) => f.id);
  if (ids.length === 0) return;

  // is_sensitive = false is re-checked in the update itself.
  const { error } = await supabase
    .from("candidate_facts")
    .update({ status: "confirmed" })
    .in("id", ids)
    .eq("is_sensitive", false)
    .eq("status", "suggested");
  if (!error) await audit(ctx, "fact.confirmed", "candidate_fact", null, { bulk: true, count: ids.length });
  refresh();
}

export async function setAutoAnalysis(formData: FormData): Promise<void> {
  const ctx = await getAppContext();
  const enabled = formData.get("enabled") === "on";
  const supabase = await createSupabaseServerClient();
  const now = new Date().toISOString();
  const { data: existing } = await supabase
    .from("consent_records")
    .select("id")
    .eq("candidate_id", ctx.candidateId)
    .eq("scope", "ai_analysis")
    .maybeSingle();

  const values = enabled
    ? { status: "granted" as const, granted_at: now, revoked_at: null }
    : { status: "revoked" as const, revoked_at: now };
  const result = existing
    ? await supabase.from("consent_records").update(values).eq("id", existing.id)
    : await supabase.from("consent_records").insert({
        tenant_id: ctx.tenantId,
        candidate_id: ctx.candidateId,
        scope: "ai_analysis",
        ...values,
      });
  if (!result.error) {
    await audit(ctx, "profile.updated", "consent_record", existing?.id ?? null, {
      scope: "ai_analysis",
      status: values.status,
    });
  }
  refresh();
}
