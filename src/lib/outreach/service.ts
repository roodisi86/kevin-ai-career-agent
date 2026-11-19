import "server-only";
import type { AppContext } from "@/lib/dal";
import { audit } from "@/lib/audit";
import { dbFor } from "@/lib/supabase/db";
import { asJson, type ContactRow, type OutreachDraftRow, type OutreachRequestRow } from "@/lib/supabase/database.types";
import { jobEvidenceText, type MatchResult, type PromptFact } from "@/lib/ai/match";
import { loadCandidateMatchInput } from "@/lib/matching/service";
import { htmlToText } from "@/lib/scanner/text";
import {
  allowedSourceUrl,
  buildOutreachPrompt,
  draftWarnings,
  pageConfirms,
  parseOutreachOutput,
  verifyOutreach,
  type VerifiedBrief,
} from "./research";

export type StartResult = { ok: true; status: "queued" | "already_queued" } | { ok: false; error: "not_found" | "no_facts" | "db" };

/** Queue research + drafts for one job (answered by the scheduled Claude task). */
export async function requestOutreach(ctx: AppContext, jobId: string): Promise<StartResult> {
  const supabase = await dbFor(ctx);
  const [{ data: job }, { data: match }, { data: existing }, input] = await Promise.all([
    supabase
      .from("jobs")
      .select("id, title, company_name, location_text, canonical_url, description_text")
      .eq("tenant_id", ctx.tenantId)
      .eq("id", jobId)
      .maybeSingle(),
    supabase.from("job_matches").select("score, result_json").eq("tenant_id", ctx.tenantId).eq("job_id", jobId).maybeSingle(),
    supabase.from("outreach_requests").select("id, status").eq("tenant_id", ctx.tenantId).eq("job_id", jobId).maybeSingle(),
    loadCandidateMatchInput(ctx),
  ]);
  if (!job) return { ok: false, error: "not_found" };
  if (input.facts.length === 0) return { ok: false, error: "no_facts" };
  if (existing?.status === "pending") return { ok: true, status: "already_queued" };

  const result = match?.result_json as unknown as MatchResult | undefined;
  const prompt = buildOutreachPrompt({
    facts: input.facts,
    profile: input.profile,
    preferenceLines: input.preferenceLines,
    job: {
      title: job.title,
      company: job.company_name,
      location: job.location_text,
      url: job.canonical_url,
      description: job.description_text,
    },
    match: match && result ? { score: match.score, fitSummary: result.fitSummary ?? "", pitchAngle: result.pitchAngle ?? null, gaps: result.gaps ?? [] } : null,
  });
  const { error } = await supabase.from("outreach_requests").upsert(
    {
      tenant_id: ctx.tenantId,
      job_id: job.id,
      prompt_text: prompt.slice(0, 40_000),
      fact_refs_json: asJson(Object.fromEntries(input.facts.map((f) => [f.ref, f.id]))),
      status: "pending",
      output_json: null,
      error: null,
      requested_by: ctx.userId,
      answered_at: null,
      processed_at: null,
    },
    { onConflict: "tenant_id,job_id" },
  );
  if (error) return { ok: false, error: "db" };
  await audit(ctx, "outreach.requested", "job", job.id, {});
  return { ok: true, status: "queued" };
}

// ---------------------------------------------------------------------------
// Contact verification: fetch the cited public page and look for the name.
// ---------------------------------------------------------------------------

function safeToFetch(url: string): boolean {
  if (!allowedSourceUrl(url)) return false;
  const host = new URL(url).hostname.toLowerCase();
  // No IP literals or internal names (SSRF guard).
  if (/^[\d.]+$/.test(host) || host.includes(":") || host === "localhost") return false;
  if (/\.(local|internal|lan|home|corp)$/.test(host) || !host.includes(".")) return false;
  return true;
}

async function fetchPageText(url: string): Promise<string | null> {
  if (!safeToFetch(url)) return null;
  try {
    const res = await fetch(url, {
      redirect: "follow",
      signal: AbortSignal.timeout(8000),
      headers: { "User-Agent": "KevinAICareerAgent/1.0 (contact source check)", Accept: "text/html,text/plain" },
    });
    if (!res.ok) return null;
    if (!safeToFetch(res.url)) return null;
    const type = res.headers.get("content-type") ?? "";
    if (!/text\/html|text\/plain/.test(type)) return null;
    const raw = (await res.text()).slice(0, 1_500_000);
    return htmlToText(raw) ?? raw;
  } catch {
    return null;
  }
}

