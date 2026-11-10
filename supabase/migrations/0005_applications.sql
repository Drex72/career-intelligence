create table if not exists applications (
 id uuid primary key default gen_random_uuid(), owner_user_id uuid not null,
 company_id uuid not null references companies(id), job_id uuid not null references jobs(id),
 status text not null check(status in ('discovered','saved','applied','interviewing','offer','rejected','withdrawn')),
 applied_at timestamptz, resume_version text, notes text,
 unique(owner_user_id,job_id)
);
create table if not exists application_events (
 id uuid primary key default gen_random_uuid(), application_id uuid not null references applications(id),
 event_type text not null, occurred_at timestamptz not null default now(), details jsonb not null default '{}'::jsonb
);
create table if not exists run_metrics (
 id uuid primary key default gen_random_uuid(), workflow_id uuid not null references workflows(id),
 metric_name text not null, value numeric not null, recorded_at timestamptz not null default now()
);
-- Owner-scoped tables deny access until authenticated owner policies are set.
alter table daily_batches enable row level security;
alter table daily_batch_items enable row level security;
alter table delivered_companies enable row level security;
alter table delivered_jobs enable row level security;
alter table applications enable row level security;
alter table application_events enable row level security;
create policy owner_read_batches on daily_batches for select to authenticated using (owner_user_id = auth.uid());
create policy owner_read_items on daily_batch_items for select to authenticated using (
 exists(select 1 from daily_batches b where b.id = batch_id and b.owner_user_id = auth.uid()));
create policy owner_read_delivered_companies on delivered_companies for select to authenticated using (owner_user_id = auth.uid());
create policy owner_read_delivered_jobs on delivered_jobs for select to authenticated using (owner_user_id = auth.uid());
create policy owner_read_applications on applications for select to authenticated using (owner_user_id = auth.uid());
create policy owner_read_application_events on application_events for select to authenticated using (
 exists(select 1 from applications a where a.id = application_id and a.owner_user_id = auth.uid()));
-- All inserts/updates are performed by constrained server-side workers.
