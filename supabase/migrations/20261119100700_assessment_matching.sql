-- Phase 3: career assessment, AI job matching and match feedback.
-- Also: assessment reports as a document kind, a work_style fact category and
-- a soft "filtered out" marker for stored jobs after the filter is tightened.

-- ---------------------------------------------------------------------------
-- Documents and facts
-- ---------------------------------------------------------------------------

alter table public.candidate_documents drop constraint candidate_documents_document_kind_check;
alter table public.candidate_documents add constraint candidate_documents_document_kind_check
  check (document_kind in ('cv', 'linkedin_profile', 'assessment'));

alter table public.candidate_facts drop constraint candidate_facts_category_check;
alter table public.candidate_facts add constraint candidate_facts_category_check
  check (category in (
    'role', 'responsibility', 'achievement', 'education', 'certification',
    'skill', 'language', 'sector', 'work_style', 'other'
  ));

-- ---------------------------------------------------------------------------
-- Jobs: filtered out by a tightened relevance filter (kept, hidden by default)
-- ---------------------------------------------------------------------------

alter table public.jobs
  add column filtered_out_reason text
    check (filtered_out_reason is null or length(filtered_out_reason) <= 200);

-- ---------------------------------------------------------------------------
-- Career assessment: the candidate's own answers (user-stated, never inferred)
-- ---------------------------------------------------------------------------

create table public.candidate_assessments (
  id uuid primary key default gen_random_uuid(),
  tenant_id uuid not null references public.tenants (id) on delete cascade,
  candidate_id uuid not null references public.candidate_profiles (id) on delete cascade,
  schema_version integer not null default 1,
  answers_json jsonb not null default '{}'::jsonb,
  completed_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (candidate_id)
);

create index candidate_assessments_tenant_idx on public.candidate_assessments (tenant_id);

create trigger candidate_assessments_updated_at before update on public.candidate_assessments
  for each row execute function public.set_updated_at();
create trigger candidate_assessments_tenant_immutable before update on public.candidate_assessments
  for each row execute function public.prevent_tenant_change();
-- Assessment answers are matching input: changing them invalidates cached matches.
create trigger candidate_assessments_bump_version
  after insert or update on public.candidate_assessments
  for each row execute function app_private.bump_profile_version();

-- ---------------------------------------------------------------------------
-- Job matches: validated, verified Claude scoring per job (cached by input hash)
-- ---------------------------------------------------------------------------

create table public.job_matches (
  id uuid primary key default gen_random_uuid(),
  tenant_id uuid not null references public.tenants (id) on delete cascade,
  job_id uuid not null references public.jobs (id) on delete cascade,
  score integer not null check (score between 0 and 100),
  classification text not null check (classification in ('top_match', 'stretch', 'research_needed', 'reject')),
  hard_gate_status text check (hard_gate_status is null or hard_gate_status in ('pass', 'fail', 'review_required')),
  limited_evidence boolean not null default false,
  result_json jsonb not null,
  input_hash text not null check (input_hash ~ '^[a-f0-9]{64}$'),
  profile_version integer not null,
  model text not null check (length(model) between 1 and 100),
  prompt_version text not null check (length(prompt_version) between 1 and 50),
  scored_at timestamptz not null default now(),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (tenant_id, job_id)
);

create index job_matches_tenant_score_idx on public.job_matches (tenant_id, score desc);
create index job_matches_job_idx on public.job_matches (job_id);

create trigger job_matches_updated_at before update on public.job_matches
  for each row execute function public.set_updated_at();
create trigger job_matches_tenant_immutable before update on public.job_matches
  for each row execute function public.prevent_tenant_change();

-- ---------------------------------------------------------------------------
-- Match feedback: thumbs up/down with optional reasons (used to calibrate)
-- ---------------------------------------------------------------------------

create table public.match_feedback (
  id uuid primary key default gen_random_uuid(),
  tenant_id uuid not null references public.tenants (id) on delete cascade,
  job_id uuid not null references public.jobs (id) on delete cascade,
  label text not null check (label in ('good', 'bad')),
  reasons text[] not null default '{}' check (cardinality(reasons) <= 8),
  note text check (note is null or length(note) <= 500),
  match_score integer check (match_score is null or match_score between 0 and 100),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (tenant_id, job_id)
);

create index match_feedback_job_idx on public.match_feedback (job_id);

create trigger match_feedback_updated_at before update on public.match_feedback
  for each row execute function public.set_updated_at();
create trigger match_feedback_tenant_immutable before update on public.match_feedback
  for each row execute function public.prevent_tenant_change();

-- ---------------------------------------------------------------------------
-- RLS
-- ---------------------------------------------------------------------------

alter table public.candidate_assessments enable row level security;
alter table public.job_matches enable row level security;
alter table public.match_feedback enable row level security;

revoke all on public.candidate_assessments, public.job_matches, public.match_feedback from anon, authenticated;
grant select, insert, update, delete on public.candidate_assessments, public.job_matches, public.match_feedback to authenticated;

create policy candidate_assessments_member on public.candidate_assessments
  for all to authenticated
  using ((select app_private.is_tenant_member(tenant_id)))
  with check (
    (select app_private.is_tenant_member(tenant_id))
    and app_private.candidate_in_tenant(candidate_id, tenant_id)
  );

create policy job_matches_member on public.job_matches
  for all to authenticated
  using ((select app_private.is_tenant_member(tenant_id)))
  with check (
    (select app_private.is_tenant_member(tenant_id))
    and app_private.job_in_tenant(job_id, tenant_id)
  );

create policy match_feedback_member on public.match_feedback
  for all to authenticated
  using ((select app_private.is_tenant_member(tenant_id)))
  with check (
    (select app_private.is_tenant_member(tenant_id))
    and app_private.job_in_tenant(job_id, tenant_id)
  );
