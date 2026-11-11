# Review and refined delivery plan: 100 verified, suitable jobs per day

## Definition of done

The product target is **100 genuinely different, newly delivered roles per Africa/Lagos calendar day** that have ALL of:

- **Fresh, live employer posting:** real open position, within the configured freshness policy, attributed to an official source and canonical URL. Idempotent dedup across ATS providers, role URLs and days.
- **Verified personal eligibility:** current job-specific official evidence that a Nigeria-based applicant can take the remote role **or** that the employer sponsors relocation/work authorization applicable to the candidate. Worldwide wording, a generic company sponsorship policy, and inferred eligibility do not count.
- **Proper job fit:** allowed job family, actual seniority/graduate eligibility, location/work model and sponsorship constraints, plus a meaningful competency/requirements assessment against approved experience. A keyword-only title/location overlap is **not** a validated fit assessment.
- **Auditable explanation:** store source attribution, relevant official job requirements, evidence excerpt and expiry, matching version and rationale, decision reasons and rejection reasons.
- **Not previously delivered:** deduplicate jobs by canonical posting identity, not only by randomly generated database ID. Distinct positions at the same company may both qualify.

If fewer than 100 pass every gate, the system must deliver the genuine shortfall, explain which step is preventing 100 and avoid padding.

## Review of Milestone 1 (2026-11-11)

**Proven:** matching worker now retrieves approved documents by `content_sha`; SQL handoff unblocked; one real matching task completed; distinct jobs at the same company are no longer excluded solely by company ledger; signed worker v15 and database migration 0032 deployed. Permissions regression checks passed.

**Not proven:** the first real match was score **0**, with empty matched and gap arrays. Existing worker only matches skills in **job title and remote_text**, not actual qualifications. A completed task therefore does not prove relevance.

**Critical finding A — delivery bypasses proper-fit gate.** `ci_generate_daily_batch` uses a LEFT JOIN for `ci_job_matches` and orders with `coalesce(m.score,0)`; the WHERE clause does not require any match, evidence-backed requirements assessment, minimum valid score or approved knowledge revision. This means the database can deliver an eligible-but-unsuitable job. **Block promotion of the 100-verified job promise until fixed**.

**Critical finding B — preferences are effectively unrestricted.** Production `ci_discovery_preferences.daily_target=100`, but `job_families=['any']`, `seniority_levels=['any']`, `work_modes=['any']`, and `sponsorship='any'`. These are settings, not user-confirmed suitability. Owner must select a sufficiently specific *allowed* family/level/work model or define evidence-backed policy defaults based on approved career preferences. Do not silently rewrite owner choices.

**Critical finding C — limited hiring-country evidence.** `classifyOfficialPosting` only verifies explicit Nigeria support; `worldwide` stays likely. Visa/relocation eligibility needs a separately verified policy with candidate-specific restrictions and expiry. Never upgrade to verified on generic sponsorship claims.

**Critical finding D — insufficient fresh supply.** 24 active ATS boards, 42 stored roles, 1 verified eligible, and recent worker acceptance rates are far below the requested delivery target. The 100 target is an *objective*, not a currently achievable operating capability. Do not estimate supply linearly from a small sample.

**Important finding E — job-level identity and stale data.** A unique internal job ID alone does not prevent the same vacancy appearing from two providers. Need canonical URL normalization, employer identity matching, title/location discrimination, posting IDs and adversarial duplicate tests.

**Important finding F — completion order and failure budget.** Scheduled discovery and batch generation are time-driven and can race. Four independent handoffs are required: ingest → eligibility → verified fit → delivery, with retry, terminal failure, and backlog alerts. "Reviewed" can process old queued jobs, not necessarily the current run's new cohort.

## Refined milestones / execution order

### P0-1: Correctness first (required before any 100/day release claim)

- [x] Repair knowledge version join and verified-job task handoff.
- [x] Remove accidental lifetime company-only dedup, retaining job ID ledger.
- [ ] Replace the LEFT JOIN delivery loophole with a **fail-closed requirement** for a recent, completed, job-requirements-based fit assessment and owner preferences version. Existing keyword-overlap-v1 records should be labelled preliminary and **must not count as validated job fit**.
- [ ] Collect approved, user-specific allowed role families, levels and remote/relocation preferences; keep existing `any` settings visible until user approves their replacement.
- [ ] Confirm official job URL, job-scoped evidence and fit version in each deliverable; add test proving a verified yet unscored/mismatched role cannot be delivered.
- [ ] Verify merge and deployment with live count queries and reject "complete" claims based on only a green CI.

