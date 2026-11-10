# Discovery Core Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Deliver a remote, authenticated, zero-paid-cost daily feed of up to 100 previously undelivered companies with current, source-backed, verified-eligible engineering jobs, editable approved personal knowledge, manual application tracking, and durable execution.

**Architecture:** Python bounded workers perform retrieval and LangGraph screening, coordinated by a PostgreSQL task ledger; Next.js shows authenticated private records. A separate private Obsidian Markdown repository is parsed into a versioned, permission-filtered Postgres index. GitHub Actions triggers bounded jobs; database records make retries safe and detect missed schedules.

**Tech Stack:** Python 3.12+, Pydantic v2, LangGraph, HTTPX, psycopg 3, pytest, uv, Supabase PostgreSQL, Next.js/TypeScript, Playwright, GitHub Actions.

**Spec:** `docs/superpowers/specs/2026-11-10-career-intelligence-design.md`; see master plan for decisions, conventions, review focus.

## Global Constraints
- Strict lifetime company exclusion; only verified eligible jobs in default feed; up to 100/day, no filler.
- Explicit role restriction > uncertain company policy; no implied global eligibility from remote label.
- Obsidian `07-private/` never ingested; knowledge edits must be approved and versioned.
- PostgreSQL owns operational state; GitHub owns versioned code and sanitized artifacts; backup not Git-only.
- $0 paid integrations by default. Cloud dashboard works while local model unavailable.
- Do not add email sending or autonomous application submission in this plan.

## Review Focus
- Alias collisions cannot create double delivery or false merges (A7).
- Edited old jobs cannot be passed off as fresh jobs (A8).
- Partial worker run with committed results must be safely reclaimed (A3).
- Deleted knowledge facts must stop appearing in new ranking (A5).
- Restarting an interrupted daily batch must create the same batch without duplicates (A11).

## File responsibilities (planned, not yet created)
```text
services/worker/src/career/config.py                 validated environment and zero-spend defaults
services/worker/src/career/contracts/{jobs,agents,tasks,knowledge}.py  typed Pydantic schemas
services/worker/src/career/db/{pool,migrations,repository}.py         pool and focused persistence protocols
services/worker/src/career/orchestration/{ledger,runner,graphs,checkpoint}.py
services/worker/src/career/knowledge/{vault,parser,index,retrieval}.py
services/worker/src/career/discovery/{sources,registry,board_discovery,normalizer,identity,freshness,scheduler,batches}.py
services/worker/src/career/eligibility/{rules,research,evidence}.py
services/worker/src/career/matching/{scoring,agent}.py
services/worker/src/career/applications/tracker.py
services/worker/src/career/observability/metrics.py
apps/web/src/app/{dashboard,opportunities,companies,applications,knowledge,operations,settings}/
apps/web/src/lib/{auth,db,api}/
supabase/migrations/0001_core.sql ... 0005_applications.sql
infra/backup/{export,restore,verify}.py
scripts/{verify_contracts,verify_migrations}.py
.github/workflows/{ci,discover,reconcile,backup-check}.yml
```

## Canonical domain interfaces

```python
class JobCandidate(BaseModel):
    source: str
    source_job_id: str | None
    company_name: str
    company_domain: str | None
    title: str
    description: str
    apply_url: AnyUrl
    remote_text: str | None
    published_at: datetime | None
    updated_at: datetime | None
    first_seen_at: datetime
    timestamp_source: str
    timestamp_confidence: Literal['authoritative','inferred','unknown']
    source_url: AnyUrl

class EligibilityDecision(BaseModel):
    status: Literal['verified_eligible','likely_eligible','unknown','ineligible']
    reasons: list[str]
    evidence_ids: list[UUID]
    contradictions: list[str]
    confidence: float
    policy_version: str

class MatchResult(BaseModel):
    job_id: UUID
    score: int                  # 0..100
    matched: list[str]
    gaps: list[str]
    knowledge_revision: str

class TaskRequest(BaseModel):
    workflow_id: UUID
    task_type: str
    input_ref: str
    idempotency_key: str
    depends_on: list[UUID] = []
```
Stored records use the same fields, plus database-generated IDs. Endpoints exchange `packages/contracts/schemas/*.json`; use UTC instants in ISO8601.

## Schema plan — migration-level contracts

