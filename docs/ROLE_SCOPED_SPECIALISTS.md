# Six independently managed specialist lanes (role-aware pool v2)

## Operational goal

The six agents run as **independently dispatched, HMAC-authenticated specialist executions** rather than identical full-pipeline worker copies. Their independent queues and executors are now:

| Specialist | Work source | Execution | Safe outcome |
|---|---|---|---|
| Discovery | approved ATS boards due after their six-hour cooldown; bounded permitted public feeds | claim at most six distinct boards per invocation; normalize and ingest | canonical jobs, official source provenance; never eligibility assumption |
| Eligibility | pending, eligible-for-review ATS jobs with due official fetch slots | claim at most eight reviews, verify job-scoped official evidence | verified, likely, unknown, or ineligible with evidence |
| Matching | pending, approved-knowledge handoffs on verified jobs | only approved note content; idempotent match record | preliminary score, never assumed qualification |
| People Research | pending verified-domain people tasks | fetch only `https://<verified-employer-domain>/team` with redirects disabled, extract bounded same-host JSON-LD persons, record attribution | verified official public contacts, or blocked/retry state |
| Outreach Preparation | submitted applications + verified contacts + approved outreach-safe notes | create review-only, idempotent drafts | never sends email or authorizes a send |
| Conversation Tracking | previously ingested `reply_received` events | classify only actual imported replies, store idempotent classification event | does not invent inbox events or connect Gmail |

**Caution:** these are independently dispatched *role-scoped Edge Function executions*, not six running Python LangGraph runtimes. The Python LangGraph graph remains a separate orchestration implementation that would require a hosted service and a dedicated integration phase. The dashboard labels real work and cannot claim active lanes without signed runs.

## Dynamic allocation, not the 10 → 5 example

No stage has a fixed allocation or stage-specific ceiling. Each 15-minute planning cycle observes real queue backlogs, provider cooldowns, active signed executions, historical per-stage throughput, and recent failures. For each role, it estimates instances needed to drain currently ready work. It gives priority to blocked upstream eligibility and matching work, then discovery, then people/outreach/conversations. If a lane has no ready work, it gets zero. New execution is issued through a role-bound HMAC message; a signature for Discovery **cannot** authorize Outreach.

There remain global **infrastructure guardrails** (defaults: 32 active requests, 24 new dispatches per wave), configurable in `ci_specialist_pool_config`. These are safety/budget constraints, not a business-level maximum or delivery-count threshold. A wave is serialized with an advisory lock and cooldown, and every launch is auditable in `ci_specialist_pool_waves`. Scale-down does not kill in-flight tasks.

## Auth, reliability and safety

- The signed payload includes `role`, and the verifier signs `nonce:timestamp:role`. Each nonce remains single use and expires within 120 seconds.
- All pool state and RPCs have service-only permissions and RLS. The owner dashboard receives *redacted*, read-only counts and execution records.
- Discovery and Eligibility retain atomic provider claims; People Research leases a task with optimistic CAS, retries with backoff, and the controller reclaims expired leases.
- Unique `(owner_user_id, job_id, contact_id)` constraint prevents duplicate outreach drafts across parallel workers.
- No autonomous Gmail sending, account changes, guessed emails, covert contact research or raw note bodies in telemetry.
- Contact research is limited to verified company domains, official structured data and a fixed `/team` path; unavailable sources result in a blocked or retry state.
- Conversation tracking processes only stored inbound events. Without a connected inbox/event ingestion, it will show idle correctly.
- The 100 **verified suitable jobs** target is still subject to the outstanding requirements-based fit and country/relocation eligibility gates. Parallelism does not justify accepting unknown jobs.

## Rollout

1. Apply migration `0034_role_scoped_adaptive_specialist_pool.sql`.
2. Deploy the new role-aware `ci-worker` function (including `specialists.mjs`) and the owner-gated `ci-api`; deploy frontend.
3. Verify a signed role-specific dry run using `ci_specialist_pool_plan()` and `ci_run_specialist_pool(true)`, where `launched=0`. Verify anonymous/authenticated roles cannot execute privileged RPCs.
4. Canary the new dispatcher with `ci_specialist_pool_config.enabled=true`. Disable the old `ci-adaptive-worker-pool-15m` cron and activate `ci-role-aware-specialist-pool-15m` within one transaction; do not leave both live.
5. Observe at least one actual signed launch for each ready role; inspect distinct board claims, retries and actual outcomes. An idle lane is not a failure if it has no eligible work.
6. Roll back by disabling the new schedule and restoring the old adaptive schedule. The migration is additive; preserve historical audit records.

## Diagnostic SQL

```sql
select public.ci_run_specialist_pool(true); -- never sends requests
select observed_at,decision,plan->'roles' as lanes,dispatched
from ci_specialist_pool_waves order by id desc limit 10;
select specialist_role,state,count(*) from ci_worker_runs
where started_at>now()-interval '1 day'
group by specialist_role,state;
```

## Still outstanding

1. Deploy and operate the Python LangGraph graph as an independent durable executor, if the term "LangGraph agents" requires the literal Python agent code (rather than these scoped role workers).
2. Implement a fail-closed requirements-based fit evaluation; current title/location-only scores are preliminary and must not satisfy the 100 verified-proper-job quality gate.
3. Expand official employer/visa evidence and approved source coverage. Proper job delivery remains supply-constrained.
4. Ingest Gmail replies through the explicitly authorized connector; classify events only after they exist. All sends remain approval-gated.
5. Add throttling by actual provider `429` headers, worker CPU/time metrics and cost accounting to the resource controller; currently recent partial/failed results downshift demand.
