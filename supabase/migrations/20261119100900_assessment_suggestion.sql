-- A proposed (not yet accepted) set of assessment answers, e.g. derived by
-- Claude from confirmed facts and preferences. Never used for matching: only
-- answers_json is. The candidate reviews and saves the proposal in the form.

alter table public.candidate_assessments
  add column suggested_answers_json jsonb,
  add column suggestion_source text check (suggestion_source is null or suggestion_source in ('claude', 'rules')),
  add column suggestion_created_at timestamptz;

-- Only real answer changes bump the profile version (not a new proposal).
drop trigger candidate_assessments_bump_version on public.candidate_assessments;
create trigger candidate_assessments_bump_version_insert
  after insert on public.candidate_assessments
  for each row execute function app_private.bump_profile_version();
create trigger candidate_assessments_bump_version_update
  after update on public.candidate_assessments
  for each row when (old.answers_json is distinct from new.answers_json)
  execute function app_private.bump_profile_version();
