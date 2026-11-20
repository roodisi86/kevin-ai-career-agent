# Phase 5 — Private pilot: reliability and privacy review

Status: pilot started 2026-11-20 (first scheduled digest). Review again at day 30.

## 1. What runs on a schedule

| When (Europe/Amsterdam, winter) | What | Where | Writes |
|---|---|---|---|
| 06:17 daily | Verify 150 company boards, scan approved sources, rules scoring, queue top jobs for Claude, process signal answers, queue weekly signal batch, store digest | GitHub Actions `daily-run.yml` (automation member account) | scans, jobs, job_matches, ai_match_requests, company_signals, signal_requests, daily_digests |
| 06:47 daily | Answer the job-assessment queue; push the digest | Claude scheduled task "Career Agent ochtendbeoordeling" | `ai_match_requests.output_json` only |
| 09:23 daily | Same pipeline again: processes Claude's answers, refreshes the digest row | GitHub Actions | as above |
| 08:23–20:23 every 2 h | Answer reverse-recruiter dossiers and signal research | Claude scheduled task "Career Agent reverse recruiter" | `outreach_requests.output_json`, `signal_requests.output_json` only |

The Claude tasks are restricted to one SELECT and one UPDATE per queue table.
Every answer is treated as untrusted and verified by app code before it is stored
in a user-visible table.

## 2. Reliability

- **Idempotency.** `daily_digests` is unique per `(tenant_id, digest_date)`; a retried
  run updates the same row. `signal_requests` is unique per `(tenant_id, batch_key)`
  with one batch per ISO week, so retries never queue a second batch. Signals are
  unique per `(tenant_id, dedupe_key)` (company + normalised URL).
- **No duplicate notifications.** The only push channel is the final message of the
  Claude tasks, which fire once per schedule slot. GitHub runs never notify.
- **Graceful degradation.** Missing automation secrets → the run logs "not configured"
  and exits 0. A failing source marks that source `error` and the scan `partial`; the
  rest continues. Signal or digest failures are logged (code only) and do not stop the
  scan. Unreachable source pages keep a signal as "bron niet automatisch gecontroleerd"
  instead of failing.
- **Monitoring.** The Pilot page shows: days with a successful scheduled scan, last
  scheduled run, sources in error, queue backlogs and number of digests.
- **Known limits.** GitHub cron can start late under load (typically minutes). Daylight
  saving time shifts the GitHub runs one hour later in summer (UTC cron). Signals cover
  20 companies per week, so the full company list is not scanned for news.

## 3. Privacy and security

- **RLS everywhere.** All five new tables (`applications`, `application_events`,
  `daily_digests`, `signal_requests`, `company_signals`) have tenant RLS; inserts check
  that linked jobs, companies, candidates and signals belong to the same tenant.
  Covered by `tests/db/rls.test.ts` (cross-tenant denial) and `tests/hosted/isolation.test.ts`.
- **Append-only history.** `application_events` is written by a trigger only; clients
  have SELECT only and updates are blocked for everyone.
- **Push content.** The digest push text holds job titles, company names and counts —
  never CV facts, notes, contact names or e-mail addresses (unit-tested).
- **Signal research prompt.** Contains company names, sectors, websites, target role
  titles and preferred sectors only; no CV facts.
- **Sources.** Signals and contacts may not cite LinkedIn, social media or contact-data
  sites (blocked in code, not only in the prompt). Pages are fetched with an SSRF guard
  (https only, no IP literals or internal host names, 8 s timeout).
- **No external actions.** There is still no sending, applying or posting code. The
  pipeline is Kevin's own tracking; "Toevoegen aan sollicitaties" creates a private row.
- **Export and deletion.** `/api/export` (format v3) includes applications, history,
  digests, signal batches and signals. "Alles wissen" deletes them (signals cascade with
  the company targets).
- **Logs.** GitHub logs contain counts and error codes only.

## 4. Costs

- Claude: the user's own subscription via scheduled tasks; `AI_MATCH_MODE=subscription`,
  no `ANTHROPIC_API_KEY` configured → €0 API cost. The Pilot page counts any API-scored
  assessments in the last 30 days if the paid path is ever enabled.
- Job sources: official free ATS APIs; Adzuna developer account.
- Hosting: Netlify, Supabase and GitHub Actions; plans are checked in their own dashboards
  (the app cannot see them). Two daily runs use roughly 5–10 Actions minutes per day.

## 5. Pilot success criteria (from the build plan)

- Scan and matching run on schedule → Pilot page "dagen met geslaagde geplande scan".
- Top recommendations are actionable → digest top 3, each with "Toevoegen aan sollicitaties"
  and "Start reverse recruiting".
- False positives can be fed back → match feedback; Pilot page shows precision and false positives.
- No data leakage or unauthorized messages → RLS tests, no send code, push content test.
- KPI → conversations with decision makers (applications in screening or later, plus replies).

## 6. Phase 6 additions (Grok Bot link, application packages)

- **Import key.** `kca_` + 32 random bytes, shown once, stored as SHA-256 only, revocable
  (wipe revokes all keys). The key reaches exactly one database function,
  `submit_job_leads`, which validates the key, accepts 1–25 leads per call and at most
  150 per 24 h, and writes only `job_leads` for the key's own workspace. Anonymous
  callers cannot read any table (tested locally and on the hosted project).
- **No fetching, no scraping.** The app never opens the job URL of a lead; it uses the
  text Grok Bot handed over, labels the job "Grok Bot · niet geverifieerd" (status
  uncertain) and applies the same relevance filter, blockers and scoring as feeds.
- **Application packages.** Written by the Claude subscription task from confirmed facts
  only. Highlights without a known fact, with unbacked numbers or heavy claims are dropped;
  non-verbatim vacancy quotes are removed; the letter (also after the user's edits) is
  checked for unbacked numbers, P&L-type claims, misrepresentation and salary.
- **Submitting stays manual.** The Grok Bot form instruction tells the bot to stop before
  the final submit, never create accounts or accept terms without asking. The app only
  records "Ik heb zelf gesolliciteerd" after the user says so.
