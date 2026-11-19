# Kevin AI Career Agent — Technisch bouwplan
Versie 1.1 | 19 november 2026 | Status: implementatiespecificatie voor Claude Code

**Wijzigingen t.o.v. 1.0:** vacaturebronnen afgestemd op multinationals (SmartRecruiters, Greenhouse, Adzuna NL eerst; Lever/Ashby optioneel); handmatige vacature-import toegevoegd (voor vacatures die Kevin zelf vindt, o.a. op LinkedIn); zoekprofiel geactualiseerd (multinational, NL-contract, leaseauto, nieuwe sectoren, no-go-werkgevers); extra tests; lokale ontwikkelomgeving zonder Docker als fallback.

## 1. Productbeslissing

We bouwen een private, webgebaseerde AI Job Scanner + AI Reverse Recruiter voor Kevin Wuytack, met een technische basis die later veilig kan doorgroeien naar een multi-tenant SaaS-platform.

**Doel:** minder tijd kwijt zijn aan vacatures, meer kansrijke seniorfuncties ontdekken buiten klassieke sales, en per relevante kans een onderbouwd en goedgekeurd introductieplan maken.

**Belangrijk onderscheid:** AI kan namens een kandidaat zoeken, matchen, argumenteren en outreach voorbereiden. AI kan geen bestaande vertrouwensrelatie of officiële aanbeveling van een echte headhunter uitvinden. Het product noemt zich daarom een 'AI Career Agent', niet een erkende headhunter.

**In scope voor MVP:** één eigenaar en één kandidatenprofiel; cv-import, voorkeuren, vacaturebronnen, periodieke scans, vacaturevalidatie, transparante matchscores, dashboard, favorieten, afwijzingen, researchbriefs, introductieconcepten, auditlog en export.

**Niet in scope voor MVP:** massaal automatisch solliciteren; mail verzenden zonder goedkeuring; LinkedIn scraping; CAPTCHA-bypass; zoekresultaten over private vacatures claimen zonder bron; toegang tot recruiter-CRM's; betaalde abonnementen; teamaccounts; matching van werkgevers met meerdere kandidaten.

## 2. Persona en voorkeuren — vooraf te bevestigen

- Kandidaat: Kevin Wuytack. Woon-/contractvoorkeur Nederland; internationaal reizen is positief.
- Loopbaan: ruim 14 jaar internationale B2B commerciële ervaring, leiderschap, go-to-market, marktontwikkeling, partnerships en zelfstandig advieswerk. Alle cijfers en exacte titels pas publiceren na bevestiging via cv.
- Carrièredoel A: General Manager / Country Manager / Business Unit Director / Managing Director.
- Carrièredoel B: Strategy Director / Business Transformation / Strategic Partnerships / Chief of Staff.
- Carrièredoel C: CCO / Commercial Director / VP Commercial waar lange, strategische cycli en bredere eindverantwoordelijkheid centraal staan.
- Carrièredoel D (stand november 2026): Head of Partnerships / Strategic Alliances, Head of Commercial, Channel Sales Director, Market Development Director. Zijwaartse stappen en volledig nieuwe sectoren zijn uitdrukkelijk welkom.
- Werkgeverstype: voorkeur multinational met Nederlandse vestiging. Instelbaar als hard of zacht filter; standaard zacht tot Kevin het bevestigt.
- Arbeidsvoorwaarden: leaseauto is een gewenste voorwaarde (instelbaar hard/zacht). Ontbreekt de informatie in de vacature, dan is de status 'onbekend', niet 'nee'.
- Sectoren: breed en bewust open voor nieuwe industrieën; extra signalen voor consumer/FMCG, dranken, automotive-distributie, wholesale B2B, hospitality, leisure, media/events, professionele dienstverlening, energie en internationale ondernemingen.
- Sectoren met lagere prioriteit (zacht negatief signaal, geen uitsluiting tenzij Kevin dat instelt): cybersecurity/GRC, fintech/payments, industrial IoT, risk/compliance/legal tech. Kevin wil hier bewust van wegbewegen.
- Uitgesloten werkgevers: een bewerkbare lijst, door Kevin in te vullen via de instellingen. Startlijst die Kevin heeft genoemd: LSEG, LexisNexis, Thomson Reuters, Moody's. Deze namen staan niet in de code, alleen als gebruikersinvoer of in de lokale demo-seed van Kevin (niet in Git).
- Talen: Nederlands, Engels, Frans, Spaans; inzetbaar voor Benelux- en Europese rollen.
- Gewenst: hybride/remote waar mogelijk, Nederlandse arbeidsovereenkomst, expliciete check van internationale reisvereisten.
- 30%-regeling: uitsluitend als aandachtspunt 'fiscale toets nodig', nooit als automatisch vaststaande geschiktheid. Geen fiscale conclusies uit een vacature.
- Salarisgrens, maximale reistijd, gewenste aandelenopties, voorkeurssectoren, uitgesloten werkgevers en beschikbare startdatum moeten aanpasbare gebruikersvelden zijn. Geen fictieve standaarden aannemen.
- Negatieve signalen: SDR/BDR/AE-rollen, pure hunter- of quotagedreven salesrollen, louter kortcyclische prospectie, junior management, onduidelijke internationale standplaats, puur commissiebetaalde rollen.
- Positieve signalen: lange cycli, relatiebeheer, partnerships en ecosystemen, marktontwikkeling, GTM-architectuur, eindverantwoordelijkheid, transformatie.

