# Kevin AI Career Agent

Private AI Job Scanner + AI Reverse Recruiter, built SaaS-ready (multi-tenant schema with Row-Level Security) but used by one owner during the MVP.

- Product spec: [`docs/Kevin_AI_Career_Agent_Technisch_Bouwplan.md`](docs/Kevin_AI_Career_Agent_Technisch_Bouwplan.md)
- Kick-off instructions: [`docs/Kevin_AI_Career_Agent_Claude_Code_Masterprompt.md`](docs/Kevin_AI_Career_Agent_Claude_Code_Masterprompt.md)
- Rules for coding agents: [`CLAUDE.md`](CLAUDE.md)

## Status

| Phase | Scope | Status |
| --- | --- | --- |
| 0 — Foundation | Next.js 16 + strict TS, Supabase Auth, protected dashboard, tenants/memberships/profile/audit/consent with RLS, CI | ✅ |
| 1 — Profile | Private CV upload (PDF/DOCX), text extraction, Claude fact suggestions (optional), confirmed vs suggested vs missing facts, preferences (tracks A–D, hard/soft filters, sectors, excluded employers), export + wipe | ✅ (AI path needs `ANTHROPIC_API_KEY`) |
| 2 — Job scanner | Greenhouse, SmartRecruiters, Lever (+EU), Ashby per verified company; Jobicy (remote); Adzuna NL (key); manual import; dedupe, status lifecycle, hard gates, manual scan | ✅ (Adzuna needs key) |
| 4 — Reverse Recruiter | `/reverse-recruiter`: research brief, contacts from allowed public sources only (no LinkedIn/social/contact-data sites; the cited page is fetched to check the name; emails only when published there), up to two pitch drafts + follow-up with claim warnings; versioned approval enforced by a database trigger (edit → new version → approval revoked; "sent" only for the exact approved version); no sending API | ✅ |
| 3 — Explainable matching | Career assessment (`/loopbaanprofiel`, user-stated only) + assessment-report upload (work-style facts); tighter title filter (minimum level, excluded title words, agencies); Claude scoring on 6 weighted dimensions with verified evidence, score/classification computed in code, cache by input hash, daily cap (`AI_DAILY_MATCH_CAP`), 👍/👎 feedback as calibration | ✅ (free path via Claude subscription; API optional) |
| 5 — Private pilot | Daily digest (top 3 + to-dos, one row per day, push via the morning Claude task), application pipeline `/sollicitaties` with append-only stage history, weekly "Hidden Opportunities" company signals `/signalen` (researched by the Claude task, cited page checked by the app), pilot dashboard `/pilot` (reliability, feedback precision, funnel, costs); review in `docs/pilot-review.md` | ✅ (30-day pilot running) |
| 6 — Grok Bot link & application packages | Personal import key (hashed, revocable, insert-only via `submit_job_leads`) so the user's own Grok Bot can POST leads to the `submit_job_leads` RPC (or `/api/import/jobs` when the site is not behind Netlify visitor protection); leads become not-verified manual jobs (`Grok Bot · niet geverifieerd`) that pass the normal filter, blockers and scoring. Application package per vacancy `/pakket/[jobId]` (letter, CV highlights, form answers, gaps; verified against confirmed facts) with a copy-ready Grok Bot form instruction that stops before submitting; 'Ik heb zelf gesolliciteerd' records it in the pipeline | ✅ |

## Architecture

- **Next.js 16 (App Router, Turbopack)** — server components, server actions and route handlers. `src/proxy.ts` refreshes the Supabase session and redirects anonymous users.
- **Supabase** (EU, Frankfurt) — Postgres with RLS on every private table, Auth (e-mail + password), private Storage bucket `cv-documents` (`<tenant_id>/<uuid>.<ext>`).
- **No service-role key in the app.** All data access uses the signed-in user's session, so RLS always applies.
- **Allow-list gate.** A tenant is only created for e-mail addresses in `public.allowed_owners` (no client access). Sign-ups should also be disabled in Supabase Auth.
- **Claude API** (optional) — CV fact suggestions with structured output, validated again with Zod. Suggestions whose evidence excerpt does not literally occur in the CV are dropped. AI suggestions can only be stored as `suggested`; confirmation is enforced by a database trigger.
- **Matching** (`src/lib/ai/match.ts`) — Claude rates six dimensions 0–5 (25/20/20/15/10/10). The app drops job quotes that are not literally in the vacancy, fact references that are not confirmed facts, "proven" claims without a cited fact or with numbers/high-stakes terms (P&L, budget, revenue…) the cited facts do not contain, and caps 4–5 ratings without evidence at 3. Score and classification (top match / stretch / research needed / reject) are computed in code; a failed hard gate is always a reject.
- **Audit log** — `audit_events` stores actions with safe metadata only (counts, ids, statuses; never CV text).

