# People Intelligence & Market Learning Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Automatically research relevant professionals for verified-eligible job opportunities, establish evidence-backed professional connections, learn scoped employer hiring facts, and reconcile supported Simplify application CSVs without spending money or sending mail.

**Architecture:** People Agent consumes durable eligibility-completed events from Plan A and performs bounded permitted research; profile and claim records are source-backed and confidence-labelled. Company intelligence is stored separately from canonical personal knowledge; a deterministic importer reconciles Simplify CSV data. Optional enrichment is strictly budget-gated.

**Tech Stack:** Python 3.12+, Pydantic v2, LangGraph, PostgreSQL, HTTPX, pytest, Next.js.

**Spec:** `docs/superpowers/specs/2026-11-10-career-intelligence-design.md`; depends on Plan A fully passing.

## Global Constraints
- Automatic research starts **only after** a verified-eligible posting is persisted. Up to five ranked contacts per company; research is NOT sending.
- Never fabricate relationship overlap, employer affiliation, colleague status, or personal familiarity. Source citations are mandatory.
- Zero external paid enrichment by default; no phone enrichment; no unauthorized platform scraping.
- Employer policy claims are scoped to role/company/time and may not be universalized from a single recruiter response.
- No Gmail credentials, message sending, or unreviewed personal knowledge edits in this plan.

## Review Focus
- Multiple profiles with identical names must not be merged automatically (B2).
- A former KAIST research affiliation must not imply knowing a contact personally (B3).
- An old recruiter reply about one US-only vacancy must not ban a whole company (B4).
- A paid enrichment endpoint must not be called when configured budget is zero (B5).
- Duplicate Simplify CSV uploads must not create repeated applications (B6).

## File responsibilities
```text
supabase/migrations/0006_people.sql
supabase/migrations/0007_market_intelligence.sql
supabase/migrations/0008_imports.sql
services/worker/src/career/people/{models,research,identity,connections,ranking,enrichment}.py
services/worker/src/career/eligibility/market_memory.py
services/worker/src/career/applications/{simplify_csv,reconcile}.py
services/worker/tests/{unit,integration,contract}/test_*.py
apps/web/src/app/{people,companies,knowledge,applications}/
apps/web/tests/e2e/people.spec.ts
packages/contracts/schemas/{contact,relationship,employer-claim,simplify-import}.json
```

## Persistent schema contracts
**0006_people.sql**
- `contacts(id uuid pk, owner_user_id uuid, company_id uuid fk, full_name text, current_title text, public_profile_url text null, identity_state text, first_seen_at timestamptz, last_verified_at timestamptz, unique(owner_user_id,company_id,public_profile_url) where public_profile_url is not null)`.
- `contact_evidence(id uuid pk, contact_id uuid fk, source_url text, source_type text, claim text, observed_at timestamptz, confidence text)`.
- `relationship_matches(id uuid pk, contact_id uuid fk, relationship_type text, personal_fact_id uuid fk knowledge_facts, evidence_id uuid fk contact_evidence, overlap_start date null, overlap_end date null, is_personally_known boolean default false, status text)`; never derive personal acquaintance from coincidental dates.
- `contact_research_runs(id uuid pk, company_id uuid fk, job_id uuid fk, workflow_id uuid fk, status text, started_at timestamptz, completed_at timestamptz, unique(company_id,job_id))`.
- `contact_methods(id uuid pk, contact_id uuid fk, method_type text, method_value_ciphertext bytea null, masked_value text, verification text, source text, suppression_status text, verified_at timestamptz null)`; raw email encrypted at app layer and never copied to audit exports.

**0007_market_intelligence.sql**
- `employer_claims(id uuid pk, company_id uuid fk, job_id uuid fk null, claim_type text, claim_text text, evidence_class text, confidence text, scope text, valid_from timestamptz null, valid_until timestamptz null, status text, superseded_by uuid null)`.
- `employer_evidence(id uuid pk, claim_id uuid fk, source_url text null, message_ref text null, excerpt text, excerpt_hash text, observed_at timestamptz, published_at timestamptz null)`.
- `intelligence_revisions(id uuid pk, company_id uuid fk, run_id uuid null, revision_reason text, created_at timestamptz)`.
- `knowledge_corrections(id uuid pk, subject_type text, subject_id uuid, proposed_change jsonb, status text, created_at timestamptz)`.

