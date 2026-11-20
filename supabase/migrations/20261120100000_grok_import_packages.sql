-- Phase 6: Grok Bot import link + application packages.
-- * import_tokens: personal keys that may ONLY submit job leads (hashed, revocable).
-- * job_leads: untrusted leads submitted with such a key; the app imports them as
--   manual, not-verified vacancies (the app never fetches the job page itself).
-- * public.submit_job_leads(): the only door for a key holder (security definer,
--   validates the key, caps volume, inserts leads only).
-- * application_packages: Claude-subscription queue + verified application package.

-- ---------------------------------------------------------------------------
-- Import keys and leads
-- ---------------------------------------------------------------------------

create table public.import_tokens (
  id uuid primary key default gen_random_uuid(),
  tenant_id uuid not null references public.tenants (id) on delete cascade,
  created_by uuid not null references auth.users (id) on delete cascade,
  label text not null check (length(label) between 1 and 80),
  token_hash text not null unique check (token_hash ~ '^[a-f0-9]{64}$'),
  token_prefix text not null check (token_prefix ~ '^kca_[A-Za-z0-9_-]{4}$'),
  use_count integer not null default 0,
  last_used_at timestamptz,
  revoked_at timestamptz,
  created_at timestamptz not null default now()
);

create table public.job_leads (
  id uuid primary key default gen_random_uuid(),
  tenant_id uuid not null references public.tenants (id) on delete cascade,
  token_id uuid references public.import_tokens (id) on delete set null,
  source text not null default 'grok_bot' check (source in ('grok_bot')),
  title text not null check (length(title) between 1 and 300),
  company text not null check (length(company) between 1 and 200),
  url text not null check (url ~ '^https?://' and length(url) <= 2000),
  url_hash text not null check (url_hash ~ '^[a-f0-9]{64}$'),
  location text check (location is null or length(location) <= 200),
  posted text check (posted is null or length(posted) <= 60),
  salary_text text check (salary_text is null or length(salary_text) <= 200),
  contract_text text check (contract_text is null or length(contract_text) <= 200),
  reason text check (reason is null or length(reason) <= 500),
  description text check (description is null or length(description) <= 20000),
  status text not null default 'pending' check (status in ('pending', 'imported', 'duplicate', 'rejected')),
  reject_reason text check (reject_reason is null or length(reject_reason) <= 80),
  job_id uuid references public.jobs (id) on delete set null,
  created_at timestamptz not null default now(),
  processed_at timestamptz,
  unique (tenant_id, url_hash)
);

create index job_leads_pending_idx on public.job_leads (tenant_id, status, created_at);

alter table public.jobs
  add column import_source text check (import_source is null or import_source in ('user', 'grok_bot'));

create or replace function public.submit_job_leads(p_token text, p_leads jsonb)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_token public.import_tokens%rowtype;
  v_lead jsonb;
  v_accepted integer := 0;
  v_duplicates integer := 0;
  v_rejected integer := 0;
  v_today integer;
  v_url text;
  v_title text;
  v_company text;
begin
  if p_token is null or length(p_token) not between 20 and 200 then
    raise exception 'invalid token' using errcode = '28000';
  end if;
  select * into v_token from public.import_tokens
    where token_hash = encode(sha256(convert_to(p_token, 'UTF8')), 'hex') and revoked_at is null;
  if not found then
    raise exception 'invalid token' using errcode = '28000';
  end if;
  if jsonb_typeof(p_leads) <> 'array' or jsonb_array_length(p_leads) = 0 or jsonb_array_length(p_leads) > 25 then
    raise exception 'send 1 to 25 leads' using errcode = '22023';
  end if;
  select count(*) into v_today from public.job_leads
    where token_id = v_token.id and created_at > now() - interval '24 hours';
  if v_today + jsonb_array_length(p_leads) > 150 then
    raise exception 'daily limit reached' using errcode = '54000';
  end if;

  for v_lead in select * from jsonb_array_elements(p_leads) loop
    v_url := btrim(coalesce(v_lead ->> 'url', ''));
    v_title := btrim(coalesce(v_lead ->> 'title', ''));
    v_company := btrim(coalesce(v_lead ->> 'company', ''));
    if v_url !~ '^https?://[^\s]+$' or length(v_url) > 2000 or v_title = '' or v_company = '' then
      v_rejected := v_rejected + 1;
      continue;
    end if;
    insert into public.job_leads (tenant_id, token_id, title, company, url, url_hash, location, posted,
                                  salary_text, contract_text, reason, description)
    values (
      v_token.tenant_id, v_token.id,
      left(v_title, 300), left(v_company, 200), v_url,
      encode(sha256(convert_to(lower(v_url), 'UTF8')), 'hex'),
      nullif(left(btrim(coalesce(v_lead ->> 'location', '')), 200), ''),
      nullif(left(btrim(coalesce(v_lead ->> 'posted', '')), 60), ''),
      nullif(left(btrim(coalesce(v_lead ->> 'salary', '')), 200), ''),
      nullif(left(btrim(coalesce(v_lead ->> 'contract', '')), 200), ''),
      nullif(left(btrim(coalesce(v_lead ->> 'reason', '')), 500), ''),
      nullif(left(coalesce(v_lead ->> 'description', ''), 20000), '')
    )
    on conflict (tenant_id, url_hash) do nothing;
    if found then v_accepted := v_accepted + 1; else v_duplicates := v_duplicates + 1; end if;
  end loop;

  update public.import_tokens
    set use_count = use_count + 1, last_used_at = now()
    where id = v_token.id;
  return jsonb_build_object('accepted', v_accepted, 'duplicates', v_duplicates, 'rejected', v_rejected);
