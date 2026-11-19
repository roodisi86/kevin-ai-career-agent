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
import { formatDateTime } from "@/lib/time";
import { saveAssessment, type SaveAssessmentState } from "./actions";

const t = getDictionary();
const a = t.assessment;

function Choice({
  name,
  value,
  onChange,
}: {
  name: ChoiceKey;
  value: string | undefined;
  onChange: (v: string | undefined) => void;
}) {
  return (
    <fieldset className="space-y-1">
      <legend className="label">{a.questions[name]}</legend>
      <div className="flex flex-wrap gap-2">
        {choiceOptions[name].map((option) => (
          <label key={option} className={`chip ${value === option ? "chip-active" : ""}`}>
            <input
              type="radio"
              className="sr-only"
              name={name}
              checked={value === option}
              onChange={() => onChange(option)}
              onClick={() => value === option && onChange(undefined)}
            />
            {a.options[option] ?? option}
          </label>
        ))}
      </div>
    </fieldset>
  );
}

function Scale({
  name,
  value,
  onChange,
}: {
  name: "strategicVsOperational" | "handsOnVsThroughOthers";
  value: number | undefined;
  onChange: (v: number | undefined) => void;
}) {
  return (
    <fieldset className="space-y-1">
      <legend className="label">{a.questions[name]}</legend>
      <div className="flex gap-2">
        {[1, 2, 3, 4, 5].map((n) => (
          <label key={n} className={`chip w-10 justify-center ${value === n ? "chip-active" : ""}`}>
            <input
              type="radio"
              className="sr-only"
              name={name}
              checked={value === n}
              onChange={() => onChange(n)}
              onClick={() => value === n && onChange(undefined)}
            />
            {n}
          </label>
        ))}
      </div>
    </fieldset>
  );
}