**0008_imports.sql**
- `external_imports(id uuid pk, owner_user_id uuid, provider text, file_hash text, imported_at timestamptz, status text, rows_read int, rows_updated int, rows_rejected int, unique(owner_user_id,provider,file_hash))`.
- `external_application_links(id uuid pk, owner_user_id uuid, provider text, external_key text, application_id uuid fk, unique(owner_user_id,provider,external_key))`.
Enable owner RLS and restricted worker authorization on all private tables; add check constraints for evidence class, confidence, status and method types.

## Interfaces
```python
class ContactCandidate(BaseModel):
    company_id: UUID
    name: str
    title: str
    public_profile_url: AnyUrl | None
    evidence: list[EvidenceRef]

class RelationshipMatch(BaseModel):
    contact_id: UUID
    kind: Literal['education','research','employment','project','interest','known_person']
    personal_fact_id: UUID
    source_evidence_id: UUID
    personally_known: bool = False
    confidence: Literal['verified','probable','unknown']

class EmployerClaim(BaseModel):
    company_id: UUID
    job_id: UUID | None
    claim_type: str
    scope: Literal['job','team','country','company']
    evidence_class: Literal['official','direct_employer','observed','community','inference']
    confidence: Literal['verified','corroborated','unverified']
    valid_until: datetime | None
```

## Task B1: Automatic event-driven contact research trigger
**Files:** Create `0006_people.sql`, `people/{models,research}.py`, `tests/integration/test_contact_trigger.py`.
**Interfaces:** `on_eligibility_verified(job_id: UUID, assessment_id: UUID) -> UUID`; `research_contacts(company_id: UUID, job_id: UUID, max_contacts: int = 5) -> list[ContactCandidate]`.
- [ ] Write RED tests `test_verified_event_enqueues_once`, `test_likely_or_unknown_does_not_trigger`, `test_5_contact_cap`, `test_failure_is_retriable`.
- [ ] Run `uv run pytest services/worker/tests/integration/test_contact_trigger.py -v`; verify RED.
- [ ] Implement outbox or durable event -> task transaction; bounded, permission-compliant provider adapters; persist research result and source evidence.
- [ ] Rerun; GREEN; repeat same event 10 times and assert one research workflow.
- [ ] Commit `feat(people): research contacts on verified eligibility`.

## Task B2: Contact identity resolution and provenance
**Files:** Create `people/identity.py`, `tests/unit/test_contact_identity.py`, `tests/integration/test_contact_identity_db.py`.
**Interfaces:** `resolve_contact(candidate: ContactCandidate) -> Resolution[UUID]`; `record_contact_evidence(contact_id: UUID, refs: list[EvidenceRef]) -> list[UUID]`.
- [ ] RED tests `test_same_name_two_profiles_not_merged`, `test_profile_url_same_contact`, `test_old_employment_current_role_unverified`, `test_missing_evidence_marks_unknown`.
- [ ] Run target tests; RED.
- [ ] Implement identity key preference (verified profile ID/URL; employer association), confidence and conflict queue, cite-preserving persistence.
- [ ] Rerun; GREEN.
- [ ] Commit `feat(people): evidence backed contact identity`.

## Task B3: Professional relationship matching and priority
**Files:** Create `people/{connections,ranking}.py`, `tests/unit/test_relationships.py`.
**Interfaces:** `match_connections(contact_id: UUID, knowledge_revision: str) -> list[RelationshipMatch]`; `rank_contacts(company_id: UUID, job_id: UUID) -> list[RankedContact]`.
- [ ] RED tests `test_shared_kaist_not_personally_known`, `test_unverified_work_overlap_no_colleague_claim`, `test_personal_fact_deletion_invalidates_match`, `test_relevant_team_outweighs_unrelated_alumnus`, `test_private_fact_not_used`.
- [ ] Run tests; RED.
- [ ] Implement join of evidence and permission-filtered knowledge with explicit relation type, source, confidence; weight role relevance and connection quality deterministically before LLM commentary.
- [ ] Rerun; GREEN; inspect generated output and claim evidence.
- [ ] Commit `feat(people): verifiable relationship matching`.

## Task B4: Employer market intelligence, scoped learning and contradiction
**Files:** Create `0007_market_intelligence.sql`, `eligibility/market_memory.py`, `tests/unit/test_market_memory.py`, `tests/integration/test_market_reassessment.py`.
**Interfaces:** `ingest_employer_claim(claim: EmployerClaim, evidence: EvidenceRef) -> UUID`; `get_relevant_claims(company_id: UUID, job_id: UUID) -> list[EmployerClaim]`; `resolve_claim_conflicts(company_id: UUID) -> list[Conflict]`.
- [ ] RED tests `test_us_only_recruiter_reply_scoped_to_job`, `test_expired_company_policy_not_authoritative`, `test_conflicting_sources_both_preserved`, `test_new_current_official_policy_supersedes_old_claim`, `test_model_summary_not_repromoted_to_verified`.
- [ ] Run; RED.
- [ ] Implement append-only evidence, scoped claims with validity, limited automatic status promotion only for authoritative evidence, contradiction flags and reassessment task emission.
- [ ] Rerun; GREEN; rerun eligibility against two jobs at same employer with different restrictions.
- [ ] Commit `feat(intelligence): scoped hiring memory and reconciliation`.

