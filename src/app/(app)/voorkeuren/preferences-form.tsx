"use client";

import { useActionState, useState } from "react";
import { getDictionary } from "@/lib/i18n";
import {
  constraintKeys,
  constraintModes,
  sectorPriorities,
  type ConstraintMode,
  type Preferences,
  type SectorPriority,
} from "@/lib/preferences/schema";
import { formatDateTime } from "@/lib/time";
import { savePreferences, type SavePreferencesState } from "./actions";

const t = getDictionary();

const lines = (value: string) =>
  value
    .split("\n")
    .map((v) => v.trim())
    .filter(Boolean);

function ModeRadios({
  name,
  legend,
  value,
  onChange,
}: {
  name: string;
  legend: string;
  value: ConstraintMode;
  onChange: (mode: ConstraintMode) => void;
}) {
  return (
    <fieldset className="rounded-lg border border-sand-200 p-3">
      <legend className="px-1 text-sm font-medium">{legend}</legend>
      <div className="flex flex-wrap gap-3">
        {constraintModes.map((mode) => (
          <label key={mode} className="flex items-center gap-1.5 text-sm">
            <input
              type="radio"
              name={name}
              value={mode}
              checked={value === mode}
              onChange={() => onChange(mode)}
            />
            {t.preferences.modes[mode]}
          </label>
        ))}
      </div>
    </fieldset>
  );
}

