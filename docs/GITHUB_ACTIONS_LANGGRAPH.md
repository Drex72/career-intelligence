# GitHub Actions: zero-server LangGraph specialist execution

This is the **recommended free-first** alternative to Oracle Cloud and Railway for Career Intelligence. It reuses six independent, real Python LangGraph single-specialist graphs, PostgreSQL checkpoints and the existing signed Supabase Edge specialist executor.

The repository is public, so GitHub-hosted standard runners for this public repository are generally free, subject to GitHub's terms, quota/rate controls and policies. **They are ephemeral; these are NOT six persistent servers.** The workflow starts only when demand is positive (except an explicit six-role canary).

## Implementation

- Workflow: [`.github/workflows/ci-langgraph-workers.yml`](../../.github/workflows/ci-langgraph-workers.yml)
- Adaptive planner: [`services/worker/src/career/actions_plan.py`](../../services/worker/src/career/actions_plan.py)
- Actual LangGraph worker: [`services/worker/src/career/hosted_langgraph.py`](../../services/worker/src/career/hosted_langgraph.py)
- Every 15 minutes at minutes 07/22/37/52, when enabled on main, one **DB-only planning job** reads `ci_specialist_pool_plan()`.
- The plan creates an isolated matrix process for each requested specialist instance, up to 12 GitHub-hosted runners *per workflow*. This cap protects infrastructure and the free runner service; **it is not a job-delivery threshold or fixed specialist count.**
- When no queues are ready, the matrix is empty; no Python LangGraph workers are launched.
- When positive demand exists, one short-lived bootstrap job initializes private checkpoint tables; then separate role/shard processes each invoke **at most one** signed specialist worker request.
- Every role checks the live queue again before calling the Edge worker. Atomic database source/review claims handle races between concurrent instances.
- The same protected reusable code handles Discovery, Eligibility, Matching, People Research, Outreach Drafts, and Conversation Tracking.
- The existing Edge worker performs the substantive specialist operation. GitHub-hosted Python LangGraph runs are role-scoped orchestration wrappers, not model-serving endpoints or six newly written agent implementations.
- Never sends Gmail; outreach remains **draft-only**.

## REQUIRED GitHub setup (the workflow is safely disabled by default)

Go to **GitHub → Drex72/career-intelligence → Settings → Secrets and variables → Actions**.

Under **Repository secrets**, add:

| Secret name | Value |
| --- | --- |
| `CI_ACTIONS_DATABASE_URL` | Supabase **session pooler** PostgreSQL connection string, port 5432, with `sslmode=require`, from Supabase Dashboard → Connect |
| `CI_ACTIONS_WORKER_SIGNING_KEY` | The **existing** HMAC signing secret recognized by `ci_verify_specialist_request`. Do **not** generate an unrelated key. |

Treat both as production credentials. The original `ci_worker_auth.shared_key` is private to the database. Do not paste it into GitHub issue comments, workflow source, ChatGPT, or logs. Use the GitHub encrypted Actions secret UI to store the HMAC key; rotate it carefully if it has previously been exposed.

Under **Repository variables**, leave `CI_GITHUB_ACTIONS_LIVE` **unset or `false`** until you complete the cutover steps below.

Only trusted **main-branch** `schedule` or `workflow_dispatch` runs can access the secrets. There is no PR-triggered production worker workflow; the PR CI workflow installs only test dependencies and has no production credentials.

## Safe first test

Navigate to **Actions → Career Intelligence — six LangGraph specialists → Run workflow**, select branch `main` and mode **plan**.

- `plan`: connects to Supabase, prints only role/instance-count matrix, makes **no** worker calls and no data changes.
- `canary`: starts **six separate Python LangGraph runners**, checks all private Postgres checkpoints and heartbeats, but uses `--dry-run --once` so **no signed requests** are issued.
- `live`: disabled unless `CI_GITHUB_ACTIONS_LIVE=true` and both encrypted secrets are available. Even then, the Python runner **refuses to dispatch if any of the three previous Supabase worker cron names remains active**.

The planner reads the owner-specified preferences from the existing system; it does not auto-raise the owner daily target or fabricate employment fit. The matrix can show zero workers even when the configured daily target is 100, because it only considers work ready *now*.

### Recommended activation / cutover

1. Install both repository secrets.
2. Run **plan** and **canary** manually with `CI_GITHUB_ACTIONS_LIVE` unset. All six canary jobs must finish successfully; examine `ci_langgraph.runtime_processes` and private checkpoint table creation.
3. Check that no existing worker runs are still performing long operations; do not overlap schedulers.
4. In Supabase Dashboard SQL, **disable the old scheduler**:

   ```sql
   select cron.unschedule('ci-role-aware-specialist-pool-15m');
   ```

5. In GitHub Settings → Secrets and variables → Actions → Variables, create `CI_GITHUB_ACTIONS_LIVE=true`.
6. Run the workflow manually in mode **live**, or allow its 15-minute schedule. Every live runner independently checks the old scheduler remains disabled; if not, it fails closed.
7. Confirm actual `ci_worker_runs.specialist_role` execution, distinct task claims, daily verified job throughput and worker failures before considering the migration complete.

**Do not enable GitHub Actions live and the old Supabase worker cron simultaneously.** The check in `hosted_langgraph.py` is an additional backstop, not permission to deliberately run dual schedulers.

## Rollback and diagnostics

1. Immediately change GitHub repository variable `CI_GITHUB_ACTIONS_LIVE=false`. Existing in-flight GH jobs might finish, so confirm completion in the Actions page.
2. Restore the existing Supabase cron:

   ```sql
   select cron.schedule('ci-role-aware-specialist-pool-15m','*/15 * * * *',
     'select public.ci_run_specialist_pool(false)');
   ```

3. Check `ci_worker_runs`, `ci_specialist_pool_waves`, `ci_langgraph.runtime_processes` and the flow dashboard. Supabase remains the canonical job/eligibility database.

GitHub cron isn't exact and can be delayed or skipped during load, and scheduled workflows in public repositories may be disabled automatically after prolonged repository inactivity. The system is **scheduled bursts** of six independently selectable specialists, not a hard-realtime service or 24/7 running processes.

## Limitations / next milestones

- **Secrets must be configured by the repository owner.** The GitHub integration used for source updates cannot read or set them here.
- The Python LangGraph role handlers are **checkpointed wrappers** that call the hardened Supabase Edge specialists. Hosting on GitHub does **not** change the existing requirements-matching limitations.
- The upstream source yield, job-scoped Nigeria eligibility and **requirements-based validated fit** are separate blockers to the 100 verified suitable jobs/day goal.
- Live production performance, monthly runner usage and checkpoint metrics must be measured after cutover; only offline tests are available until the protected secrets are installed.
