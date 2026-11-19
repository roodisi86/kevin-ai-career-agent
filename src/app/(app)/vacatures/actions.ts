"use server";

import { revalidatePath } from "next/cache";
import { z } from "zod";
import { getAppContext } from "@/lib/dal";
import { audit } from "@/lib/audit";
import { createSupabaseServerClient } from "@/lib/supabase/server";
import { importManualJob } from "@/lib/scanner/service";
import { allFeedbackReasons, feedbackReasons } from "@/lib/matching/context";

const StateSchema = z.object({
  id: z.uuid(),
  state: z.enum(["new", "interesting", "later", "not_relevant"]),
});

export async function setJobState(formData: FormData): Promise<void> {
  const ctx = await getAppContext();
  const parsed = StateSchema.safeParse({ id: formData.get("id"), state: formData.get("state") });
  if (!parsed.success) return;
  const supabase = await createSupabaseServerClient();
  const { error } = await supabase.from("jobs").update({ user_state: parsed.data.state }).eq("id", parsed.data.id);
  if (!error) await audit(ctx, "job.state_changed", "job", parsed.data.id, { state: parsed.data.state });
  revalidatePath("/vacatures");
  revalidatePath("/dashboard");
}

export type ImportState = { ok: boolean; code: "invalid" | "error" | "updated" | null };

const ImportSchema = z.object({
  url: z.url().max(2000).refine((u) => u.startsWith("https://"), "https only"),
  title: z.string().trim().min(2).max(300),
  company: z.string().trim().min(1).max(200),
  location: z.string().trim().max(300),
  text: z.string().max(60_000),
});

export async function importJob(_prev: ImportState, formData: FormData): Promise<ImportState> {
  const ctx = await getAppContext();
  const parsed = ImportSchema.safeParse({
    url: formData.get("url"),
    title: formData.get("title"),
    company: formData.get("company"),
    location: formData.get("location") ?? "",
    text: formData.get("text") ?? "",
  });
  if (!parsed.success) return { ok: false, code: "invalid" };
  try {
    const result = await importManualJob(ctx, parsed.data);
    revalidatePath("/vacatures");
    return { ok: true, code: result.duplicate ? "updated" : null };
  } catch {
    return { ok: false, code: "error" };
  }
}

const FeedbackSchema = z.object({
  jobId: z.uuid(),
  label: z.enum(["good", "bad", "clear"]),
  reasons: z.array(z.enum(allFeedbackReasons as [string, ...string[]])).max(8).default([]),
  note: z.string().trim().max(500).optional(),
});

export type FeedbackState = { ok: boolean; error: boolean };

/** Thumbs up/down on a job assessment. Used as calibration for later assessments. */
export async function saveFeedback(input: unknown): Promise<FeedbackState> {
  const ctx = await getAppContext();
  const parsed = FeedbackSchema.safeParse(input);
  if (!parsed.success) return { ok: false, error: true };
  const { jobId, label, reasons, note } = parsed.data;
  const supabase = await createSupabaseServerClient();

  if (label === "clear") {
    const { error } = await supabase.from("match_feedback").delete().eq("tenant_id", ctx.tenantId).eq("job_id", jobId);
    if (error) return { ok: false, error: true };
  } else {
    const allowed = new Set<string>(feedbackReasons[label]);
    const { data: match } = await supabase
      .from("job_matches")
      .select("score")
      .eq("tenant_id", ctx.tenantId)
      .eq("job_id", jobId)
      .maybeSingle();
    const { error } = await supabase.from("match_feedback").upsert(
      {
        tenant_id: ctx.tenantId,
        job_id: jobId,
        label,
        reasons: reasons.filter((r) => allowed.has(r)),
        note: note || null,
        match_score: match?.score ?? null,
      },
      { onConflict: "tenant_id,job_id" },
    );
    if (error) return { ok: false, error: true };
  }
  await audit(ctx, "match.feedback", "job", jobId, { label, reasons: reasons.length });
  revalidatePath("/vacatures");
  return { ok: true, error: false };
}