export function PreferencesForm({ initial }: { initial: Preferences }) {
  const [prefs, setPrefs] = useState<Preferences>(initial);
  const [titlesText, setTitlesText] = useState(() =>
    Object.fromEntries(initial.tracks.map((tr) => [tr.id, tr.titles.join("\n")])),
  );
  const [locationsText, setLocationsText] = useState(initial.locations.preferred.join("\n"));
  const [negativeText, setNegativeText] = useState(initial.negativeRoleSignals.join("\n"));
  const [aliasText, setAliasText] = useState(() => initial.excludedEmployers.map((e) => e.aliases.join(", ")));
  const [newSector, setNewSector] = useState("");
  const [newEmployer, setNewEmployer] = useState("");

  const [state, action, pending] = useActionState<SavePreferencesState, FormData>(savePreferences, {
    ok: false,
    error: null,
    savedAt: null,
  });

  const payload: Preferences = {
    ...prefs,
    tracks: prefs.tracks.map((tr) => ({ ...tr, titles: lines(titlesText[tr.id] ?? "") })),
    locations: { ...prefs.locations, preferred: lines(locationsText) },
    negativeRoleSignals: lines(negativeText),
    excludedEmployers: prefs.excludedEmployers.map((e, i) => ({
      name: e.name,
      aliases: (aliasText[i] ?? "")
        .split(",")
        .map((a) => a.trim())
        .filter(Boolean),
    })),
  };

  return (
    <form action={action} className="space-y-6">
      <input type="hidden" name="payload" value={JSON.stringify(payload)} />

      <section aria-labelledby="tracks" className="card space-y-4">
        <h2 id="tracks" className="font-semibold">
          {t.preferences.tracksTitle}
        </h2>
        <div className="grid gap-4 md:grid-cols-2">
          {prefs.tracks.map((track, index) => (
            <div key={track.id} className="rounded-lg border border-sand-200 p-3">
              <label className="mb-2 flex items-center gap-2 font-medium">
                <input
                  type="checkbox"
                  checked={track.enabled}
                  onChange={(e) =>
                    setPrefs((p) => ({
                      ...p,
                      tracks: p.tracks.map((tr, i) => (i === index ? { ...tr, enabled: e.target.checked } : tr)),
                    }))
                  }
                />
                {t.preferences.tracks[track.id]}
              </label>
              <label htmlFor={`titles-${track.id}`} className="label">
                {t.preferences.titles}
              </label>
              <textarea
                id={`titles-${track.id}`}
                rows={5}
                className="input"
                value={titlesText[track.id]}
                onChange={(e) => setTitlesText((s) => ({ ...s, [track.id]: e.target.value }))}
              />
            </div>
          ))}
        </div>
      </section>

      <section aria-labelledby="constraints" className="card space-y-4">
        <h2 id="constraints" className="font-semibold">
          {t.preferences.constraintsTitle}
        </h2>
        <div className="grid gap-3 md:grid-cols-2">
          {constraintKeys.map((key) => (
            <ModeRadios
              key={key}
              name={`constraint-${key}`}
              legend={t.preferences.constraints[key]}
              value={prefs.constraints[key]}
              onChange={(mode) => setPrefs((p) => ({ ...p, constraints: { ...p.constraints, [key]: mode } }))}
            />
          ))}
        </div>
      </section>

      <div className="grid gap-6 lg:grid-cols-2">
        <section aria-labelledby="salary" className="card space-y-3">
          <h2 id="salary" className="font-semibold">
            {t.preferences.salaryTitle}
          </h2>
          <div>
            <label htmlFor="salary-min" className="label">
              {t.preferences.salaryMinimum}
            </label>
            <input
              id="salary-min"
              type="number"
              min={1}
              step={1000}
              inputMode="numeric"
              className="input"
              value={prefs.salary.minimumAnnualBase ?? ""}
              onChange={(e) =>
                setPrefs((p) => ({
                  ...p,
                  salary: { ...p.salary, minimumAnnualBase: e.target.value ? Number(e.target.value) : null },
                }))
              }
            />
            <p className="help">{t.preferences.salaryHelp}</p>
          </div>
          <ModeRadios
            name="salary-mode"
            legend={t.preferences.salaryTitle}
            value={prefs.salary.mode}
            onChange={(mode) => setPrefs((p) => ({ ...p, salary: { ...p.salary, mode } }))}
          />
          <div>
            <label htmlFor="start-date" className="label">
              {t.preferences.startDate}
            </label>
            <input
              id="start-date"
              type="date"
              className="input"
              value={prefs.earliestStartDate ?? ""}
              onChange={(e) => setPrefs((p) => ({ ...p, earliestStartDate: e.target.value || null }))}
            />
          </div>
        </section>

        <section aria-labelledby="locations" className="card space-y-3">
          <h2 id="locations" className="font-semibold">
            {t.preferences.locationsTitle}
          </h2>
          <div>
            <label htmlFor="locations-list" className="label">
              {t.preferences.locations}
            </label>
            <textarea
              id="locations-list"
              rows={3}
              className="input"
              value={locationsText}
              onChange={(e) => setLocationsText(e.target.value)}
            />
          </div>
          <div>
            <label htmlFor="commute" className="label">
              {t.preferences.commute}
            </label>
            <input
              id="commute"
              type="number"
              min={0}
              max={600}
              className="input"
              value={prefs.locations.maxOneWayCommuteMinutes ?? ""}
              onChange={(e) =>
                setPrefs((p) => ({
                  ...p,
                  locations: {
                    ...p.locations,
                    maxOneWayCommuteMinutes: e.target.value ? Number(e.target.value) : null,
                  },
                }))
              }
            />
          </div>
          <div>
            <label htmlFor="travel" className="label">
              {t.preferences.travel}
            </label>
            <select
              id="travel"
              className="input"
              value={prefs.locations.internationalTravel}
              onChange={(e) =>
                setPrefs((p) => ({
                  ...p,
                  locations: {
                    ...p.locations,
                    internationalTravel: e.target.value as Preferences["locations"]["internationalTravel"],
                  },
                }))
              }
            >
              {(["welcome", "limited", "no", "unspecified"] as const).map((v) => (
                <option key={v} value={v}>
                  {t.preferences.travelOptions[v]}
                </option>
              ))}
            </select>
          </div>
        </section>
      </div>

      <section aria-labelledby="sectors" className="card space-y-3">
        <h2 id="sectors" className="font-semibold">
          {t.preferences.sectorsTitle}
        </h2>
        <p className="help">{t.preferences.sectorsHelp}</p>
        {prefs.sectors.length > 0 && (
          <ul className="space-y-2">
            {prefs.sectors.map((sector, index) => (
              <li key={sector.name} className="flex flex-wrap items-center gap-2">
                <span className="min-w-40 font-medium">{sector.name}</span>
                <label className="sr-only" htmlFor={`sector-${index}`}>
                  {t.preferences.sectorPriority}
                </label>
                <select
                  id={`sector-${index}`}
                  className="input w-auto"
                  value={sector.priority}
                  onChange={(e) =>
                    setPrefs((p) => ({
                      ...p,
                      sectors: p.sectors.map((s, i) =>
                        i === index ? { ...s, priority: e.target.value as SectorPriority } : s,
                      ),
                    }))
                  }
                >
                  {sectorPriorities.map((prio) => (
                    <option key={prio} value={prio}>
                      {t.preferences.priorities[prio]}
                    </option>
                  ))}
                </select>
                <button
                  type="button"
                  className="btn-secondary"
                  onClick={() => setPrefs((p) => ({ ...p, sectors: p.sectors.filter((_, i) => i !== index) }))}
                >
                  {t.common.remove}
                </button>
              </li>
            ))}
          </ul>
        )}
        <div className="flex flex-wrap items-end gap-2">
          <div className="grow">
            <label htmlFor="new-sector" className="label">
              {t.preferences.sectorName}
            </label>
            <input
              id="new-sector"
              className="input"
              value={newSector}
              maxLength={120}
              onChange={(e) => setNewSector(e.target.value)}
            />
          </div>
          <button
            type="button"
            className="btn-secondary"
            onClick={() => {
              const name = newSector.trim();
              if (!name || prefs.sectors.some((s) => s.name.toLowerCase() === name.toLowerCase())) return;
              setPrefs((p) => ({ ...p, sectors: [...p.sectors, { name, priority: "neutral" }] }));
              setNewSector("");
            }}
          >
            {t.preferences.addSector}
          </button>
        </div>
      </section>

      <section aria-labelledby="excluded" className="card space-y-3">
        <h2 id="excluded" className="font-semibold">
          {t.preferences.excludedTitle}
        </h2>
        <p className="help">{t.preferences.excludedHelp}</p>
        {prefs.excludedEmployers.length > 0 && (
          <ul className="space-y-2">
            {prefs.excludedEmployers.map((employer, index) => (
              <li key={`${employer.name}-${index}`} className="grid items-end gap-2 md:grid-cols-[200px_1fr_auto]">
                <span className="font-medium">{employer.name}</span>
                <div>
                  <label htmlFor={`alias-${index}`} className="label">
                    {t.preferences.employerAliases}
                  </label>
                  <input
                    id={`alias-${index}`}
                    className="input"
                    value={aliasText[index] ?? ""}
                    onChange={(e) => setAliasText((a) => a.map((v, i) => (i === index ? e.target.value : v)))}
                  />
                </div>
                <button
                  type="button"
                  className="btn-secondary"
                  onClick={() => {
                    setPrefs((p) => ({ ...p, excludedEmployers: p.excludedEmployers.filter((_, i) => i !== index) }));
                    setAliasText((a) => a.filter((_, i) => i !== index));
                  }}
                >
                  {t.common.remove}
                </button>
              </li>
            ))}
          </ul>
        )}
        <div className="flex flex-wrap items-end gap-2">
          <div className="grow">
            <label htmlFor="new-employer" className="label">
              {t.preferences.employerName}
            </label>
            <input
              id="new-employer"
              className="input"
              value={newEmployer}
              maxLength={120}
              onChange={(e) => setNewEmployer(e.target.value)}
            />
          </div>
          <button
            type="button"
            className="btn-secondary"
            onClick={() => {
              const name = newEmployer.trim();
              if (!name) return;
              setPrefs((p) => ({ ...p, excludedEmployers: [...p.excludedEmployers, { name, aliases: [] }] }));
              setAliasText((a) => [...a, ""]);
              setNewEmployer("");
            }}
          >
            {t.preferences.addEmployer}
          </button>
        </div>
      </section>

      <section aria-labelledby="negative" className="card space-y-3">
        <h2 id="negative" className="font-semibold">
          {t.preferences.negativeTitle}
        </h2>
        <label htmlFor="negative-signals" className="help block">
          {t.preferences.negativeHelp}
        </label>
        <textarea
          id="negative-signals"
          rows={4}
          className="input"
          value={negativeText}
          onChange={(e) => setNegativeText(e.target.value)}
        />
      </section>

      <div className="sticky bottom-0 flex flex-wrap items-center gap-3 border-t border-sand-200 bg-sand-50/95 py-3">
        <button type="submit" className="btn-primary" disabled={pending}>
          {pending ? t.common.saving : t.common.save}
        </button>
        <span aria-live="polite" className="text-sm">
          {state.ok && state.savedAt && (
            <span className="text-teal-700">
              {t.common.saved} {formatDateTime(state.savedAt)}
            </span>
          )}
          {state.error && (
            <span role="alert" className="text-rose-800">
              {t.preferences.saveError}
            </span>
          )}
        </span>
      </div>
    </form>
  );
}