**0001_core.sql**
- `companies(id uuid pk, canonical_domain text unique null, legal_name text, normalized_name text not null, first_seen_at timestamptz not null, identity_confidence text not null)`; domain uniqueness is a partial unique index on non-null normalized domains, not fuzzy names.
- `company_aliases(id uuid pk, company_id uuid fk, alias_type text, alias_value text, verified boolean, unique(alias_type,alias_value))` with exception queue for disputed aliases.
- `jobs(id uuid pk, company_id uuid fk, title text, description_hash text, apply_url text, canonical_apply_url text, status text, published_at timestamptz null, updated_at timestamptz null, first_seen_at timestamptz not null, last_verified_at timestamptz null, timestamp_source text, timestamp_confidence text, remote_text text)`.
- `job_sources(id uuid pk, job_id uuid fk, source_name text, source_job_id text, source_url text, retrieved_at timestamptz, raw_hash text, unique(source_name,source_job_id) where source_job_id is not null)`; `unique(company_id,canonical_apply_url)` on jobs with non-null URL; URL canonicalization excludes campaign tracking parameters.
- `company_identity_conflicts(id uuid pk, left_candidate jsonb, right_company_id uuid null, reason text, status text)`.

**0002_execution.sql**
- `workflows(id uuid pk, kind text, status text, version text, correlation_key text unique, created_at timestamptz, updated_at timestamptz)`.
- `workflow_tasks(id uuid pk, workflow_id uuid fk, task_type text, state text, priority int, input_ref text, output_ref text null, idempotency_key text unique, worker_id text null, lease_until timestamptz null, attempt_count int default 0, max_attempts int, next_retry_at timestamptz null, created_at timestamptz, updated_at timestamptz)`.
- `task_dependencies(task_id uuid fk, predecessor_id uuid fk, primary key(task_id,predecessor_id))`.
- `task_attempts(id uuid pk, task_id uuid fk, worker_id text, started_at timestamptz, finished_at timestamptz null, outcome text null, error_code text null)`.
- `task_events(id bigserial pk, task_id uuid fk, event_type text, payload jsonb, created_at timestamptz)` append only.
- `agent_checkpoints(id uuid pk, workflow_id uuid fk, graph_thread_id text, checkpoint_ref text, graph_version text, saved_at timestamptz)`.
- `provider_usage(id uuid pk, provider text, operation text, units numeric, estimated_usd numeric, intent_key text unique, recorded_at timestamptz)`.

**0003_knowledge.sql**
- `knowledge_documents(id uuid pk, path text unique, git_sha text, content_sha text, visibility text, status text, updated_at timestamptz)`.
- `knowledge_versions(id uuid pk, document_id uuid fk, revision text, body text, parsed_metadata jsonb, created_at timestamptz, unique(document_id,revision))` (only approved, permitted documents; avoid confidential material).
- `knowledge_facts(id uuid pk, document_version_id uuid fk, claim_key text, claim_text text, verification text, visibility text, source_ref text, active boolean, unique(document_version_id,claim_key))`.
- `knowledge_change_proposals(id uuid pk, document_id uuid fk, proposed_diff text, origin text, status text, created_at timestamptz)`.

**0004_discovery.sql**
- `discovery_sources(id uuid pk, name text unique, kind text, state text, rate_limit_json jsonb, cursor text null)`.
- `discovery_runs(id uuid pk, source_id uuid fk, started_at timestamptz, finished_at timestamptz null, new_companies int, eligible_jobs int, duplicate_jobs int, error_code text null)`.
- `eligibility_evidence(id uuid pk, job_id uuid fk, source_url text, source_kind text, excerpt text, excerpt_hash text, observed_at timestamptz, source_published_at timestamptz null, scope text, claim text, confidence text)`.
- `eligibility_assessments(id uuid pk, job_id uuid fk, status text, confidence numeric, reasons jsonb, contradictions jsonb, policy_version text, assessed_at timestamptz, expires_at timestamptz)`.
- `job_matches(id uuid pk, job_id uuid fk, knowledge_revision text, score int, matched jsonb, gaps jsonb, computed_at timestamptz, unique(job_id,knowledge_revision))`.
- `daily_batches(id uuid pk, owner_user_id uuid, local_date date, target int default 100, state text, generated_at timestamptz, unique(owner_user_id,local_date))`.
- `daily_batch_items(id uuid pk, batch_id uuid fk, company_id uuid fk, job_id uuid fk, rank int, unique(batch_id,company_id), unique(batch_id,job_id))`.
- `delivered_companies(owner_user_id uuid, company_id uuid fk, first_batch_id uuid fk, first_delivered_at timestamptz, primary key(owner_user_id,company_id))` ensures lifetime exclusion transactionally; `delivered_jobs(owner_user_id uuid, job_id uuid fk, primary key(owner_user_id,job_id))`.

