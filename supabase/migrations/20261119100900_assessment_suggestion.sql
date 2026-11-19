-- A proposed (not yet accepted) set of assessment answers, e.g. derived by
-- Claude from confirmed facts and preferences. Never used for matching: only
-- answers_json is. The candidate reviews and saves the proposal in the form.
-- (A proposal update may bump profile_version; that is harmless because match
-- caching hashes the actual answers, not the version number.)

alter table public.candidate_assessments
  add column suggested_answers_json jsonb,
  add column suggestion_source text check (suggestion_source is null or suggestion_source in ('claude', 'rules')),
  add column suggestion_created_at timestamptz;
