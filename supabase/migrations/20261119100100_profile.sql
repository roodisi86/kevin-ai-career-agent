-- Phase 1: CV documents, candidate facts (confirmed vs suggested), preferences,
-- and a private storage bucket for CV files.

-- ---------------------------------------------------------------------------
-- CV documents
-- ---------------------------------------------------------------------------

create table public.candidate_documents (
  id uuid primary key default gen_random_uuid(),
  tenant_id uuid not null references public.tenants (id) on delete cascade,
  candidate_id uuid not null references public.candidate_profiles (id) on delete cascade,
  storage_path text not null unique,
  original_filename text not null check (length(original_filename) between 1 and 255),
  file_type text not null check (file_type in ('pdf', 'docx')),
  size_bytes integer not null check (size_bytes > 0 and size_bytes <= 5242880),
  checksum text not null check (checksum ~ '^[a-f0-9]{64}$'),
  processing_status text not null default 'uploaded'
    check (processing_status in ('uploaded', 'extracted', 'failed')),
  extracted_text text,
  extraction_error text check (extraction_error is null or length(extraction_error) <= 500),
  ai_status text not null default 'not_requested'
    check (ai_status in ('not_requested', 'not_configured', 'completed', 'failed')),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  -- The storage object must live under the tenant's own folder.
  check (storage_path like tenant_id::text || '/%')
);

create index candidate_documents_tenant_idx on public.candidate_documents (tenant_id, created_at desc);

create trigger candidate_documents_updated_at
  before update on public.candidate_documents
  for each row execute function public.set_updated_at();

create trigger candidate_documents_tenant_immutable
  before update on public.candidate_documents
  for each row execute function public.prevent_tenant_change();

-- ---------------------------------------------------------------------------
-- Candidate facts: every claim about Kevin lives here with its own ID, origin
-- and status. Only facts with status 'confirmed' may be used in matching or
-- outreach later on.
-- ---------------------------------------------------------------------------

create table public.candidate_facts (
  id uuid primary key default gen_random_uuid(),
  tenant_id uuid not null references public.tenants (id) on delete cascade,
  candidate_id uuid not null references public.candidate_profiles (id) on delete cascade,
  category text not null check (category in (
    'role', 'responsibility', 'achievement', 'education', 'certification',
    'skill', 'language', 'sector', 'other'
  )),
  statement text not null check (length(statement) between 1 and 1000),
  status text not null default 'suggested' check (status in ('suggested', 'confirmed', 'rejected')),
  origin text not null check (origin in ('ai_suggestion', 'user')),
  -- Quantified or high-stakes claims (P&L, budget, team size, revenue...).
  is_sensitive boolean not null default false,
  evidence_excerpt text check (evidence_excerpt is null or length(evidence_excerpt) <= 600),
  source_document_id uuid references public.candidate_documents (id) on delete set null,
  confirmed_at timestamptz,
  confirmed_by uuid references auth.users (id) on delete set null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  check (status <> 'confirmed' or (confirmed_at is not null and confirmed_by is not null))
);

create index candidate_facts_tenant_status_idx on public.candidate_facts (tenant_id, status);

create trigger candidate_facts_updated_at
  before update on public.candidate_facts
  for each row execute function public.set_updated_at();

create trigger candidate_facts_tenant_immutable
  before update on public.candidate_facts
  for each row execute function public.prevent_tenant_change();

-- Confirmation is always attributed to the current user and can never be
-- pre-filled by an AI suggestion.
create or replace function public.guard_fact_confirmation() returns trigger
language plpgsql
set search_path = ''
as $$
begin
  if tg_op = 'INSERT' then
    if new.origin = 'ai_suggestion' and new.status <> 'suggested' then
      raise exception 'AI suggestions must start as suggested' using errcode = '42501';
    end if;
  end if;

  if new.status = 'confirmed'
     and (tg_op = 'INSERT' or old.status is distinct from 'confirmed') then
    if (select auth.uid()) is null then
      raise exception 'confirmation requires an authenticated user' using errcode = '42501';
    end if;
    new.confirmed_by := (select auth.uid());
    new.confirmed_at := now();
  elsif new.status <> 'confirmed' then
    new.confirmed_by := null;
    new.confirmed_at := null;
  end if;

  return new;
end;
$$;

create trigger candidate_facts_guard_confirmation
  before insert or update on public.candidate_facts
  for each row execute function public.guard_fact_confirmation();

-- ---------------------------------------------------------------------------
-- Preferences (validated by a Zod schema in the app; stored as one document)
-- ---------------------------------------------------------------------------

