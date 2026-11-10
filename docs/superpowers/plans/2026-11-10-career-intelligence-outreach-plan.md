# Outreach & Conversation Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Generate source-grounded professional emails, safely send only individually approved or narrowly pre-authorized messages via a credential-isolated Gmail Dispatcher, reconcile uncertain delivery states, and learn from replies without repeating messages or inventing facts.

**Architecture:** The Outreach/Conversation LangGraph agents produce typed draft and classification records; a separate deterministic authorization engine and Gmail Dispatcher own all send decisions and Gmail credentials. Every send request is persisted first, transitioned under row lock, and provider outcomes are reconciled before retries. Reply processing uses authorized scoped Gmail reads and feeds role/company/time-specific market intelligence.

**Tech Stack:** Python 3.12+, Pydantic v2, LangGraph, PostgreSQL, pytest, Gmail API OAuth, Next.js/TypeScript/Playwright.

**Spec:** `docs/superpowers/specs/2026-11-10-career-intelligence-design.md`; depends on Plans A and B passing.

## Global Constraints
- No agent gets send credentials, direct arbitrary Gmail endpoint access, or permission to modify policy.
- Default manual-review mode; bounded automatic mode must be **explicitly enabled** by user and remain revocable.
- Proposed initial enabled limits: 10 initial messages/day, 1 initial message/company/day, verified business email, confirmed application, no automatic referral request, no automatic follow-up unless separately approved.
- Send intents are immutable after approval; editing draft creates a new approval requirement. Recheck current knowledge and suppression at dispatch time.
- Ambiguous Gmail send outcome requires provider reconciliation or manual review; **never blind retry**.
- Unsubscribe/decline and suppression states stop future outreach.

## Review Focus
- A revoked policy between approval and dispatch must stop the send (C3/C4).
- A deleted or corrected knowledge claim must invalidate stale personalization (C1/C3).
- Gmail may have accepted a message before a network timeout: hold and reconcile, no resend (C4).
- Same contact might appear at two employers or in two applications: prevent unintended duplicate outreach (C3/C4).
- A reply containing malicious instructions must never authorize a follow-up or tool use (C5).

## File responsibilities
```text
supabase/migrations/0009_outreach.sql
supabase/migrations/0010_conversation.sql
services/worker/src/career/outreach/{models,drafting,quality,policy,intents,gmail_dispatcher,reconcile}.py
services/worker/src/career/conversation/{gmail_reader,classifier,followups,learning}.py
services/worker/tests/{unit,integration,contract}/test_*.py
apps/web/src/app/{outreach,settings,applications}/
apps/web/tests/e2e/outreach.spec.ts
packages/contracts/schemas/{draft,send-policy,send-intent,reply-classification}.json
```

## Schema contracts
**0009_outreach.sql**
- `outreach_drafts(id uuid pk, owner_user_id uuid, contact_id uuid fk, application_id uuid fk null, subject text, body text, knowledge_revision text, claim_refs jsonb, intent_type text, quality_state text, created_at timestamptz, updated_at timestamptz)`.
- `outreach_policies(id uuid pk, owner_user_id uuid, version int, enabled boolean default false, categories jsonb, allowed_recipient_types jsonb, daily_limit int default 10, company_daily_limit int default 1, require_confirmed_application boolean default true, allow_auto_followups boolean default false, valid_from timestamptz, revoked_at timestamptz null, unique(owner_user_id,version))`.
- `outreach_approvals(id uuid pk, draft_id uuid fk, policy_id uuid fk null, approval_kind text, approved_message_hash text, approved_recipient_hash text, approved_at timestamptz, expires_at timestamptz, revoked_at timestamptz null)`.
- `suppression_records(id uuid pk, owner_user_id uuid, contact_id uuid fk null, normalized_email_hash text null, company_id uuid fk null, reason text, active boolean, created_at timestamptz)`; index active suppression matches.
- `outbound_messages(id uuid pk, owner_user_id uuid, draft_id uuid fk, approval_id uuid fk null, recipient_method_id uuid fk, company_id uuid fk, intent_key text unique, status text, message_hash text, gmail_message_id text null, gmail_thread_id text null, reserved_at timestamptz, sent_at timestamptz null, last_attempt_at timestamptz null, uncertainty_reason text null)`.
- `message_attempts(id uuid pk, outbound_id uuid fk, provider text, started_at timestamptz, finished_at timestamptz null, result text, provider_request_key text null, error_code text null)`.

**0010_conversation.sql**
- `conversation_events(id uuid pk, owner_user_id uuid, gmail_message_id text, gmail_thread_id text, outbound_id uuid fk null, event_type text, classification text, evidence_excerpt text, received_at timestamptz, processed_at timestamptz, unique(owner_user_id,gmail_message_id))`.
- `reply_ingestion_cursors(id uuid pk, owner_user_id uuid unique, gmail_history_id text null, last_success_at timestamptz)`.
- `followup_suggestions(id uuid pk, owner_user_id uuid, conversation_id uuid fk conversation_events, draft_id uuid fk null, status text, suggested_at timestamptz)`.
Include check constraints/status enums, owner RLS, encryption/access controls for addresses and correspondence; avoid raw mailbox archive duplication.