function MultiChoice<T extends string>({
  legend,
  options,
  value,
  max,
  onChange,
}: {
  legend: string;
  options: readonly T[];
  value: T[];
  max?: number;
  onChange: (v: T[]) => void;
}) {
  return (
    <fieldset className="space-y-1">
      <legend className="label">{legend}</legend>
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

export function AssessmentForm({ initial }: { initial: AssessmentAnswers }) {
  const [answers, setAnswers] = useState<AssessmentAnswers>(initial);
  const [state, action, pending] = useActionState<SaveAssessmentState, FormData>(saveAssessment, {
    ok: false,
    error: null,
    savedAt: null,
  });
  const set = <K extends keyof AssessmentAnswers>(key: K, value: AssessmentAnswers[K]) =>
    setAnswers((prev) => ({ ...prev, [key]: value }));
  const progress = assessmentProgress(answers);

  return (
    <form action={action} className="space-y-6">
      <input type="hidden" name="payload" value={JSON.stringify(answers)} />
      <p className="text-sm text-navy-600" aria-live="polite">
        {a.progress(progress.answered, progress.total)}
      </p>

      <section aria-labelledby="sec-energy" className="card space-y-3">
        <h2 id="sec-energy" className="font-semibold">{a.sections.energy}</h2>
        <p className="help">{a.sections.energyHelp}</p>
        <div className="divide-y divide-sand-200">
          {activityIds.map((id) => (
            <fieldset key={id} className="flex flex-wrap items-center justify-between gap-2 py-2">
              <legend className="sr-only">{a.activities[id]}</legend>
              <span className="text-sm">{a.activities[id]}</span>
              <div className="flex gap-1">
                {energyValues.map((v) => {
                  const checked = answers.activities[id] === v;
                  return (
                    <label key={v} className={`chip text-xs ${checked ? (v === "drain" ? "chip-negative" : "chip-active") : ""}`}>
                      <input
                        type="radio"
                        className="sr-only"
                        name={`act-${id}`}
                        aria-label={`${a.activities[id]}: ${a.energyValues[v]}`}
                        checked={checked}
                        onChange={() => set("activities", { ...answers.activities, [id]: v })}
                      />
                      {a.energyValues[v]}
                    </label>
                  );
                })}
              </div>
            </fieldset>
          ))}
        </div>
      </section>

      <section aria-labelledby="sec-role" className="card space-y-4">
        <h2 id="sec-role" className="font-semibold">{a.sections.roleShape}</h2>
        <Choice name="newBusinessShareMax" value={answers.newBusinessShareMax} onChange={(v) => set("newBusinessShareMax", v as AssessmentAnswers["newBusinessShareMax"])} />
        <Choice name="quotaPreference" value={answers.quotaPreference} onChange={(v) => set("quotaPreference", v as AssessmentAnswers["quotaPreference"])} />
        <Choice name="cycleLength" value={answers.cycleLength} onChange={(v) => set("cycleLength", v as AssessmentAnswers["cycleLength"])} />
        <Scale name="strategicVsOperational" value={answers.strategicVsOperational} onChange={(v) => set("strategicVsOperational", v)} />
        <Scale name="handsOnVsThroughOthers" value={answers.handsOnVsThroughOthers} onChange={(v) => set("handsOnVsThroughOthers", v)} />
      </section>

      <section aria-labelledby="sec-scope" className="card space-y-4">
        <h2 id="sec-scope" className="font-semibold">{a.sections.scope}</h2>
        <Choice name="teamSize" value={answers.teamSize} onChange={(v) => set("teamSize", v as AssessmentAnswers["teamSize"])} />
        <Choice name="resultsResponsibility" value={answers.resultsResponsibility} onChange={(v) => set("resultsResponsibility", v as AssessmentAnswers["resultsResponsibility"])} />
        <MultiChoice legend={a.questions.reportingLines} options={reportingIds} value={answers.reportingLines} onChange={(v) => set("reportingLines", v)} />
        <MultiChoice legend={a.questions.geographicScope} options={scopeIds} value={answers.geographicScope} onChange={(v) => set("geographicScope", v)} />
      </section>

      <section aria-labelledby="sec-employer" className="card space-y-4">
        <h2 id="sec-employer" className="font-semibold">{a.sections.employer}</h2>
        <fieldset>
          <legend className="label">{a.questions.employerTypes}</legend>
          <div className="divide-y divide-sand-200">
            {employerTypeIds.map((id) => (
              <div key={id} className="flex flex-wrap items-center justify-between gap-2 py-2">
                <span className="text-sm">{a.employerTypes[id]}</span>
                <div className="flex gap-1">
                  {employerTypeValues.map((v) => {
                    const checked = answers.employerTypes[id] === v;
                    return (
                      <label key={v} className={`chip text-xs ${checked ? (v === "avoid" ? "chip-negative" : "chip-active") : ""}`}>
                        <input
                          type="radio"
                          className="sr-only"
                          name={`emp-${id}`}
                          aria-label={`${a.employerTypes[id]}: ${a.employerValues[v]}`}
                          checked={checked}
                          onChange={() => set("employerTypes", { ...answers.employerTypes, [id]: v })}
                        />
                        {a.employerValues[v]}
                      </label>
                    );
                  })}
                </div>
              </div>
            ))}
          </div>
        </fieldset>
        <Choice name="minCompanySize" value={answers.minCompanySize} onChange={(v) => set("minCompanySize", v as AssessmentAnswers["minCompanySize"])} />
      </section>

      <section aria-labelledby="sec-culture" className="card space-y-4">
        <h2 id="sec-culture" className="font-semibold">{a.sections.culture}</h2>
        <Choice name="travelMax" value={answers.travelMax} onChange={(v) => set("travelMax", v as AssessmentAnswers["travelMax"])} />
        <fieldset className="space-y-1">
          <legend className="label">{a.questions.officeDaysMax}</legend>
          <div className="flex gap-2">
            {[0, 1, 2, 3, 4, 5].map((n) => (
              <label key={n} className={`chip w-10 justify-center ${answers.officeDaysMax === n ? "chip-active" : ""}`}>
                <input
                  type="radio"
                  className="sr-only"
                  name="officeDaysMax"
                  checked={answers.officeDaysMax === n}
                  onChange={() => set("officeDaysMax", n)}
                />
                {n}
              </label>
            ))}
          </div>
        </fieldset>
        <MultiChoice legend={a.questions.culture} options={cultureIds} value={answers.culture} max={5} onChange={(v) => set("culture", v)} />
        <MultiChoice legend={a.questions.workLanguages} options={languageIds} value={answers.workLanguages} onChange={(v) => set("workLanguages", v)} />
      </section>

      <section aria-labelledby="sec-words" className="card space-y-4">
        <h2 id="sec-words" className="font-semibold">{a.sections.ownWords}</h2>
        <p className="help">{a.textHelp}</p>
        {textKeys.map((key) => (
          <div key={key}>
            <label htmlFor={`txt-${key}`} className="label">{a.texts[key]}</label>
            <textarea
              id={`txt-${key}`}
              rows={3}
              maxLength={1500}
              className="input"
              value={answers.texts[key] ?? ""}
              onChange={(e) => set("texts", { ...answers.texts, [key]: e.target.value })}
            />
          </div>
        ))}
      </section>

      <div className="sticky bottom-0 flex flex-wrap items-center gap-3 border-t border-sand-200 bg-sand-50/95 py-3">
        <button type="submit" className="btn-primary" disabled={pending}>
          {pending ? t.common.saving : t.common.save}
        </button>
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
