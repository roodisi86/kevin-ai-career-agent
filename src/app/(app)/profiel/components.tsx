"use client";

import { useActionState, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import { getDictionary } from "@/lib/i18n";
import { factCategories } from "@/lib/ai/cv-facts";
import type { CandidateFactRow, FactCategory } from "@/lib/supabase/database.types";
import {
  addFact,
  confirmFact,
  setAutoAnalysis,
  rejectFact,
  suggestFactsFromDocument,
  updateBasics,
  type ActionState,
} from "./actions";

const t = getDictionary();
const initial: ActionState = { ok: false, message: null };

function ErrorText({ code }: { code?: string }) {
  if (!code) return null;
  const messages: Record<string, string> = {
    sensitive_ack_required: t.profile.facts.sensitiveConfirm,
    not_configured: t.profile.ai.notConfigured,
    cap_reached: t.profile.ai.capReached,
    ...t.profile.ai.failed,
  };
  return (
    <p role="alert" className="mt-2 text-sm text-rose-800">
      {messages[code] ?? t.common.error}
    </p>
  );
}

// ---------------------------------------------------------------------------

export function UploadForm({ autoAnalyse }: { autoAnalyse: boolean }) {
  const router = useRouter();
  const inputRef = useRef<HTMLInputElement>(null);
  const [kind, setKind] = useState<"cv" | "linkedin_profile" | "assessment">("cv");
  const [state, setState] = useState<{
    status: "idle" | "uploading" | "analysing" | "done" | "error";
    code?: string;
    result?: string;
  }>({ status: "idle" });

  async function onSubmit(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const file = inputRef.current?.files?.[0];
    if (!file) return;
    setState({ status: "uploading" });
    const body = new FormData();
    body.append("file", file);
    body.append("kind", kind);
    try {
      const response = await fetch("/api/profile/documents", { method: "POST", body });
      const json = (await response.json()) as { ok: boolean; error?: string; documentId?: string; extracted?: boolean };
      if (!response.ok || !json.ok) {
        setState({ status: "error", code: json.error ?? "generic" });
        return;
      }
      if (inputRef.current) inputRef.current.value = "";
      router.refresh();

      if (autoAnalyse && json.extracted && json.documentId) {
        setState({ status: "analysing" });
        const form = new FormData();
        form.append("id", json.documentId);
        const ai = await suggestFactsFromDocument({ ok: false, message: null }, form);
        if (ai.ok && ai.message) {
          const [kept, dropped, summary] = ai.message.split("|").map(Number);
          setState({ status: "done", result: t.profile.ai.result(kept, dropped, summary === 1) });
        } else {
          setState({ status: "error", code: ai.code ?? "generic" });
        }
        router.refresh();
        return;
      }
      setState({ status: "done" });
    } catch {
      setState({ status: "error", code: "generic" });
    }
  }

  const errors: Record<string, string> = {
    ...(t.profile.upload.errors as Record<string, string>),
    ...(t.profile.ai.failed as Record<string, string>),
    not_configured: t.profile.ai.notConfigured,
    cap_reached: t.profile.ai.capReached,
  };
  const busy = state.status === "uploading" || state.status === "analysing";

  return (
    <form onSubmit={onSubmit} className="space-y-3" aria-describedby="upload-help">
      <fieldset>
        <legend className="label">{t.profile.upload.kindLegend}</legend>
        <div className="flex flex-wrap gap-4 text-sm">
          <label className="flex items-center gap-1.5">
            <input type="radio" name="kind" value="cv" checked={kind === "cv"} onChange={() => setKind("cv")} />
            {t.profile.upload.kindCv}
          </label>
          <label className="flex items-center gap-1.5">
            <input
              type="radio"
              name="kind"
              value="linkedin_profile"
              checked={kind === "linkedin_profile"}
              onChange={() => setKind("linkedin_profile")}
            />
            {t.profile.upload.kindLinkedin}
          </label>
          <label className="flex items-center gap-1.5">
            <input
              type="radio"
              name="kind"
              value="assessment"
              checked={kind === "assessment"}
              onChange={() => setKind("assessment")}
            />
            {t.profile.upload.kindAssessment}
          </label>
        </div>
        {kind === "linkedin_profile" && <p className="help">{t.profile.upload.linkedinHelp}</p>}
        {kind === "assessment" && <p className="help">{t.profile.upload.assessmentHelp}</p>}
      </fieldset>
      <div>
        <label htmlFor="cv-file" className="label">
          {t.profile.upload.choose}
        </label>
        <input
          ref={inputRef}
          id="cv-file"
          name="file"
          type="file"
          required
          accept=".pdf,.docx,application/pdf,application/vnd.openxmlformats-officedocument.wordprocessingml.document"
          className="block w-full text-sm file:mr-3 file:rounded-lg file:border-0 file:bg-navy-800 file:px-4 file:py-2 file:text-white"
        />
        <p id="upload-help" className="help">
          {t.profile.upload.help}
        </p>
      </div>
      <button type="submit" className="btn-primary" disabled={busy}>
        {state.status === "uploading"
          ? t.profile.upload.uploading
          : state.status === "analysing"
            ? t.profile.upload.autoRunning
            : t.profile.upload.submit}
      </button>
      <div aria-live="polite">
        {state.status === "done" && (
          <p className="text-sm text-teal-700">
            {t.profile.upload.done} {state.result ?? ""}
          </p>
        )}
        {state.status === "error" && (
          <p role="alert" className="text-sm text-rose-800">
            {errors[state.code ?? "generic"] ?? errors.generic}
          </p>
        )}
      </div>
    </form>
  );
}

// ---------------------------------------------------------------------------

export function BasicsForm({
  headline,
  desiredSeniority,
  summary,
}: {
  headline: string;
  desiredSeniority: string;
  summary: string;
}) {
  const [state, action, pending] = useActionState(updateBasics, initial);
  return (
    <form action={action} className="space-y-3">
      <div>
        <label htmlFor="headline" className="label">
          {t.profile.headline}
        </label>
        <input id="headline" name="headline" defaultValue={headline} maxLength={300} className="input" />
        <p className="help">{t.profile.headlineHelp}</p>
      </div>
      <div>
        <label htmlFor="desired_seniority" className="label">
          {t.profile.desiredSeniority}
        </label>
        <input
          id="desired_seniority"
          name="desired_seniority"
          defaultValue={desiredSeniority}
          maxLength={200}
          className="input"
        />
      </div>
      <div>
        <label htmlFor="summary" className="label">
          {t.profile.summary}
        </label>
        <textarea id="summary" name="summary" defaultValue={summary} maxLength={5000} rows={4} className="input" />
      </div>
      <button type="submit" className="btn-secondary" disabled={pending}>
        {pending ? t.common.saving : t.common.save}
      </button>
      <span aria-live="polite" className="ml-3 text-sm text-teal-700">
        {state.ok ? t.common.saved : ""}
      </span>
      {!state.ok && <ErrorText code={state.code} />}
    </form>
  );
}

// ---------------------------------------------------------------------------

function CategorySelect({ id, defaultValue }: { id: string; defaultValue: FactCategory }) {
  return (
    <select id={id} name="category" defaultValue={defaultValue} className="input">
      {factCategories.map((c) => (
        <option key={c} value={c}>
          {t.profile.categories[c]}
        </option>
      ))}
    </select>
  );
}

export function SuggestionCard({ fact }: { fact: CandidateFactRow }) {
  const [state, action, pending] = useActionState(confirmFact, initial);
  const [editing, setEditing] = useState(false);

  return (
    <li className="rounded-lg border border-dashed border-amber-800/40 bg-amber-100/40 p-4" data-testid="suggestion">
      <form action={action} className="space-y-3">
        <input type="hidden" name="id" value={fact.id} />
        <div className="flex flex-wrap items-center gap-2">
          <span className="badge bg-amber-100 text-amber-800">{t.profile.facts.status.suggested}</span>
          <span className="badge bg-sand-200 text-navy-800">{t.profile.categories[fact.category]}</span>
          <span className="badge bg-sand-100 text-navy-600">{t.profile.facts.origin[fact.origin]}</span>
          {fact.is_sensitive && (
            <span className="badge bg-rose-100 text-rose-800">{t.profile.facts.sensitive}</span>
          )}
        </div>

        {editing ? (
          <div className="grid gap-2 md:grid-cols-[1fr_200px]">
            <div>
              <label htmlFor={`st-${fact.id}`} className="label">
                {t.profile.facts.statement}
              </label>
              <textarea
                id={`st-${fact.id}`}
                name="statement"
                defaultValue={fact.statement}
                rows={2}
                maxLength={1000}
                className="input"
              />
            </div>
            <div>
              <label htmlFor={`cat-${fact.id}`} className="label">
                {t.profile.facts.category}
              </label>
              <CategorySelect id={`cat-${fact.id}`} defaultValue={fact.category} />
            </div>
          </div>
        ) : (
          <p className="font-medium">{fact.statement}</p>
        )}

        {fact.evidence_excerpt && (
          <blockquote className="border-l-4 border-sand-300 pl-3 text-sm text-navy-600">
            <span className="font-medium">{t.profile.facts.evidence}:</span> “{fact.evidence_excerpt}”
          </blockquote>
        )}

        {fact.is_sensitive && (
          <label className="flex items-start gap-2 text-sm">
            <input type="checkbox" name="sensitive_ack" className="mt-1" />
            <span>{t.profile.facts.sensitiveConfirm}</span>
          </label>
        )}

        <div className="flex flex-wrap gap-2">
          <button type="submit" className="btn-teal" disabled={pending}>
            {editing ? t.profile.facts.editConfirm : t.profile.facts.confirm}
          </button>
          {!editing && (
            <button type="button" className="btn-secondary" onClick={() => setEditing(true)}>
              {t.profile.facts.edit}
            </button>
          )}
          <button type="submit" formAction={rejectFact} className="btn-secondary">
            {t.profile.facts.reject}
          </button>
        </div>
        {!state.ok && <ErrorText code={state.code} />}
      </form>
    </li>
  );
}

// ---------------------------------------------------------------------------

export function AddFactForm() {
  const [state, action, pending] = useActionState(addFact, initial);
  return (
    <form action={action} className="space-y-3">
      <div className="grid gap-3 md:grid-cols-[1fr_200px]">
        <div>
          <label htmlFor="new-statement" className="label">
            {t.profile.facts.statement}
          </label>
          <textarea id="new-statement" name="statement" required minLength={3} maxLength={1000} rows={2} className="input" />
        </div>
        <div>
          <label htmlFor="new-category" className="label">
            {t.profile.facts.category}
          </label>
          <CategorySelect id="new-category" defaultValue="role" />
        </div>
      </div>
      <p className="help">{t.profile.facts.addHelp}</p>
      <button type="submit" className="btn-primary" disabled={pending}>
        {pending ? t.common.saving : t.common.add}
      </button>
      {!state.ok && <ErrorText code={state.code} />}
    </form>
  );
}

// ---------------------------------------------------------------------------

export function AiSuggestButton({ documentId }: { documentId: string }) {
  const [state, action, pending] = useActionState(suggestFactsFromDocument, initial);
  let resultText: string | null = null;
  if (state.ok && state.message) {
    const [kept, dropped, summary] = state.message.split("|").map(Number);
    resultText = t.profile.ai.result(kept, dropped, summary === 1);
  }
  return (
    <form action={action} className="space-y-2">
      <input type="hidden" name="id" value={documentId} />
      <p className="help">{t.profile.documents.aiNotice}</p>
      <button type="submit" className="btn-teal" disabled={pending}>
        {pending ? t.profile.documents.aiSuggesting : t.profile.documents.aiSuggest}
      </button>
      <div aria-live="polite">
        {resultText && <p className="text-sm text-teal-700">{resultText}</p>}
        {!state.ok && <ErrorText code={state.code} />}
      </div>
    </form>
  );
}

// ---------------------------------------------------------------------------

/** Two-step confirmation without a native dialog. */
export function ConfirmDeleteButton({
  action,
  id,
  confirmText,
  label = t.common.delete,
}: {
  action: (formData: FormData) => Promise<void>;
  id: string;
  confirmText: string;
  label?: string;
}) {
  const [armed, setArmed] = useState(false);
  if (!armed) {
    return (
      <button type="button" className="btn-danger" onClick={() => setArmed(true)}>
        {label}
      </button>
    );
  }
  return (
    <form action={action} className="flex flex-wrap items-center gap-2">
      <input type="hidden" name="id" value={id} />
      <span className="text-sm text-rose-800">{confirmText}</span>
      <button type="submit" className="btn-danger">
        {label}
      </button>
      <button type="button" className="btn-secondary" onClick={() => setArmed(false)}>
        {t.common.cancel}
      </button>
    </form>
  );
}

// ---------------------------------------------------------------------------

export function AutoAnalysisToggle({ enabled }: { enabled: boolean }) {
  const [checked, setChecked] = useState(enabled);
  return (
    <form action={setAutoAnalysis} className="mt-4 space-y-2 rounded-lg bg-sand-100 p-3">
      <label className="flex items-start gap-2 text-sm font-medium">
        <input
          type="checkbox"
          name="enabled"
          className="mt-1"
          checked={checked}
          onChange={(e) => setChecked(e.target.checked)}
        />
        <span>{t.profile.upload.autoLabel}</span>
      </label>
      <p className="help">{t.profile.upload.autoHelp}</p>
      {checked !== enabled && (
        <button type="submit" className="btn-secondary">
          {t.profile.upload.autoSave}
        </button>
      )}
    </form>
  );
}