// ---------------------------------------------------------------------------
// Processing answers
// ---------------------------------------------------------------------------

export async function processOutreachAnswers(ctx: AppContext): Promise<{ processed: number; rejected: number }> {
  const supabase = await dbFor(ctx);
  const { data: answered } = await supabase
    .from("outreach_requests")
    .select("id, job_id, output_json, fact_refs_json")
    .eq("tenant_id", ctx.tenantId)
    .eq("status", "answered");
  const summary = { processed: 0, rejected: 0 };
  for (const req of answered ?? []) {
    const parsed = parseOutreachOutput(req.output_json);
    if (!parsed.ok) {
      summary.rejected++;
      await supabase
        .from("outreach_requests")
        .update({ status: "rejected", error: "invalid_output", processed_at: new Date().toISOString() })
        .eq("id", req.id);
      continue;
    }

    // Facts by the refs used in the prompt — only those still confirmed.
    const refs = (req.fact_refs_json ?? {}) as Record<string, string>;
    const { data: factRows } = await supabase
      .from("candidate_facts")
      .select("id, category, statement")
      .eq("candidate_id", ctx.candidateId)
      .eq("status", "confirmed")
      .in("id", Object.values(refs).length ? Object.values(refs) : ["00000000-0000-0000-0000-000000000000"]);
    const byId = new Map((factRows ?? []).map((f) => [f.id, f]));
    const facts: PromptFact[] = Object.entries(refs).flatMap(([ref, id]) => {
      const f = byId.get(id);
      return f ? [{ ref, id, category: f.category, statement: f.statement }] : [];
    });

    const { data: job } = await supabase
      .from("jobs")
      .select("id, title, company_name, location_text, description_text")
      .eq("tenant_id", ctx.tenantId)
      .eq("id", req.job_id)
      .maybeSingle();
    if (!job) continue;
    const verified = verifyOutreach(parsed.output, {
      facts,
      jobText: jobEvidenceText({ title: job.title, company: job.company_name, location: job.location_text, description: job.description_text }),
    });

    // Replace earlier AI suggestions that were never reviewed; keep everything the user touched.
    await supabase
      .from("outreach_drafts")
      .delete()
      .eq("tenant_id", ctx.tenantId)
      .eq("job_id", job.id)
      .eq("origin", "ai_research")
      .eq("state", "draft")
      .eq("version", 1);
    const { data: oldContacts } = await supabase
      .from("contacts")
      .select("id, name")
      .eq("tenant_id", ctx.tenantId)
      .eq("job_id", job.id);
    const contactIdByName = new Map((oldContacts ?? []).map((c) => [c.name.toLowerCase(), c.id]));

    for (const c of verified.contacts) {
      if (contactIdByName.has(c.name.toLowerCase())) continue;
      const page = await fetchPageText(c.sourceUrl);
      const check = page ? pageConfirms(page, c.name, c.email) : null;
      const { data: inserted } = await supabase
        .from("contacts")
        .insert({
          tenant_id: ctx.tenantId,
          job_id: job.id,
          name: c.name,
          role: c.role,
          organisation: c.organisation,
          source_url: c.sourceUrl,
          source_type: c.sourceType,
          // An email is kept only when it is literally on the cited page.
          email: check?.emailFound ? c.email : null,
          verification_status: !check ? "unverified" : check.nameFound ? "source_checked" : "source_mismatch",
          lawful_basis_note: "Zakelijke contactgegevens uit een openbare bron; alleen voor één persoonlijk, relevant bericht.",
          origin: "ai_research",
          last_checked_at: new Date().toISOString(),
        })
        .select("id")
        .single();
      if (inserted) contactIdByName.set(c.name.toLowerCase(), inserted.id);
    }

    for (const d of verified.drafts) {
      await supabase.from("outreach_drafts").insert({
        tenant_id: ctx.tenantId,
        candidate_id: ctx.candidateId,
        job_id: job.id,
        contact_id: d.recipientName ? (contactIdByName.get(d.recipientName.toLowerCase()) ?? null) : null,
        kind: d.kind,
        language: d.language,
        subject: d.subject,
        body: d.body,
        evidence_json: asJson({ facts: d.facts, followUpAfterDays: d.kind === "follow_up" ? verified.followUpAfterDays : null }),
        warnings: d.warnings,
        origin: "ai_research",
      });
    }

    await supabase
      .from("outreach_requests")
      .update({ status: "processed", brief_json: asJson(verified.brief), processed_at: new Date().toISOString() })
      .eq("id", req.id);
    await audit(ctx, "outreach.researched", "job", job.id, {
      contacts: verified.contacts.length,
      drafts: verified.drafts.length,
      dropped_sources: verified.brief.droppedSources,
    });
    summary.processed++;
  }
  return summary;
}

