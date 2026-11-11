# Adaptive multi-worker orchestration (v1)

## Why this exists

The target is **100 newly delivered, officially verified, individually suitable jobs per Lagos day**, not 100 raw postings. Worker parallelism reduces idle time and reviews backlog but does not by itself solve verified supply or meaningful requirements-based fit. The existing `ci-worker` already processes discovery, official eligibility reviews and approved-knowledge matching in one signed invocation, and thus the v1 pool manages *parallel worker instances*, not independent LangGraph process replicas. Do not label these as individual LLM agents.

## Controller loop

Every 15 minutes, a server-side PostgreSQL cron calls `ci_run_adaptive_worker_pool(false)`. It is serialised with an advisory transaction lock, and records a `ci_worker_pool_waves` row for every evaluated dispatch. It computes:
- `target`: the owner-configured daily target, currently 100.
- `delivered`: jobs already in today's batch **as a scheduling proxy**, not proof of validated role fit.
- `remaining`: target minus delivered.
- `due_boards`: official approved ATS boards whose six-hour provider cooldown has ended.
- `pending_reviews`: jobs with a due official ATS review.
- `pending_matches`: already-verified jobs with a pending matching handoff.
- `active`: recently running signed workers; stale-running rows older than four minutes don't consume capacity.
- `ceiling`: max 10 instances while less than 80 delivered; 5 from 80 to 99; zero at 100.
- `desired`: minimum of ceiling and real demand, computed as the greatest of `ceil(due_boards/6)`, `ceil(pending_reviews/8)`, `ceil(pending_matches/3)`, minus the already-active count.

Examples: 0 delivered, 60 due boards -> **10** new workers; 80 delivered, 60 due boards -> **5** new workers; 100 delivered -> **0**. With only 24 boards due, the controller launches 4 workers, not 10 idle workers.

Each selected invocation calls the existing HMAC-nonce-signed `ci_emit_signed_worker_request()`. It never sends service secrets over HTTP and enforces a minimum four-minute gap between waves with actual dispatch. Board/feed/review database claims remain effective across concurrent instances. The controller never force-terminates active workers, and a zero-demand calculation launches none. Scale-down affects *future* dispatches.

## Guardrails

- All pool config, wave logs and RPCs are server-only with RLS. Cron runs as database owner; browser clients cannot invoke launch or read private wave tables directly.
- Limits are enforced by PostgreSQL CHECK constraints: max instances at most 10; reduced <= max; 60–3600 second minimum dispatch interval.
- No provider rate limits, approved-source gating, eligibility rules or email authorization are weakened.
- Production worker function remains exactly the same signed HMAC endpoint; controller never receives provider keys or enables arbitrary URLs.
- Replays, errors and idle source cooldowns are recorded as real states; concurrency cannot magically turn 24 approved boards into 100 eligible jobs.
- The existing daily batch is still timestamp-driven; its job-fit correctness gap is **not** fixed in this tranche. A separate requirements-based, fail-closed fit gate is still a P0 blocker.

## Rollout / rollback

1. Run isolated PostgreSQL tests against migration 0033, including dry-run and privilege checks.
2. Deploy migration, query `select ci_run_adaptive_worker_pool(true);` to inspect proposed launches. This is side-effect free and sends zero HTTP requests.
3. Explicitly activate the new 15-minute pg_cron schedule, then retire the old 6-hour one. Do not run both simultaneously.
4. Verify waves and actual signed `ci_worker_runs` counts; compare eligible throughput and provider failures.
5. Rollback without data loss: `select cron.unschedule('ci-adaptive-worker-pool-15m');` and reactivate `ci-unattended-public-research-6h`. The tables remain read-only historical audit data.

## Next stages

1. Distinct capacity queues and signed worker roles: `discovery`, `eligibility`, `matching`, `people`, `outreach_drafts`, `conversations`. Each role needs a separate lease/claim API, quota, executor and idempotency boundary. Only then will the orchestrator truly instantiate independently scalable *sub-agents*.
2. Measure verified-job yield per approved source, backlog age and errors, and prioritise the verified suitability bottleneck instead of merely jobs fetched.
3. Implement true requirements-based fit validation, hiring geography / visa eligibility evidence, and event-driven batch retries. Daily 100 target is not achieved until these pass and production supply proves it.

## Useful read-only inspection

```sql
select public.ci_run_adaptive_worker_pool(true); -- simulation only, no request sent
select observed_at,decision,due_boards,pending_reviews,pending_matches,
       active_count,desired_instances,dispatched,request_ids
from public.ci_worker_pool_waves order by observed_at desc limit 10;
```