## Interfaces
```python
class DraftEmail(BaseModel):
    contact_id: UUID
    application_id: UUID | None
    subject: str
    body: str
    knowledge_revision: str
    evidence_ids: list[UUID]
    intent_type: Literal['conversation','role_question','referral','follow_up']

class SendDecision(BaseModel):
    allowed: bool
    reason_codes: list[str]
    policy_version: int | None
    mode: Literal['manual','standing','blocked']

class ReplyClassification(BaseModel):
    kind: Literal['positive','referral','interview','information','rejection','decline','opt_out','unrelated']
    confidence: float
    related_application_id: UUID | None
    suggested_action: str | None
```

## Task C1: Evidence-grounded draft generation
**Files:** Create `0009_outreach.sql`, `outreach/{models,drafting,quality}.py`, `tests/unit/test_drafts.py`, `tests/integration/test_draft_graph.py`.
**Interfaces:** `generate_draft(contact_id: UUID, application_id: UUID | None, intent_type: str, knowledge_revision: str) -> DraftEmail`; `validate_claims(draft: DraftEmail) -> DraftQualityReport`.
- [ ] RED tests `test_real_shared_kaist_only_says_shared_affiliation`, `test_no_connection_does_not_invent_one`, `test_stale_knowledge_invalidates_draft`, `test_missing_evidence_requires_review`, `test_draft_agent_has_no_gmail_tool`.
- [ ] Run `uv run pytest services/worker/tests/unit/test_drafts.py -v`; RED.
- [ ] Implement permission-filtered retrieval, bounded model invocation/local queue fallback, evidence references, draft schema and factual guardrails.
- [ ] Rerun; GREEN; human-review 20 generated fixture drafts.
- [ ] Commit `feat(outreach): evidence grounded personalized drafting`.

## Task C2: Gmail OAuth and least-privilege connection
**Files:** Create `outreach/gmail_dispatcher.py` OAuth adapter and token store interface, `tests/integration/test_gmail_auth.py`, dashboard connection UI.
**Interfaces:** `authorize_gmail(owner_id: UUID, code: str, state: str) -> GmailConnection`; `revoke_gmail(owner_id: UUID) -> None`; `get_scoped_gmail_client(owner_id: UUID, scopes: frozenset[str]) -> GmailClient`.
- [ ] RED tests `test_oauth_state_csrf_rejected`, `test_secret_not_returned_to_browser`, `test_revocation_blocks_dispatch`, `test_read_scope_not_send_scope`.
- [ ] Run tests with fake provider; RED.
- [ ] Implement secure OAuth flow with minimum necessary scopes, server-side encrypted token storage and revocation; avoid presenting credentials to agents.
- [ ] Rerun; GREEN; complete sandbox/manual connection check without sending.
- [ ] Commit `feat(gmail): scoped and revocable oauth connection`.

## Task C3: Hybrid deterministic authorization and suppression
**Files:** Create `outreach/policy.py`, `tests/unit/test_send_policy.py`, `tests/integration/test_policy_race.py`, settings UI.
**Interfaces:** `evaluate_send(draft_id: UUID, contact_method_id: UUID, now: datetime) -> SendDecision`; `approve_exact_draft(draft_id: UUID, recipient_method_id: UUID, expires_at: datetime) -> UUID`; `enable_standing_policy(owner_id: UUID, policy_input: PolicyInput) -> UUID`; `revoke_policy(policy_id: UUID) -> None`.
- [ ] RED tests `test_default_manual`, `test_automatic_requires_explicit_enable`, `test_10_daily_and_1_company_cap`, `test_unverified_email_blocked`, `test_missing_application_blocked`, `test_referral_request_manual_only`, `test_followup_needs_separate_policy`, `test_opt_out_suppresses`, `test_changed_draft_invalidates_approval`, `test_revoked_policy_before_send_blocks`, `test_deleted_fact_blocks_stale_draft`.
- [ ] Run tests; RED.
- [ ] Implement normalized recipient identity, immutable content hashes, atomic quota reservations, full policy reason codes, real-time suppression, knowledge revalidation and immediate pause.
- [ ] Rerun; GREEN; run race test with two concurrent reservations at daily limit.
- [ ] Commit `feat(outreach): revocable bounded send authorization`.