**0005_applications.sql**
- `applications(id uuid pk, owner_user_id uuid, company_id uuid fk, job_id uuid fk, status text, applied_at timestamptz null, resume_version text null, notes text null, unique(owner_user_id,job_id))`.
- `application_events(id uuid pk, application_id uuid fk, event_type text, occurred_at timestamptz, details jsonb)`.
- `run_metrics(id uuid pk, workflow_id uuid fk, metric_name text, value numeric, recorded_at timestamptz)`.

**Security migration:** enable RLS on user-private tables, restrictive authenticated owner policies, and backend scoped execution; deny anon access. Grant read-only views of safe fields to UI. Enforce check constraints on enumerated state/status, score range and nonnegative money. Avoid storing raw third-party copyrighted text unnecessarily.

## Task A1: Monorepo, CI and schema bootstrap
**Files:** Create `services/worker/pyproject.toml`, `apps/web/package.json`, `.env.example`, `.github/workflows/ci.yml`, `supabase/migrations/0001_core.sql`, `scripts/verify_migrations.py`, `services/worker/tests/integration/test_core_migration.py`.
**Interfaces:** Produces `create_pool(dsn: str) -> AsyncConnectionPool` in `db/pool.py`, `verify_migrations(dsn: str) -> None`.
- [ ] Write failing integration tests `test_empty_database_migrates` and `test_duplicate_company_domain_rejected`; assert tables/indexes exist and duplicate canonical domains fail.
- [ ] Run `uv run pytest services/worker/tests/integration/test_core_migration.py -v` against disposable DB; confirm RED.
- [ ] Implement bootstrap, SQL migration, typed settings, database pool, testcontainers or CI Postgres service, and migration verification script.
- [ ] Re-run targeted tests; confirm GREEN; run `uv run ruff check services/worker`.
- [ ] Commit: `git commit -m 'feat(core): bootstrap schema and CI'`.

## Task A2: Shared contracts and validation
**Files:** Create `contracts/{jobs,agents,tasks,knowledge}.py`, `packages/contracts/schemas/{job-candidate,eligibility,match,task}.json`, `scripts/verify_contracts.py`, `tests/contract/test_schemas.py`.
**Interfaces:** `JobCandidate.model_validate`, `EligibilityDecision.model_validate`, `MatchResult.model_validate`, `TaskRequest.model_validate`; JSON schemas generated from Pydantic and drift-checked.
- [ ] Write failing `test_malformed_agent_output_rejected` (confidence outside 0..1, missing evidence on verified decision) and `test_schema_export_matches_models`.
- [ ] Run `uv run pytest services/worker/tests/contract/test_schemas.py -v`; RED.
- [ ] Implement the four models, enums and JSON schema exporter; constrain verified-eligible decisions to nonempty evidence IDs.
- [ ] Rerun; GREEN; `python scripts/verify_contracts.py` exits 0.
- [ ] Commit `feat(contracts): define validated agent outputs`.

## Task A3: Durable task ledger + worker lease semantics
**Files:** Create `supabase/migrations/0002_execution.sql`, `orchestration/ledger.py`, `orchestration/runner.py`, `tests/integration/test_ledger.py`.
**Interfaces:** `enqueue_task(req: TaskRequest) -> UUID`; `claim_next(worker_id: str, now: datetime, lease_seconds: int) -> ClaimedTask | None`; `heartbeat(task_id: UUID, worker_id: str, now: datetime) -> bool`; `complete(task_id: UUID, output_ref: str) -> None`; `fail(task_id: UUID, code: str, retryable: bool) -> None`.
- [ ] RED tests: `test_claim_skip_locked`, `test_dep_blocks_task`, `test_lease_expires_and_recovers`, `test_completion_after_crash_is_idempotent`, `test_dead_letter_after_bounded_retries`, `test_append_only_events`.
- [ ] Run `uv run pytest services/worker/tests/integration/test_ledger.py -v`; verify failures.
- [ ] Implement atomic `FOR UPDATE SKIP LOCKED` claim, lease ownership predicate, event transactions, dependency gating, retry backoff and dead-letter state.
- [ ] Run test again; GREEN; run parallel worker stress case on disposable DB.
- [ ] Commit `feat(orchestration): durable leased task ledger`.