## 3. Architectuur

### Technologiekeuze

- Frontend en API: Next.js met TypeScript (strict), React, toegankelijke componenten, responsive dashboard.
- Database, auth, opslag: Supabase Postgres, Supabase Auth, private Storage, Row-Level Security (RLS).
- AI: Anthropic Claude API voor normalisatie, evidence-based matching, samenvattingen, carrièretransitieanalyse en meertalige pitches.
- Validatie: Zod-schema's en JSON Schema voor alle gestructureerde AI-antwoorden.
- Jobs: bronadapters voor officiële openbare ATS-postings (eerst SmartRecruiters en Greenhouse, omdat daar veel multinationals op zitten; Lever en Ashby als optionele extra adapters), Adzuna NL als brede aggregator achter een feature flag (gratis developer-sleutel), handmatige import, daarna geverifieerde andere bronnen.
- Achtergrondwerk: planbare scan-worker met queue, retries, rate-limits en idempotency; niet afhankelijk van open browser.
- Hosting: Netlify of Vercel voor de webapp; achtergrondworker volgens hostinglimieten of een aparte worker-service.
- Observability: gestructureerde logs, scan-run status, errors zonder persoonsgegevens in logs.
- E-mail: eerst concepten + copy; optioneel later Gmail/Outlook OAuth, alleen drafts vóór expliciete verzendautorisatie.
- Deployment: Git-repository, migrations, tests, CI, afzonderlijke development/staging/productie-omgevingen.

### Systeemstroom

1. Gebruiker bevestigt zijn persoonlijke profiel, bewijsstukken en zoekvoorkeuren.
2. Scheduler haalt vacatures op via toegestane bronnen, inclusief originele URL en timestamps.
3. Normalisatie haalt bedrijf, locatie, type, titel, werkvorm, beschrijving en compensatie uit bronvelden.
4. Duplicaatcontrole en live-statusverificatie voorkomen oude of dubbele vacatures.
5. Harde filters verwerken uitsluitend objectief verifieerbare voorwaarden.
6. Claude beoordeelt relevantie, overdraagbare ervaring, ontbrekend bewijs en werkelijke geschiktheid.
7. Dashboard toont fit-score, bewijsregels, onzekerheden en eventuele overstap-redenering.
8. Gebruiker kiest 'interessant', 'niet relevant', 'later', of 'intro voorbereiden'.
9. AI maakt een employer brief, contactplan en conceptintroductie met uitsluitend geverifieerde claims.
10. Externe acties vereisen telkens expliciete toestemming; alles komt in auditlog en pipeline.

