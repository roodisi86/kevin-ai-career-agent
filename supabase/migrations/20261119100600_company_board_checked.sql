-- Remember when we last looked for a public job board (also when none was found).
alter table public.company_targets add column board_checked_at timestamptz;
