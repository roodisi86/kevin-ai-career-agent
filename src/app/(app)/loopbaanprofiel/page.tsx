import Link from "next/link";
import { getAppContext } from "@/lib/dal";
import { getDictionary } from "@/lib/i18n";
import { createSupabaseServerClient } from "@/lib/supabase/server";
import { assessmentProgress, parseStoredAssessment } from "@/lib/assessment/schema";
import { suggestAssessment } from "@/lib/assessment/suggest";
import { loadPreferences } from "@/lib/scanner/service";
import { formatDateTime } from "@/lib/time";
import { AssessmentForm } from "./assessment-form";

const t = getDictionary();

export default async function AssessmentPage() {
  const ctx = await getAppContext();
  const supabase = await createSupabaseServerClient();
  const [{ data }, { data: facts }, prefs] = await Promise.all([
    supabase
      .from("candidate_assessments")
      .select("answers_json, updated_at, suggested_answers_json, suggestion_source, suggestion_created_at")
      .eq("candidate_id", ctx.candidateId)
      .maybeSingle(),
    supabase.from("candidate_facts").select("category, statement").eq("candidate_id", ctx.candidateId).eq("status", "confirmed"),
    loadPreferences(ctx),
  ]);
  const answers = parseStoredAssessment(data?.answers_json);
  // Proposal: Claude's (from facts + preferences) when present, otherwise rules.
  const claudeProposal = data?.suggested_answers_json ? parseStoredAssessment(data.suggested_answers_json) : null;
  const useClaude = Boolean(claudeProposal && assessmentProgress(claudeProposal).answered > 0);
  const proposal = useClaude ? claudeProposal! : suggestAssessment(prefs, facts ?? []);

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-2xl font-semibold">{t.assessment.title}</h1>
        <p className="max-w-3xl text-sm text-navy-600">{t.assessment.intro}</p>
        {data?.updated_at && (
          <p className="mt-2 text-xs text-navy-600">
            {t.common.lastUpdated}: {formatDateTime(data.updated_at)}
          </p>
        )}
      </div>

      <section className="card space-y-2" aria-labelledby="external">
        <h2 id="external" className="font-semibold">{t.assessment.externalTitle}</h2>
        <p className="text-sm text-navy-800">{t.assessment.externalBody}</p>
        <Link href="/profiel" className="btn-secondary inline-block">{t.assessment.externalLink}</Link>
      </section>

      <AssessmentForm
        initial={answers}
        proposal={proposal}
        proposalSource={useClaude ? "claude" : "rules"}
        proposalDate={useClaude ? (data?.suggestion_created_at ?? null) : null}
      />
    </div>
  );
}
