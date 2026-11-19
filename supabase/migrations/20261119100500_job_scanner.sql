-- Phase 2: target companies, job sources, scanned jobs and scan runs.
-- Everything is tenant-scoped with RLS (jobs are per tenant: simple, safe
-- isolation now; a shared job cache can be added for SaaS later).

create table public.company_targets (
  id uuid primary key default gen_random_uuid(),
  tenant_id uuid not null references public.tenants (id) on delete cascade,
  company_name text not null check (length(company_name) between 1 and 200),
  company_key text not null check (length(company_key) between 1 and 200),
  sector text check (sector is null or length(sector) <= 120),
  website text check (website is null or website ~ '^https://'),
  is_multinational text not null default 'unknown' check (is_multinational in ('yes', 'no', 'unknown')),
  origin text not null default 'user' check (origin in ('user', 'suggested_list')),
  notes text check (notes is null or length(notes) <= 2000),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (tenant_id, company_key)
);

create table public.job_sources (
  id uuid primary key default gen_random_uuid(),
  tenant_id uuid not null references public.tenants (id) on delete cascade,
  company_target_id uuid references public.company_targets (id) on delete cascade,
  provider text not null check (provider in ('greenhouse', 'smartrecruiters', 'lever', 'lever_eu', 'ashby', 'jobicy', 'adzuna')),
  identifier text not null check (identifier ~ '^[A-Za-z0-9._-]{1,120}$'),
  display_name text check (display_name is null or length(display_name) <= 200),
  verification_status text not null default 'unverified'
    check (verification_status in ('unverified', 'verified', 'failed')),
  verification_detail text check (verification_detail is null or length(verification_detail) <= 300),
  verified_at timestamptz,
  approved boolean not null default false,
  last_polled_at timestamptz,
  last_poll_status text check (last_poll_status is null or last_poll_status in ('ok', 'partial', 'error')),
  last_poll_error text check (last_poll_error is null or length(last_poll_error) <= 300),
  last_poll_counts jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (tenant_id, provider, identifier)
);

create table public.scans (
  id uuid primary key default gen_random_uuid(),
  tenant_id uuid not null references public.tenants (id) on delete cascade,
  trigger text not null default 'manual' check (trigger in ('manual', 'scheduled')),
  status text not null default 'running' check (status in ('running', 'completed', 'partial', 'failed')),
  started_at timestamptz not null default now(),
  finished_at timestamptz,
  created_by uuid references auth.users (id) on delete set null,
  counts_json jsonb not null default '{}'::jsonb,
  errors_json jsonb not null default '{}'::jsonb
);

create index scans_tenant_time_idx on public.scans (tenant_id, started_at desc);

create table public.jobs (
  id uuid primary key default gen_random_uuid(),
  tenant_id uuid not null references public.tenants (id) on delete cascade,
  source_id uuid references public.job_sources (id) on delete set null,
  provider text not null check (provider in ('greenhouse', 'smartrecruiters', 'lever', 'lever_eu', 'ashby', 'jobicy', 'adzuna', 'manual')),
  external_job_id text not null check (length(external_job_id) between 1 and 200),
  company_name text not null check (length(company_name) between 1 and 200),
  company_target_id uuid references public.company_targets (id) on delete set null,
  title text not null check (length(title) between 1 and 300),
  canonical_url text not null check (canonical_url ~ '^https?://' and length(canonical_url) <= 2000),
  description_text text check (description_text is null or length(description_text) <= 60000),
  description_is_truncated boolean not null default false,
  location_text text check (location_text is null or length(location_text) <= 300),
  country_code text check (country_code is null or country_code ~ '^[a-z]{2}$'),
  workplace_type text not null default 'unknown' check (workplace_type in ('onsite', 'hybrid', 'remote', 'unknown')),
  employment_type text check (employment_type is null or length(employment_type) <= 100),
  salary_json jsonb not null default '{}'::jsonb,
  signals_json jsonb not null default '{}'::jsonb,
  track_hits text[] not null default '{}',
  gate_status text check (gate_status is null or gate_status in ('pass', 'fail', 'review_required')),
  gate_json jsonb not null default '{}'::jsonb,
  status text not null default 'uncertain' check (status in ('open', 'uncertain', 'closed')),
  status_reason text check (status_reason is null or length(status_reason) <= 100),
  missed_polls integer not null default 0,
  published_at timestamptz,
  first_seen_at timestamptz not null default now(),
  last_seen_at timestamptz not null default now(),
  status_checked_at timestamptz not null default now(),
  raw_hash text not null check (raw_hash ~ '^[a-f0-9]{64}$'),
  dedupe_key text not null check (length(dedupe_key) between 1 and 600),
  duplicate_of uuid references public.jobs (id) on delete set null,
  user_state text not null default 'new' check (user_state in ('new', 'interesting', 'later', 'not_relevant')),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (tenant_id, provider, external_job_id)
);