## 4. Datamodel (multi-tenant ready, MVP met één tenant)

Alle kandidaten- en outreachtabellen krijgen tenant_id en user_id of owner_id, met echte RLS. De service-role sleutel blijft uitsluitend server-side.

### Basistabellen

- tenants: id, slug, name, status, created_at.
- memberships: id, tenant_id, user_id, role.
- candidate_profiles: id, tenant_id, owner_user_id, headline, summary, confirmed_facts_json, inferred_facts_json, desired_seniority, locale, updated_at.
- candidate_documents: id, tenant_id, candidate_id, storage_path, file_type, checksum, processing_status, created_at.
- candidate_preferences: id, tenant_id, candidate_id, titles_json, sectors_json, locations_json, salary_json, work_mode_json, exclusions_json, hard_constraints_json, weights_json.
- company_targets: id, tenant_id, company_name, country, sector, website, nl_presence_status, employees_worldwide_status, is_multinational_status, excluded, ats_provider, ats_identifier, ats_verification_status, ats_verified_at, research_notes, source_urls_json.
- job_sources: id, provider (smartrecruiters | greenhouse | lever | ashby | adzuna | manual), base_url, company_slug, license_status, approved_by_user, active, last_polled_at, allowed_rate.
- jobs: id, company_key, source_id, external_job_id, canonical_url, aggregator_url_optional, title, description_text, description_is_truncated, location_json, employment_type, salary_json, benefits_json (o.a. leaseauto: yes/no/unknown met bronfragment), workplace_type, published_at, first_seen_at, last_seen_at, status, status_checked_at, raw_hash, source_evidence_json.
- job_matches: id, tenant_id, candidate_id, job_id, score, hard_gate_status, rationale_json, evidence_json, unknowns_json, risks_json, model_version, prompt_version, scored_at.
- match_feedback: id, tenant_id, candidate_id, job_match_id, label, note, created_at.
- scans: id, tenant_id, status, started_at, finished_at, counts_json, errors_json.
- contacts: id, tenant_id, company_target_id, name, role, source_url, email_optional, verification_status, consent_or_lawful_basis_note, last_checked_at.
- outreach_drafts: id, tenant_id, candidate_id, job_match_id_optional, company_target_id, language, subject, body, state, reviewer_user_id, approved_at, sent_at_optional, evidence_json, version.
- outreach_events: id, tenant_id, outreach_draft_id, event_type, event_time, metadata_json.
- applications: id, tenant_id, candidate_id, job_id, stage, submitted_at_optional, next_action_at_optional, notes.
- audit_events: id, tenant_id, actor_id, action, resource_type, resource_id, occurred_at, safe_metadata_json.
- consent_records: id, tenant_id, candidate_id, scope, status, granted_at, revoked_at.

Unieke index op bron + external_job_id, en extra deduplicatie op genormaliseerd bedrijf + titel + locatie + URL. Foreign keys en tenant guards voorkomen cross-tenant leaks.

## 5. Job Scanner

### Bronnenbeleid

**Prioriteit 1:** officiële publieke werkgever- en ATS-vacaturefeeds, met controle van toegangsvoorwaarden:
- SmartRecruiters Posting API (openbaar, zonder sleutel): `GET https://api.smartrecruiters.com/v1/companies/{companyId}/postings` plus `/postings/{id}` voor de volledige tekst. Veel enterprise-werkgevers.
- Greenhouse Job Board API (lezen is openbaar, zonder sleutel): `GET https://boards-api.greenhouse.io/v1/boards/{board_token}/jobs?content=true`. Alleen het indienen van sollicitaties vereist een sleutel; dat endpoint wordt niet gebruikt.
- Lever Postings API en Ashby public job postings: optionele adapters via dezelfde interface.
- Elke ATS-bron werkt per bedrijf (company ID / board token). Er is geen globale lijst; doelbedrijven en hun ATS-ID's komen uit configuratie of uit een bedrijfsverificatie-stap (zie hieronder).