```
src/
  app/(app)/        dashboard, profiel, voorkeuren, instellingen (protected)
  app/api/          profile/documents (upload, signed download), export
  app/login/        login page + sign-in/out actions
  lib/              dal, audit, env, i18n (nl), cv (validate/extract/text), ai, preferences, profile
supabase/migrations RLS schema (applied to the hosted project)
tests/db            RLS isolation tests against plain Postgres (Supabase stub)
tests/e2e           Playwright smoke + demo happy path
```

## Local development

```bash
npm ci
cp .env.example .env.local   # fill in the public Supabase URL + publishable key
npm run dev
```

Without `ANTHROPIC_API_KEY` the app works fully; AI suggestions are shown as "niet ingesteld" and facts are entered manually.

## Tests

```bash
npm run lint
npm run typecheck
npm run test:unit                      # validation, extraction, anti-hallucination, preferences
DATABASE_TEST_URL=postgres://postgres@localhost:5432/postgres npm run test:db   # RLS + cross-tenant
npm run build && npm run test:e2e      # Playwright (smoke always; happy path needs a DEMO account)
npm run test:hosted                    # isolation against the real Supabase API + Storage (DEMO account)
```

`test:db` creates a throw-away database, loads `tests/db/supabase-stub.sql` (auth/storage stand-ins) and applies all migrations. Never point it at a real database.

The Playwright happy path needs a synthetic, allow-listed DEMO account in `.env.e2e.local` (`E2E_EMAIL`, `E2E_PASSWORD`). Never use a real account or a real CV in tests.

Fixtures (`tests/fixtures`) are synthetic and generated by `npm run fixtures`.

## Supabase setup (one-off)

1. Apply `supabase/migrations/*.sql` in order (already done for the hosted project).
2. Authentication → Sign In / Providers: **disable "Allow new users to sign up"** once the owner account exists.
3. Create the owner user in Authentication → Users → *Add user* (auto-confirm).
4. Allow-list the owner e-mail:
   ```sql
   insert into public.allowed_owners (email, tenant_slug, tenant_name)
   values ('owner@example.com', 'owner', 'Private workspace');
   ```
5. Authentication → URL configuration: set the Site URL to the deployed URL.

## Deployment (Netlify)

Deployed to the Netlify project `kevin-ai-career-agent` (team `kevinwuytack`): https://kevin-ai-career-agent.netlify.app

- Two locks: Netlify team-login protection on all deploys, then Supabase login + allow-list in the app.
- Environment variables live in Netlify (*Project configuration → Environment variables*): `NEXT_PUBLIC_SUPABASE_URL`, `NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY`, optional `ANTHROPIC_API_KEY` (mark as secret, scope *Functions/Runtime*).
- Deploys are currently triggered manually (no Git continuous deployment yet).
- Uploads are limited to 5 MB, below Netlify's function payload limit.

## Free matching path (no paid API)

Without `ANTHROPIC_API_KEY` the app scores every job with deterministic rules (`src/lib/matching/rules.ts`: the same six dimensions from literal signals in the vacancy, the career assessment, preferences and thumbs up/down) and queues the most promising ones in `ai_match_requests`. A scheduled Claude task, run under the user's own Claude subscription, answers the queue with the same prompt; the app validates and verifies every answer with the same code as the API path before it becomes a match. With an API key the app calls Claude directly instead.

## Daily automation

`.github/workflows/daily-run.yml` runs `scripts/daily-run.ts` twice every morning (05:17 and 08:23 UTC) and on demand: it verifies new company boards, scans all approved sources, scores jobs (rules + Claude queue), processes company-signal answers, queues one signal batch per ISO week and stores the daily digest (idempotent per Amsterdam date). It signs in as a dedicated automation user that is a plain `member` of the tenant, so RLS applies; there is no service-role key anywhere. It never sends, applies or contacts anyone, and logs counts only.

Setup (once): create the automation user in Supabase Auth (auto-confirm), add it to `public.memberships` with role `member`, and set the repository secrets `AUTOMATION_EMAIL`, `AUTOMATION_PASSWORD`, `ADZUNA_APP_ID`, `ADZUNA_APP_KEY` (optionally `ANTHROPIC_API_KEY` with `AI_MATCH_MODE=api`). Without them the workflow exits cleanly with "not configured".

## Privacy

- CVs and extracted text live only in the private bucket / RLS-protected tables.
- Export (`/api/export`) and full wipe (Privacy & instellingen) are built in; the auth login itself is removed in Supabase.
- `.gitignore` excludes `.env*`, exports and CV files. Screenshots/traces from tests are off or kept local.
