-- Isolate persistent Python LangGraph checkpoint tables from public API tables.
-- The Python PostgresSaver creates its checkpoint* tables in this schema on first boot.
create schema if not exists ci_langgraph;
revoke all on schema ci_langgraph from public,anon,authenticated;
grant usage,create on schema ci_langgraph to service_role;

create table if not exists ci_langgraph.runtime_processes(
 instance_id uuid primary key,
 role text not null check(role in (
  'discovery','eligibility','matching','people','outreach','conversation')),
 state text not null check(state in ('starting','polling','executing','stopped')),
 started_at timestamptz not null default now(),
 last_heartbeat_at timestamptz not null default now()
);
create index if not exists ci_langgraph_process_status_idx
 on ci_langgraph.runtime_processes(role,last_heartbeat_at desc);
revoke all on ci_langgraph.runtime_processes from public,anon,authenticated;
grant select,insert,update on ci_langgraph.runtime_processes to service_role;
-- No anonymous or authenticated data access; the ci_langgraph schema is not
-- exposed in the Supabase Data API and does not contain user-facing tables.
