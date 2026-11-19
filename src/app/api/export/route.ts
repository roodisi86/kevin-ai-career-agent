import { NextResponse } from "next/server";
import { getAppContext, NotAllowedError } from "@/lib/dal";
import { audit } from "@/lib/audit";
import { createSupabaseServerClient } from "@/lib/supabase/server";

export const runtime = "nodejs";

/** GET /api/export — downloads all of the user's candidate data as JSON (AVG right of access). */
export async function GET() {
  let ctx;
  try {
    ctx = await getAppContext();
  } catch (error) {
    if (error instanceof NotAllowedError) return NextResponse.json({ error: "not_allowed" }, { status: 403 });
    throw error;
  }

  const supabase = await createSupabaseServerClient();
  const [tenant, profile, documents, facts, preferences, consents, auditEvents, assessment, matches, feedback, aiRequests] = await Promise.all([
    supabase.from("tenants").select("id, name, is_demo, created_at").eq("id", ctx.tenantId).single(),
    supabase.from("candidate_profiles").select("*").eq("id", ctx.candidateId).single(),
    supabase
      .from("candidate_documents")
      .select(
        "id, original_filename, file_type, size_bytes, checksum, processing_status, extracted_text, ai_status, created_at",
      )
      .eq("candidate_id", ctx.candidateId),
    supabase.from("candidate_facts").select("*").eq("candidate_id", ctx.candidateId),
    supabase.from("candidate_preferences").select("*").eq("candidate_id", ctx.candidateId).maybeSingle(),
    supabase.from("consent_records").select("*").eq("candidate_id", ctx.candidateId),
    supabase.from("audit_events").select("*").eq("tenant_id", ctx.tenantId).order("occurred_at", { ascending: false }),
    supabase.from("candidate_assessments").select("*").eq("candidate_id", ctx.candidateId).maybeSingle(),
    supabase.from("job_matches").select("*").eq("tenant_id", ctx.tenantId),
    supabase.from("match_feedback").select("*").eq("tenant_id", ctx.tenantId),
    supabase.from("ai_match_requests").select("*").eq("tenant_id", ctx.tenantId),
  ]);

  const failed = [tenant, profile, documents, facts, preferences, consents, auditEvents, assessment, matches, feedback, aiRequests].some(
    (r) => r.error,
  );
  if (failed) return NextResponse.json({ error: "export_failed" }, { status: 500 });

  await audit(ctx, "data.exported", "tenant", ctx.tenantId, { documents: documents.data?.length ?? 0 });

  const body = {
    exported_at: new Date().toISOString(),
    format_version: 2,
    note: "Original CV files are not embedded; download them individually from Mijn profiel.",
    tenant: tenant.data,
    profile: profile.data,
    documents: documents.data,
    facts: facts.data,
    preferences: preferences.data,
    consents: consents.data,
    career_assessment: assessment.data,
    job_matches: matches.data,
    match_feedback: feedback.data,
    ai_match_requests: aiRequests.data,
    audit_events: auditEvents.data,
  };

  const date = new Date().toISOString().slice(0, 10);
  return new NextResponse(JSON.stringify(body, null, 2), {
    status: 200,
    headers: {
      "Content-Type": "application/json; charset=utf-8",
      "Content-Disposition": `attachment; filename="career-agent-export-${date}.json"`,
      "Cache-Control": "no-store",
    },
  });
}
