import { getAppContext } from "@/lib/dal";
import { getDictionary } from "@/lib/i18n";
import { createSupabaseServerClient } from "@/lib/supabase/server";
import type { ApplicationEventRow, ApplicationRow, ApplicationStage } from "@/lib/supabase/database.types";
import { amsterdamDate, formatDateTime } from "@/lib/time";
import { createApplication, deleteApplication, moveApplication, updateApplication } from "./actions";

const t = getDictionary();
const a = t.applications;

const ACTIVE: ApplicationStage[] = ["prospect", "applied", "screening", "interviewing", "final_round", "offer", "on_hold"];
const CLOSED: ApplicationStage[] = ["accepted", "rejected", "withdrawn"];
const ALL = [...ACTIVE, ...CLOSED];
const CHANNELS = Object.keys(a.channel) as (keyof typeof a.channel)[];

function Fields({ app }: { app?: ApplicationRow }) {
  return (
    <div className="grid gap-3 md:grid-cols-2">
      <label className="block">
        <span className="label">{a.company}</span>
        <input name="companyName" required maxLength={200} defaultValue={app?.company_name} className="input" />
      </label>
      <label className="block">
        <span className="label">{a.role}</span>
        <input name="roleTitle" required maxLength={300} defaultValue={app?.role_title} className="input" />
      </label>
      <label className="block">
        <span className="label">{a.stageLabel}</span>
        <select name="stage" defaultValue={app?.stage ?? "applied"} className="input">
          {ALL.map((s) => (
            <option key={s} value={s}>{a.stage[s]}</option>
          ))}
        </select>
      </label>
      <label className="block">
        <span className="label">{a.channelLabel}</span>
        <select name="channel" defaultValue={app?.channel ?? "unknown"} className="input">
          {CHANNELS.map((c) => (
            <option key={c} value={c}>{a.channel[c]}</option>
          ))}
        </select>
      </label>
      <label className="block">
        <span className="label">{a.contact}</span>
        <input name="contactName" maxLength={200} defaultValue={app?.contact_name ?? ""} className="input" />
      </label>
      <label className="block">
        <span className="label">{a.jobUrl}</span>
        <input name="jobUrl" type="url" maxLength={2000} defaultValue={app?.job_url ?? ""} className="input" />
      </label>
      <label className="block">
        <span className="label">{a.appliedOn}</span>
        <input name="appliedOn" type="date" defaultValue={app?.applied_on ?? ""} className="input" />
      </label>
      <div className="grid grid-cols-[1fr_auto] gap-2">
        <label className="block">
          <span className="label">{a.nextAction}</span>
          <input name="nextAction" maxLength={300} defaultValue={app?.next_action ?? ""} className="input" />
        </label>
        <label className="block">
          <span className="label">{a.nextActionDue}</span>
          <input name="nextActionDue" type="date" defaultValue={app?.next_action_due ?? ""} className="input" />
        </label>
      </div>
      <label className="block md:col-span-2">
        <span className="label">{a.notes}</span>
        <textarea name="notes" rows={3} maxLength={4000} defaultValue={app?.notes ?? ""} className="input" />
      </label>
    </div>
  );
}

function DueBadge({ due, today }: { due: string; today: string }) {
  if (due < today) return <span className="badge bg-rose-100 text-rose-800">{a.overdue}</span>;
  if (due === today) return <span className="badge bg-amber-100 text-amber-800">{a.dueToday}</span>;
  return null;
}