/** Recompute warnings after the user edits a draft (shown, not blocking). */
export async function warningsForEdit(ctx: AppContext, draft: Pick<OutreachDraftRow, "job_id" | "evidence_json">, text: string): Promise<string[]> {
  const supabase = await dbFor(ctx);
  const [{ data: facts }, { data: job }, { data: req }] = await Promise.all([
    supabase.from("candidate_facts").select("statement").eq("candidate_id", ctx.candidateId).eq("status", "confirmed"),
    draft.job_id
      ? supabase.from("jobs").select("title, company_name, location_text, description_text").eq("tenant_id", ctx.tenantId).eq("id", draft.job_id).maybeSingle()
      : Promise.resolve({ data: null }),
    draft.job_id
      ? supabase.from("outreach_requests").select("brief_json").eq("tenant_id", ctx.tenantId).eq("job_id", draft.job_id).maybeSingle()
      : Promise.resolve({ data: null }),
  ]);
  const cited = ((draft.evidence_json as { facts?: { statement: string }[] })?.facts ?? []).map((f) => f.statement).join("\n");
  const brief = (req?.brief_json ?? null) as VerifiedBrief | null;
  return draftWarnings(text, {
    citedFacts: cited,
    allFactsText: (facts ?? []).map((f) => f.statement).join("\n"),
    jobText: job ? jobEvidenceText({ title: job.title, company: job.company_name, location: job.location_text, description: job.description_text }) : "",
    briefText: brief ? [brief.businessModel, brief.strategicChallenge, ...brief.recentNews.map((n) => n.title)].join("\n") : "",
  });
}

export interface OutreachWorkspaceItem {
  request: Pick<OutreachRequestRow, "id" | "job_id" | "status" | "brief_json" | "created_at" | "processed_at" | "error">;
  job: { id: string; title: string; company_name: string; canonical_url: string; location_text: string | null } | null;
  contacts: ContactRow[];
  drafts: OutreachDraftRow[];
}

export async function loadWorkspace(ctx: AppContext): Promise<OutreachWorkspaceItem[]> {
  const supabase = await dbFor(ctx);
  const { data: requests } = await supabase
    .from("outreach_requests")
    .select("id, job_id, status, brief_json, created_at, processed_at, error")
    .eq("tenant_id", ctx.tenantId)
    .order("created_at", { ascending: false });
  const jobIds = (requests ?? []).map((r) => r.job_id);
  if (jobIds.length === 0) return [];
  const [{ data: jobs }, { data: contacts }, { data: drafts }] = await Promise.all([
    supabase.from("jobs").select("id, title, company_name, canonical_url, location_text").eq("tenant_id", ctx.tenantId).in("id", jobIds),
    supabase.from("contacts").select("*").eq("tenant_id", ctx.tenantId).in("job_id", jobIds).order("created_at"),
    supabase.from("outreach_drafts").select("*").eq("tenant_id", ctx.tenantId).in("job_id", jobIds).order("created_at"),
  ]);
  return (requests ?? []).map((request) => ({
    request,
    job: (jobs ?? []).find((j) => j.id === request.job_id) ?? null,
    contacts: (contacts ?? []).filter((c) => c.job_id === request.job_id) as ContactRow[],
    drafts: (drafts ?? []).filter((d) => d.job_id === request.job_id) as OutreachDraftRow[],
  }));
}