**Prioriteit 2:** Adzuna NL (`https://api.adzuna.com/v1/api/jobs/nl/search/{page}`, `app_id` + `app_key`) of andere gelicentieerde aggregatoren, mits de voorwaarden het beoogde gebruik toestaan. Aandachtspunten: Adzuna-beschrijvingen kunnen ingekort zijn en de link kan via een Adzuna-redirect lopen. De matching markeert ingekorte tekst als 'beperkt bewijs', en de UI toont zowel de Adzuna-link als, indien gevonden, de originele werkgeversvacature.

**Prioriteit 3:** handmatig toegevoegde vacatures en doelbedrijven. Kevin kan een vacature-URL plus geplakte tekst toevoegen (bijvoorbeeld een LinkedIn-vacature die hij zelf heeft gevonden). Dit is gebruikersinvoer, geen scraping: de app haalt de URL niet automatisch op als de bron dat niet toestaat. Status is 'handmatig — niet automatisch geverifieerd' tot Kevin het bevestigt.

**Workday en vergelijkbare systemen:** veel multinationals gebruiken Workday, maar daar is geen officiële openbare vacature-API voor. Geen adapters op interne/ongedocumenteerde endpoints; deze vacatures lopen via handmatige import of via Adzuna.

**Bedrijfsverificatie:** een hulpfunctie die voor een opgegeven bedrijf controleert of een SmartRecruiters-, Greenhouse-, Lever- of Ashby-ID een geldige openbare board oplevert, en het resultaat met bron en tijdstip opslaat. Kevin keurt elke nieuwe bron goed voordat die in de dagelijkse scan komt.

**Geen basis:** ongeautoriseerd LinkedIn-scrapen, inloggen als derde, omzeilen van blokkades of massaal scrapen van sites die dit verbieden.

Elk bronrecord krijgt: provider, originele vacature-URL, company ID, tijdstip van ophalen, gepubliceerde datum indien aanwezig, validatie van open-status en raw hash. Niet-inhoudelijke wijzigingen hoeven geen nieuw matchrapport te veroorzaken.

### Search scopes

- Eerste lancering: Nederlandse functies en remote/hybride functies die een Nederlandse payroll-overeenkomst niet uitsluiten.
- Tweede zone: EU/internationale EMEA-verantwoordelijkheid met NL-standplaats.
- Derde zone: internationale opties met reizen naar Spanje/België, zonder onbevestigde juridische contractclaims.
- Bedrijfslijsten: importeer later geverifieerde multinationals met >1.000 werknemers wereldwijd en Nederlandse vestiging; beschouw onafgeronde lijsten niet als waarheid.
- Taalsynoniemen: general manager/algemeen directeur, country manager/landenmanager/vestigingsdirecteur, managing director, business unit director, director of strategy/strategiedirecteur, head of partnerships/hoofd partnerships, strategic alliances, channel director/kanaaldirecteur, market development director, head of commercial/commercieel directeur, wholesale manager, commercial operations, transformation.
- Bronfrequentie: configureerbaar, standaard één volledige scan per 24 uur en een 'scan nu'-knop, binnen provider-limieten.
- Staleness: vacature zonder recent bronbewijs krijgt status 'onzeker', niet 'open'; verdwenen vacatures worden opnieuw gecontroleerd en daarna gesloten.
- Controle op spookvacatures: geen harde claim dat een publicatie echt een actieve vacature is zonder bevestiging via werkgeversbron.

## 6. Matching-engine: hybride en controleerbaar

### Stap A: deterministische normalisatie

Normaliseer functietitel, functiefamilie, senioriteitsniveau, standplaats, type dienstverband, werkmodus, salaris indien expliciet gepubliceerd, reismogelijkheid, rapportagelijn en typische operationele verantwoordelijkheid. Bewaar ruwe tekst en bronlocaties.

### Stap B: harde beperkingen

Gebruik alleen door gebruiker gemarkeerde knock-outs. Bijvoorbeeld: geen contract in Nederland wanneer de gebruiker NL-payroll als harde eis kiest. Ontbrekend bewijs is 'unknown' en vereist review; onbekend is niet automatisch een afwijzing.

