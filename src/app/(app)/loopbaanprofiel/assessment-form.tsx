"use client";

import { useActionState, useState } from "react";
import { getDictionary } from "@/lib/i18n";
import {
  activityIds,
  assessmentProgress,
  choiceOptions,
  cultureIds,
  employerTypeIds,
  employerTypeValues,
  energyValues,
  languageIds,
  reportingIds,
  scopeIds,
  textKeys,
  type AssessmentAnswers,
  type ChoiceKey,
} from "@/lib/assessment/schema";
import { mergeProposal } from "@/lib/assessment/suggest";
import { formatDateTime } from "@/lib/time";
import { saveAssessment, type SaveAssessmentState } from "./actions";

const t = getDictionary();
const a = t.assessment;

function Proposed({ show }: { show: boolean }) {
  return show ? <span className="badge ml-2 bg-amber-100 text-amber-800">{a.proposedBadge}</span> : null;
}

/** A labelled dropdown with an explicit "no answer" option (unknown ≠ no). */
function Select({
  id,
  label,
  value,
  options,
  optionLabel,
  onChange,
  proposed,
  compact = false,
}: {
  id: string;
  label: string;
  value: string | undefined;
  options: readonly string[];
  optionLabel: (o: string) => string;
  onChange: (v: string | undefined) => void;
  proposed: boolean;
  compact?: boolean;
}) {
  return (
    <div className={compact ? "flex flex-wrap items-center justify-between gap-2 py-2" : ""}>
      <label htmlFor={id} className={compact ? "text-sm" : "label"}>
        {label}
        <Proposed show={proposed} />
      </label>
      <select
        id={id}
        className={`input ${compact ? "w-auto min-w-40" : "max-w-md"}`}
        value={value ?? ""}
        onChange={(e) => onChange(e.target.value === "" ? undefined : e.target.value)}
      >
        <option value="">{a.notAnswered}</option>
        {options.map((o) => (
          <option key={o} value={o}>
            {optionLabel(o)}
          </option>
        ))}
      </select>
    </div>
  );
}

function MultiChoice<T extends string>({
  legend,
  options,
  value,
  max,
  onChange,
  proposed,
}: {
  legend: string;
  options: readonly T[];
  value: T[];
  max?: number;
  onChange: (v: T[]) => void;
  proposed: boolean;
}) {
  return (
    <fieldset className="space-y-1">
      <legend className="label">
        {legend}
        <Proposed show={proposed} />
      </legend>
      <div className="flex flex-wrap gap-2">
        {options.map((option) => {
          const checked = value.includes(option);
          const disabled = !checked && max !== undefined && value.length >= max;
          return (
            <label key={option} className={`chip ${checked ? "chip-active" : ""} ${disabled ? "opacity-50" : ""}`}>
              <input
                type="checkbox"
                className="sr-only"
                checked={checked}
                disabled={disabled}
                onChange={(e) => onChange(e.target.checked ? [...value, option] : value.filter((v) => v !== option))}
              />
              {a.options[option] ?? option}
            </label>
          );
        })}
      </div>
    </fieldset>
  );
}

