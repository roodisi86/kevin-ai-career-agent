import { getAppContext } from "@/lib/dal";
import { getDictionary } from "@/lib/i18n";
import { isAiConfigured } from "@/lib/env";
import { loadProfileData } from "@/lib/profile/queries";
import { missingCategories } from "@/lib/profile/summary";
import { formatDateTime } from "@/lib/time";
import { bulkConfirmable } from "@/lib/ai/cv-facts";
import { createSupabaseServerClient } from "@/lib/supabase/server";
import {
  acceptSummarySuggestion,
  confirmAllNonSensitive,
  deleteDocument,
  deleteFact,
  discardSummarySuggestion,
  restoreFact,
} from "./actions";
import {
  AddFactForm,
  AiSuggestButton,
  AutoAnalysisToggle,
  BasicsForm,
  ConfirmDeleteButton,
  SuggestionCard,
  UploadForm,
} from "./components";

const t = getDictionary();

function formatSize(bytes: number): string {
  return bytes > 1024 * 1024 ? `${(bytes / 1024 / 1024).toFixed(1)} MB` : `${Math.round(bytes / 1024)} kB`;
}

export default async function ProfilePage() {
  const ctx = await getAppContext();
  const { profile, documents, facts } = await loadProfileData(ctx);
  const aiConfigured = isAiConfigured();
  const supabase = await createSupabaseServerClient();
  const { data: consent } = await supabase
    .from("consent_records")
    .select("status")
    .eq("candidate_id", ctx.candidateId)
    .eq("scope", "ai_analysis")
    .maybeSingle();
  const autoAnalyse = aiConfigured && consent?.status === "granted";

  const suggested = facts.filter((f) => f.status === "suggested");
  const confirmed = facts.filter((f) => f.status === "confirmed");
  const rejected = facts.filter((f) => f.status === "rejected");
  const missing = missingCategories(facts);

  return (
    <div className="space-y-8">
      <div>
        <h1 className="text-2xl font-semibold">{t.profile.title}</h1>
        <p className="max-w-3xl text-sm text-navy-600">{t.profile.intro}</p>
        <ul className="mt-3 flex flex-wrap gap-3 text-xs" aria-label="Legenda">
          <li className="badge bg-teal-100 text-teal-700">● {t.profile.facts.legend.confirmed}</li>
          <li className="badge bg-amber-100 text-amber-800">◌ {t.profile.facts.legend.suggested}</li>
          <li className="badge bg-sand-200 text-navy-600">○ {t.profile.facts.legend.missing}</li>
        </ul>
      </div>

      <div className="grid gap-6 lg:grid-cols-2">
        <section aria-labelledby="upload" className="card">
          <h2 id="upload" className="mb-3 font-semibold">
            {t.profile.upload.title}
          </h2>
          <UploadForm autoAnalyse={autoAnalyse} />
          {aiConfigured && <AutoAnalysisToggle enabled={consent?.status === "granted"} />}
        </section>

        <section aria-labelledby="basics" className="card">
          <h2 id="basics" className="mb-3 font-semibold">
            {t.profile.basics}
          </h2>
          {profile.suggested_summary && (
            <div
              className="mb-4 rounded-lg border border-dashed border-amber-800/40 bg-amber-100/40 p-4"
              data-testid="summary-suggestion"
            >
              <p className="text-sm font-semibold">{t.profile.suggestion.title}</p>
              <p className="help mb-2">
                {t.profile.suggestion.notice} {t.profile.suggestion.proposedOn}{" "}
                {formatDateTime(profile.suggestion_created_at)}
              </p>
              {profile.suggested_headline && <p className="font-medium">{profile.suggested_headline}</p>}
              <p className="text-sm">{profile.suggested_summary}</p>
              <div className="mt-3 flex flex-wrap gap-2">
                <form action={acceptSummarySuggestion}>
                  <button type="submit" className="btn-teal">
                    {t.profile.suggestion.accept}
                  </button>
                </form>
                <form action={discardSummarySuggestion}>
                  <button type="submit" className="btn-secondary">
                    {t.profile.suggestion.discard}
                  </button>
                </form>
              </div>
            </div>
          )}
          <BasicsForm
            key={profile.updated_at}
            headline={profile.headline ?? ""}
            desiredSeniority={profile.desired_seniority ?? ""}
            summary={profile.summary ?? ""}
          />
        </section>
      </div>

      <section aria-labelledby="documents" className="card">
        <h2 id="documents" className="mb-3 font-semibold">
          {t.profile.documents.title}
        </h2>
        {documents.length === 0 ? (
          <p className="text-sm text-navy-600">{t.profile.documents.empty}</p>
        ) : (
          <ul className="divide-y divide-sand-200">
            {documents.map((doc) => (
              <li key={doc.id} className="space-y-3 py-4" data-testid="document">
                <div className="flex flex-wrap items-center justify-between gap-2">
                  <div>
                    <p className="font-medium">
                      {doc.original_filename}{" "}
                      <span className="badge bg-sand-200 text-navy-800">{t.profile.documents.kind[doc.document_kind]}</span>
                    </p>
                    <p className="text-xs text-navy-600">
                      {doc.file_type.toUpperCase()} · {formatSize(doc.size_bytes)} · {t.profile.documents.uploadedAt}{" "}
                      {formatDateTime(doc.created_at)} · {t.profile.documents.status[doc.processing_status]}
                      {doc.ai_status !== "not_requested" && ` · ${t.profile.documents.aiStatus[doc.ai_status]}`}
                    </p>
                    {doc.extraction_error && (
                      <p className="text-sm text-rose-800">
                        {t.profile.documents.extractionErrors[doc.extraction_error as "no_text" | "parse_failed"] ??
                          t.common.error}
                      </p>
                    )}
                  </div>
                  <div className="flex flex-wrap gap-2">
                    <a href={`/api/profile/documents/${doc.id}`} className="btn-secondary" target="_blank" rel="noreferrer">
                      {t.profile.documents.open}
                    </a>
                    <ConfirmDeleteButton
                      action={deleteDocument}
                      id={doc.id}
                      confirmText={t.profile.documents.deleteConfirm}
                    />
                  </div>
                </div>
                {doc.extracted_text && (
                  <details className="rounded-lg bg-sand-100 p-3">
                    <summary className="cursor-pointer text-sm font-medium">{t.profile.documents.showText}</summary>
                    <pre className="mt-2 max-h-80 overflow-auto whitespace-pre-wrap text-xs text-navy-800">
                      {doc.extracted_text}
                    </pre>
                  </details>
                )}
                {doc.extracted_text &&
                  (aiConfigured ? (
                    <AiSuggestButton documentId={doc.id} />
                  ) : (
                    <p className="text-sm text-navy-600">{t.profile.ai.notConfigured}</p>
                  ))}
              </li>
            ))}
          </ul>
        )}
      </section>

      <section aria-labelledby="review" className="card">
        <h2 id="review" className="mb-3 font-semibold">
          {t.profile.facts.reviewTitle} ({suggested.length})
        </h2>
        {suggested.length === 0 ? (
          <p className="text-sm text-navy-600">{t.profile.facts.reviewEmpty}</p>
        ) : (
          <>
          {bulkConfirmable(suggested).length > 0 && (
            <form action={confirmAllNonSensitive} className="mb-3 flex flex-wrap items-center gap-3">
              <button type="submit" className="btn-teal">
                {t.profile.facts.confirmAll(bulkConfirmable(suggested).length)}
              </button>
              <span className="help">{t.profile.facts.confirmAllHelp}</span>
            </form>
          )}
          <ul className="space-y-3">
            {suggested.map((fact) => (
              <SuggestionCard key={fact.id} fact={fact} />
            ))}
          </ul>
          </>
        )}
      </section>

      <section aria-labelledby="confirmed" className="card">
        <h2 id="confirmed" className="mb-3 font-semibold">
          {t.profile.facts.confirmedTitle} ({confirmed.length})
        </h2>
        {confirmed.length === 0 ? (
          <p className="text-sm text-navy-600">{t.profile.facts.confirmedEmpty}</p>
        ) : (
          <ul className="space-y-2">
            {confirmed.map((fact) => (
              <li
                key={fact.id}
                className="flex flex-wrap items-start justify-between gap-3 rounded-lg border border-teal-600/30 bg-teal-100/40 p-3"
                data-testid="confirmed-fact"
              >
                <div>
                  <div className="mb-1 flex flex-wrap gap-2">
                    <span className="badge bg-teal-100 text-teal-700">{t.profile.facts.status.confirmed}</span>
                    <span className="badge bg-sand-200 text-navy-800">{t.profile.categories[fact.category]}</span>
                    <span className="badge bg-sand-100 text-navy-600">{t.profile.facts.origin[fact.origin]}</span>
                    {fact.is_sensitive && (
                      <span className="badge bg-rose-100 text-rose-800">{t.profile.facts.sensitive}</span>
                    )}
                  </div>
                  <p>{fact.statement}</p>
                  <p className="text-xs text-navy-600">
                    {t.profile.facts.confirmedOn} {formatDateTime(fact.confirmed_at)} · ID {fact.id.slice(0, 8)}
                  </p>
                </div>
                <ConfirmDeleteButton action={deleteFact} id={fact.id} confirmText={t.profile.facts.deleteConfirm} />
              </li>
            ))}
          </ul>
        )}
      </section>

      <div className="grid gap-6 lg:grid-cols-2">
        <section aria-labelledby="missing" className="card">
          <h2 id="missing" className="mb-1 font-semibold">
            {t.profile.facts.missingTitle}
          </h2>
          <p className="mb-3 text-sm text-navy-600">{t.profile.facts.missingHelp}</p>
          {missing.length === 0 ? (
            <p className="text-sm text-teal-700">✓</p>
          ) : (
            <ul className="flex flex-wrap gap-2">
              {missing.map((c) => (
                <li key={c} className="badge bg-sand-200 text-navy-600">
                  ○ {t.profile.categories[c]}
                </li>
              ))}
            </ul>
          )}
        </section>

        <section aria-labelledby="add-fact" className="card">
          <h2 id="add-fact" className="mb-3 font-semibold">
            {t.profile.facts.addTitle}
          </h2>
          <AddFactForm />
        </section>
      </div>

      {rejected.length > 0 && (
        <section aria-labelledby="rejected" className="card">
          <details>
            <summary id="rejected" className="cursor-pointer font-semibold">
              {t.profile.facts.rejectedTitle} ({rejected.length})
            </summary>
            <ul className="mt-3 space-y-2">
              {rejected.map((fact) => (
                <li key={fact.id} className="flex flex-wrap items-center justify-between gap-2 text-sm text-navy-600">
                  <span className="line-through">{fact.statement}</span>
                  <form action={restoreFact}>
                    <input type="hidden" name="id" value={fact.id} />
                    <button type="submit" className="btn-secondary">
                      {t.profile.facts.restore}
                    </button>
                  </form>
                </li>
              ))}
            </ul>
          </details>
        </section>
      )}
    </div>
  );
}
