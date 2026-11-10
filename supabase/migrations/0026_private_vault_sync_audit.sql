-- Approved private Obsidian vault sync audit (no source token, note body or vault URL).
create table if not exists ci_knowledge_sync_runs (
 id uuid primary key default gen_random_uuid(),
 git_sha text not null check (length(git_sha) between 5 and 64),
 status text not null default 'completed' check (status in ('completed')),
 approved_count integer not null check (approved_count between 0 and 500),
 changed_count integer not null check (changed_count between 0 and 500),
 tombstoned_count integer not null check (tombstoned_count between 0 and 500),
 skipped_count integer not null check (skipped_count between 0 and 100000),
 finished_at timestamptz not null default now()
);
create index if not exists ci_knowledge_sync_runs_recent
 on ci_knowledge_sync_runs(finished_at desc);
alter table ci_knowledge_sync_runs enable row level security;
revoke all on table ci_knowledge_sync_runs from public,anon,authenticated;
grant select,insert on table ci_knowledge_sync_runs to service_role;
