import { getAppContext } from "@/lib/dal";
import { getDictionary } from "@/lib/i18n";
import { getServerEnv, isAiConfigured } from "@/lib/env";
import { createSupabaseServerClient } from "@/lib/supabase/server";
import { formatDateTime } from "@/lib/time";
import { DeleteAllForm } from "./delete-form";

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
