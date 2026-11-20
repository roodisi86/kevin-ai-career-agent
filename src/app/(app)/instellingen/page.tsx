import { getAppContext } from "@/lib/dal";
import { getDictionary } from "@/lib/i18n";
import { getPublicEnv, getServerEnv, isAiConfigured } from "@/lib/env";
import { createSupabaseServerClient } from "@/lib/supabase/server";
import { formatDateTime } from "@/lib/time";
import { DeleteAllForm } from "./delete-form";
import { GrokTokenForm } from "./grok-token-form";
import { revokeImportToken } from "./actions";
import { CopyButton } from "../copy-button";

const t = getDictionary();

export default async function SettingsPage() {
  const ctx = await getAppContext();
  const supabase = await createSupabaseServerClient();
  const { data: events } = await supabase
    .from("audit_events")
    .select("id, action, resource_type, occurred_at")
    .eq("tenant_id", ctx.tenantId)
    .order("occurred_at", { ascending: false })
    .limit(50);
  const env = getServerEnv();
  const [{ data: tokens }, { data: leadRows }] = await Promise.all([
    supabase
      .from("import_tokens")
      .select("id, label, token_prefix, use_count, last_used_at, revoked_at, created_at")
      .eq("tenant_id", ctx.tenantId)
      .order("created_at", { ascending: false }),
    supabase.from("job_leads").select("status").eq("tenant_id", ctx.tenantId).limit(5000),
  ]);
  const leadCount = (s: string) => (leadRows ?? []).filter((l) => l.status === s).length;
  // The Netlify site sits behind visitor-access protection, so Grok Bot talks to
  // the database function directly: the publishable key is public by design and
  // submit_job_leads() checks the import key, caps volume and only adds leads.
  const pub = getPublicEnv();
  const endpoint = `${pub.NEXT_PUBLIC_SUPABASE_URL}/rest/v1/rpc/submit_job_leads`;
  const grokInstruction = [
    "When you have the list, send it to my Career Agent (do this every run):",
    `POST ${endpoint}`,
    `Header: apikey: ${pub.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY}`,
    "Header: Content-Type: application/json",
    'Body: {"p_token":"<the import key I gave you via a secure secret card — never print it>","p_leads":[{"title":"…","company":"…","url":"original job URL","location":"…","posted":"…","salary":"only if stated","contract":"only if stated","reason":"one line why it fits","description":"the vacancy text exactly as shown on the job page (max 20000 characters)"}]}',
    "Max 25 jobs per request. The reply is {\"accepted\":n,\"duplicates\":n,\"rejected\":n}. A 403 with \"invalid token\" means the key is wrong or revoked. If it fails, mention that in your report; do not retry more than once.",
  ].join("\n");

  return (
    <div className="space-y-6">
      <h1 className="text-2xl font-semibold">{t.settings.title}</h1>

      <div className="grid gap-6 lg:grid-cols-2">
        <section aria-labelledby="account" className="card">
          <h2 id="account" className="mb-3 font-semibold">
            {t.settings.account}
          </h2>
          <dl className="space-y-1 text-sm">
            <div>
              <dt className="inline font-medium">{t.settings.signedInAs}: </dt>
              <dd className="inline">{ctx.email ?? t.common.unknown}</dd>
            </div>
            <div>
              <dt className="inline font-medium">{t.settings.workspace}: </dt>
              <dd className="inline">{ctx.tenantName}</dd>
            </div>
          </dl>
        </section>

        <section aria-labelledby="ai" className="card">
          <h2 id="ai" className="mb-3 font-semibold">
            {t.settings.aiTitle}
          </h2>
          <p className="text-sm text-navy-600">
            {isAiConfigured() ? t.dashboard.aiConfigured : t.dashboard.aiNotConfigured}
          </p>
          <dl className="mt-2 space-y-1 text-sm">
            <div>
              <dt className="inline font-medium">{t.settings.aiModel}: </dt>
              <dd className="inline">{env.ANTHROPIC_MODEL}</dd>
            </div>
            <div>
              <dt className="inline font-medium">{t.settings.aiCap}: </dt>
              <dd className="inline">{env.AI_DAILY_REQUEST_CAP}</dd>
            </div>
          </dl>
        </section>
      </div>

      <section aria-labelledby="grok" className="card space-y-3">
        <h2 id="grok" className="font-semibold">{t.grok.title}</h2>
        <p className="max-w-3xl text-sm text-navy-600">{t.grok.intro}</p>
        <GrokTokenForm />
        <div>
          <h3 className="text-sm font-medium">{t.grok.keys}</h3>
          {(tokens ?? []).length === 0 ? (
            <p className="text-sm text-navy-600">{t.grok.noKeys}</p>
          ) : (
            <ul className="space-y-1 text-sm">
              {(tokens ?? []).map((k) => (
                <li key={k.id} className="flex flex-wrap items-center gap-2">
                  <span className="font-medium">{k.label}</span>
                  <code className="text-xs">{k.token_prefix}…</code>
                  <span className="text-navy-600">
                    {t.grok.lastUsed}: {k.last_used_at ? formatDateTime(k.last_used_at) : t.grok.never} · {t.grok.uses(k.use_count)}
                  </span>
                  {k.revoked_at ? (
                    <span className="badge bg-rose-100 text-rose-800">{t.grok.revoked}</span>
                  ) : (
                    <form action={revokeImportToken}>
                      <input type="hidden" name="id" value={k.id} />
                      <button type="submit" className="text-xs underline">{t.grok.revoke}</button>
                    </form>
                  )}
                </li>
              ))}
            </ul>
          )}
          <p className="mt-1 text-xs text-navy-600" data-testid="lead-stats">
            {t.grok.leads(leadCount("pending"), leadCount("imported") + leadCount("duplicate"), leadCount("rejected"))}
          </p>
        </div>
        <div>
          <div className="flex flex-wrap items-center justify-between gap-2">
            <h3 className="text-sm font-medium">{t.grok.instructionTitle}</h3>
            <CopyButton text={grokInstruction} label={t.grok.copy} copiedLabel={t.grok.copied} />
          </div>
          <pre className="mt-1 whitespace-pre-wrap rounded-lg bg-sand-100 p-3 text-xs">{grokInstruction}</pre>
          <p className="text-xs text-navy-600">{t.grok.endpoint}: <code>{endpoint}</code></p>
        </div>
      </section>

      <section aria-labelledby="export" className="card">
        <h2 id="export" className="mb-1 font-semibold">
          {t.settings.exportTitle}
        </h2>
        <p className="mb-3 text-sm text-navy-600">{t.settings.exportHelp}</p>
        <a href="/api/export" className="btn-primary" download>
          {t.settings.exportButton}
        </a>
      </section>

      <section aria-labelledby="delete" className="card border-rose-800/30">
        <h2 id="delete" className="mb-1 font-semibold text-rose-800">
          {t.settings.deleteTitle}
        </h2>
        <p className="mb-3 max-w-3xl text-sm text-navy-600">{t.settings.deleteHelp}</p>
        <DeleteAllForm />
      </section>

      <section aria-labelledby="audit" className="card">
        <h2 id="audit" className="mb-3 font-semibold">
          {t.settings.auditTitle}
        </h2>
        {!events || events.length === 0 ? (
          <p className="text-sm text-navy-600">{t.settings.auditEmpty}</p>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full text-left text-sm">
              <tbody>
                {events.map((event) => (
                  <tr key={event.id} className="border-t border-sand-200">
                    <td className="whitespace-nowrap py-2 pr-4 text-navy-600">{formatDateTime(event.occurred_at)}</td>
                    <td className="py-2 pr-4 font-mono text-xs">{event.action}</td>
                    <td className="py-2 text-navy-600">{event.resource_type}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </section>
    </div>
  );
}
