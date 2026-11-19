"use server";

import { revalidatePath } from "next/cache";
import { getAppContext } from "@/lib/dal";
import { refreshMatches } from "@/lib/matching/service";
import { generateDigest } from "@/lib/pilot/service";

/** Rebuilds today's digest on demand (same row as the scheduled one). */
export async function generateDigestNow(): Promise<void> {
  const ctx = await getAppContext();
  await refreshMatches(ctx);
  await generateDigest(ctx, { generatedBy: "manual" });
  revalidatePath("/dashboard");
}
