# Career Intelligence — self-hosted personal job research

**Implementation status (10 Nov 2026; GitHub draft PR #1):** Testable local single-user application with an authenticated dashboard, real public-ATS/Remotive retrieval adapters, evidence-gated jobs, application tracking, knowledge-vault ingestion, automatic contact-research queues, optional Apollo discovery, outreach drafting, and a guarded Gmail dispatch adapter. **Not a production-ready or remotely deployed PRD v0.5 system.** See [Remaining integration work](#remaining-integration-work).

The platform defaults to **zero paid requests and zero outgoing emails**. Do not load private knowledge or real Gmail credentials into public/shared hosting.

## Local quickstart

Requires Python 3.12+ and package registry access for first installation.

```bash
python -m venv .venv
. .venv/bin/activate
pip install -e 'services/worker[test]'
export CAREER_DB_PATH="$PWD/career.db"
export CAREER_ACCESS_TOKEN="$(python -c 'import secrets; print(secrets.token_urlsafe(32))')"
python -m career.cli add-board lever example-company 'Example Company' --domain example.com
python -m career.cli discover --terms 'backend engineer,software engineer'
python -m career.cli generate-batch
python -m career.cli serve --host 127.0.0.1 --port 8000
```

Visit `http://127.0.0.1:8000`, enter the `CAREER_ACCESS_TOKEN`, and unlock the dashboard. Replace the example ATS slug with an authentic company board before using discovery; the example is illustrative. `discover` contacts public services and may be blocked by network conditions. It never applies to jobs, purchases enrichment, or sends mail.

To run without installing the package:

```bash
PYTHONPATH=services/worker/src python -m pytest services/worker/tests -q
PYTHONPATH=services/worker/src python -m career.cli --help
```

### Source attribution

Jobs retain original URLs and source identifiers. Remotive's public API is delayed and rate-limited; source discovery intentionally limits requests. The product's source coverage and freshness are not sufficient to guarantee 100 verified eligible new employers per day. Verify posting availability before applying.

### Obsidian knowledge vault

Copy `knowledge-vault-template/` to an independent **private** directory outside the application repository, edit with Obsidian, and explicitly approve shareable notes with YAML front matter, such as `status: approved` and `visibility: matching-safe`, `outreach-safe`, or `agents-safe`. Run:

```bash
python -m career.cli vault-sync /path/to/private/vault
```

The `07-private` folder is excluded by ingestion. The **local** parser does not itself sync GitHub. Keep the vault repository private and never commit private credentials.

### Application and contact workflows

Record applications in the dashboard or API; `import-simplify` and `export-simplify` support simple CSV exchange (not live Simplify API sync). Verified-eligible roles enqueue automatic people research. Public team-page data and optionally Apollo can supply employee identities. Personal connections require separate verification. No paid contact enrichment is enabled.

### Email and authorization

The system can generate individual drafts and has a Gmail API dispatcher adapter. Automatic sending is disabled until explicitly opted in. The dispatcher checks application status, verified recipient addresses, authorization, limits, and suppressions; uncertain Gmail results are **not blindly retried**. Do not enable real Gmail sending without configuring OAuth scopes, monitoring, and provider compliance.

## System boundaries

| Component | Implemented | Caveat |
|---|---|---|
| SQLite local dashboard + API | Yes | Development-only token auth, no remote session management |
| Greenhouse / Lever / Ashby parsing | Yes | Source availability varies; no crawl guarantees |
| New-employer discovery via Remotive + ATS expansion | Partial | No global search index or complete market coverage |
| Eligibility and matching | Partial | Deterministic first pass, evidence required for verified status |
| Batch history and strict dedup | Yes locally | Domain/alias resolution incomplete across unrelated sources |
| Approved Obsidian knowledge ingestion | Yes locally | No automatic remote GitHub vault synchronization |
| People research + optional Apollo | Partial | No guarantees of 4–5 relevant contacts |
| Outreach and Gmail adapters | Partial | OAuth onboarding, production delivery, and reconciliation missing |
| Conversation and employer learning | Partial | Authenticated message ingestion adapter; no scheduled live sync |
| LangGraph graph contract | Draft implementation | Optional dependency not installed or runtime tested |
| PostgreSQL migrations and ledger | Draft implementation | Migrated to Groundwork, with PostgreSQL CI gates |
| Private remote deployment and Supabase auth | No | Requires dedicated infrastructure provisioning |

## Test and safety gates

```bash
PYTHONPATH=services/worker/src python -m pytest services/worker/tests -q
python -m compileall -q services/worker/src
bash -n scripts/*.sh
```

PostgreSQL integration test is intentionally skipped unless `PG_TEST_DSN` points to an isolated testing database. The migrations 0001–0008 have been applied to the authorized Groundwork Supabase project; never point tests at an unrelated production project.

## GitHub publishing

The code is maintained in an isolated local Git branch `feat/discovery-foundation`. To provision a **new private repository** on the authorized account `Drex72` when GitHub CLI authentication is available:

```bash
gh auth login
bash scripts/publish-github.sh
```

This operator step creates `Drex72/career-intelligence`, pushes `main` and the feature branch, and opens a **draft PR**. The current tool connector can modify existing GitHub repositories but cannot create a new one; neither repository nor PR has been created remotely from this environment. Never push the personal Obsidian vault or production data in this application repository.

## Remaining integration work

PRD v0.5 complete delivery still requires: provisioning a **new** private GitHub repo; live PostgreSQL/Supabase migration testing and owner-scoped RLS, persistent LangGraph checkpoint integration, scalable cloud scheduler and authenticated remote UI, Obsidian Git synchronization, tested remote deployment with rollback, robust employer and contact research, and real Gmail OAuth verification and send reconciliation. Paid services and email automation must remain disabled until separately validated and configured.

See `docs/superpowers/plans/` for the approved feature plans and `docs/DEPLOYMENT.md` for a provisioning checklist.

## GitHub source and safety

The application repository at https://github.com/Drex72/career-intelligence is **public**. Draft PR #1 contains the testable local foundation, not a production deployment. Never commit a filled `.env`, OAuth access tokens, imported emails, personal contacts, or private Obsidian knowledge. Store approved personal notes in a separately access-controlled private repository. Production database, remote authentication, and LangGraph checkpointing still require integration tests before deployment.

## Postgres-first implementation (ongoing)

The existing SQLite UI remains a local development tool. PostgreSQL worker
commands now include `pg-add-board`, `pg-discover`, `pg-research-eligibility`,
`pg-research-people`, `pg-generate-batch`, `pg-vault-sync`, and `pg-serve`.
The shared Groundwork database uses 40 isolated `ci_` tables and migration
`0008_discovery_config`. Migration `0009_people_research_safety` adds company
research deduplication and function search-path hardening. All automatic
email sending and paid lookups remain disabled. The full Next.js product UI,
private Obsidian Git synchronization, and Gmail OAuth are still outstanding.

### Next.js dashboard source

The `apps/web/` directory contains a responsive, dark-first Next.js dashboard
with authenticated Groundwork Supabase sign-in and owner-gated backend reads.
Sections include real daily batches, job listings, application statuses, people,
knowledge metadata, outreach drafts and workflow operations. The client never
exposes PostgreSQL passwords, OAuth refresh secrets, or privileged database keys.
The dashboard requires `CI_BACKEND_URL` and Supabase publishable settings to run.
It has not yet been deployed to a production public URL.