### P0-2: Real requirements matching

- [ ] Parse required years, seniority, languages, location, degree/student eligibility, work model and skill requirements from the *actual official job description*, never title/location alone.
- [ ] Use scored, traceable evidence from approved experience; assess mandatory requirements separately from preferences. Represent missing requirements as `unknown/needs_review`, not zero or guaranteed eligible.
- [ ] Version the evaluation rubric. Calibrate on a manually labeled set including internships, graduate roles, experienced roles, on-site abroad, remote from Nigeria, relocation sponsorship and hard exclusions.
- [ ] Target high precision **before** throughput; track false-positive rate, false-negative rate and missing-evidence rate, not just average score.

### P0-3: Real eligibility verification

- [ ] Verify Nigeria work authorization or a *job-specific*, applicable relocation/visa sponsorship pathway; check country restrictions, citizenship, employment entity, seniority and any student/graduate restrictions.
- [ ] Persist the official excerpt, URL, observation timestamp, expiry, policy version, specific claim and contradiction checks. Generic remote ≠ Nigeria eligibility; generic sponsorship ≠ guaranteed relocation.
- [ ] Scale the review backlog with bounded concurrency, provider quotas and retries. Do not count a posting in `unknown` or `likely_eligible` as verified.

### P0-4: Supply expansion grounded in yield

- [ ] Build a broad vetted employer/source roster using current official job openings and employer identities. Source approval is separate from job eligibility.
- [ ] Track per source: fetched, parsed, fresh, unique, verified, matched, delivered, failures, 429s and update lag.
- [ ] Rank scans and add capacity by **verified eligible suitable yield per source/hour**, not just raw titles scraped.
- [ ] Observe at least seven representative days, then calculate the required daily reviewed inventory from measured end-to-end conversion. Validate the 100/day claim statistically against actual source market supply.

### P1: Reliable autonomous operation

- [ ] Trigger matching only after completed evidence verification; trigger a catch-up daily batch only after eligible matches are available, then re-run safely on retries.
- [ ] Queue jobs with concurrency leases, idempotent transitions, deadlines and poison-job handling; report blocking stage and backlog age.
- [ ] Send a shortfall report when fewer than 100 verified suitable unique roles qualify; never silently mark a 3-item batch as "100 achieved".
- [ ] Keep people research, outreach sending and Gmail conversation automation **out of the critical delivery path**; obey explicit owner authorization for external messaging.

## Acceptance tests (must be passing on disposable DB and observed live)

1. Unverified, unknown, likely-only, expired-evidence, already-delivered and stale jobs cannot enter the verified daily batch.
2. An official Nigeria-eligible posting with **no validated requirements fit**, 0-score title-only match or incompatible mandatory requirements cannot enter the verified batch.
3. Verified, matched, genuinely distinct positions from one employer may both qualify, but the same job across two ATS providers is delivered once.
4. A role restricted to applicants in the US or requiring unsupported citizenship is rejected even when it contains "remote" or broad visa policy language.
5. A plausible visa-sponsoring employer without job-specific applicant-eligibility evidence is `needs_review`, not `verified_eligible`.
6. The independently rechecked production total equals the dashboard total: exact job IDs, evidence state, matching policy version and owner preference version; 100 is only achieved when all 100 satisfy the same gate.
7. During an upstream outage, the system retries safely, reports an honest shortfall and does not lower thresholds, create artificial jobs or send any email.

## Operational dashboard contract

Display (per Africa/Lagos day) a **true verified-qualified delivery counter 0–100**, a separate raw-discovery counter, the full conversion funnel and shortfall reasons. Each job must show *why this employer can hire the candidate*, *why the candidate fits*, exact official source links and expiry. Agent statuses come from persisted execution records; no simulated claims.

**Current status:** Milestone 1 operational plumbing has been fixed; the daily 100 verified proper-job target remains unmet. This document distinguishes proven pipeline execution from unproven job-quality guarantees.