## Task A4: LangGraph workflow checkpoints and dispatch
**Files:** Create `orchestration/{graphs,checkpoint}.py`, `tests/integration/test_graph_recovery.py`.
**Interfaces:** `build_discovery_graph(deps: DiscoveryDependencies) -> CompiledStateGraph`; `run_workflow(task_id: UUID, thread_id: str) -> WorkflowRunResult`; `checkpoint_ref_for(thread_id: str) -> str | None`.
- [ ] RED tests: `test_interrupted_graph_resumes`, `test_graph_version_stored`, `test_invalid_output_blocks_downstream`.
- [ ] Run selected tests; verify failure.
- [ ] Implement checkpoint persistence with supported LangGraph Postgres saver, thread IDs, node-safe task side effects and validated handoff contracts.
- [ ] Rerun tests; GREEN; verify a stopped/restarted worker resumes from the checkpoint.
- [ ] Commit `feat(orchestration): resumable langgraph execution`.

## Task A5: Obsidian Git vault ingestion + scoped knowledge
**Files:** Create `supabase/migrations/0003_knowledge.sql`, `knowledge/{vault,parser,index,retrieval}.py`, `tests/unit/test_knowledge.py`, `tests/integration/test_knowledge_sync.py`; separate vault template tracked in documentation.
**Interfaces:** `sync_revision(commit_sha: str, changed_paths: list[str]) -> SyncReport`; `retrieve_knowledge(agent_role: AgentRole, query: str, revision: str) -> list[KnowledgeFact]`; `propose_change(document_id: UUID, diff: str, origin: str) -> UUID`.
- [ ] RED tests: `test_private_directory_never_indexed`, `test_deleted_claim_disappears`, `test_unchanged_content_is_idempotent`, `test_matching_receives_skills_but_not_private_notes`, `test_git_sync_conflict_requires_review`.
- [ ] Run tests and inspect RED results.
- [ ] Implement approved-file allowlist, frontmatter validation, Git SHA/content hash idempotency, fact deactivate/delete propagation, access-filtered retrieval, optimistic revision checks; no automatic agent writes to canonical vault.
- [ ] Rerun tests; GREEN. Manually edit a fixture Markdown document and confirm index version changes.
- [ ] Commit `feat(knowledge): ingest versioned scoped obsidian vault`.

## Task A6: Source adapter contracts and registry
**Files:** Create `discovery/{sources,registry}.py`, `tests/contract/test_sources.py`, `tests/fixtures/{greenhouse,lever,ashby}.json`.
**Interfaces:** `class SourceAdapter(Protocol): async def fetch(self, cursor: str | None, limit: int) -> SourceBatch`; `SourceBatch(items: list[JobCandidate], next_cursor: str | None, rate_limit_hint: int | None)`; `register_adapter(name: str, adapter: SourceAdapter) -> None`.
- [ ] RED tests: `test_three_source_fixtures_normalize`, `test_429_defers_without_spinning`, `test_missing_job_description_rejected_or_marked_incomplete`, `test_unknown_publication_time_is_unknown`.
- [ ] Run `uv run pytest services/worker/tests/contract/test_sources.py -v`; RED.
- [ ] Implement bounded HTTPX adapters for Greenhouse, Lever, Ashby via documented public endpoints, per-source timeouts, JSON validation, cursor state; gate any novel source by allowed access policy.
- [ ] Rerun; GREEN; test recorded fixtures offline to avoid live dependence.
- [ ] Commit `feat(discovery): public ATS source adapters`.

## Task A6b: Discover new employers and ATS boards (not only seeded companies)
**Files:** Create `discovery/board_discovery.py`, `tests/unit/test_board_discovery.py`, `tests/integration/test_board_registry.py`; extend `discovery_sources` with `discovery_method` and `first_discovered_at` as a follow-on migration `0004a_source_discovery.sql` applied before `0004_discovery.sql` (or consolidate in that migration before merge).
**Interfaces:** `discover_company_sources(query: DiscoveryQuery, cursor: str | None, cap: int) -> list[SourceCandidate]`; `verify_source_candidate(candidate: SourceCandidate) -> VerifiedSource | RejectedSource`; `register_discovered_source(source: VerifiedSource) -> UUID`.
- [ ] RED tests `test_unknown_company_found_without_seed_registry`, `test_malformed_board_slug_rejected`, `test_same_board_seen_twice_unique`, `test_query_rotation_explores_new_role_or_region`, `test_forbidden_source_access_skipped`.
- [ ] Run `uv run pytest services/worker/tests/unit/test_board_discovery.py services/worker/tests/integration/test_board_registry.py -v`; RED.
- [ ] Implement permitted public search/index adapters and ATS URL pattern candidate extraction, board endpoint validation, persisted discovery provenance/cursors, rotating role/technology/region queries; use fixture-first tests and respect source terms.
- [ ] Rerun; GREEN; demonstrate at least one verified employer not present in initial registry.
- [ ] Commit `feat(discovery): discover new employer boards dynamically`.

