"use client";

import { useActionState } from "react";
import { getDictionary } from "@/lib/i18n";
import { CopyButton } from "../copy-button";
import { createImportToken, type TokenState } from "./actions";

const g = getDictionary().grok;

export function GrokTokenForm() {
  const [state, action, pending] = useActionState<TokenState, FormData>(createImportToken, { token: null, error: null });
  return (
    <div className="space-y-3">
      <form action={action} className="flex flex-wrap items-end gap-2">
        <label className="block">
          <span className="label">{g.label}</span>
          <input name="label" defaultValue={g.defaultLabel} maxLength={80} className="input" />
        </label>
        <button type="submit" className="btn-primary" disabled={pending}>{g.create}</button>
      </form>
      {state.token && (
        <div className="rounded-lg bg-amber-100 p-3 text-sm" role="status" data-testid="new-import-token">
          <p className="font-medium">{g.once}</p>
          <div className="mt-2 flex flex-wrap items-center gap-2">
            <code className="break-all rounded bg-white px-2 py-1 text-xs">{state.token}</code>
            <CopyButton text={state.token} label={g.copy} copiedLabel={g.copied} />
          </div>
        </div>
      )}
      {state.error && <p className="text-sm text-rose-800">{getDictionary().common.error}</p>}
    </div>
  );
}
