"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { z } from "zod";
import { getAppContext } from "@/lib/dal";
import { audit } from "@/lib/audit";
import { createSupabaseServerClient } from "@/lib/supabase/server";
import { requestSignals } from "@/lib/signals/service";

export async function requestSignalsNow(): Promise<void> {
  const ctx = await getAppContext();
  const result = await requestSignals(ctx, { manual: true });
  revalidatePath("/signalen");
  redirect(`/signalen?requested=${result.ok ? result.status : result.error}`);
}

const Feedback = z.object({ id: z.uuid(), state: z.enum(["new", "useful", "dismissed"]) });

export async function setSignalState(formData: FormData): Promise<void> {
  const ctx = await getAppContext();
  const parsed = Feedback.safeParse(Object.fromEntries(formData));
  if (!parsed.success) return;
  const supabase = await createSupabaseServerClient();
  const { error } = await supabase.from("company_signals").update({ user_state: parsed.data.state }).eq("tenant_id", ctx.tenantId).eq("id", parsed.data.id);
  if (!error) await audit(ctx, "signals.feedback", "company_signal", parsed.data.id, { state: parsed.data.state });
  revalidatePath("/signalen");
  revalidatePath("/dashboard");
}