### Stap C: gewogen score 0–100 (startgewichten, configureerbaar)

- Verantwoordelijkheid en senioriteit: 25
- Strategische / management-inhoud: 20
- Overdraagbare ervaring en aantoonbare resultaten: 20
- Contractbasis, locatie en reismodel: 15
- Sector- en internationale fit: 10
- Salaris, hybride flexibiliteit en praktische fit: 10

Indeling van Kevins voorwaarden over de factoren: NL-contract en remote/hybride vallen onder 'Contractbasis, locatie en reismodel'; leaseauto onder 'Salaris, hybride flexibiliteit en praktische fit'; multinational en sectorprioriteit onder 'Sector- en internationale fit'; hunter/quota-signalen versus lange-cyclus/partnership-signalen onder 'Strategische / management-inhoud'.

Laat Claude per factor 0–5 beoordelen met 1–3 letterlijke, korte evidence-fragmenten of verwijzingen naar vacaturevelden. Schaal de gewogen score naar 100. Dit is een beslissingshulp, geen objectieve voorspelling van selectie.

### Output per match

- percentage en subscore per factor;
- waarom deze rol past, inclusief roltransitie;
- welke claims bewezen zijn door cv;
- welke ervaring 'transferable' is maar niet direct bewezen;
- welke kwalificaties ontbreken;
- welke belangrijke details onbekend zijn;
- wat een recruiter zou kunnen betwijfelen;
- concrete, eerlijk geformuleerde introductiehoek;
- prioriteit: topmatch, stretch, research-needed, afwijzen;
- klikbare originele bron.

### Anti-hallucinatie

Nooit P&L-eindverantwoordelijkheid, teamgrootte, omzet, diploma's, netwerkintroducties, werkautorisatie, 30%-regeling, beschikbaarheid of recruiterinteresse claimen zonder bevestigd bewijs. In alle niet-bewezen gevallen: 'onbekend / moet bevestigd worden'.

## 7. Reverse Recruiter

### Onderzoek en contactplanning

Voor goedgekeurde topmatches en geselecteerde doelbedrijven:
1. Maak een kort business dossier: business model, recent geverifieerd nieuws, vacaturevraag en strategische uitdaging.
2. Kies mogelijke invalshoek: marktuitbreiding, BU-leiderschap, commerciële operatie, partnerships, transformatie.
3. Vind passende beslissers uitsluitend via toegestane openbare of gelicentieerde bronnen.
4. Toon bron en verificatiestatus bij elke persoon; lege velden blijven leeg.
5. Genereer maximaal twee pitches: recruiterintroductie en rechtstreeks aan hiring manager.
6. Voeg korte bewijszinnen over Kevin toe, gekoppeld aan zijn bevestigde prestaties.
7. Zet inhoud in status 'draft', wacht op expliciete review en goedkeuring.
8. Maak follow-upvoorstel, maar laat geen bericht automatisch vertrekken in de MVP.

### Outreach-state machine

draft -> reviewed -> approved -> sent -> replied / no_reply -> closed

'approved' is alleen toestemming voor precies die versie, ontvanger en context. Elke wijziging aan onderwerp, tekst of ontvanger na goedkeuring reset de status naar 'draft'. Geen bulkgoedkeuring van onbekende contacten; geen fictieve warme introducties; geen impersonatie als onafhankelijke headhunter.

## 8. Interface

### Pagina's

1. Dashboard: nieuwe matches, top 10, interessante werkgevers, follow-ups en scanstatus.
2. Mijn profiel: cv-upload, bevestigde feiten, doelrollen, salaris, locaties, talen, hard/soft constraints.
3. Vacatures: filtering, sortering, bronvermelding, vacaturestatus, favorieten en feedback.
4. Match detail: subscore, bewijs, gaps, functieoverstap, recruiter vragen, actieknoppen.
5. Doelbedrijven: internationale groepen, sectoren, Nederlandse aanwezigheid, strategie en mogelijke openingen.
6. Reverse Recruiter: contactpersonen, bronbewijs, conceptintroducties en review.
7. Pipeline: saved, research, approved, contacted, interviewing, offer, rejected, closed.
8. Instellingen: bronnen, scanschema, privacy, export, delete, budget en notificaties.

