create table if not exists discovery_sources (
 id uuid primary key default gen_random_uuid(), name text not null unique,
 kind text not null, state text not null default 'active',
 rate_limit_json jsonb not null default '{}'::jsonb, cursor text,
 discovery_method text not null default 'manual',
 first_discovered_at timestamptz not null default now()
);
create table if not exists discovery_runs (
 id uuid primary key default gen_random_uuid(), source_id uuid not null references discovery_sources(id),
 started_at timestamptz not null default now(), finished_at timestamptz,
 new_companies int not null default 0, eligible_jobs int not null default 0,
 duplicate_jobs int not null default 0, error_code text
);
create table if not exists eligibility_evidence (
 id uuid primary key default gen_random_uuid(), job_id uuid not null references jobs(id),
 source_url text not null, source_kind text not null, excerpt text not null,
 excerpt_hash text not null, observed_at timestamptz not null default now(),
 source_published_at timestamptz, scope text not null,
 claim text not null, confidence text not null
);
create table if not exists eligibility_assessments (
 id uuid primary key default gen_random_uuid(), job_id uuid not null references jobs(id),
 status text not null check(status in ('verified_eligible','likely_eligible','unknown','ineligible')),
 confidence numeric not null check(confidence between 0 and 1),
 reasons jsonb not null, contradictions jsonb not null,
 policy_version text not null, assessed_at timestamptz not null default now(), expires_at timestamptz
);
create table if not exists job_matches (
 id uuid primary key default gen_random_uuid(), job_id uuid not null references jobs(id),
 knowledge_revision text not null, score int not null check(score between 0 and 100),
 matched jsonb not null, gaps jsonb not null,
 computed_at timestamptz not null default now(), unique(job_id,knowledge_revision)
);
create table if not exists daily_batches (
 id uuid primary key default gen_random_uuid(), owner_user_id uuid not null,
 local_date date not null, target int not null default 100 check(target between 1 and 100),
 state text not null default 'pending', generated_at timestamptz not null default now(),
 unique(owner_user_id,local_date)
);
create table if not exists daily_batch_items (
 id uuid primary key default gen_random_uuid(), batch_id uuid not null references daily_batches(id),
 company_id uuid not null references companies(id), job_id uuid not null references jobs(id),
 rank int not null, unique(batch_id,company_id),unique(batch_id,job_id)
);
create table if not exists delivered_companies (
 owner_user_id uuid not null, company_id uuid not null references companies(id),
 first_batch_id uuid not null references daily_batches(id), first_delivered_at timestamptz not null default now(),
 primary key(owner_user_id,company_id)
);
create table if not exists delivered_jobs (
 owner_user_id uuid not null, job_id uuid not null references jobs(id),
 primary key(owner_user_id,job_id)
);
create table if not exists employer_intelligence (
 id uuid primary key default gen_random_uuid(), company_id uuid not null references companies(id),
 job_id uuid references jobs(id), claim text not null, scope text not null,
 evidence_source_url text not null, authority text not null,
 observed_at timestamptz not null default now(), expires_at timestamptz,
 status text not null default 'unverified'
);
