-- Phase 5: private pilot.
-- * applications + application_events: Kevin's own application pipeline.
-- * daily_digests: one stored digest per tenant per day (Europe/Amsterdam date),
--   idempotent so a retried scheduled run never creates a second digest.
-- * signal_requests + company_signals: weekly "Hidden Opportunities" research
--   (answered by the scheduled Claude task, verified by the app).
-- Everything is tenant-scoped with RLS.

-- ---------------------------------------------------------------------------
-- Company watch list for signals
-- ---------------------------------------------------------------------------

alter table public.company_targets
  add column watch_signals boolean not null default false,
  add column signals_checked_at timestamptz;

-- ---------------------------------------------------------------------------
-- Hidden Opportunities
-- ---------------------------------------------------------------------------

create table public.signal_requests (
  id uuid primary key default gen_random_uuid(),
  tenant_id uuid not null references public.tenants (id) on delete cascade,
  -- ISO week (e.g. 2026-W47) or 'manual-<timestamp>': one scheduled batch per week.
  batch_key text not null check (batch_key ~ '^(\d{4}-W\d{2}-\d{1,2}|manual-\d{8,14})$'),
  prompt_text text not null check (length(prompt_text) between 1 and 40000),
  -- C1 -> company_target id, so answers map back to the right company.
  target_refs_json jsonb not null default '{}'::jsonb,
  status text not null default 'pending' check (status in ('pending', 'answered', 'processed', 'rejected')),
  output_json jsonb,
  result_counts jsonb not null default '{}'::jsonb,
  error text check (error is null or length(error) <= 200),
  answered_at timestamptz,
  processed_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (tenant_id, batch_key)
);

create table public.company_signals (
  id uuid primary key default gen_random_uuid(),
  tenant_id uuid not null references public.tenants (id) on delete cascade,
  company_target_id uuid not null references public.company_targets (id) on delete cascade,
  request_id uuid references public.signal_requests (id) on delete set null,
  signal_type text not null check (signal_type in (
    'leadership_change', 'expansion', 'market_entry', 'acquisition', 'funding',
    'restructuring', 'partnership', 'hiring', 'other'
  )),
  headline text not null check (length(headline) between 1 and 300),
  summary text check (summary is null or length(summary) <= 1000),
  relevance text check (relevance is null or length(relevance) <= 600),
  suggested_action text check (suggested_action is null or length(suggested_action) <= 400),
  source_url text not null check (source_url ~ '^https://' and length(source_url) <= 2000),
  source_title text check (source_title is null or length(source_title) <= 300),
  published_on date,
  verification_status text not null default 'unverified'
    check (verification_status in ('unverified', 'source_checked', 'source_mismatch')),
  user_state text not null default 'new' check (user_state in ('new', 'useful', 'dismissed')),
  dedupe_key text not null check (dedupe_key ~ '^[a-f0-9]{32}$'),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (tenant_id, dedupe_key)
);

create index company_signals_tenant_time_idx on public.company_signals (tenant_id, created_at desc);
create index company_signals_target_idx on public.company_signals (company_target_id);

-- ---------------------------------------------------------------------------
-- Application pipeline
-- ---------------------------------------------------------------------------