function Card({ app, events, today }: { app: ApplicationRow; events: ApplicationEventRow[]; today: string }) {
  return (
    <li id={`app-${app.id}`} className="card space-y-2" data-testid="application">
      <div className="flex flex-wrap items-start justify-between gap-2">
        <div>
          <p className="font-semibold">{app.role_title}</p>
          <p className="text-sm text-navy-600">
            {app.company_name} · {a.channel[app.channel]}
            {app.contact_name ? ` · ${app.contact_name}` : ""}
            {app.applied_on ? ` · ${a.appliedOn.toLowerCase()} ${app.applied_on}` : ""}
          </p>
        </div>
        <form action={moveApplication} className="flex items-center gap-2">
          <input type="hidden" name="id" value={app.id} />
          <label className="sr-only" htmlFor={`stage-${app.id}`}>{a.stageLabel}</label>
          <select id={`stage-${app.id}`} name="stage" defaultValue={app.stage} className="input py-1 text-sm">
            {ALL.map((s) => (
              <option key={s} value={s}>{a.stage[s]}</option>
            ))}
          </select>
          <button type="submit" className="btn-secondary py-1 text-sm">{a.save}</button>
        </form>
      </div>
      {app.next_action && (
        <p className="text-sm">
          <span className="font-medium">{a.nextAction}: </span>
          {app.next_action}
          {app.next_action_due && (
            <span className="text-navy-600"> · {app.next_action_due} </span>
          )}
          {app.next_action_due && <DueBadge due={app.next_action_due} today={today} />}
        </p>
      )}
      {app.notes && <p className="whitespace-pre-line text-sm text-navy-600">{app.notes}</p>}
      <div className="flex flex-wrap gap-3 text-xs">
        {app.job_url && (
          <a href={app.job_url} target="_blank" rel="noopener noreferrer" className="underline">{a.viewJob}</a>
        )}
      </div>
      <details>
        <summary className="cursor-pointer text-sm underline">{a.edit}</summary>
        <form action={updateApplication} className="mt-3 space-y-3">
          <input type="hidden" name="id" value={app.id} />
          <Fields app={app} />
          <button type="submit" className="btn-primary">{a.save}</button>
        </form>
        <form action={deleteApplication} className="mt-3 flex flex-wrap items-end gap-2">
          <input type="hidden" name="id" value={app.id} />
          <label className="block">
            <span className="label">{a.removeConfirm}</span>
            <input name="confirm" className="input" autoComplete="off" />
          </label>
          <button type="submit" className="btn-danger">{a.remove}</button>
        </form>
        {events.length > 0 && (
          <div className="mt-3">
            <p className="text-sm font-medium">{a.history}</p>
            <ul className="text-xs text-navy-600">
              {events.map((e) => {
                const meta = (e.metadata_json ?? {}) as { from?: ApplicationStage; to?: ApplicationStage; stage?: ApplicationStage };
                return (
                  <li key={e.id}>
                    {formatDateTime(e.event_time)} · {a.event[e.event_type] ?? e.event_type}
                    {meta.from && meta.to ? `: ${a.stage[meta.from]} → ${a.stage[meta.to]}` : meta.stage ? `: ${a.stage[meta.stage]}` : ""}
                  </li>
                );
              })}
            </ul>
          </div>
        )}
      </details>
    </li>
  );
}

export default async function ApplicationsPage({ searchParams }: { searchParams: Promise<Record<string, string | string[] | undefined>> }) {
  const ctx = await getAppContext();
  const params = await searchParams;
  const status = typeof params.status === "string" ? params.status : null;
  const supabase = await createSupabaseServerClient();
  const [{ data: apps }, { data: events }] = await Promise.all([
    supabase.from("applications").select("*").eq("tenant_id", ctx.tenantId).order("updated_at", { ascending: false }),
    supabase.from("application_events").select("*").eq("tenant_id", ctx.tenantId).order("event_time", { ascending: true }).limit(1000),
  ]);
  const eventsByApp = new Map<string, ApplicationEventRow[]>();
  for (const e of events ?? []) eventsByApp.set(e.application_id, [...(eventsByApp.get(e.application_id) ?? []), e]);
  const today = amsterdamDate();
  const list = apps ?? [];
  const active = list.filter((x) => ACTIVE.includes(x.stage));
  const closed = list.filter((x) => CLOSED.includes(x.stage));

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-2xl font-semibold">{a.title}</h1>
        <p className="max-w-3xl text-sm text-navy-600">{a.intro}</p>
      </div>

      {status && (
        <p className="card text-sm" role="status">
          {status === "added" ? a.added : status === "saved" ? a.saved : a.errors[status] ?? t.common.error}
        </p>
      )}

      {list.length === 0 && <p className="card text-sm">{a.empty}</p>}

      {ACTIVE.map((stage) => {
        const items = active.filter((x) => x.stage === stage);
        if (items.length === 0) return null;
        return (
          <section key={stage} aria-labelledby={`stage-h-${stage}`} className="space-y-2">
            <h2 id={`stage-h-${stage}`} className="font-semibold">
              {a.stage[stage]} <span className="text-sm font-normal text-navy-600">({items.length})</span>
            </h2>
            <ul className="space-y-2">
              {items.map((app) => (
                <Card key={`${app.id}-${app.updated_at}`} app={app} events={eventsByApp.get(app.id) ?? []} today={today} />
              ))}
            </ul>
          </section>
        );
      })}

      {closed.length > 0 && (
        <details className="space-y-2">
          <summary className="cursor-pointer font-semibold">
            {a.closedTitle} ({closed.length})
          </summary>
          <ul className="mt-2 space-y-2">
            {closed.map((app) => (
              <Card key={`${app.id}-${app.updated_at}`} app={app} events={eventsByApp.get(app.id) ?? []} today={today} />
            ))}
          </ul>
        </details>
      )}

      <section aria-labelledby="add-app" className="card space-y-3">
        <h2 id="add-app" className="font-semibold">{a.addTitle}</h2>
        <form action={createApplication} className="space-y-3">
          <Fields />
          <button type="submit" className="btn-primary">{a.add}</button>
        </form>
      </section>
    </div>
  );
}