export function AssessmentForm({
  initial,
  proposal,
  proposalSource,
  proposalDate,
}: {
  initial: AssessmentAnswers;
  proposal: AssessmentAnswers;
  proposalSource: "claude" | "rules";
  proposalDate: string | null;
}) {
  const [answers, setAnswers] = useState<AssessmentAnswers>(initial);
  const [proposed, setProposed] = useState<Set<string>>(new Set());
  const [autofillMessage, setAutofillMessage] = useState<string | null>(null);
  const [state, action, pending] = useActionState<SaveAssessmentState, FormData>(saveAssessment, {
    ok: false,
    error: null,
    savedAt: null,
  });

  // Any manual change to a field removes its "proposed" marker.
  const unmark = (key: string) =>
    setProposed((prev) => {
      if (!prev.has(key)) return prev;
      const next = new Set(prev);
      next.delete(key);
      return next;
    });
  const set = <K extends keyof AssessmentAnswers>(key: K, value: AssessmentAnswers[K]) => {
    setAnswers((prev) => ({ ...prev, [key]: value }));
    unmark(key);
  };
  const setChoice = (key: ChoiceKey, v: string | undefined) => set(key, v as never);
  const progress = assessmentProgress(answers);

  function autofill() {
    const { merged, filled } = mergeProposal(answers, proposal);
    setAnswers(merged);
    setProposed(new Set([...proposed, ...filled]));
    setAutofillMessage(filled.length ? a.autofillDone(filled.length) : a.autofillNothing);
  }

  return (
    <form action={action} className="space-y-6" onSubmit={() => setProposed(new Set())}>
      <input type="hidden" name="payload" value={JSON.stringify(answers)} />

      <section className="card space-y-2" aria-labelledby="autofill">
        <h2 id="autofill" className="font-semibold">{a.autofillTitle}</h2>
        <p className="text-sm text-navy-800">
          {proposalSource === "claude" ? a.autofillClaude : a.autofillRules}
          {proposalSource === "claude" && proposalDate ? ` (${formatDateTime(proposalDate)})` : ""}
        </p>
        <div className="flex flex-wrap items-center gap-3">
          <button type="button" className="btn-teal" onClick={autofill}>
            {a.autofillButton}
          </button>
          <span aria-live="polite" className="text-sm text-navy-600">{autofillMessage}</span>
        </div>
        <p className="help">{a.autofillHelp}</p>
      </section>

      <p className="text-sm text-navy-600" aria-live="polite">
        {a.progress(progress.answered, progress.total)}
      </p>

      <section aria-labelledby="sec-energy" className="card space-y-3">
        <h2 id="sec-energy" className="font-semibold">{a.sections.energy}</h2>
        <p className="help">{a.sections.energyHelp}</p>
        <div className="divide-y divide-sand-200">
          {activityIds.map((id) => (
            <Select
              key={id}
              compact
              id={`act-${id}`}
              label={a.activities[id]}
              value={answers.activities[id]}
              options={energyValues}
              optionLabel={(o) => a.energyValues[o as keyof typeof a.energyValues]}
              proposed={proposed.has(`activities.${id}`)}
              onChange={(v) => {
                const next = { ...answers.activities };
                if (v) next[id] = v as (typeof energyValues)[number];
                else delete next[id];
                setAnswers((prev) => ({ ...prev, activities: next }));
                unmark(`activities.${id}`);
              }}
            />
          ))}
        </div>
      </section>

      <section aria-labelledby="sec-role" className="card space-y-4">
        <h2 id="sec-role" className="font-semibold">{a.sections.roleShape}</h2>
        {(["newBusinessShareMax", "quotaPreference", "cycleLength"] as const).map((key) => (
          <Select
            key={key}
            id={`q-${key}`}
            label={a.questions[key]}
            value={answers[key]}
            options={choiceOptions[key]}
            optionLabel={(o) => a.options[o] ?? o}
            proposed={proposed.has(key)}
            onChange={(v) => setChoice(key, v)}
          />
        ))}
        {(["strategicVsOperational", "handsOnVsThroughOthers"] as const).map((key) => (
          <Select
            key={key}
            id={`q-${key}`}
            label={a.questions[key]}
            value={answers[key] !== undefined ? String(answers[key]) : undefined}
            options={["1", "2", "3", "4", "5"]}
            optionLabel={(o) => a.scaleLabels[key][Number(o) - 1]}
            proposed={proposed.has(key)}
            onChange={(v) => set(key, v ? Number(v) : undefined)}
          />
        ))}
      </section>

      <section aria-labelledby="sec-scope" className="card space-y-4">
        <h2 id="sec-scope" className="font-semibold">{a.sections.scope}</h2>
        {(["teamSize", "resultsResponsibility"] as const).map((key) => (
          <Select
            key={key}
            id={`q-${key}`}
            label={a.questions[key]}
            value={answers[key]}
            options={choiceOptions[key]}
            optionLabel={(o) => a.options[o] ?? o}
            proposed={proposed.has(key)}
            onChange={(v) => setChoice(key, v)}
          />
        ))}
        <MultiChoice legend={a.questions.reportingLines} options={reportingIds} value={answers.reportingLines} proposed={proposed.has("reportingLines")} onChange={(v) => set("reportingLines", v)} />
        <MultiChoice legend={a.questions.geographicScope} options={scopeIds} value={answers.geographicScope} proposed={proposed.has("geographicScope")} onChange={(v) => set("geographicScope", v)} />
      </section>

      <section aria-labelledby="sec-employer" className="card space-y-4">
        <h2 id="sec-employer" className="font-semibold">{a.sections.employer}</h2>
        <fieldset>
          <legend className="label">{a.questions.employerTypes}</legend>
          <div className="divide-y divide-sand-200">
            {employerTypeIds.map((id) => (
              <Select
                key={id}
                compact
                id={`emp-${id}`}
                label={a.employerTypes[id]}
                value={answers.employerTypes[id]}
                options={employerTypeValues}
                optionLabel={(o) => a.employerValues[o as keyof typeof a.employerValues]}
                proposed={proposed.has(`employerTypes.${id}`)}
                onChange={(v) => {
                  const next = { ...answers.employerTypes };
                  if (v) next[id] = v as (typeof employerTypeValues)[number];
                  else delete next[id];
                  setAnswers((prev) => ({ ...prev, employerTypes: next }));
                  unmark(`employerTypes.${id}`);
                }}
              />
            ))}
          </div>
        </fieldset>
        <Select
          id="q-minCompanySize"
          label={a.questions.minCompanySize}
          value={answers.minCompanySize}
          options={choiceOptions.minCompanySize}
          optionLabel={(o) => a.options[o] ?? o}
          proposed={proposed.has("minCompanySize")}
          onChange={(v) => setChoice("minCompanySize", v)}
        />
      </section>

      <section aria-labelledby="sec-culture" className="card space-y-4">
        <h2 id="sec-culture" className="font-semibold">{a.sections.culture}</h2>
        <Select
          id="q-travelMax"
          label={a.questions.travelMax}
          value={answers.travelMax}
          options={choiceOptions.travelMax}
          optionLabel={(o) => a.options[o] ?? o}
          proposed={proposed.has("travelMax")}
          onChange={(v) => setChoice("travelMax", v)}
        />
        <Select
          id="q-officeDaysMax"
          label={a.questions.officeDaysMax}
          value={answers.officeDaysMax !== undefined ? String(answers.officeDaysMax) : undefined}
          options={["0", "1", "2", "3", "4", "5"]}
          optionLabel={(o) => a.officeDays(Number(o))}
          proposed={proposed.has("officeDaysMax")}
          onChange={(v) => set("officeDaysMax", v === undefined ? undefined : Number(v))}
        />
        <MultiChoice legend={a.questions.culture} options={cultureIds} value={answers.culture} max={5} proposed={proposed.has("culture")} onChange={(v) => set("culture", v)} />
        <MultiChoice legend={a.questions.workLanguages} options={languageIds} value={answers.workLanguages} proposed={proposed.has("workLanguages")} onChange={(v) => set("workLanguages", v)} />
      </section>

      <section aria-labelledby="sec-words" className="card space-y-4">
        <h2 id="sec-words" className="font-semibold">{a.sections.ownWords}</h2>
        <p className="help">{a.textHelp}</p>
        {textKeys.map((key) => (
          <div key={key}>
            <label htmlFor={`txt-${key}`} className="label">
              {a.texts[key]}
              <Proposed show={proposed.has(`texts.${key}`)} />
            </label>
            <textarea
              id={`txt-${key}`}
              rows={3}
              maxLength={1500}
              className="input"
              value={answers.texts[key] ?? ""}
              onChange={(e) => {
                setAnswers((prev) => ({ ...prev, texts: { ...prev.texts, [key]: e.target.value } }));
                unmark(`texts.${key}`);
              }}
            />
          </div>
        ))}
      </section>

      <div className="sticky bottom-0 flex flex-wrap items-center gap-3 border-t border-sand-200 bg-sand-50/95 py-3">
        <button type="submit" className="btn-primary" disabled={pending}>
          {pending ? t.common.saving : t.common.save}
        </button>
        {proposed.size > 0 && <span className="text-sm text-amber-800">{a.reviewBeforeSave(proposed.size)}</span>}
        <span aria-live="polite" className="text-sm">
          {state.ok && state.savedAt && (
            <span className="text-teal-700">
              {a.saved} ({formatDateTime(state.savedAt)})
            </span>
          )}
          {state.error && <span className="text-rose-800">{a.saveError}</span>}
        </span>
      </div>
    </form>
  );
}