create table public.applications (
  id uuid primary key default gen_random_uuid(),
  tenant_id uuid not null references public.tenants (id) on delete cascade,
  candidate_id uuid not null references public.candidate_profiles (id) on delete cascade,
  job_id uuid references public.jobs (id) on delete set null,
  company_target_id uuid references public.company_targets (id) on delete set null,
  signal_id uuid references public.company_signals (id) on delete set null,
  company_name text not null check (length(company_name) between 1 and 200),
  role_title text not null check (length(role_title) between 1 and 300),
  stage text not null default 'prospect' check (stage in (
    'prospect', 'applied', 'screening', 'interviewing', 'final_round', 'offer',
    'accepted', 'rejected', 'withdrawn', 'on_hold'
  )),
  channel text not null default 'unknown' check (channel in (
    'direct', 'recruiter', 'referral', 'reverse_recruiting', 'agency', 'other', 'unknown'
  )),
  contact_name text check (contact_name is null or length(contact_name) <= 200),
  job_url text check (job_url is null or (job_url ~ '^https?://' and length(job_url) <= 2000)),
  applied_on date,
  next_action text check (next_action is null or length(next_action) <= 300),
  next_action_due date,
  notes text check (notes is null or length(notes) <= 4000),
  closed_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create index applications_tenant_stage_idx on public.applications (tenant_id, stage);
create index applications_job_idx on public.applications (job_id);

create table public.application_events (
  id uuid primary key default gen_random_uuid(),
  tenant_id uuid not null references public.tenants (id) on delete cascade,
  application_id uuid not null references public.applications (id) on delete cascade,
  event_type text not null check (length(event_type) between 1 and 50),
  actor_id uuid,
  metadata_json jsonb not null default '{}'::jsonb,
  event_time timestamptz not null default now()
);

create index application_events_app_idx on public.application_events (application_id, event_time);

create or replace function app_private.track_application()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  if new.stage in ('accepted', 'rejected', 'withdrawn') then
    if tg_op = 'INSERT' or old.stage not in ('accepted', 'rejected', 'withdrawn') then
      new.closed_at := now();
    end if;
  else
    new.closed_at := null;
  end if;
  if new.applied_on is null and new.stage not in ('prospect', 'on_hold') and (tg_op = 'INSERT' or old.stage = 'prospect') then
    new.applied_on := (now() at time zone 'Europe/Amsterdam')::date;
  end if;
  return new;
end;
$$;

create or replace function app_private.log_application_event()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  if tg_op = 'INSERT' then
    insert into public.application_events (tenant_id, application_id, event_type, actor_id, metadata_json)
    values (new.tenant_id, new.id, 'created', auth.uid(), jsonb_build_object('stage', new.stage));
  elsif new.stage is distinct from old.stage then
    insert into public.application_events (tenant_id, application_id, event_type, actor_id, metadata_json)
    values (new.tenant_id, new.id, 'stage_changed', auth.uid(), jsonb_build_object('from', old.stage, 'to', new.stage));
  end if;
  return null;
end;
$$;

create trigger applications_track before insert or update on public.applications
  for each row execute function app_private.track_application();
create trigger applications_log after insert or update on public.applications
  for each row execute function app_private.log_application_event();

create or replace function app_private.prevent_application_event_change()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  raise exception 'Application events are immutable' using errcode = '42501';
end;
$$;
create trigger application_events_immutable before update on public.application_events
  for each row execute function app_private.prevent_application_event_change();

-- ---------------------------------------------------------------------------
-- Daily digest
-- ---------------------------------------------------------------------------

create table public.daily_digests (
  id uuid primary key default gen_random_uuid(),
  tenant_id uuid not null references public.tenants (id) on delete cascade,
  digest_date date not null,
  content_json jsonb not null default '{}'::jsonb,
  -- Short text for the push notification: titles and companies only, no CV data.
  push_text text not null check (length(push_text) between 1 and 1500),
  generated_by text not null default 'scheduled' check (generated_by in ('scheduled', 'manual')),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (tenant_id, digest_date)
);

-- ---------------------------------------------------------------------------
-- Housekeeping triggers
-- ---------------------------------------------------------------------------

create trigger signal_requests_updated_at before update on public.signal_requests
  for each row execute function public.set_updated_at();
create trigger signal_requests_tenant_immutable before update on public.signal_requests
  for each row execute function public.prevent_tenant_change();
create trigger company_signals_updated_at before update on public.company_signals
  for each row execute function public.set_updated_at();
create trigger company_signals_tenant_immutable before update on public.company_signals
  for each row execute function public.prevent_tenant_change();
create trigger applications_updated_at before update on public.applications
  for each row execute function public.set_updated_at();
create trigger applications_tenant_immutable before update on public.applications
  for each row execute function public.prevent_tenant_change();
create trigger daily_digests_updated_at before update on public.daily_digests
  for each row execute function public.set_updated_at();
create trigger daily_digests_tenant_immutable before update on public.daily_digests
  for each row execute function public.prevent_tenant_change();

-- ---------------------------------------------------------------------------
-- RLS
-- ---------------------------------------------------------------------------

alter table public.signal_requests enable row level security;
alter table public.company_signals enable row level security;
alter table public.applications enable row level security;
alter table public.application_events enable row level security;
alter table public.daily_digests enable row level security;

revoke all on public.signal_requests, public.company_signals, public.applications,
  public.application_events, public.daily_digests from anon, authenticated;
grant select, insert, update, delete on public.signal_requests, public.company_signals,
  public.applications, public.daily_digests to authenticated;
grant select on public.application_events to authenticated;

create policy signal_requests_member on public.signal_requests
  for all to authenticated
  using ((select app_private.is_tenant_member(tenant_id)))
  with check ((select app_private.is_tenant_member(tenant_id)));

create policy company_signals_member on public.company_signals
  for all to authenticated
  using ((select app_private.is_tenant_member(tenant_id)))
  with check (
    (select app_private.is_tenant_member(tenant_id))
    and app_private.target_in_tenant(company_target_id, tenant_id)
    and (request_id is null or exists (
      select 1 from public.signal_requests r where r.id = request_id and r.tenant_id = company_signals.tenant_id
    ))
  );

create policy applications_member on public.applications
  for all to authenticated
  using ((select app_private.is_tenant_member(tenant_id)))
  with check (
    (select app_private.is_tenant_member(tenant_id))
    and app_private.candidate_in_tenant(candidate_id, tenant_id)
    and app_private.job_in_tenant(job_id, tenant_id)
    and app_private.target_in_tenant(company_target_id, tenant_id)
    and (signal_id is null or exists (
      select 1 from public.company_signals s where s.id = signal_id and s.tenant_id = applications.tenant_id
    ))
  );

create policy application_events_member_read on public.application_events
  for select to authenticated
  using ((select app_private.is_tenant_member(tenant_id)));

create policy daily_digests_member on public.daily_digests
  for all to authenticated
  using ((select app_private.is_tenant_member(tenant_id)))
  with check ((select app_private.is_tenant_member(tenant_id)));
