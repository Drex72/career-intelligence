# Delivery plan: 100 genuinely verified, suitable jobs per day

**Goal:** Sustain a daily batch of **100 new, open, recent, job-specific-eligibility-verified, user-preference-compatible, nonduplicate roles**, not 100 collected leads. Source volume, preliminary role matches, and likely eligibility do **not** count as delivered success.

**Starting baseline (2026-11-11, production):** 24 active ATS sources; 42 stored roles; 26 official eligibility assessments (1 verified, 4 likely, 21 unknown); 20 approved knowledge notes but **zero** scored matches; daily batches target 100 and delivered 0 today (1 yesterday). Six-hour unattended worker and 07:00 WAT batch are active. Latest worker inspected 286 postings, passed four initial screening; zero fresh eligibility reviews or matching outcomes. Existing batch selects no more than one role per company over account lifetime, contrary to the explicit job-based goal.

## Non-negotiable acceptance criteria

1. 100 means 100 **distinct role IDs** per Africa/Lagos day, never padding with unverified, stale, previously delivered or preference-incompatible jobs. Same company may have distinct roles, but repeat roles do not count.
2. "Verified" requires current, job-scoped employer/official evidence that the candidate can lawfully apply from Nigeria **or** supported relocation/visa sponsorship evidence scoped to the candidate's circumstances. General worldwide wording remains likely, not verified.
3. "Proper" means matching the user's configured families, seniority, work mode and sponsorship; role requirements are compared with approved knowledge, with an explainable fit score. A listing missing required facts is escalated, not misrepresented.
4. Each delivery carries an official source URL, evidence and expiry, original posting date, fit rationale, and deduplication key.
5. The batch can be short and expose a visible shortfall. Never weaken gates to show 100.
6. The entire discovery → eligibility → matching → batch transition is idempotent, recoverable and observable; quality regressions stop promotion.

## Milestone A — Repair correctness and unblock handoffs (in progress)

- [x] Identify production mismatch: `ci_knowledge_versions.revision = ci_knowledge_documents.content_sha`, not `git_sha`. Both the worker retrieval and SQL handoff readiness used the incorrect join.
- [x] Implement matching worker version lookup fix and SQL handoff repair (migration 0032).
- [x] Remove lifetime **company** exclusion in delivery while preserving lifetime **job** exclusion and the company ledger; one employer can have multiple genuinely distinct suitable jobs.
- [ ] Validate migration on isolated PostgreSQL and production, check RLS/permissions; deploy worker and verify a previously awaiting-approval matching task becomes pending then completed with real approved knowledge.
- [ ] Add source evidence assertions and inspect whether the matching score reflects real role requirements rather than only job title and location.

## Milestone B — Scale trustworthy discovery supply

- [ ] Build a measurable source portfolio: official employer ATS, eligible country filters and additional permitted public APIs. Every board needs a current official vacancy as proof; don't confuse valid ATS hosting with evidence of Nigeria eligibility.
- [ ] Rank board selection by yield of **fresh, eventually verified** roles, not volume. Monitor board failures, 429s, stale posting rates and per-source acceptance.
- [ ] Preserve source-provider API quotas and keep concurrency bounded. Raise bounded scan/review capacity only after measuring actual latency, cost, platform quotas and retries.
- [ ] Expose distinct new jobs, screened-out examples, review-pending, verified, matched and delivered counts as a reconciled per-run funnel.
- [ ] Validate real-life supply: collect at least 7 days of attributable conversion statistics; determine whether 100 verified/day is feasible given country and visa restrictions before claiming capacity.

## Milestone C — Evidence-backed eligibility for Nigeria + relocation

- [ ] Independently verify job-specific Nigeria-based employment and visa/relocation sponsorship on official employer evidence. Explicit exclusions override generic remote or sponsorship statements.
- [ ] Add source-backed hiring geography, visa support, citizenship/residency restrictions, document freshness and evidence policy version fields; permit reviews/escalation on ambiguity.
- [ ] Queue all appropriate freshly ingested ATS jobs for verified evidence checks; measure failures and missed jobs separately.
- [ ] Scale daily review throughput above 100 with bounded parallelism and scheduling, retry/backoff and expiry refresh, but never infer positive status from unknown.

## Milestone D — Fit matching and dependable scheduling

- [ ] Parse actual job responsibilities/qualifications from official postings; score against approved knowledge with requirements evidence, seniority and exclusions.
- [ ] Ensure every verified role gets an idempotent matching task and enforce required knowledge, scoring and preference gates before delivery.
- [ ] Run daily batches **after** verified/matched work, not concurrently with the 06:00 UTC scheduled discovery run. Add catch-up attempts and an under-target alert with reasons.
- [ ] Reconcile unique job IDs and optional per-company diversity constraints without imposing an accidental lifetime employer ban.

## Milestone E — Autonomous people/outreach/conversations (separate success metric)

- [ ] Enable reliable, citation-backed employer contact discovery for eligible, relevant roles; no invented contacts.
- [ ] Generate reviewable outreach drafts; integrate any actual Gmail sending only with the owner's explicit standing or per-message authorization.
- [ ] Connect reply monitoring and follow-up queues with suppression, revocation, retries, reconciliation and kill switches.

## Metrics / release gates

Daily funnel must disclose: source postings **seen**; initial role/source/date **passed**; unique stored roles; queue submissions; verified Nigeria or confirmed eligible relocation; verified-but-stale; verified-but-rejected by user preferences; matched and scored; delivered distinct jobs; target shortfall; provider errors and rate limits. Minimum correctness tests: duplicate job never delivered twice, two distinct verified roles at one company remain eligible, stale/unverified/unknown excluded, no approved knowledge means no fabricated score, and no automatic Gmail action.

**Current commitment:** Milestone A fixes the correctness bugs and proves a real matching handoff; it cannot by itself produce 100 verified/day. Milestones B–D are necessary supply and quality work. A benchmark must demonstrate the target before marking it achieved.
