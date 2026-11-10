# Career Intelligence

A personal, owner-authenticated job discovery, hiring-eligibility research, matching and outreach intelligence platform.

**Production dashboard:** https://career-intelligence-jade.vercel.app

**Current state (10 November 2026):** Deployed Next.js interface on Vercel, a private Supabase Edge API and signed unattended research worker sharing the Groundwork Supabase project through prefixed `ci_` tables. This is **not yet the complete PRD v0.5**. Gmail sending and paid services remain disabled.

## What is live

- Supabase Auth login with owner-only workspace access; Google sign-in UI (provider configuration and end-to-end OAuth still require verification).
- Opportunities dashboard with actual Remotive and Himalayas feeds; verified source provenance and source attribution.
- Public Greenhouse, Lever and Ashby board registration, approval-gated source candidates and bounded job scans.
- Official-job eligibility assessment for Nigeria-based applicants, with conservative interpretation of remote/worldwide language, expiration, evidence and reason history.
- Signed, replay-resistant Supabase Edge worker, scheduled every six hours via pg_cron and pg_net; provider-specific daily/six-hour rate controls.
- Durable verified-job task handoff, knowledge-safe lexical matching and verified-company-domain-gated people research tasks.
- Evidence-backed, lifetime-deduplicated daily batches at 07:00 Africa/Lagos; expired assessments are requeued at 06:00.
- Application tracking, researched contacts when available, draft-only outreach, manually recorded recruiter responses and scoped employer knowledge.
- Versioned private Obsidian Markdown ingestion CLI and opt-in private-repository sync workflow; **not configured** until an actual private vault and credentials are supplied.

No UI element should report simulated provider results, metrics, contacts or guaranteed daily quotas.

## Architecture and security

```
Next.js (Vercel, protected)
    └─ Authenticated same-origin proxy
        └─ Supabase ci-api (JWT and explicit ci_workspace_owners allowlist)
            └─ ci_ operational PostgreSQL schema (RLS)
pg_cron + pg_net (Groundwork)
    └─ signed short-lived, replay-protected requests
        └─ ci-worker (no human JWT, DB-backed HMAC gate)
            ├─ public Remotive and Himalayas feeds
            ├─ approved Greenhouse, Lever and Ashby boards
            ├─ official role-level eligibility research
            └─ approved-knowledge matching
```

Do not expose service-role keys, SQL connection strings, private notes, OAuth tokens or contact databases in this public repository or in client-side code. All Career Intelligence objects are prefixed `ci_`; do not change other Groundwork data. The separate signed worker intentionally requires HMAC authentication and must not be exposed as a generic public API.

## Running locally

Requires Python 3.12+, Node.js 22+, PostgreSQL 15+ for integration tests. The Python services are under `services/worker`, the Next.js app under `apps/web`, SQL migrations under `supabase/migrations`, and Supabase functions under `supabase/functions`.

```bash
python -m pip install -e 'services/worker[test]'
PYTHONPATH=services/worker/src python -m pytest services/worker/tests -q
cd apps/web
npm ci
npm test
npm run build
```

PostgreSQL integration tests run in GitHub Actions against disposable PostgreSQL. They require `PG_TEST_DSN` locally. **Never** point CI or destructive test fixtures at Groundwork production.

For the standalone local Python API/CLI and Obsidian template, see `docs/DEPLOYMENT.md`, `docs/ATS_SOURCES.md`, `docs/DAILY_DELIVERY_SCHEDULE.md`, `docs/OFFICIAL_ELIGIBILITY.md`, `docs/SIGNED_WORKER.md` and `docs/HIMALAYAS_FEED.md`.

## Remaining PRD v0.5 work

- A broader, independently validated international employer discovery strategy; no promise of 100 distinct verified-eligible companies daily.
- Private, approved Obsidian vault repository connection and tested synchronization, needed to produce real user-specific fit scores.
- Safe execution of verified-domain employee research and authenticated professional relationship verification.
- Gmail OAuth grant, explicit authorized send intent, safe dispatch and reconciliation, inbound replies and suppressions. **Do not enable sending before consent and end-to-end tests.**
- Full LangGraph six-role orchestration and production operational acceptance/backup/restore monitoring.
- Live Google OAuth sign-in acceptance, role-specific global hiring confirmation, and ongoing changes to employer policy and open positions.

## GitHub workflow

Changes go through CI-tested branches and reviewed pull requests into `main`. Production Vercel deploys track `main`; SQL migrations and Supabase functions must also be explicitly applied/deployed and verified. Never infer database deployment from a green TypeScript build alone.

**Repository:** https://github.com/Drex72/career-intelligence
