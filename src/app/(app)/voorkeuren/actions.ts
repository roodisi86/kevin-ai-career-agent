"use server";

import { revalidatePath } from "next/cache";
import { getAppContext } from "@/lib/dal";
import { audit } from "@/lib/audit";
import { createSupabaseServerClient } from "@/lib/supabase/server";
import { PreferencesSchema } from "@/lib/preferences/schema";
import { regateAll } from "@/lib/scanner/service";

export type SavePreferencesState = { ok: boolean; error: "invalid" | "db" | null; savedAt: string | null };

export async function savePreferences(
  _prev: SavePreferencesState,
  formData: FormData,
): Promise<SavePreferencesState> {
  const ctx = await getAppContext();

  let raw: unknown;
  try {
    raw = JSON.parse(String(formData.get("payload") ?? ""));
  } catch {
    return { ok: false, error: "invalid", savedAt: null };
  }
  const parsed = PreferencesSchema.safeParse(raw);
  if (!parsed.success) return { ok: false, error: "invalid", savedAt: null };

  const supabase = await createSupabaseServerClient();
  const { data: existing } = await supabase
    .from("candidate_preferences")
    .select("id")
    .eq("candidate_id", ctx.candidateId)
    .maybeSingle();

  const result = existing
    ? await supabase
        .from("candidate_preferences")
        .update({ preferences_json: parsed.data, schema_version: 1 })
        .eq("id", existing.id)
    : await supabase.from("candidate_preferences").insert({
        tenant_id: ctx.tenantId,
        candidate_id: ctx.candidateId,
        preferences_json: parsed.data,
        schema_version: 1,
      });
  if (result.error) return { ok: false, error: "db", savedAt: null };

  await audit(ctx, "preferences.updated", "candidate_preferences", existing?.id ?? null, {
    hard_filters: Object.values(parsed.data.constraints).filter((m) => m === "hard").length,
    excluded_employers: parsed.data.excludedEmployers.length,
    sectors: parsed.data.sectors.length,
  });
  // Hard requirements may have changed: re-evaluate stored jobs right away.
  await regateAll(ctx);
  revalidatePath("/voorkeuren");
  revalidatePath("/vacatures");
  revalidatePath("/dashboard");
  return { ok: true, error: null, savedAt: new Date().toISOString() };
}