end;
$$;

revoke all on function public.submit_job_leads(text, jsonb) from public;
grant execute on function public.submit_job_leads(text, jsonb) to anon, authenticated;

-- ---------------------------------------------------------------------------
-- Application packages
-- ---------------------------------------------------------------------------

create table public.application_packages (
  id uuid primary key default gen_random_uuid(),
  tenant_id uuid not null references public.tenants (id) on delete cascade,
  candidate_id uuid not null references public.candidate_profiles (id) on delete cascade,
  job_id uuid not null references public.jobs (id) on delete cascade,
  status text not null default 'pending' check (status in ('pending', 'answered', 'ready', 'rejected')),
  prompt_text text not null check (length(prompt_text) between 1 and 40000),
  fact_refs_json jsonb not null default '{}'::jsonb,
  output_json jsonb,
  package_json jsonb,
  letter_text text check (letter_text is null or length(letter_text) <= 8000),
  letter_edited boolean not null default false,
  warnings_json jsonb not null default '[]'::jsonb,
  prompt_version text not null check (length(prompt_version) <= 40),
  error text check (error is null or length(error) <= 200),
  requested_by uuid,
  answered_at timestamptz,
  processed_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (tenant_id, job_id)
);

-- ---------------------------------------------------------------------------
-- Housekeeping + RLS
-- ---------------------------------------------------------------------------

create trigger import_tokens_tenant_immutable before update on public.import_tokens
  for each row execute function public.prevent_tenant_change();
create trigger job_leads_tenant_immutable before update on public.job_leads
  for each row execute function public.prevent_tenant_change();
create trigger application_packages_updated_at before update on public.application_packages
  for each row execute function public.set_updated_at();
create trigger application_packages_tenant_immutable before update on public.application_packages
  for each row execute function public.prevent_tenant_change();

alter table public.import_tokens enable row level security;
alter table public.job_leads enable row level security;
alter table public.application_packages enable row level security;

revoke all on public.import_tokens, public.job_leads, public.application_packages from anon, authenticated;
-- Keys: members see and create them; only revoked_at may change; never deleted by clients.
grant select, insert on public.import_tokens to authenticated;
grant update (revoked_at) on public.import_tokens to authenticated;
grant select, update, delete on public.job_leads to authenticated;
grant select, insert, update, delete on public.application_packages to authenticated;

create policy import_tokens_member on public.import_tokens
  for all to authenticated
  using ((select app_private.is_tenant_member(tenant_id)))
  with check ((select app_private.is_tenant_member(tenant_id)) and created_by = (select auth.uid()));

create policy job_leads_member on public.job_leads
  for all to authenticated
  using ((select app_private.is_tenant_member(tenant_id)))
  with check (
    (select app_private.is_tenant_member(tenant_id))
    and app_private.job_in_tenant(job_id, tenant_id)
  );

create policy application_packages_member on public.application_packages
  for all to authenticated
  using ((select app_private.is_tenant_member(tenant_id)))
  with check (
    (select app_private.is_tenant_member(tenant_id))
    and app_private.candidate_in_tenant(candidate_id, tenant_id)
    and app_private.job_in_tenant(job_id, tenant_id)
  );
