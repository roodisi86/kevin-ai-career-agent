import Link from "next/link";
import { getAppContext } from "@/lib/dal";
import { getDictionary } from "@/lib/i18n";
import { createSupabaseServerClient } from "@/lib/supabase/server";
import { parseStoredAssessment } from "@/lib/assessment/schema";
import { formatDateTime } from "@/lib/time";
import { AssessmentForm } from "./assessment-form";

const t = getDictionary();

export default async function AssessmentPage() {
  const ctx = await getAppContext();
  const supabase = await createSupabaseServerClient();
  const { data } = await supabase
    .from("candidate_assessments")
    .select("answers_json, updated_at")
    .eq("candidate_id", ctx.candidateId)
    .maybeSingle();
  const answers = parseStoredAssessment(data?.answers_json);

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

      <AssessmentForm initial={answers} />
    </div>
  );
}