create table public.candidate_preferences (
  id uuid primary key default gen_random_uuid(),
  tenant_id uuid not null references public.tenants (id) on delete cascade,
  candidate_id uuid not null unique references public.candidate_profiles (id) on delete cascade,
  schema_version integer not null default 1,
  preferences_json jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create trigger candidate_preferences_updated_at
  before update on public.candidate_preferences
  for each row execute function public.set_updated_at();

create trigger candidate_preferences_tenant_immutable
  before update on public.candidate_preferences
  for each row execute function public.prevent_tenant_change();

-- ---------------------------------------------------------------------------
-- profile_version bump (cache key for later AI matching)
-- ---------------------------------------------------------------------------

create or replace function public.bump_profile_version() returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_candidate uuid := coalesce(new.candidate_id, old.candidate_id);
begin
  if tg_table_name = 'candidate_facts' then
    if tg_op = 'UPDATE'
       and old.status is not distinct from new.status
       and old.statement is not distinct from new.statement
       and old.category is not distinct from new.category then
      return null;
    end if;
    if tg_op <> 'DELETE' and new.status <> 'confirmed'
       and (tg_op = 'INSERT' or old.status <> 'confirmed') then
      return null;
    end if;
    if tg_op = 'DELETE' and old.status <> 'confirmed' then
      return null;
    end if;
  end if;

  update public.candidate_profiles
  set profile_version = profile_version + 1
  where id = v_candidate;

  return null;
end;
$$;

revoke all on function public.bump_profile_version() from public, anon;

create trigger candidate_facts_bump_version
  after insert or update or delete on public.candidate_facts
  for each row execute function public.bump_profile_version();

create trigger candidate_preferences_bump_version
  after insert or update on public.candidate_preferences
  for each row execute function public.bump_profile_version();

-- ---------------------------------------------------------------------------
-- RLS
-- ---------------------------------------------------------------------------

alter table public.candidate_documents enable row level security;
alter table public.candidate_facts enable row level security;
alter table public.candidate_preferences enable row level security;

revoke all on public.candidate_documents, public.candidate_facts, public.candidate_preferences
  from anon, authenticated;

grant select, insert, update, delete on public.candidate_documents to authenticated;
grant select, insert, update, delete on public.candidate_facts to authenticated;
grant select, insert, update on public.candidate_preferences to authenticated;

-- The candidate referenced by a row must belong to the same tenant.
create or replace function public.candidate_in_tenant(p_candidate uuid, p_tenant uuid) returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select exists (
    select 1 from public.candidate_profiles c
    where c.id = p_candidate and c.tenant_id = p_tenant
  );
$$;

revoke all on function public.candidate_in_tenant(uuid, uuid) from public, anon;
grant execute on function public.candidate_in_tenant(uuid, uuid) to authenticated;

create policy candidate_documents_all_member on public.candidate_documents
  for all to authenticated
  using ((select public.is_tenant_member(tenant_id)))
  with check (
    (select public.is_tenant_member(tenant_id))
    and public.candidate_in_tenant(candidate_id, tenant_id)
  );

create policy candidate_facts_all_member on public.candidate_facts
  for all to authenticated
  using ((select public.is_tenant_member(tenant_id)))
  with check (
    (select public.is_tenant_member(tenant_id))
    and public.candidate_in_tenant(candidate_id, tenant_id)
  );

create policy candidate_preferences_select_member on public.candidate_preferences
  for select to authenticated
  using ((select public.is_tenant_member(tenant_id)));

create policy candidate_preferences_insert_member on public.candidate_preferences
  for insert to authenticated
  with check (
    (select public.is_tenant_member(tenant_id))
    and public.candidate_in_tenant(candidate_id, tenant_id)
  );

create policy candidate_preferences_update_member on public.candidate_preferences
  for update to authenticated
  using ((select public.is_tenant_member(tenant_id)))
  with check ((select public.is_tenant_member(tenant_id)));

-- ---------------------------------------------------------------------------
-- Private storage bucket for CV files: <tenant_id>/<uuid>.<ext>
-- ---------------------------------------------------------------------------

insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values (
  'cv-documents',
  'cv-documents',
  false,
  5242880,
  array[
    'application/pdf',
    'application/vnd.openxmlformats-officedocument.wordprocessingml.document'
  ]
)
on conflict (id) do update
  set public = false,
      file_size_limit = excluded.file_size_limit,
      allowed_mime_types = excluded.allowed_mime_types;

create or replace function public.storage_path_tenant_member(p_name text) returns boolean
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  v_folder text := (storage.foldername(p_name))[1];
begin
  if v_folder is null
     or v_folder !~ '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$' then
    return false;
  end if;
  return public.is_tenant_member(v_folder::uuid);
end;
$$;

revoke all on function public.storage_path_tenant_member(text) from public, anon;
grant execute on function public.storage_path_tenant_member(text) to authenticated;

create policy cv_documents_select_member on storage.objects
  for select to authenticated
  using (bucket_id = 'cv-documents' and public.storage_path_tenant_member(name));

create policy cv_documents_insert_member on storage.objects
  for insert to authenticated
  with check (bucket_id = 'cv-documents' and public.storage_path_tenant_member(name));

create policy cv_documents_delete_member on storage.objects
  for delete to authenticated
  using (bucket_id = 'cv-documents' and public.storage_path_tenant_member(name));
