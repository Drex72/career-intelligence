# Personal Job Discovery & Outreach Intelligence Platform — Approved Design Baseline

**Origin:** PRD v0.5 approved by the user on 2026-11-10. This document is an execution-oriented record of that approved conversation specification, not a replacement for it.

## Intent
A privately authenticated, remotely accessible, single-user product finds up to 100 **previously undelivered companies** with relevant jobs per day, verifies that the user in Nigeria is eligible for global remote/relocation opportunities, ranks openings against an editable Obsidian personal knowledge base, and researches professional contacts automatically after verification. It later supports supported Simplify CSV integration, evidence-grounded drafts, hybrid bounded Gmail sending, reply classification, and job-market learning.

## Invariants
- **Zero additional paid spending by default**; free-tier exhaustion must defer work and be visible, not trigger charges.
- **Strict lifetime company exclusion** from *new* daily batches, plus job-level uniqueness. Discovery and previously delivered company profiles may continue to be updated internally.
- Up to 100 recommendations/day is a **target, not a guarantee**. No fake or irrelevant fillers. One primary job per company; other jobs viewable in profile.
- Job postings, web pages, email, and external profile text are **untrusted data**, never executable instructions.
- Job-specific explicit work restrictions outweigh inferred or anecdotal company policies. Verified / likely / unknown / ineligible are distinct states; only verified eligible enters the default daily batch.
- Company intelligence is scoped to job/company/time and retains original sources and contradiction states. Do not universalize individual replies.
- Obsidian Markdown in an **independent private Git repository** is the editable source for approved personal knowledge. PostgreSQL is the query index and operational source for company/job/task state. Exclude `07-private/` from sync and indexing by default. Never commit secrets, contact lists, or raw correspondence.
- Six *logical* LangGraph roles: Discovery, Eligibility, Matching, People, Outreach, Conversation. Workers are ephemeral and may run concurrently; no always-on six-model infrastructure.
- Durable task ledger supports ownership leases, dependencies, checkpoint references, bounded retries, dead letters, structured output validation, and audited events. Database state is authoritative; GitHub stores versioned code, prompts, migrations, approved sanitized exports; encrypted backups are separate.
- Eligible posting automatically triggers People research (up to 5 contacts/company). Public professional identities need evidence. Email enrichment is selective and budget-bound.
- Applications are user-confirmed initially. Simplify integration uses supported CSV flow unless a documented API exists.
- Gmail Dispatcher **alone** owns send credentials. Default manual review; optional **hybrid** pre-authorized automatic sending is explicitly enabled, revocable, and bounded. Proposed initial maximum when enabled: 10 initial emails/day, 1/company/day, verified business addresses, confirmed application, no automatic referral request or follow-up. Suppression and ambiguous-send reconciliation are mandatory.
- Dashboard must be usable while Mac/Ollama is offline; advanced inference may queue. GitHub Actions scheduling is at-least-once/best-effort, so missed-run reconciliation is needed.

## Architectural approaches considered
1. Fully local: cheapest but offline when Mac is off.
2. **Selected:** free-tier cloud dashboard/database/bounded schedulers + optional outbound-polling local Ollama worker; remotely accessible with graceful degradation.
3. Existing products plus thin custom discovery: quicker initially, insufficient lifetime uniqueness, autonomy and provenance.
For durable workflows: LangGraph + Postgres ledger chosen; Temporal deferred due hosting complexity; Gas Town concepts adopted without requiring Gas Town runtime.

## Product release boundaries
A. **Discovery Core**: durable substrate, approved personal knowledge, connectors, company normalization, freshness, source-backed eligibility, matching, remotely accessible dashboard, application tracking, recurring jobs, backups.
B. **People & Intelligence**: automatic people research, relationship evidence, company learning, Simplify import/export.
C. **Outreach & Conversation**: selectively enriched business emails, drafts, hybrid policy, Gmail dispatcher and reconciliation, replies and follow-ups.

## Security
Use authenticated single-user dashboard, server-side secrets, tight RLS, scoped worker service identity, validation of external evidence, versioned knowledge snapshots, explicit permissions, deletion paths, privacy-conscious retention, and protected encrypted restore-tested backups. Production secrets must not be exposed to agent prompts or GitHub.

## Open validation / acceptance risks
Actual eligible company yield; current provider limits/terms; free-cloud worker quotas; date semantics; company identity collisions; public contact coverage; Simplify CSV availability; provider send reconciliation; protected backup destination. These are *measured gates* in implementation plans, not assumptions of feasibility.
