# Six independently hosted LangGraph processes on Railway

Each of the six services below is a distinct, persistent Python container, not a Vercel
function or six copies of one process. They share this repository and the reviewed
`Dockerfile.langgraph`, but each receives a different `CI_SPECIALIST_ROLE`.

## Create six services

Create a Railway project and **six separate services** connected to
`Drex72/career-intelligence`, using repository root `/` and Dockerfile
`Dockerfile.langgraph`. For each service, configure the corresponding
environment variable and use the Dockerfile's default entrypoint.

| Service | CI_SPECIALIST_ROLE |
|---|---|
| ci-lg-discovery | discovery |
| ci-lg-eligibility | eligibility |
| ci-lg-matching | matching |
| ci-lg-people | people |
| ci-lg-outreach | outreach |
| ci-lg-conversation | conversation |

Common private environment variables on **each** service:

- `DATABASE_URL`: PostgreSQL connection URI authorized for `ci_` data and
  `ci_langgraph` schema. Configure as a provider secret, never in Git.
- `CI_WORKER_ENDPOINT`: exact existing
  `https://manqpbwiwmzqxgldhbdt.supabase.co/functions/v1/ci-worker`
- `CI_WORKER_SIGNING_KEY`: exact current CI worker HMAC key, configured as a
  secret through an authorized credential workflow; never commit or paste it.
- `CI_SPECIALIST_ROLE`: unique role per service.
- `CI_LANGGRAPH_ENABLED=false` initially, then true *only* after cutover.
- `CI_POLL_SECONDS=30`, `LANGGRAPH_STRICT_MSGPACK=true`.

Do not assign public domains; these workers are outbound-only background
processes. Keep startup/restart enabled and set an expenditure limit.

## Dry-run before enabling

Run `python -m career.hosted_langgraph --role discovery --dry-run --once`
with private environment variables set; it verifies DB connectivity,
checkpointer setup and real role-specific LangGraph compilation, but
**does not dispatch a worker**. Run all six roles.

Query:
```sql
select role,state,last_heartbeat_at
from ci_langgraph.runtime_processes
order by last_heartbeat_at desc limit 20;
```

## Cutover

1. Verify six deployments are healthy and their checkpoint tables are created in
   `ci_langgraph`; verify six distinct `role` values in process registry.
2. Disable old `ci-role-aware-specialist-pool-15m` pg_cron schedule (its Edge
   workers would otherwise duplicate hosted process dispatch).
3. Set `CI_LANGGRAPH_ENABLED=true` on all six Railway services.
4. Verify actual role executions and upstream/downstream CI pipeline metrics.
5. Rollback: set `CI_LANGGRAPH_ENABLED=false`; restore
   `ci-role-aware-specialist-pool-15m` after the Python dispatches drain.

## Separation and constraints

A Python process runs a genuine, PostgreSQL-checkpointed LangGraph graph with
**one specialist node**. The node invokes the existing HMAC-authenticated,
role-specific Supabase Edge executor, which owns actual ATS, eligibility,
matching, people, draft and inbound-reply writes. Thus Python processes are
independent schedulers and checkpointed LangGraph decision/execution wrappers;
the business logic remains in hardened Edge handlers rather than being
reimplemented or forked in Python. No Google/Gmail sending is possible from
these runtimes.

Worker replicas and Python service count can be changed independently by the
hosting provider; the queue and Edge source-claim paths remain concurrency-safe.
This is not yet a centralized Railway autoscaler that creates/destroys **Railway
service replicas** based on demand, nor a fully integrated Python LangGraph
multi-agent transaction spanning six services. Those require provider
management API support and durable handoff semantics.

The 100 verified suitable jobs/day requirement is still gated by evidence and
requirements matching; concurrency never bypasses those controls.
