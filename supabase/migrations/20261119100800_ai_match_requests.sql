-- Queue for AI assessments answered by Claude through the user's own Claude
-- subscription (a scheduled Claude task), instead of a paid API key.
-- The app writes the full prompt; the task writes the raw JSON answer; the app
-- then validates and verifies it with the same code as the API path
-- (src/lib/ai/match.ts) before anything becomes a match.

create table public.ai_match_requests (
  id uuid primary key default gen_random_uuid(),
  tenant_id uuid not null references public.tenants (id) on delete cascade,
  job_id uuid not null references public.jobs (id) on delete cascade,
  input_hash text not null check (input_hash ~ '^[a-f0-9]{64}$'),
  priority integer not null default 0 check (priority between 0 and 100),
  prompt_text text not null check (length(prompt_text) between 1 and 40000),
  status text not null default 'pending' check (status in ('pending', 'answered', 'processed', 'rejected', 'stale')),
  output_json jsonb,
  error text check (error is null or length(error) <= 200),
  answered_at timestamptz,
  processed_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (tenant_id, job_id)
);

create index ai_match_requests_status_idx on public.ai_match_requests (tenant_id, status, priority desc);

create trigger ai_match_requests_updated_at before update on public.ai_match_requests
  for each row execute function public.set_updated_at();
create trigger ai_match_requests_tenant_immutable before update on public.ai_match_requests
  for each row execute function public.prevent_tenant_change();

alter table public.ai_match_requests enable row level security;
revoke all on public.ai_match_requests from anon, authenticated;
grant select, insert, update, delete on public.ai_match_requests to authenticated;

create policy ai_match_requests_member on public.ai_match_requests
  for all to authenticated
  using ((select app_private.is_tenant_member(tenant_id)))
  with check (
    (select app_private.is_tenant_member(tenant_id))
    and app_private.job_in_tenant(job_id, tenant_id)
  );
