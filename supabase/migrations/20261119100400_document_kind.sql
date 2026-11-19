-- Distinguish CVs from LinkedIn profile PDFs (the user's own "Save to PDF"
-- export; LinkedIn is never scraped).
alter table public.candidate_documents
  add column document_kind text not null default 'cv'
    check (document_kind in ('cv', 'linkedin_profile'));
