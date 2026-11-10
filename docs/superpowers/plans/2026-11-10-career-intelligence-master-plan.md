# Career Intelligence Platform — Master Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Build the PRD v0.5 single-user, zero-spend, remote-first career intelligence system in three independently releasable, testable increments.

**Architecture:** A Next.js private dashboard and Supabase Postgres hold authoritative data and durable workflow state. Bounded Python workers execute LangGraph workflows; source adapters and side-effecting operations are deterministic, and an optional outbound-only local Ollama worker handles expensive inference. A private GitHub repository versions code, agent schemas, migrations, and sanitized exports; a separate private Obsidian vault repository holds approved personal knowledge.

**Tech Stack:** Python 3.12+, uv, Pydantic v2, pytest, HTTPX, LangGraph, psycopg 3, PostgreSQL 15+, Next.js 15+ (validate current stable at implementation), TypeScript strict, Playwright, Supabase Auth/RLS, GitHub Actions, Ollama, Gmail API.

**Spec:** `docs/superpowers/specs/2026-11-10-career-intelligence-design.md` (approved PRD v0.5 baseline from conversation).

## Global Constraints
- Never start paid services without deliberate user action. Budget cap is 0 USD by default.
- Do not conflate `first_seen_at` / `updated_at` with `published_at`; timestamps include provenance.
- New daily batch contains at most one primary job per previously **undelivered** canonical company; aim for 100, never fabricate.
- Only `verified_eligible` appears in primary daily batch; uncertainty goes to review.
- Knowledge ingest only approved Obsidian files, scoped to agents; exclude private directory and secrets.
- Only Gmail Dispatcher can send, and only under explicit approved single-message or standing policy. No automatic sending enabled at rollout.
- Every external side effect uses durable intents and reconciliation, not naïve blind retries.
- Cloud runtime is viable without local Ollama; queue expensive work instead of failing the dashboard.
- GitHub is not the operational data store; protected database backups are independently restore-tested.

## Review Focus
1. Two sources give same employer different aliases/domains: never deliver twice or merge unrelated companies; covered in Plan A Task A7.
2. A job is edited today but published months ago: freshness must use published_at with confidence, covered in Plan A Task A8.
3. Database transaction commits but worker dies before ack: durable task returns previous result rather than repeating side effect, covered in Plan A Task A3 and Plan C Task C4.
4. Profile fact is edited/deleted after a draft was prepared: sender must revalidate evidence and permission; covered in Plan A Task A5 and Plan C Task C3.
5. Gmail times out after message acceptance: no blind resend, reconcile or hold for review; covered in Plan C Task C4.

## Repo layout (decided before tasks)
```text
career-intelligence/
  docs/superpowers/specs/2026-11-10-career-intelligence-design.md
  docs/superpowers/plans/2026-11-10-career-intelligence-{master,discovery,people,outreach}-plan.md
  apps/web/src/app/{(auth),dashboard,opportunities,companies,applications,people,outreach,knowledge,operations,settings}/
  apps/web/src/lib/{auth,db,api}/
  apps/web/tests/{unit,e2e}/
  services/worker/pyproject.toml
  services/worker/src/career/{config,contracts,db,orchestration,knowledge,discovery,eligibility,matching,people,applications,outreach,conversation,observability}/
  services/worker/tests/{unit,integration,contract}/
  packages/contracts/{openapi.yaml,schemas/}
  supabase/migrations/
  infra/{github,backup}/
  .github/workflows/{ci,discover,reconcile,backup-check}.yml
  .env.example
```
The separate `career-knowledge` repo is the Obsidian vault; only approved paths are ingested.

## Plan order and interfaces
1. **Plan A** `2026-11-10-career-intelligence-discovery-plan.md`: durable foundation, knowledge, discovery, eligibility, matching, dashboard, manual applications, operations, backup. **Release gate: MVP is usable without paid services.**
2. **Plan B** `2026-11-10-career-intelligence-people-plan.md`: verified employer intelligence, people research, relationship retrieval, selective enrichment budget adapter, Simplify CSV round-trip. **Release gate: qualified jobs generate contact queues, with no mail credentials.**
3. **Plan C** `2026-11-10-career-intelligence-outreach-plan.md`: evidence-grounded drafts, deterministic hybrid authorization, Gmail side-effect owner, email reconciliation, reply classification, learning feedback. **Release gate: first a manually approved send, then separately opt-in bounded auto-send with full audit.**

## Database conventions
- UUID primary keys; all times UTC `timestamptz`; `created_at`, `updated_at` where mutable.
- `owner_user_id uuid not null` on user-private rows; enforce RLS via `auth.uid()`; background worker uses server-only scoped authorization, never browser service-role key.
- `unique` indexes model business identities, while uncertain collisions go to review rather than auto-merge.
- Store evidence as URL + bounded excerpt/hash + retrieved/published dates; don't store entire copyrighted pages without permission.
- Use versioned migrations only; migrations must be reproducible from an empty database and rollback approach documented.
- `metadata jsonb` is supplemental, not a replacement for typed core fields.

## Milestone gates
| Gate | Evidence | Reject if |
|---|---|---|
| M0: Schema/task durability | Postgres integration suite, restart/reclaim/lease/duplicate tests | A task is lost or duplicate side effect may occur |
| M1: Knowledge | Obsidian fixture sync and deletion/version tests | Private paths indexed or stale facts used |
| M2: Discovery | Recorded fixtures across 3 source categories; 30-day no-duplicate simulation | Cannot trace application URL or canonical company |
| M3: Eligible MVP | Human-reviewed eligibility sample + remote E2E; blank Mac worker | Ineligible jobs default to primary batch or dashboard fails |
| M4: People | Identity/relationship fixtures, zero-spend budget gate | Fabricated connection or paid enrichment |
| M5: Outreach | OAuth fake, ambiguous-send test, suppressions, approval E2E | Any unapproved send or unsafe replay |
| M6: Recovery | Encrypted backup and restore into isolated test DB | Loss of delivered companies/suppression/send intents |

## CI verification after each milestone
- `uv run pytest services/worker/tests/unit -q`
- `uv run pytest services/worker/tests/integration -q` (requires disposable Postgres)
- `uv run ruff check services/worker && uv run mypy services/worker/src`
- `npm --prefix apps/web run lint && npm --prefix apps/web run typecheck && npm --prefix apps/web run test`
- `npm --prefix apps/web run test:e2e` (Playwright test instance)
- `python scripts/verify_contracts.py` (implement in A2; checks JSON schemas and OpenAPI drift)
- `python scripts/verify_migrations.py` (implement in A1; applies all migrations to empty disposable DB)
Run the specific owning test in **red** first, implement minimum code, rerun **green**, then commit. No product code should be written before plan review and execution authorization.

## Execution options after review
**Recommended: Subagent-driven**, because agent contracts, database ownership, privacy policy, and external side effects benefit from an independent reviewer per task. **Native** is cheaper in runtime/context and can implement tasks sequentially with one final review. Nothing in these documents authorizes implementation yet.
