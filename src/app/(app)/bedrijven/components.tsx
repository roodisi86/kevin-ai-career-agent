"use client";

import { useActionState, useState } from "react";
import { useRouter } from "next/navigation";
import { getDictionary } from "@/lib/i18n";
import { addCompany, type AddCompanyState } from "./actions";

const t = getDictionary();

export function AddCompanyForm() {
  const [state, action, pending] = useActionState<AddCompanyState, FormData>(addCompany, { ok: false, code: null });
  return (
    <form action={action} className="grid gap-3 md:grid-cols-[1fr_1fr_1.4fr_auto] md:items-end">
      <div>
        <label htmlFor="company-name" className="label">{t.companies.name}</label>
        <input id="company-name" name="name" required maxLength={200} className="input" />
      </div>
      <div>
        <label htmlFor="company-sector" className="label">{t.companies.sector}</label>
        <input id="company-sector" name="sector" maxLength={120} className="input" />
      </div>
      <div>
        <label htmlFor="company-url" className="label">{t.companies.careersUrl}</label>
        <input id="company-url" name="url" type="url" maxLength={500} className="input" placeholder="https://jobs.smartrecruiters.com/…" />
      </div>
      <button type="submit" className="btn-primary" disabled={pending}>{pending ? t.common.saving : t.companies.add}</button>
      <p className="help md:col-span-4">{t.companies.careersUrlHelp}</p>
      <div aria-live="polite" className="md:col-span-4">
        {state.ok && <p className="text-sm text-teal-700">{t.common.saved}</p>}
        {state.code === "url_not_supported" && <p role="alert" className="text-sm text-rose-800">{t.companies.urlNotSupported}</p>}
        {(state.code === "invalid" || state.code === "db") && <p role="alert" className="text-sm text-rose-800">{t.common.error}</p>}
      </div>
    </form>
  );
}

async function verify(id: string, url?: string): Promise<boolean> {
  const response = await fetch(`/api/companies/${id}/verify`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(url ? { url } : {}),
  });
  return response.ok;
}

export function VerifyButton({ id }: { id: string }) {
  const router = useRouter();
  const [busy, setBusy] = useState(false);
  const [failed, setFailed] = useState(false);
  return (
    <span className="inline-flex items-center gap-2">
      <button
        type="button"
        className="btn-secondary"
        disabled={busy}
        onClick={async () => {
          setBusy(true);
          setFailed(!(await verify(id)));
          setBusy(false);
          router.refresh();
        }}
      >
        {busy ? t.companies.verifying : t.companies.verify}
      </button>
      {failed && <span role="alert" className="text-sm text-rose-800">{t.common.error}</span>}
    </span>
  );
}

export function VerifyAllButton({ ids }: { ids: string[] }) {
  const router = useRouter();
  const [progress, setProgress] = useState<{ done: number; total: number } | null>(null);
  if (ids.length === 0) return null;
  return (
    <div className="flex flex-wrap items-center gap-3">
      <button
        type="button"
        className="btn-teal"
        disabled={progress !== null}
        onClick={async () => {
          setProgress({ done: 0, total: ids.length });
          for (let i = 0; i < ids.length; i++) {
            await verify(ids[i]).catch(() => false);
            setProgress({ done: i + 1, total: ids.length });
          }
          setProgress(null);
          router.refresh();
        }}
      >
        {t.companies.verifyAll} ({ids.length})
      </button>
      <span aria-live="polite" className="text-sm text-navy-600">
        {progress && t.companies.verifyAllRunning(progress.done, progress.total)}
      </span>
    </div>
  );
}
