create table if not exists ci_applications (
 id uuid primary key default gen_random_uuid(), owner_user_id uuid not null,
 company_id uuid not null references ci_companies(id), job_id uuid not null references ci_jobs(id),
 status text not null check(status in ('discovered','saved','applied','interviewing','offer','rejected','withdrawn')),
 applied_at timestamptz, resume_version text, notes text,
 unique(owner_user_id,job_id)
);
create table if not exists ci_application_events (
 id uuid primary key default gen_random_uuid(), application_id uuid not null references ci_applications(id),
 event_type text not null, occurred_at timestamptz not null default now(), details jsonb not null default '{}'::jsonb
);
create table if not exists ci_run_metrics (
 id uuid primary key default gen_random_uuid(), workflow_id uuid not null references ci_workflows(id),
 metric_name text not null, value numeric not null, recorded_at timestamptz not null default now()
);
-- Owner-scoped tables deny access until authenticated owner policies are set.
alter table ci_daily_batches enable row level security;
alter table ci_daily_batch_items enable row level security;
alter table ci_delivered_companies enable row level security;
alter table ci_delivered_jobs enable row level security;
alter table ci_applications enable row level security;
alter table ci_application_events enable row level security;
create policy ci_owner_read_batches on ci_daily_batches for select to authenticated using (owner_user_id = auth.uid());
create policy ci_owner_read_items on ci_daily_batch_items for select to authenticated using (
 exists(select 1 from ci_daily_batches b where b.id = batch_id and b.owner_user_id = auth.uid()));
create policy ci_owner_read_delivered_companies on ci_delivered_companies for select to authenticated using (owner_user_id = auth.uid());
create policy ci_owner_read_delivered_jobs on ci_delivered_jobs for select to authenticated using (owner_user_id = auth.uid());
create policy ci_owner_read_applications on ci_applications for select to authenticated using (owner_user_id = auth.uid());
create policy ci_owner_read_application_events on ci_application_events for select to authenticated using (
 exists(select 1 from ci_applications a where a.id = application_id and a.owner_user_id = auth.uid()));
-- All inserts/updates are performed by constrained server-side workers.
