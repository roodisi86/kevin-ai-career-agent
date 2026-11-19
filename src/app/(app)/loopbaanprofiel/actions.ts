"use server";

import { revalidatePath } from "next/cache";
import { getAppContext } from "@/lib/dal";
import { audit } from "@/lib/audit";
import { createSupabaseServerClient } from "@/lib/supabase/server";
import { asJson } from "@/lib/supabase/database.types";
import { refreshMatches } from "@/lib/matching/service";
import { ASSESSMENT_SCHEMA_VERSION, AssessmentAnswersSchema, assessmentProgress } from "@/lib/assessment/schema";

export type SaveAssessmentState = { ok: boolean; error: "invalid" | "db" | null; savedAt: string | null };

export async function saveAssessment(_prev: SaveAssessmentState, formData: FormData): Promise<SaveAssessmentState> {
  const ctx = await getAppContext();
  let raw: unknown;
  try {
    raw = JSON.parse(String(formData.get("payload") ?? ""));
  } catch {
    return { ok: false, error: "invalid", savedAt: null };
  }
  const parsed = AssessmentAnswersSchema.safeParse(raw);
  if (!parsed.success) return { ok: false, error: "invalid", savedAt: null };

  const { answered } = assessmentProgress(parsed.data);
  const supabase = await createSupabaseServerClient();
  const { data, error } = await supabase
    .from("candidate_assessments")
    .upsert(
      {
        tenant_id: ctx.tenantId,
        candidate_id: ctx.candidateId,
        schema_version: ASSESSMENT_SCHEMA_VERSION,
        answers_json: asJson(parsed.data),
        completed_at: answered > 0 ? new Date().toISOString() : null,
      },
      { onConflict: "candidate_id" },
    )
    .select("id")
    .single();
  if (error) return { ok: false, error: "db", savedAt: null };

  // Only counts, never the answers themselves.
  await audit(ctx, "assessment.saved", "candidate_assessment", data.id, { answered });
  await refreshMatches(ctx);
  revalidatePath("/loopbaanprofiel");
  revalidatePath("/vacatures");
  revalidatePath("/dashboard");
  return { ok: true, error: null, savedAt: new Date().toISOString() };
}
