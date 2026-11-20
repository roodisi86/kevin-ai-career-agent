"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { z } from "zod";
import { getAppContext } from "@/lib/dal";
import { markApplied, requestPackage, saveLetter } from "@/lib/packages/service";

const JobId = z.uuid();

function back(jobId: string, status: string): never {
  revalidatePath(`/pakket/${jobId}`);
  redirect(`/pakket/${jobId}?status=${status}`);
}

export async function createPackage(formData: FormData): Promise<void> {
  const ctx = await getAppContext();
  const jobId = JobId.safeParse(formData.get("jobId"));
  if (!jobId.success) redirect("/vacatures");
  if (formData.get("regenerate") === "1" && formData.get("confirm") !== "OPNIEUW") back(jobId.data, "confirm");
  const result = await requestPackage(ctx, jobId.data);
  back(jobId.data, result.ok ? result.status : result.error);
}

export async function saveLetterAction(formData: FormData): Promise<void> {
  const ctx = await getAppContext();
  const jobId = JobId.safeParse(formData.get("jobId"));
  const letter = z.string().trim().min(1).max(8000).safeParse(formData.get("letter"));
  if (!jobId.success) redirect("/vacatures");
  if (!letter.success) back(jobId.data, "invalid");
  const ok = await saveLetter(ctx, jobId.data, letter.data);
  back(jobId.data, ok ? "saved" : "db");
}

export async function markAppliedAction(formData: FormData): Promise<void> {
  const ctx = await getAppContext();
  const jobId = JobId.safeParse(formData.get("jobId"));
  if (!jobId.success) redirect("/vacatures");
  const id = await markApplied(ctx, jobId.data);
  revalidatePath("/sollicitaties");
  revalidatePath("/dashboard");
  back(jobId.data, id ? "applied" : "db");
}
