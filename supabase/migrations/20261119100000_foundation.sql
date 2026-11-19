-- Phase 0 foundation: tenants, memberships, candidate profile, audit log, consent.
-- Every private row carries tenant_id and is protected by Row-Level Security.

-- ---------------------------------------------------------------------------
-- Shared helpers
-- ---------------------------------------------------------------------------

create or replace function public.set_updated_at() returns trigger
language plpgsql
set search_path = ''
as $$
begin
  new.updated_at := now();
  return new;
end;
$$;

-- ---------------------------------------------------------------------------
-- Tables
-- ---------------------------------------------------------------------------

create table public.tenants (
  id uuid primary key default gen_random_uuid(),
  slug text not null unique check (slug ~ '^[a-z0-9-]{2,64}$'),
  name text not null check (length(name) between 1 and 200),
  status text not null default 'active' check (status in ('active', 'suspended')),
  is_demo boolean not null default false,
  created_at timestamptz not null default now()
);

create table public.memberships (
  id uuid primary key default gen_random_uuid(),
  tenant_id uuid not null references public.tenants (id) on delete cascade,
  user_id uuid not null references auth.users (id) on delete cascade,
  role text not null default 'owner' check (role in ('owner', 'member')),
  created_at timestamptz not null default now(),
  unique (tenant_id, user_id)
);

create index memberships_user_id_idx on public.memberships (user_id);

-- Private-MVP gate: only e-mail addresses listed here can bootstrap a tenant.
-- No RLS policies exist on this table, so clients can never read or write it.
create table public.allowed_owners (
  email text primary key check (email = lower(email)),
  tenant_slug text not null unique check (tenant_slug ~ '^[a-z0-9-]{2,64}$'),
  tenant_name text not null,
  is_demo boolean not null default false,
  created_at timestamptz not null default now()
);

create table public.candidate_profiles (
  id uuid primary key default gen_random_uuid(),
  tenant_id uuid not null references public.tenants (id) on delete cascade,
  owner_user_id uuid not null references auth.users (id) on delete cascade,
  headline text check (headline is null or length(headline) <= 300),
  summary text check (summary is null or length(summary) <= 5000),
  desired_seniority text check (desired_seniority is null or length(desired_seniority) <= 200),
  locale text not null default 'nl-NL',
  -- Bumped whenever confirmed facts or preferences change; part of the
  -- AI match cache key in Phase 3.
  profile_version integer not null default 1,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (tenant_id, owner_user_id)
);

create index candidate_profiles_tenant_idx on public.candidate_profiles (tenant_id);

create trigger candidate_profiles_updated_at
  before update on public.candidate_profiles
  for each row execute function public.set_updated_at();

create table public.audit_events (
  id uuid primary key default gen_random_uuid(),
  tenant_id uuid not null references public.tenants (id) on delete cascade,
  actor_id uuid references auth.users (id) on delete set null,
  action text not null check (action ~ '^[a-z_]+(\.[a-z_]+)+$'),
  resource_type text not null,
  resource_id uuid,
  occurred_at timestamptz not null default now(),
  -- Never put CV text, e-mail bodies or other personal payloads in here.
  safe_metadata_json jsonb not null default '{}'::jsonb
);

create index audit_events_tenant_time_idx on public.audit_events (tenant_id, occurred_at desc);

create table public.consent_records (
  id uuid primary key default gen_random_uuid(),
  tenant_id uuid not null references public.tenants (id) on delete cascade,
  candidate_id uuid not null references public.candidate_profiles (id) on delete cascade,
  scope text not null check (scope in ('cv_processing', 'ai_analysis', 'outreach_drafting')),
  status text not null check (status in ('granted', 'revoked')),
  granted_at timestamptz,
  revoked_at timestamptz,
  created_at timestamptz not null default now()
);

create index consent_records_tenant_idx on public.consent_records (tenant_id);

-- ---------------------------------------------------------------------------
-- Membership helper (security definer avoids RLS recursion on memberships)
-- ---------------------------------------------------------------------------

create or replace function public.is_tenant_member(p_tenant uuid) returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select exists (
    select 1
    from public.memberships m
    where m.tenant_id = p_tenant
      and m.user_id = (select auth.uid())
  );
$$;

revoke all on function public.is_tenant_member(uuid) from public, anon;
grant execute on function public.is_tenant_member(uuid) to authenticated;

-- ---------------------------------------------------------------------------
-- Tenant bootstrap: creates the caller's tenant + profile on first login,
-- but only for allow-listed e-mail addresses.
-- ---------------------------------------------------------------------------

create or replace function public.bootstrap_tenant() returns uuid
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_uid uuid := auth.uid();
  v_email text;
  v_allowed public.allowed_owners%rowtype;
  v_tenant uuid;
