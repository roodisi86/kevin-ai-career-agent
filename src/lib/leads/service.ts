import "server-only";
import type { AppContext } from "@/lib/dal";
import { audit } from "@/lib/audit";
import { dbFor } from "@/lib/supabase/db";
import { importManualJob } from "@/lib/scanner/service";
import type { JobLeadRow } from "@/lib/supabase/database.types";

/**
 * Turns pending Grok Bot leads into vacancies. The app does not fetch the job
 * page: it uses the text Grok Bot handed over, labels the job "Grok Bot · not
 * automatically verified" and lets it pass the same relevance filter, blockers,
 * scoring and Claude assessment as every other vacancy.
 */
export async function processJobLeads(ctx: AppContext, limit = 50): Promise<{ imported: number; filtered: number; failed: number }> {
  const supabase = await dbFor(ctx);
  const { data: leads } = await supabase
    .from("job_leads")
    .select("id, title, company, url, location, description, reason, salary_text, contract_text, posted")
    .eq("tenant_id", ctx.tenantId)
    .eq("status", "pending")
    .order("created_at", { ascending: true })
    .limit(limit);
  const summary = { imported: 0, filtered: 0, failed: 0 };
  for (const lead of leads ?? []) {
    const now = new Date().toISOString();
    try {
      const result = await importManualJob(
        ctx,
        { url: lead.url, title: lead.title, company: lead.company, location: lead.location ?? "", text: lead.description ?? "" },
        { importSource: "grok_bot" },
      );
      if (result.id === null) {
        summary.filtered++;
        await supabase.from("job_leads").update({ status: "rejected", reject_reason: result.filteredReason, processed_at: now }).eq("id", lead.id);
      } else {
        summary.imported++;
        await supabase
          .from("job_leads")
          .update({ status: result.duplicate ? "duplicate" : "imported", job_id: result.id, processed_at: now })
          .eq("id", lead.id);
      }
    } catch {
      summary.failed++;
      await supabase.from("job_leads").update({ status: "rejected", reject_reason: "import_failed", processed_at: now }).eq("id", lead.id);
    }
  }
  if ((leads ?? []).length) await audit(ctx, "leads.processed", "job_lead", null, summary);
  return summary;
}

export type LeadNote = Pick<JobLeadRow, "job_id" | "reason" | "salary_text" | "contract_text" | "posted" | "created_at">;

/** What Grok Bot said about each imported job (shown as an unverified note). */
export async function leadNotesForJobs(ctx: AppContext, jobIds: string[]): Promise<Map<string, LeadNote>> {
  if (jobIds.length === 0) return new Map();
  const supabase = await dbFor(ctx);
  const { data } = await supabase
    .from("job_leads")
    .select("job_id, reason, salary_text, contract_text, posted, created_at")
    .eq("tenant_id", ctx.tenantId)
    .in("job_id", jobIds.slice(0, 300));
  return new Map((data ?? []).filter((l) => l.job_id).map((l) => [l.job_id!, l]));
}