## Task A7: Company canonicalization and deduplication
**Files:** Create `discovery/{normalizer,identity}.py`, `tests/integration/test_identity.py`.
**Interfaces:** `canonicalize_url(url: str) -> str`; `resolve_company(candidate: JobCandidate) -> Resolution[UUID]`; `upsert_job(candidate: JobCandidate, company_id: UUID) -> UUID`.
- [ ] RED tests: `test_aliases_same_domain_one_company`, `test_similar_names_different_domains_not_merged`, `test_tracking_parameters_same_job`, `test_conflicting_domains_held_for_review`, `test_parallel_upsert_one_job`.
- [ ] Run selected tests; RED.
- [ ] Implement normalized registered domains (careful with shared hosted ATS domains), stable ATS aliases, manual conflict queue, canonical URL handling, unique DB upserts.
- [ ] Rerun; GREEN; perform concurrent insert stress test.
- [ ] Commit `feat(discovery): canonical company and job identities`.

## Task A8: Publication freshness, live status and source budgeting
**Files:** Create `discovery/{freshness,scheduler}.py`, `supabase/migrations/0004_discovery.sql`, `tests/unit/test_freshness.py`, `tests/integration/test_source_schedule.py`.
**Interfaces:** `classify_freshness(published_at: datetime | None, updated_at: datetime | None, first_seen_at: datetime, now: datetime) -> Freshness`; `choose_source(sources: list[SourceStats], remaining_budget: Budget) -> SourceChoice | None`; `verify_open(job: Job) -> VerificationResult`.
- [ ] RED tests: `test_updated_old_posting_not_fresh`, `test_72h_then_7d_windows`, `test_missing_timestamp_labeled_unknown`, `test_no_budget_no_requests`, `test_source_exploration_nonzero`, `test_404_job_closed`.
- [ ] Run tests; RED.
- [ ] Implement freshness classification (72h primary, 7-day expansion), rate/budget aware source selection with explicit exploration floor, link verification with status/redirect handling.
- [ ] Rerun; GREEN; compare recorded sources with original timestamps.
- [ ] Commit `feat(discovery): freshness and budget-aware scheduling`.

## Task A9: Eligibility evidence + agent assessment
**Files:** Create `eligibility/{rules,research,evidence}.py`, `tests/unit/test_eligibility.py`, `tests/integration/test_eligibility_graph.py`.
**Interfaces:** `extract_hard_restrictions(job: JobCandidate) -> RestrictionResult`; `research_eligibility(job_id: UUID, context: UserEligibilityContext) -> EligibilityDecision`; `persist_assessment(job_id: UUID, decision: EligibilityDecision) -> UUID`.
- [ ] RED tests: `test_us_only_remote_is_ineligible`, `test_explicit_no_sponsorship_overrides_forum_post`, `test_no_authoritative_evidence_unknown`, `test_bounded_research_timeout`, `test_prompt_injection_in_job_text_has_no_tool_authority`, `test_verified_eligible_requires_sources`.
- [ ] Run; RED.
- [ ] Implement rule-first screening, bounded official-site evidence gathering, optional permitted public discussion lookup, contradiction tracking and Pydantic validated output; only definitive results advance.
- [ ] Rerun; GREEN. Manually audit 30 fixture postings and document confusion matrix.
- [ ] Commit `feat(eligibility): evidence-gated remote screening`.

## Task A10: Knowledge-aware matching with offline fallback
**Files:** Create `matching/{scoring,agent}.py`, `tests/unit/test_matching.py`.
**Interfaces:** `score_match(job_id: UUID, knowledge_revision: str, model_available: bool) -> MatchResult`; `revalidate_match(job_id: UUID, knowledge_revision: str) -> MatchResult`.
- [ ] RED tests: `test_scoring_deterministic_without_ollama`, `test_high_fit_cannot_override_ineligibility`, `test_profile_claim_removed_changes_match`, `test_prompt_revision_recorded`.
- [ ] Run; RED.
- [ ] Implement deterministic rubric, permission-filtered retrieval, optional LLM improvement, bounded timeouts, evidence citation and schema validation; queue advanced pass if local model offline.
- [ ] Rerun; GREEN.
- [ ] Commit `feat(matching): profile grounded opportunity ranking`.