## Task C4: Gmail Dispatcher, transactional intents and ambiguity reconciliation
**Files:** Create `outreach/{intents,gmail_dispatcher,reconcile}.py`, `tests/integration/test_gmail_dispatch.py`.
**Interfaces:** `reserve_send(draft_id: UUID, method_id: UUID, approval_id: UUID | None) -> UUID`; `dispatch_send(outbound_id: UUID) -> DispatchResult`; `reconcile_send(outbound_id: UUID) -> ReconcileResult`.
- [ ] RED tests `test_duplicate_enqueue_single_intent`, `test_two_workers_only_one_dispatch`, `test_timeout_after_acceptance_does_not_resend`, `test_send_reconciled_by_provider_message_id_or_verified_sent_item`, `test_unresolved_send_held_for_manual_review`, `test_policy_revocation_blocks_dispatch`, `test_suppression_race_blocks_dispatch`.
- [ ] Run tests against deterministic fake Gmail client; RED.
- [ ] Implement DB-reserved send intent before provider call; transactional state transitions, stable local correlation headers/message ID when supported, Gmail send, provider receipt storage, reconciliation by provider records; do not blindly retry unknown outcomes.
- [ ] Rerun; GREEN; simulate crash at each durable boundary and verify one-or-zero provider sends under test expectations.
- [ ] Commit `feat(outreach): audited idempotent gmail dispatcher`.

## Task C5: Reply ingestion, classification, scoped employer learning
**Files:** Create `0010_conversation.sql`, `conversation/{gmail_reader,classifier,learning}.py`, `tests/integration/test_reply_ingest.py`, `tests/unit/test_reply_classification.py`.
**Interfaces:** `ingest_gmail_changes(owner_id: UUID, cursor: str | None) -> IngestReport`; `classify_reply(message_ref: str) -> ReplyClassification`; `propose_market_claim(reply: ReplyClassification, message_ref: str) -> EmployerClaim | None`.
- [ ] RED tests `test_duplicate_message_ingested_once`, `test_opt_out_creates_suppression`, `test_us_only_reply_scoped_to_exact_role`, `test_quoted_prompt_injection_cannot_send`, `test_unrelated_email_ignored`, `test_history_cursor_expiry_reconciliation`.
- [ ] Run tests; RED.
- [ ] Implement scoped inbox read, threading/reply association, Pydantic classification, appropriate suppression, application event append and market claim evidence with correct scope/verification class; no raw mailbox-wide retention.
- [ ] Rerun; GREEN; run offline fixture dataset and manually review misclassifications.
- [ ] Commit `feat(conversation): reply classification and scoped learning`.

## Task C6: Follow-up drafting without unrestricted sending
**Files:** Create `conversation/followups.py`, `tests/unit/test_followups.py`.
**Interfaces:** `suggest_followup(thread_id: str, now: datetime) -> FollowUpSuggestion | None`; `prepare_followup_draft(suggestion_id: UUID) -> UUID`.
- [ ] RED tests `test_decline_disables_followup`, `test_opt_out_disables_followup`, `test_no_automatic_followup_without_policy`, `test_sent_thread_not_resent_on_retry`, `test_unanswered_thread_returns_reviewable_draft`.
- [ ] Run; RED.
- [ ] Implement reply-aware suggestions, cooldown, conversation closure, explicit policy re-evaluation and draft-only default behavior.
- [ ] Rerun; GREEN.
- [ ] Commit `feat(conversation): guarded followup recommendations`.

## Task C7: Outreach dashboard, full system recovery test
**Files:** Create web `/outreach` and settings pages, `/api/outreach/{drafts,approvals,queue,pause}`, `/api/conversations`, `apps/web/tests/e2e/outreach.spec.ts`, `tests/integration/test_full_outreach_recovery.py`, update `infra/backup/verify.py`.
**Interfaces:** Authenticated list/edit/approve/queue/pause endpoints; send operations invoked **only** via dispatcher command, never direct web-route raw Gmail call.
- [ ] RED E2E tests `draft_edits_require_new_approval`, `manual_send_review_flow`, `auto_send_opt_in_flow`, `pause_stops_unsent`, `opt_out_visible`, `different_user_cannot_see_messages`, `restored_db_preserves_send_intents_and_suppressions`.
- [ ] Run Playwright and integration suite; RED.
- [ ] Implement approval screen with evidence detail, policy controls, live pause, message status/reconciliation UI, protected event timeline; extend restore verifier for complete state.
- [ ] Rerun; GREEN; separately test with sandbox Gmail account and explicit authorization; no live mass sends.
- [ ] Commit `feat(web): controlled outreach and conversation workspace`.

## Milestone gates
- **C-M1:** 20 draft fixture audit; zero unsupported claims and proper stale-knowledge invalidation.
- **C-M2:** OAuth and revocation tests; tokens remain inaccessible to browser and model agents.
- **C-M3:** Exact-message manual approval succeeds with provider fake; unauthorized requests produce no send call.
- **C-M4:** Opt-in bounded auto-send enforces all limits and is instantly revocable.
- **C-M5:** Gmail ambiguous failure does not duplicate messages in fault injection; unreconciled state held for review.
- **C-M6:** Replies/opt-outs update the scoped employer ledger and suppression list; backups restore send history.

## Verification commands
`uv run pytest services/worker/tests/unit -q`
`uv run pytest services/worker/tests/integration -q`
`uv run pytest services/worker/tests/contract -q`
`npm --prefix apps/web run test:e2e`
`uv run ruff check services/worker && uv run mypy services/worker/src`
Before any non-test outbound send, complete separate review of Gmail scopes, provider policy, privacy and anti-spam rules, approval mechanism, and contact identity provenance.
