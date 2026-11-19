"use client";

import { useActionState } from "react";
import { signIn, type LoginState } from "./actions";
import { getDictionary } from "@/lib/i18n";

const t = getDictionary();

export function LoginForm() {
  const [state, formAction, pending] = useActionState<LoginState, FormData>(signIn, { error: null });

  return (
    <form action={formAction} className="space-y-4" noValidate>
      <div>
        <label htmlFor="email" className="label">
          {t.login.email}
        </label>
        <input id="email" name="email" type="email" autoComplete="email" required className="input" />
      </div>
      <div>
        <label htmlFor="password" className="label">
          {t.login.password}
        </label>
        <input
          id="password"
          name="password"
          type="password"
          autoComplete="current-password"
          required
          className="input"
        />
      </div>
      {state.error && (
        <p role="alert" className="rounded-lg bg-rose-100 px-3 py-2 text-sm text-rose-800">
          {state.error === "invalid"
            ? t.login.invalid
            : state.error === "rate_limited"
              ? t.login.rateLimited
              : t.login.generic}
        </p>
      )}
      <button type="submit" className="btn-primary w-full" disabled={pending}>
        {pending ? t.login.submitting : t.login.submit}
      </button>
    </form>
  );
}
