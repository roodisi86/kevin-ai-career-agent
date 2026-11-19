import "server-only";
import { dbFor } from "@/lib/supabase/db";
import type { AppContext } from "@/lib/dal";

export type AuditAction =
  | "document.uploaded"
  | "document.extracted"
  | "document.deleted"
  | "fact.created"
  | "fact.confirmed"
  | "fact.rejected"
  | "fact.updated"
  | "fact.deleted"
  | "ai.facts_suggested"
  | "preferences.updated"
  | "profile.updated"
  | "data.exported"
  | "data.deleted"
  | "scan.started"
  | "scan.finished"
  | "company.added"
  | "company.removed"
  | "source.verified"
  | "source.approved"
  | "source.revoked"
  | "job.imported"
  | "job.state_changed"
  | "assessment.saved"
  | "match.scored"
  | "match.feedback"
  | "outreach.requested"
  | "outreach.researched"
  | "outreach.draft_saved"
  | "outreach.state_changed"
  | "outreach.contact_added"
  | "outreach.contact_removed";

type SafeMetadata = Record<string, string | number | boolean | null>;

/**
 * Appends an audit event. Metadata must be "safe": counts, ids, statuses —
 * never CV text, statements, e-mail addresses or other personal payloads.
 */
export async function audit(
  ctx: AppContext,
  action: AuditAction,
  resourceType: string,
  resourceId: string | null,
  metadata: SafeMetadata = {},
): Promise<void> {
  const supabase = await dbFor(ctx);
  const { error } = await supabase.from("audit_events").insert({
    tenant_id: ctx.tenantId,
    actor_id: ctx.userId,
    action,
    resource_type: resourceType,
    resource_id: resourceId,
    safe_metadata_json: metadata,
  });
  if (error) {
    // Log the code only; never the payload.
    console.error(`audit insert failed: ${error.code}`);
  }
}