### UX

Warm off-white/sand met deep navy/teal accent; professioneel, rustig, mobiel bruikbaar. Heldere labels voor feiten versus AI-inferenties. Geen schijnprecisie, geen opgeblazen dashboardscores. Elke match moet met twee klikken naar het originele vacaturebericht leiden.

## 9. API-contracten (concept)

- POST /api/profile/documents — upload, ingest en extractie; uploadgrootte en MIME strikt gecontroleerd.
- GET/PATCH /api/profile — kandidaatprofiel en bevestigde claims.
- GET/PATCH /api/preferences — zoekwensen en hard/soft constraints.
- POST /api/scans — handmatige scan met idempotency en rate limiting.
- GET /api/scans — historie en status.
- GET /api/jobs — gepagineerde, gefilterde resultaten.
- GET /api/jobs/:id — originele vacature, status en bewijs.
- POST /api/jobs/:id/match — evidence-based scoring.
- POST /api/matches/:id/feedback — relevante feedback.
- GET/POST /api/targets — bedrijfsresearch.
- POST /api/outreach/drafts — concept opstellen op basis van geverifieerde feiten.
- POST /api/outreach/drafts/:id/approve — expliciete goedkeuring met versiecontrole.
- GET/PATCH /api/applications — pipeline.
- GET /api/export — download kandidatengegevens.
- DELETE /api/account — account- en datawissing (binnen toepasselijke bewaarplichten).

### JSON contract match

~~~json
{
  "hardGate": "pass|fail|unknown",
  "overallScore": 82,
  "classification": "top_match|stretch|research_needed|reject",
  "dimensions": [{"name": "seniority", "weight": 25, "rating": 4, "evidence": ["..."]}],
  "confirmedFit": ["..."],
  "transferableExperience": ["..."],
  "gaps": ["..."],
  "unknowns": ["..."],
  "hiringManagerQuestions": ["..."],
  "pitchAngle": "...",
  "sourceUrl": "https://example.com/job/123"
}
~~~

Use Zod validation and reject malformed model output. Score has no value without an accompanying rationale and source.

## 10. Veiligheid, privacy, wettelijke kaders

- Private by default; never place CV or client secrets in a public repository or frontend bundle.
- RLS, tenant-aware queries, least-privilege service roles, request authentication and tenant isolation tests from day one.
- Encrypt transport, use private object storage and signed file access; avoid embedding raw CV text in telemetry.
- Record provenance and consent; enable deletion/export; implement configurable retention and backups.
- Build an explicit approval gate for all external communications and submissions.
- Use OAuth with minimal scopes and no plaintext access tokens in the DB. Prefer draft creation to immediate sending.
- Respect job board terms, robots/rate limits, applicable privacy rules and anti-spam rules; never evade restrictions.
- If offered to employers or used to evaluate applicants commercially, obtain specialist EU AI Act/AVG review before launch. A private candidate-side recommendation tool is not automatically equivalent to employer screening.
- Add transparent privacy notice, risk register and data flow diagram before multi-user beta.
- Never infer or score protected characteristics or use age, health, gender or nationality as a ranking proxy.
- Prevent prompt injection: vacancy descriptions, external web pages and CVs are untrusted data. They cannot override system instructions or authorize actions.

## 11. Observability, kostenbeheersing en betrouwbaarheid

- Per scan log: provider, time, records fetched, new, changed, closed, duplicates, failures.
- Cache AI-analyse on input hash + prompt version + model version. Re-score only materially changed roles or preferences.
- Add per-candidate daily AI-request cap, token/spend cap, scheduler throttle and provider retry with exponential backoff.
- Stop safely on API key missing, quota exceeded, provider terms error or authentication failure; no bypass tricks.
- Keep salary data source-bound and currencies explicit; no market salary guesses inside the scraper.
- Backup and migration restore procedure.
- Track precision of top-10 recommendations using Kevin's feedback; do not invent performance benchmarks.

