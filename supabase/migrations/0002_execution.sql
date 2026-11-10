-- Durable task ledger, leases and append-only events.
create table if not exists ci_workflows (
 id uuid primary key default gen_random_uuid(), kind text not null,
 status text not null default 'pending', version text not null,
 correlation_key text not null unique, created_at timestamptz not null default now(),
 updated_at timestamptz not null default now()
);
create table if not exists ci_workflow_tasks (
 id uuid primary key default gen_random_uuid(),
 workflow_id uuid not null references ci_workflows(id),
 task_type text not null,
 state text not null default 'pending' check(state in
 ('pending','claimed','running','completed','retry_wait','failed','blocked','awaiting_approval','cancelled')),
 priority int not null default 0, input_ref text not null, output_ref text,
 idempotency_key text not null unique, worker_id text,
 lease_until timestamptz, attempt_count int not null default 0 check(attempt_count >= 0),
 max_attempts int not null default 3 check(max_attempts > 0),
 next_retry_at timestamptz, created_at timestamptz not null default now(),
 updated_at timestamptz not null default now()
);
create index if not exists ci_idx_tasks_available on ci_workflow_tasks(state,next_retry_at,priority desc);
create table if not exists ci_task_dependencies (
 task_id uuid not null references ci_workflow_tasks(id) on delete cascade,
 predecessor_id uuid not null references ci_workflow_tasks(id),
 primary key(task_id,predecessor_id), check(task_id <> predecessor_id)
);
create table if not exists ci_task_attempts (
 id uuid primary key default gen_random_uuid(), task_id uuid not null references ci_workflow_tasks(id),
 worker_id text not null, started_at timestamptz not null default now(),
 finished_at timestamptz, outcome text, error_code text
);
create table if not exists ci_task_events (
 id bigserial primary key, task_id uuid not null references ci_workflow_tasks(id),
 event_type text not null, payload jsonb not null default '{}'::jsonb,
 created_at timestamptz not null default now()
);
create or replace function ci_prevent_task_event_mutation() returns trigger as $$
begin raise exception 'ci_task_events is append-only'; end; $$ language plpgsql;
drop trigger if exists ci_task_events_immutable on ci_task_events;
create trigger ci_task_events_immutable before update or delete on ci_task_events
 for each row execute function ci_prevent_task_event_mutation();
create table if not exists ci_agent_checkpoints (
 id uuid primary key default gen_random_uuid(), workflow_id uuid not null references ci_workflows(id),
 graph_thread_id text not null, checkpoint_ref text not null,
 graph_version text not null, saved_at timestamptz not null default now()
);
create table if not exists ci_provider_usage (
 id uuid primary key default gen_random_uuid(), provider text not null,
 operation text not null, units numeric not null check(units >= 0),
 estimated_usd numeric not null default 0 check(estimated_usd >= 0),
 intent_key text not null unique, recorded_at timestamptz not null default now()
);