create index jobs_tenant_status_idx on public.jobs (tenant_id, status);
create index jobs_tenant_dedupe_idx on public.jobs (tenant_id, dedupe_key);
create index jobs_source_idx on public.jobs (source_id);

-- updated_at + immutable tenant_id
create trigger company_targets_updated_at before update on public.company_targets
  for each row execute function public.set_updated_at();
create trigger job_sources_updated_at before update on public.job_sources
  for each row execute function public.set_updated_at();
create trigger jobs_updated_at before update on public.jobs
  for each row execute function public.set_updated_at();
create trigger company_targets_tenant_immutable before update on public.company_targets
  for each row execute function public.prevent_tenant_change();
create trigger job_sources_tenant_immutable before update on public.job_sources
  for each row execute function public.prevent_tenant_change();
create trigger jobs_tenant_immutable before update on public.jobs
  for each row execute function public.prevent_tenant_change();
create trigger scans_tenant_immutable before update on public.scans
  for each row execute function public.prevent_tenant_change();

-- References to other rows must stay inside the same tenant.
create or replace function app_private.target_in_tenant(p_target uuid, p_tenant uuid) returns boolean
language sql stable security definer set search_path = ''
as $$
  select p_target is null or exists (
    select 1 from public.company_targets t where t.id = p_target and t.tenant_id = p_tenant
  );
$$;

create or replace function app_private.source_in_tenant(p_source uuid, p_tenant uuid) returns boolean
language sql stable security definer set search_path = ''
as $$
  select p_source is null or exists (
    select 1 from public.job_sources s where s.id = p_source and s.tenant_id = p_tenant
  );
$$;

create or replace function app_private.job_in_tenant(p_job uuid, p_tenant uuid) returns boolean
language sql stable security definer set search_path = ''
as $$
  select p_job is null or exists (
    select 1 from public.jobs j where j.id = p_job and j.tenant_id = p_tenant
  );
$$;

revoke all on function app_private.target_in_tenant(uuid, uuid) from public, anon;
revoke all on function app_private.source_in_tenant(uuid, uuid) from public, anon;
revoke all on function app_private.job_in_tenant(uuid, uuid) from public, anon;
grant execute on function app_private.target_in_tenant(uuid, uuid) to authenticated;
grant execute on function app_private.source_in_tenant(uuid, uuid) to authenticated;
grant execute on function app_private.job_in_tenant(uuid, uuid) to authenticated;

alter table public.company_targets enable row level security;
alter table public.job_sources enable row level security;
alter table public.scans enable row level security;
alter table public.jobs enable row level security;

revoke all on public.company_targets, public.job_sources, public.scans, public.jobs from anon, authenticated;
grant select, insert, update, delete on public.company_targets, public.job_sources, public.jobs to authenticated;
grant select, insert, update on public.scans to authenticated;

create policy company_targets_member on public.company_targets
  for all to authenticated
  using ((select app_private.is_tenant_member(tenant_id)))
  with check ((select app_private.is_tenant_member(tenant_id)));

create policy job_sources_member on public.job_sources
  for all to authenticated
  using ((select app_private.is_tenant_member(tenant_id)))
  with check (
    (select app_private.is_tenant_member(tenant_id))
    and app_private.target_in_tenant(company_target_id, tenant_id)
  );

create policy scans_member on public.scans
  for all to authenticated
  using ((select app_private.is_tenant_member(tenant_id)))
  with check ((select app_private.is_tenant_member(tenant_id)));

create policy jobs_member on public.jobs
  for all to authenticated
  using ((select app_private.is_tenant_member(tenant_id)))
  with check (
    (select app_private.is_tenant_member(tenant_id))
    and app_private.source_in_tenant(source_id, tenant_id)
    and app_private.target_in_tenant(company_target_id, tenant_id)
    and app_private.job_in_tenant(duplicate_of, tenant_id)
  );