## Task B5: Optional contact method enrichment with hard zero-budget gate
**Files:** Create `people/enrichment.py`, `tests/unit/test_enrichment_budget.py`, `tests/integration/test_provider_intents.py`.
**Interfaces:** `authorize_enrichment(provider: str, contact_id: UUID, quoted_cost: Decimal) -> EnrichmentAuthorization`; `enrich_business_email(auth: EnrichmentAuthorization) -> ContactMethod | Deferred`.
- [ ] RED tests `test_zero_budget_blocks_paid_network_call`, `test_usage_reservation_atomic`, `test_retry_does_not_double_bill_intent`, `test_private_personal_email_not_accepted`, `test_unverified_email_not_autosend_eligible`.
- [ ] Run; RED.
- [ ] Implement credit quote and reservation, external intent key, provider adapter behind mockable transport; accept public business contact methods; encrypt stored sensitive values.
- [ ] Rerun; GREEN; verify provider fake receives 0 calls under hard-zero budget.
- [ ] Commit `feat(people): budget protected contact enrichment`.

## Task B6: Simplify supported CSV import/export and reconcile
**Files:** Create `0008_imports.sql`, `applications/{simplify_csv,reconcile}.py`, `tests/contract/test_simplify_csv.py`, `tests/integration/test_import_reconcile.py`.
**Interfaces:** `parse_simplify_csv(file_bytes: bytes) -> ImportPreview`; `apply_import(preview: ImportPreview, owner_id: UUID) -> ImportReport`; `export_applications(owner_id: UUID) -> bytes`.
- [ ] RED tests `test_duplicate_file_hash_idempotent`, `test_changed_row_updates_existing_status`, `test_bad_date_rejected_per_row`, `test_unknown_company_not_falsely_merged`, `test_formula_injection_escaped_on_export`.
- [ ] Run; RED.
- [ ] Implement schema-mapping adapter for **verified** Simplify export format with versioned column map, preview validation, row-level rejections, canonical identity reconciliation, CSV escaping; if format unknown, implement generic adapter and require captured authorized sample before enabling provider-specific map.
- [ ] Rerun; GREEN; round-trip sample fixture and assert status/event history intact.
- [ ] Commit `feat(applications): supported CSV reconciliation`.

## Task B7: People, learned knowledge and imports dashboard
**Files:** Create Next.js `/people`, company contacts and knowledge-intelligence views, `/applications/import` route, `apps/web/tests/e2e/people.spec.ts`.
**Interfaces:** `GET /api/companies/{id}/contacts`, `GET /api/companies/{id}/intelligence`, `POST /api/applications/import/preview`, `POST /api/applications/import/commit`, `POST /api/intelligence/{claim_id}/correct`.
- [ ] RED E2E tests `eligible_job_contacts_queued`, `view_evidence_for_connection`, `import_preview_before_commit`, `revoke_invalid_claim`, `anonymous_contact_data_denied`.
- [ ] Run Playwright; RED.
- [ ] Implement private views, source badges, correction workflow, import preview and commit; never display unmasked contact values without explicit authenticated action.
- [ ] Rerun; GREEN; accessibility checks keyboard paths and announcements.
- [ ] Commit `feat(web): people and learned employer intelligence`.

## Milestone gates
- **B-M1:** Verified eligible job emits one research workflow, finds max 5 evidence-backed profiles, no message sends.
- **B-M2:** Human audit of 25 contact records with zero unsupported shared-acquaintance claims and explicit unknowns.
- **B-M3:** Employer policy contradiction tests pass; a job-specific restriction never becomes universal policy.
- **B-M4:** CSV round-trip is idempotent and protected; unknown format explicitly blocked; zero paid enrichment calls.

## Verification commands
`uv run pytest services/worker/tests/unit -q`
`uv run pytest services/worker/tests/integration -q`
`uv run pytest services/worker/tests/contract -q`
`npm --prefix apps/web run test:e2e`
`uv run ruff check services/worker && uv run mypy services/worker/src`