begin
  if v_uid is null then
    raise exception 'not authenticated' using errcode = '28000';
  end if;

  select m.tenant_id into v_tenant
  from public.memberships m
  where m.user_id = v_uid
  order by m.created_at
  limit 1;

  if v_tenant is not null then
    return v_tenant;
  end if;

  select lower(u.email) into v_email from auth.users u where u.id = v_uid;

  select * into v_allowed from public.allowed_owners a where a.email = v_email;
  if not found then
    raise exception 'account not allowed' using errcode = '42501';
  end if;

  insert into public.tenants (slug, name, is_demo)
  values (v_allowed.tenant_slug, v_allowed.tenant_name, v_allowed.is_demo)
  on conflict (slug) do nothing
  returning id into v_tenant;

  if v_tenant is null then
    -- Never attach a new user to an already existing tenant implicitly.
    raise exception 'tenant already exists' using errcode = '23505';
  end if;

  insert into public.memberships (tenant_id, user_id, role)
  values (v_tenant, v_uid, 'owner');

  insert into public.candidate_profiles (tenant_id, owner_user_id)
  values (v_tenant, v_uid);

  insert into public.audit_events (tenant_id, actor_id, action, resource_type, resource_id)
  values (v_tenant, v_uid, 'tenant.bootstrapped', 'tenant', v_tenant);

  return v_tenant;
end;
$$;

revoke all on function public.bootstrap_tenant() from public, anon;
grant execute on function public.bootstrap_tenant() to authenticated;

-- ---------------------------------------------------------------------------
-- Row-Level Security
-- ---------------------------------------------------------------------------

alter table public.tenants enable row level security;
alter table public.memberships enable row level security;
alter table public.allowed_owners enable row level security;
alter table public.candidate_profiles enable row level security;
alter table public.audit_events enable row level security;
alter table public.consent_records enable row level security;

revoke all on public.tenants, public.memberships, public.allowed_owners,
  public.candidate_profiles, public.audit_events, public.consent_records
  from anon, authenticated;

grant select on public.tenants, public.memberships to authenticated;
grant select, update on public.candidate_profiles to authenticated;
grant select, insert on public.audit_events to authenticated;
grant select, insert, update on public.consent_records to authenticated;

create policy tenants_select_member on public.tenants
  for select to authenticated
  using ((select public.is_tenant_member(id)));

create policy memberships_select_own on public.memberships
  for select to authenticated
  using (user_id = (select auth.uid()));

create policy candidate_profiles_select_member on public.candidate_profiles
  for select to authenticated
  using ((select public.is_tenant_member(tenant_id)));

create policy candidate_profiles_update_owner on public.candidate_profiles
  for update to authenticated
  using ((select public.is_tenant_member(tenant_id)) and owner_user_id = (select auth.uid()))
  with check ((select public.is_tenant_member(tenant_id)) and owner_user_id = (select auth.uid()));

create policy audit_events_select_member on public.audit_events
  for select to authenticated
  using ((select public.is_tenant_member(tenant_id)));

create policy audit_events_insert_self on public.audit_events
  for insert to authenticated
  with check ((select public.is_tenant_member(tenant_id)) and actor_id = (select auth.uid()));

create policy consent_records_select_member on public.consent_records
  for select to authenticated
  using ((select public.is_tenant_member(tenant_id)));

create policy consent_records_insert_member on public.consent_records
  for insert to authenticated
  with check ((select public.is_tenant_member(tenant_id)));

create policy consent_records_update_member on public.consent_records
  for update to authenticated
  using ((select public.is_tenant_member(tenant_id)))
  with check ((select public.is_tenant_member(tenant_id)));

-- Protect tenant_id / ownership columns from being re-pointed by an update.
create or replace function public.prevent_tenant_change() returns trigger
language plpgsql
set search_path = ''
as $$
begin
  if new.tenant_id is distinct from old.tenant_id then
    raise exception 'tenant_id is immutable' using errcode = '42501';
  end if;
  return new;
end;
$$;

create trigger candidate_profiles_tenant_immutable
  before update on public.candidate_profiles
  for each row execute function public.prevent_tenant_change();

create trigger consent_records_tenant_immutable
  before update on public.consent_records
  for each row execute function public.prevent_tenant_change();

create or replace function public.prevent_owner_change() returns trigger
language plpgsql
set search_path = ''
as $$
begin
  if new.owner_user_id is distinct from old.owner_user_id
     or (new.profile_version is distinct from old.profile_version and current_user = 'authenticated') then
    raise exception 'owner_user_id and profile_version are managed by the system' using errcode = '42501';
  end if;
  return new;
end;
$$;

create trigger candidate_profiles_owner_immutable
  before update on public.candidate_profiles
  for each row execute function public.prevent_owner_change();
