-- Phase 4: Reverse Recruiter.
-- Research brief + contacts + pitch drafts per job. Research is queued and
-- answered by a scheduled Claude task (user's own subscription); the app
-- verifies every answer before it is stored here.
--
-- The approval rules live in the database, so no client can bypass them:
--   draft -> reviewed -> approved -> sent -> replied | no_reply -> closed
-- * Any change to subject, body, language or recipient creates a new version
--   and resets the state to 'draft' (approval is for one exact version).
-- * 'approved' stores a hash of exactly that version + recipient.
-- * 'sent' is only possible from 'approved' with an unchanged hash.
-- There is no sending API at all: "sent" is the user marking that they sent it.

-- ---------------------------------------------------------------------------
-- Research queue (one per job)
-- ---------------------------------------------------------------------------

create table public.outreach_requests (
  id uuid primary key default gen_random_uuid(),
  tenant_id uuid not null references public.tenants (id) on delete cascade,
  job_id uuid not null references public.jobs (id) on delete cascade,
  prompt_text text not null check (length(prompt_text) between 1 and 40000),
  -- Fact references used in the prompt (F1 -> fact id), so answers map to the
  -- same facts even if facts change before the answer is processed.
  fact_refs_json jsonb not null default '{}'::jsonb,
  status text not null default 'pending' check (status in ('pending', 'answered', 'processed', 'rejected')),
  output_json jsonb,
  brief_json jsonb,
  error text check (error is null or length(error) <= 200),
  requested_by uuid references auth.users (id),
  answered_at timestamptz,
  processed_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (tenant_id, job_id)
);

-- ---------------------------------------------------------------------------
-- Contacts (only with a verifiable public source, or added by the user)
-- ---------------------------------------------------------------------------

create table public.contacts (
  id uuid primary key default gen_random_uuid(),
  tenant_id uuid not null references public.tenants (id) on delete cascade,
  job_id uuid references public.jobs (id) on delete cascade,
  name text not null check (length(name) between 1 and 200),
  role text check (role is null or length(role) <= 200),
  organisation text check (organisation is null or length(organisation) <= 200),
  source_url text check (source_url is null or source_url ~ '^https://'),
  source_type text not null check (source_type in ('company_site', 'press_release', 'news', 'registry', 'other', 'user')),
  email text check (email is null or email ~ '^[^@\s]+@[^@\s]+\.[^@\s]+$'),
  verification_status text not null default 'unverified'
    check (verification_status in ('unverified', 'source_checked', 'source_mismatch', 'user_confirmed')),
  lawful_basis_note text check (lawful_basis_note is null or length(lawful_basis_note) <= 500),
  origin text not null check (origin in ('ai_research', 'user')),
  last_checked_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  -- AI-found contacts must have a source; user-added ones may not.
  check (origin = 'user' or source_url is not null)
);

create index contacts_job_idx on public.contacts (tenant_id, job_id);

-- ---------------------------------------------------------------------------
-- Drafts with versioned approval
-- ---------------------------------------------------------------------------

create table public.outreach_drafts (
  id uuid primary key default gen_random_uuid(),
  tenant_id uuid not null references public.tenants (id) on delete cascade,
  candidate_id uuid not null references public.candidate_profiles (id) on delete cascade,
  job_id uuid references public.jobs (id) on delete cascade,
  contact_id uuid references public.contacts (id) on delete set null,
  kind text not null check (kind in ('recruiter', 'hiring_manager', 'follow_up')),
  language text not null check (language in ('nl', 'en', 'fr', 'es', 'de')),
  subject text not null default '' check (length(subject) <= 300),
  body text not null check (length(body) between 1 and 6000),
  state text not null default 'draft'
    check (state in ('draft', 'reviewed', 'approved', 'sent', 'replied', 'no_reply', 'closed')),
  version integer not null default 1,
  approved_hash text,
  approved_version integer,
  approved_at timestamptz,
  reviewer_user_id uuid references auth.users (id),
  sent_at timestamptz,
  evidence_json jsonb not null default '{}'::jsonb,
  warnings text[] not null default '{}',
  origin text not null default 'ai_research' check (origin in ('ai_research', 'user')),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create index outreach_drafts_job_idx on public.outreach_drafts (tenant_id, job_id);

create table public.outreach_events (
  id uuid primary key default gen_random_uuid(),
  tenant_id uuid not null references public.tenants (id) on delete cascade,
  outreach_draft_id uuid not null references public.outreach_drafts (id) on delete cascade,
  event_type text not null check (length(event_type) between 1 and 50),
  actor_id uuid,
  metadata_json jsonb not null default '{}'::jsonb,
  event_time timestamptz not null default now()
);

create index outreach_events_draft_idx on public.outreach_events (outreach_draft_id, event_time);

-- ---------------------------------------------------------------------------
-- State machine
-- ---------------------------------------------------------------------------

create or replace function app_private.outreach_content_hash(d public.outreach_drafts)
returns text
language sql
immutable
set search_path = ''
as $$
  select md5(coalesce(d.subject, '') || chr(31) || d.body || chr(31) || d.language || chr(31) || coalesce(d.contact_id::text, ''));
$$;

create or replace function app_private.guard_outreach_draft()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  content_changed boolean;
  allowed boolean;
begin
  if tg_op = 'INSERT' then
    -- New drafts always start as an unapproved first version.
    new.state := 'draft';
    new.version := 1;
    new.approved_hash := null;
    new.approved_version := null;
    new.approved_at := null;
    new.reviewer_user_id := null;
    new.sent_at := null;
    return new;
  end if;

  content_changed := new.subject is distinct from old.subject
    or new.body is distinct from old.body
    or new.language is distinct from old.language
    or new.contact_id is distinct from old.contact_id;

  if content_changed then
    if old.state in ('sent', 'replied', 'no_reply', 'closed') then
      raise exception 'A sent message cannot be edited; create a new draft' using errcode = '42501';
    end if;
    -- Any edit is a new version and revokes review/approval.
    new.version := old.version + 1;
    new.state := 'draft';
    new.approved_hash := null;
    new.approved_version := null;
    new.approved_at := null;
    new.reviewer_user_id := null;
    return new;
  end if;

  -- Approval columns are owned by this trigger, never by clients.
  new.approved_hash := old.approved_hash;
  new.approved_version := old.approved_version;
  new.approved_at := old.approved_at;
  new.reviewer_user_id := old.reviewer_user_id;
  new.sent_at := old.sent_at;
  new.version := old.version;

  if new.state is distinct from old.state then
    allowed := (old.state, new.state) in (
      ('draft', 'reviewed'),
      ('reviewed', 'draft'),
      ('reviewed', 'approved'),
      ('approved', 'draft'),
      ('approved', 'sent'),
      ('sent', 'replied'),
      ('sent', 'no_reply'),
      ('no_reply', 'replied'),
      ('replied', 'closed'),
      ('no_reply', 'closed'),
      ('sent', 'closed')
    );
    if not allowed then
      raise exception 'Outreach state change % -> % is not allowed', old.state, new.state using errcode = '42501';
    end if;

    if new.state = 'approved' then
      if auth.uid() is null then
        raise exception 'Approval requires a signed-in user' using errcode = '42501';
      end if;
      new.approved_hash := app_private.outreach_content_hash(new);
      new.approved_version := new.version;
      new.approved_at := now();
      new.reviewer_user_id := auth.uid();
    elsif new.state = 'sent' then
      if old.approved_hash is null
        or old.approved_hash <> app_private.outreach_content_hash(new)
        or old.approved_version <> new.version then
        raise exception 'Only the exact approved version can be marked as sent' using errcode = '42501';
      end if;
      new.sent_at := now();
    elsif new.state in ('draft', 'reviewed') then
      new.approved_hash := null;
      new.approved_version := null;
      new.approved_at := null;
      new.reviewer_user_id := null;
    end if;
  end if;
  return new;
end;
$$;

create or replace function app_private.log_outreach_event()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  if tg_op = 'INSERT' then
    insert into public.outreach_events (tenant_id, outreach_draft_id, event_type, actor_id, metadata_json)
    values (new.tenant_id, new.id, 'created', auth.uid(), jsonb_build_object('version', new.version, 'origin', new.origin));
  elsif new.version <> old.version then
    insert into public.outreach_events (tenant_id, outreach_draft_id, event_type, actor_id, metadata_json)
    values (new.tenant_id, new.id, 'edited', auth.uid(), jsonb_build_object('version', new.version, 'previous_state', old.state));
  elsif new.state <> old.state then
    insert into public.outreach_events (tenant_id, outreach_draft_id, event_type, actor_id, metadata_json)
    values (new.tenant_id, new.id, 'state_' || new.state, auth.uid(),
            jsonb_build_object('version', new.version, 'from', old.state, 'approved_hash', new.approved_hash));
  end if;
  return null;
end;
$$;

create trigger outreach_drafts_guard before insert or update on public.outreach_drafts
  for each row execute function app_private.guard_outreach_draft();
create trigger outreach_drafts_log after insert or update on public.outreach_drafts
  for each row execute function app_private.log_outreach_event();

-- Events are an append-only audit trail written by the trigger only. Clients
-- have no insert/delete grant; updates are blocked for everyone. Deletion only
-- happens by cascade when the draft itself is deleted (e.g. data wipe).
create or replace function app_private.prevent_outreach_event_change()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  raise exception 'Outreach events are immutable' using errcode = '42501';
end;
$$;
create trigger outreach_events_immutable before update on public.outreach_events
  for each row execute function app_private.prevent_outreach_event_change();

-- ---------------------------------------------------------------------------
-- Housekeeping triggers
-- ---------------------------------------------------------------------------

create trigger outreach_requests_updated_at before update on public.outreach_requests
  for each row execute function public.set_updated_at();
create trigger outreach_requests_tenant_immutable before update on public.outreach_requests
  for each row execute function public.prevent_tenant_change();
create trigger contacts_updated_at before update on public.contacts
  for each row execute function public.set_updated_at();
create trigger contacts_tenant_immutable before update on public.contacts
  for each row execute function public.prevent_tenant_change();
create trigger outreach_drafts_updated_at before update on public.outreach_drafts
  for each row execute function public.set_updated_at();
create trigger outreach_drafts_tenant_immutable before update on public.outreach_drafts
  for each row execute function public.prevent_tenant_change();

-- ---------------------------------------------------------------------------
-- RLS
-- ---------------------------------------------------------------------------

alter table public.outreach_requests enable row level security;
alter table public.contacts enable row level security;
alter table public.outreach_drafts enable row level security;
alter table public.outreach_events enable row level security;

revoke all on public.outreach_requests, public.contacts, public.outreach_drafts, public.outreach_events from anon, authenticated;
grant select, insert, update, delete on public.outreach_requests, public.contacts, public.outreach_drafts to authenticated;
grant select on public.outreach_events to authenticated;

create policy outreach_requests_member on public.outreach_requests
  for all to authenticated
  using ((select app_private.is_tenant_member(tenant_id)))
  with check ((select app_private.is_tenant_member(tenant_id)) and app_private.job_in_tenant(job_id, tenant_id));

create policy contacts_member on public.contacts
  for all to authenticated
  using ((select app_private.is_tenant_member(tenant_id)))
  with check ((select app_private.is_tenant_member(tenant_id)) and app_private.job_in_tenant(job_id, tenant_id));

create policy outreach_drafts_member on public.outreach_drafts
  for all to authenticated
  using ((select app_private.is_tenant_member(tenant_id)))
  with check (
    (select app_private.is_tenant_member(tenant_id))
    and app_private.candidate_in_tenant(candidate_id, tenant_id)
    and app_private.job_in_tenant(job_id, tenant_id)
    and (contact_id is null or exists (
      select 1 from public.contacts c where c.id = contact_id and c.tenant_id = outreach_drafts.tenant_id
    ))
  );

create policy outreach_events_member_read on public.outreach_events
  for select to authenticated
  using ((select app_private.is_tenant_member(tenant_id)));