## 12. Fasen en acceptatiecriteria

### Fase 0 — Repo en projectbasis
Deliverables: Next.js/TypeScript repo, strict lint/typecheck, test runner, Supabase local migration, env.example, README, CI, CLAUDE.md met de niet-onderhandelbare regels.
Lokale omgeving: Supabase local vereist Docker. Is Docker niet beschikbaar, gebruik dan een apart, leeg Supabase-ontwikkelproject (gehost) met alleen synthetische data, of lokale Postgres voor migratie- en RLS-tests. Vraag Kevin welke optie; blokkeer niet.
Done when: fresh checkout starts without production secrets; tests pass; app login/secure home route works.

### Fase 1 — Persoonlijk profiel
Deliverables: private PDF/DOCX CV upload, structured extraction, 'confirm facts' review UI, preferences, editable search tracks.
Done when: no inferred fact is marked confirmed automatically; profile persists; upload is private and export/delete tested.

### Fase 2 — Scanner
Deliverables: SmartRecruiters- en Greenhouse-adapter, Adzuna NL achter feature flag, handmatige vacature-import (URL + geplakte tekst), bedrijfsverificatie voor ATS-ID's, scheduled scans, de-dup, last-seen status, manual run, job feed. Lever/Ashby optioneel via dezelfde interface.
Done when: 20 synthetic fixture jobs are processed deterministically; no duplicate visible jobs; source URL/status always shown; retries safe.

### Fase 3 — AI matching
Deliverables: schema-validated Claude scoring, evidence per dimension, missing-information flags, career pivot logic, feedback actions.
Done when: test set includes good, stretch, rejected, expired, duplicate and missing-payroll cases; explanations distinguish facts from transferability; unknowns are not hallucinated.

### Fase 4 — Reverse Recruiter
Deliverables: target-company workspace, research brief, contact verification, multilingual pitch drafts, versioned approval workflow.
Done when: no message can be sent through any API from an unapproved or modified draft; contacts require verifiable sources; approved states auditable.

### Fase 5 — Private pilot
Deliverables: 30-day pilot with Kevin's feedback, daily digest, tracking dashboard, cost report, reliability and privacy review.
Done when: scan and matching operate on schedule, top recommendations are actionable, false positives can be fed back, no data leakage or unauthorized messages.

### Fase 6 — SaaS-ready hardening (later, not MVP)
Deliverables: self-service signup, multi-tenant onboarding, billing, quotas, data-region choices, incident response, DPA, GDPR risk assessment and legal AI Act classification; invitation-only beta.
Done when: tenant isolation, deletion, billing and abuse prevention have separate security tests and a documented release gate.

## 13. Testplan (minimum)

- Duplicate job from Greenhouse and Adzuna.
- Closed job still appears in cached feed.
- Dutch job title with English description.
- 'Country Manager' role requiring actual full P&L while CV only proves sales leadership.
- Role in Spain requiring Spanish payroll; candidate prefers NL contract.
- Remote EMEA role not specifying employer payroll jurisdiction.
- Salary missing or given as hourly.
- Source text attempts to instruct Claude to ignore criteria or leak credentials.
- Fake named person appears in web content without primary corroboration.
- AI invents €2M deal or 200 employees from incomplete profile.
- Candidate changes approved outreach draft: approval revoked.
- Unauthorized tenant requests CV/matches from another tenant: denied.
- Scheduled scan retried twice: no duplicate notifications.
- User deletes CV and profile: inaccessible and deletion audited.
- Vacature noemt geen leaseauto: status 'onbekend', geen afwijzing (tenzij Kevin leaseauto als harde eis instelt, dan 'review nodig').
- Werkgever staat op Kevins uitsluitingslijst (ook bij variant in schrijfwijze, bv. 'LSEG' vs 'London Stock Exchange Group'): niet in de feed, wel zichtbaar in een 'uitgesloten'-filter.
- Rol in een sector met lagere prioriteit (bv. fintech) met verder sterke fit: lager gerangschikt, niet verborgen.
- Pure quota/hunter-rol met een senior titel ('Sales Director', 100% new business): negatief signaal, uitgelegd in de rationale.
- Adzuna-vacature met ingekorte beschrijving: match gemarkeerd als 'beperkt bewijs'.
- Dezelfde vacature via Adzuna en via de SmartRecruiters-board van de werkgever: één logische vacature, originele werkgeverslink voorop.
- Handmatig geplakte vacature met verborgen prompt-injectie: genegeerd en gelogd.
- Ongeldig of verlopen ATS-ID bij bedrijfsverificatie: duidelijke foutstatus, geen lege 'succesvolle' scan.

