"use client";

import { useActionState, useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { getDictionary } from "@/lib/i18n";
import type { ContactRow, OutreachDraftRow } from "@/lib/supabase/database.types";
import { formatDateTime } from "@/lib/time";
import { addContact, changeDraftState, saveDraft, type ActionResult } from "./actions";

const t = getDictionary();
const o = t.outreach;

const STATE_STYLE: Record<string, string> = {
  draft: "bg-sand-200 text-navy-800",
  reviewed: "bg-amber-100 text-amber-800",
  approved: "bg-teal-600 text-white",
  sent: "bg-navy-800 text-white",
  replied: "bg-teal-100 text-teal-700",
  no_reply: "bg-sand-200 text-navy-600",
  closed: "bg-sand-200 text-navy-600",
};

export function DraftEditor({ draft, contacts }: { draft: OutreachDraftRow; contacts: ContactRow[] }) {
  const router = useRouter();
  const [subject, setSubject] = useState(draft.subject);
  const [body, setBody] = useState(draft.body);
  const [language, setLanguage] = useState(draft.language);
  const [contactId, setContactId] = useState<string | null>(draft.contact_id);
  const [ack, setAck] = useState(false);
  const [message, setMessage] = useState<string | null>(null);
  const [pending, startTransition] = useTransition();
  const [copied, setCopied] = useState(false);

  const locked = ["sent", "replied", "no_reply", "closed"].includes(draft.state);
  const dirty =
    subject !== draft.subject || body !== draft.body || language !== draft.language || contactId !== draft.contact_id;
  const approved = draft.state === "approved" && !dirty;
  const contact = contacts.find((c) => c.id === draft.contact_id) ?? null;
  const evidence = ((draft.evidence_json as { facts?: { id: string; statement: string }[]; followUpAfterDays?: number | null }) ?? {});

  const run = (fn: () => Promise<ActionResult>) =>
    startTransition(async () => {
      setMessage(null);
      const result = await fn();
      if (!result.ok) setMessage(result.error === "state" || result.error === "warnings" ? o.stateError : t.common.error);
      router.refresh();
    });

  const setState = (state: OutreachDraftRow["state"]) =>
    run(() => changeDraftState({ id: draft.id, state, acknowledgedWarnings: ack }));

  async function copy() {
    await navigator.clipboard.writeText(subject ? `${subject}\n\n${body}` : body);
    setCopied(true);
    setTimeout(() => setCopied(false), 2000);
  }

  return (
    <article className="space-y-3 rounded-lg border border-sand-200 p-4" data-testid="draft" aria-label={o.kind[draft.kind]}>
      <div className="flex flex-wrap items-center gap-2">
        <h4 className="font-medium">{o.kind[draft.kind]}</h4>
        <span className={`badge ${STATE_STYLE[draft.state]}`} data-testid="draft-state">{o.state[draft.state]}</span>
        <span className="text-xs text-navy-600">{o.version(draft.version)}</span>
        {draft.approved_at && draft.approved_version && (
          <span className="text-xs text-teal-700">{o.approvedVersion(draft.approved_version, formatDateTime(draft.approved_at))}</span>
        )}
        {draft.kind === "follow_up" && evidence.followUpAfterDays ? (
          <span className="text-xs text-navy-600">{o.followUpAfter(evidence.followUpAfterDays)}</span>
        ) : null}
      </div>

      <div className="grid gap-3 md:grid-cols-2">
        <div>
          <label htmlFor={`rcpt-${draft.id}`} className="label">{o.recipient}</label>
          <select
            id={`rcpt-${draft.id}`}
            className="input"
            disabled={locked}
            value={contactId ?? ""}
            onChange={(e) => setContactId(e.target.value || null)}
          >
            <option value="">{o.noRecipient}</option>
            {contacts.map((c) => (
              <option key={c.id} value={c.id}>
                {c.name}
                {c.role ? ` – ${c.role}` : ""}
              </option>
            ))}
          </select>
        </div>
        <div>
          <label htmlFor={`lang-${draft.id}`} className="label">{o.language}</label>
          <select
            id={`lang-${draft.id}`}
            className="input"
            disabled={locked}
            value={language}
            onChange={(e) => setLanguage(e.target.value as OutreachDraftRow["language"])}
          >
            {Object.entries(o.languages).map(([code, label]) => (
              <option key={code} value={code}>{label}</option>
            ))}
          </select>
        </div>
      </div>
      <div>
        <label htmlFor={`subj-${draft.id}`} className="label">{o.subject}</label>
        <input id={`subj-${draft.id}`} className="input" disabled={locked} value={subject} maxLength={300} onChange={(e) => setSubject(e.target.value)} />
      </div>
      <div>
        <label htmlFor={`body-${draft.id}`} className="label">{o.body}</label>
        <textarea id={`body-${draft.id}`} rows={9} className="input" disabled={locked} value={body} maxLength={6000} onChange={(e) => setBody(e.target.value)} />
      </div>

      {draft.warnings.length > 0 && (
        <div className="rounded-lg bg-amber-100 p-3 text-sm text-amber-800" role="alert">
          <p className="font-medium">{o.warningsTitle}</p>
          <ul className="ml-5 list-disc">
            {draft.warnings.map((w, i) => (
              <li key={i}>{w}</li>
            ))}
          </ul>
          {draft.state === "reviewed" && (
            <label className="mt-2 flex items-center gap-2">
              <input type="checkbox" checked={ack} onChange={(e) => setAck(e.target.checked)} />
              {o.warningsAck}
            </label>
          )}
        </div>
      )}

      {(evidence.facts ?? []).length > 0 && (
        <details className="text-sm">
          <summary className="cursor-pointer">{o.evidence}</summary>
          <ul className="ml-5 mt-1 list-disc text-navy-800">
            {evidence.facts!.map((f) => (
              <li key={f.id}>{f.statement}</li>
            ))}
          </ul>
        </details>
      )}

      <div className="flex flex-wrap items-center gap-2">
        {!locked && dirty && (
          <button
            type="button"
            className="btn-primary"
            disabled={pending}
            onClick={() => run(() => saveDraft({ id: draft.id, subject, body, language, contactId }))}
          >
            {o.save}
          </button>
        )}
        {!dirty && draft.state === "draft" && (
          <button type="button" className="btn-secondary" disabled={pending} onClick={() => setState("reviewed")}>
            {o.markReviewed}
          </button>
        )}
        {!dirty && draft.state === "reviewed" && (
          <>
            <button
              type="button"
              className="btn-teal"
              disabled={pending || (draft.warnings.length > 0 && !ack)}
              onClick={() => setState("approved")}
            >
              {o.approve}
            </button>
            <button type="button" className="btn-secondary" disabled={pending} onClick={() => setState("draft")}>
              {o.backToDraft}
            </button>
          </>
        )}
        {approved && (
          <>
            <button type="button" className="btn-secondary" onClick={copy}>
              {copied ? o.copied : o.copy}
            </button>
            {contact?.email && (
              <a
                className="btn-secondary"
                href={`mailto:${encodeURIComponent(contact.email)}?subject=${encodeURIComponent(subject)}&body=${encodeURIComponent(body)}`}
              >
                {o.openMail}
              </a>
            )}
            <button type="button" className="btn-primary" disabled={pending} onClick={() => setState("sent")}>
              {o.markSent}
            </button>
            <button type="button" className="btn-secondary" disabled={pending} onClick={() => setState("draft")}>
              {o.backToDraft}
            </button>
          </>
        )}
        {draft.state === "sent" && (
          <>
            <button type="button" className="btn-secondary" onClick={copy}>{copied ? o.copied : o.copy}</button>
            <button type="button" className="btn-secondary" disabled={pending} onClick={() => setState("replied")}>{o.markReplied}</button>
            <button type="button" className="btn-secondary" disabled={pending} onClick={() => setState("no_reply")}>{o.markNoReply}</button>
          </>
        )}
        {(draft.state === "replied" || draft.state === "no_reply") && (
          <>
            {draft.state === "no_reply" && (
              <button type="button" className="btn-secondary" disabled={pending} onClick={() => setState("replied")}>{o.markReplied}</button>
            )}
            <button type="button" className="btn-secondary" disabled={pending} onClick={() => setState("closed")}>{o.close}</button>
          </>
        )}
      </div>
      {!approved && !locked && <p className="help">{dirty ? o.saveResets : o.copyOnlyApproved}</p>}
      {draft.state === "approved" && <p className="help">{o.neverSends}</p>}
      <p aria-live="polite" className="text-sm text-rose-800">{message}</p>
    </article>
  );
}

export function AddContactForm({ jobId }: { jobId: string }) {
  const [state, action, pending] = useActionState<ActionResult, FormData>(addContact, { ok: false, error: null });
  return (
    <details className="text-sm">
      <summary className="cursor-pointer font-medium">{o.addContact}</summary>
      <form action={action} className="mt-2 grid gap-2 md:grid-cols-2">
        <input type="hidden" name="jobId" value={jobId} />
        <div>
          <label className="label" htmlFor={`c-name-${jobId}`}>{o.contactName}</label>
          <input id={`c-name-${jobId}`} name="name" required minLength={2} maxLength={200} className="input" />
        </div>
        <div>
          <label className="label" htmlFor={`c-role-${jobId}`}>{o.contactRole}</label>
          <input id={`c-role-${jobId}`} name="role" maxLength={200} className="input" />
        </div>
        <div>
          <label className="label" htmlFor={`c-org-${jobId}`}>{o.contactOrg}</label>
          <input id={`c-org-${jobId}`} name="organisation" maxLength={200} className="input" />
        </div>
        <div>
          <label className="label" htmlFor={`c-email-${jobId}`}>{o.contactEmail}</label>
          <input id={`c-email-${jobId}`} name="email" type="email" maxLength={200} className="input" />
        </div>
        <div className="md:col-span-2">
          <label className="label" htmlFor={`c-src-${jobId}`}>{o.contactSource}</label>
          <input id={`c-src-${jobId}`} name="sourceUrl" type="url" maxLength={500} className="input" />
        </div>
        <div className="md:col-span-2 flex items-center gap-3">
          <button type="submit" className="btn-secondary" disabled={pending}>{o.addContact}</button>
          {state.error && <span className="text-rose-800">{t.common.error}</span>}
        </div>
      </form>
    </details>
  );
}
