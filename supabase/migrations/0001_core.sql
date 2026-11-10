-- Operational identity registry. Requires PostgreSQL 15+.
create table if not exists companies (
  id uuid primary key default gen_random_uuid(),
  canonical_domain text,
  legal_name text,
  normalized_name text not null,
  identity_confidence text not null default 'unverified'
    check (identity_confidence in ('verified','likely','unverified')),
  first_seen_at timestamptz not null default now(),
  created_at timestamptz not null default now()
);
create unique index if not exists uq_company_domain on companies(lower(canonical_domain))
  where canonical_domain is not null;

create table if not exists company_aliases (
  id uuid primary key default gen_random_uuid(),
  company_id uuid not null references companies(id) on delete cascade,
  alias_type text not null,
  alias_value text not null,
  verified boolean not null default false,
  unique(alias_type,alias_value)
);
create table if not exists company_identity_conflicts (
  id uuid primary key default gen_random_uuid(),
  candidate jsonb not null,
  candidate_company_id uuid references companies(id),
  reason text not null,
  status text not null default 'pending' check(status in ('pending','resolved','dismissed')),
  created_at timestamptz not null default now()
);
create table if not exists jobs (
  id uuid primary key default gen_random_uuid(),
  company_id uuid not null references companies(id),
  title text not null,
  description_hash text,
  apply_url text not null,
  canonical_apply_url text not null,
  status text not null default 'unverified' check(status in ('unverified','open','closed')),
  published_at timestamptz,
  updated_at timestamptz,
  first_seen_at timestamptz not null default now(),
  last_verified_at timestamptz,
  timestamp_source text not null default 'unknown',
  timestamp_confidence text not null default 'unknown'
     check(timestamp_confidence in ('authoritative','inferred','unknown')),
  remote_text text,
  unique(company_id,canonical_apply_url)
);
create table if not exists job_sources (
  id uuid primary key default gen_random_uuid(),
  job_id uuid not null references jobs(id) on delete cascade,
  source_name text not null,
  source_job_id text,
  source_url text not null,
  retrieved_at timestamptz not null default now(),
  raw_hash text
);
create unique index if not exists uq_source_job_id on job_sources(source_name,source_job_id)
 where source_job_id is not null;
