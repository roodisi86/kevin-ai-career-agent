"use client";

import { useActionState } from "react";
import { getDictionary } from "@/lib/i18n";
import { deleteAllCandidateData, type DeleteState } from "./actions";

const t = getDictionary();

export function DeleteAllForm() {
  const [state, action, pending] = useActionState<DeleteState, FormData>(deleteAllCandidateData, {
    ok: false,
    error: null,
  });
  return (
    <form action={action} className="space-y-3">
      <div>
        <label htmlFor="confirm-delete" className="label">
          {t.settings.deleteConfirmLabel}
        </label>
        <input id="confirm-delete" name="confirm" autoComplete="off" className="input max-w-xs" />
      </div>
      <button type="submit" className="btn-danger" disabled={pending}>
        {t.settings.deleteButton}
      </button>
      <div aria-live="polite">
        {state.ok && <p className="text-sm text-teal-700">{t.settings.deleteDone}</p>}
        {state.error === "mismatch" && (
          <p role="alert" className="text-sm text-rose-800">
            {t.settings.deleteMismatch}
          </p>
        )}
        {(state.error === "db" || state.error === "storage") && (
          <p role="alert" className="text-sm text-rose-800">
            {t.common.error}
          </p>
        )}
      </div>
    </form>
  );
}
