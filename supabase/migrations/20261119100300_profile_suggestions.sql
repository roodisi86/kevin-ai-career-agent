-- Phase 1: AI-proposed headline/summary, stored separately from the
-- user's own headline/summary until the user explicitly accepts it.

alter table public.candidate_profiles
  add column suggested_headline text check (suggested_headline is null or length(suggested_headline) <= 300),
  add column suggested_summary text check (suggested_summary is null or length(suggested_summary) <= 5000),
  add column suggestion_document_id uuid references public.candidate_documents (id) on delete set null,
  add column suggestion_created_at timestamptz;
