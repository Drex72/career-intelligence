-- Service-side event trail for the interactive Factory Flow.
-- Only trusted worker/API backends write; user-facing reads pass through owner-gated ci-api.
create table if not exists public.ci_pipeline_events (
  id bigint generated always as identity primary key,
  worker_run_id uuid references public.ci_worker_runs(id) on delete set null,
  job_id uuid references public.ci_jobs(id) on delete set null,
  stage text not null check (stage in ('sources','registry','ingestion','eligibility','matching','ranking','delivery','people','outreach','conversation','knowledge')),
  agent text not null check (length(agent) between 2 and 80),
  event_type text not null check (length(event_type) between 2 and 80),
  input_preview jsonb not null default '{}'::jsonb check (jsonb_typeof(input_preview)='object' and pg_column_size(input_preview)<=8192),
  output_preview jsonb not null default '{}'::jsonb check (jsonb_typeof(output_preview)='object' and pg_column_size(output_preview)<=8192),
  occurred_at timestamptz not null default now()
);
create index if not exists ci_pipeline_events_occurred_idx on public.ci_pipeline_events (occurred_at desc, id desc);
create index if not exists ci_pipeline_events_job_idx on public.ci_pipeline_events (job_id, occurred_at desc) where job_id is not null;
create index if not exists ci_pipeline_events_run_idx on public.ci_pipeline_events (worker_run_id, occurred_at desc) where worker_run_id is not null;
alter table public.ci_pipeline_events enable row level security;
revoke all on public.ci_pipeline_events from public, anon, authenticated;
revoke all on sequence public.ci_pipeline_events_id_seq from public, anon, authenticated;
grant select, insert on public.ci_pipeline_events to service_role;
grant usage, select on sequence public.ci_pipeline_events_id_seq to service_role;
comment on table public.ci_pipeline_events is 'Bounded sanitized production transformation metadata. No raw descriptions, credentials, note bodies or arbitrary LLM text.';