Include unit tests, schema tests, API integration tests and one Playwright end-to-end happy path. Build fixtures with synthetic sample CVs; never put Kevin's true CV in Git.

## 14. Wat Kevin aanlevert voor eerste echte pilot

1. Actuele cv (PDF/DOCX) en LinkedIn URL.
2. Minimum wenssalaris, eventuele bonus/equity voorkeur.
3. Acceptatie NL contract, uitzonderingen en gewenste werkvorm.
4. Voorkeurslanden, reisdagen, maximale enkele reis naar kantoor.
5. Uitsluitingen en voorkeurssectoren.
6. Aanvullende resultaten voor P&L, budgetten, teams en operations, liefst met bewijs.
7. Lijst van werkgevers waar al is gesolliciteerd, om dubbelvoorstellen te vermijden.
8. Eventuele warme contacten die hij zelf wil vastleggen; geen automatische import van persoonlijke netwerken zonder toestemming.
9. Bevestiging per filter of het hard of zacht is: multinational, Nederlands contract, leaseauto, remote/hybride.
10. Uitsluitingslijst werkgevers en sectoren met lagere prioriteit.
11. Startlijst van 30–100 doelbedrijven (multinationals met NL-vestiging) waarvan de ATS-ID's via de bedrijfsverificatie worden opgezocht.
12. Gratis Adzuna developer-sleutel en een Anthropic API-sleutel, in te stellen in `.env.local` (nooit in de chat of in Git).

## 15. Externe documentatie voor implementatie

- Anthropic tool use: https://platform.claude.com/docs/en/agents-and-tools/tool-use/how-tool-use-works
- Anthropic structured outputs: https://platform.claude.com/docs/en/build-with-claude/structured-outputs
- SmartRecruiters Posting API: https://developers.smartrecruiters.com/reference/v1listpostings
- Greenhouse Job Board API: https://developers.greenhouse.io/job-board.html
- Adzuna search endpoint: https://developer.adzuna.com/docs/search
- Lever Postings API: https://github.com/lever/postings-api
- Ashby public job postings: https://developers.ashbyhq.com/docs/public-job-posting-api
- Adzuna developer: https://developer.adzuna.com/
- LinkedIn API restrictions: https://developer.linkedin.com/legal
- Nederlandse AP algoritmes en AVG: https://autoriteitpersoonsgegevens.nl/themas/algoritmes-ai/algoritmes-ai-en-de-avg/regels-bij-gebruik-van-ai-algoritmes

Documentatie is een startpunt; controleer actuele API- en licentievoorwaarden in iedere implementatiefase.

## 16. Projectbesluiten

- Private MVP + later SaaS zonder technische herbouw: JA.
- Eén user-facing interface, meerdere zelfstandige services/werkstromen: JA.
- Real-time AI browsing als enige bron van vacatures: NEE; gebruik gecontroleerde bronadapters.
- Volautomatische outreach: NEE; menselijke goedkeuring per versie en ontvanger.
- Preferred-candidate claims: NEE.
- Kostenbesparing vóór complexiteit: JA.
- Bewijsgedreven matching boven 'magische' percentages: JA.
- Specifieke salariseisen en 30%-regeling worden door Kevin geconfigureerd en waar nodig extern gevalideerd.