## Task A11: Idempotent daily batch and manual applications
**Files:** Create `discovery/batches.py`, `applications/tracker.py`, `supabase/migrations/0005_applications.sql`, `tests/integration/test_batches.py`, `tests/integration/test_applications.py`.
**Interfaces:** `materialize_batch(owner_user_id: UUID, local_date: date, target: int = 100) -> BatchResult`; `record_application(owner_user_id: UUID, job_id: UUID, status: ApplicationStatus, at: datetime) -> UUID`.
- [ ] RED tests: `test_restart_batch_no_duplicate`, `test_two_workers_one_company_never_repeated`, `test_only_verified_eligible_batch`, `test_100_is_upper_bound`, `test_empty_batch_reports_shortfall`, `test_same_application_import_upserts`.
- [ ] Run tests; RED.
- [ ] Implement transaction inserting `delivered_companies` and `daily_batch_items` atomically, ranked selection one job/company, user-local day calculation, manual status events.
- [ ] Rerun; GREEN; simulate a 30-day batch run and assert zero repeated delivered company IDs.
- [ ] Commit `feat(batches): lifetime unique delivery and applications`.

## Task A12: Remote private dashboard, read APIs and observability
**Files:** Create Next.js routes under `apps/web/src/app/{dashboard,opportunities,companies,applications,knowledge,operations,settings}/`, `apps/web/src/lib/{auth,db,api}/`, `apps/web/tests/{unit,e2e}/`, `services/worker/src/career/observability/metrics.py`.
**Interfaces:** Authenticated `GET /api/batches/today`, `GET /api/companies/{id}`, `POST /api/applications`, `GET /api/operations/tasks`, `GET /api/knowledge/sync`; requests validated against OpenAPI `packages/contracts/openapi.yaml`.
- [ ] RED UI E2E tests: anonymous route denied; authenticated owner can see daily batch/evidence; application status saved; other owner cannot fetch data; Mac offline renders queued AI notice; task failure is inspectable.
- [ ] Run `npm --prefix apps/web run test:e2e` on test server; RED.
- [ ] Build minimal accessible screens and typed API routes with Supabase Auth/RLS; expose task state and source budget without secrets.
- [ ] Run E2E; GREEN; run web lint/typecheck and API contract verification.
- [ ] Commit `feat(web): authenticated opportunities and operations MVP`.

## Task A13: Scheduling, encrypted backups and recovery gate
**Files:** Create `.github/workflows/{discover,reconcile,backup-check}.yml`, `infra/backup/{export,restore,verify}.py`, `tests/integration/test_recovery.py`, `docs/operations/runbook.md`.
**Interfaces:** `reconcile_due_runs(now: datetime) -> list[UUID]`; `backup_database(destination: BackupTarget) -> BackupManifest`; `verify_restore(manifest: BackupManifest, test_dsn: str) -> RestoreReport`.
- [ ] RED tests: `test_missed_cron_queues_once`, `test_backup_restore_preserves_delivered_history`, `test_restore_preserves_suppressions_when_tables_exist`, `test_backup_never_commits_secrets`, `test_expired_worker_reclaimed`.
- [ ] Run; RED.
- [ ] Implement idempotent scheduled launcher, catch-up due-run reconciler, protected encrypted backup to a separately authorized destination, isolated restore verifier, source quota/zero-dollar guard and runbook.
- [ ] Rerun; GREEN; execute manual disaster recovery drill in disposable DB, record evidence and limitations.
- [ ] Commit `feat(ops): recurring discovery and tested recovery`.

## Milestone verification
- **A-M0** Tasks A1–A4: migration from blank Postgres + concurrent lease/recovery tests.
- **A-M1** Task A5: authorized Obsidian sync; no private notes, correct fact deletion.
- **A-M2** Tasks A6–A11: 3 independent sources, freshness and eligibility fixture review, 30-day duplicate-free batches.
- **A-M3** Tasks A12–A13: deployed authenticated dashboard, cloud worker works Mac-offline, protected restore, no external paid calls.

## Deferred to Plans B/C
People research, Simplify CSV, contact enrichment, market learning, outbound drafts/sending and conversation ingestion. Do not secretly implement them as part of discovery core.
