-- Career Intelligence source-specific metadata only. Never alter Groundwork tables.
alter table public.ci_discovery_sources
  add column if not exists config jsonb not null default '{}'::jsonb;
create index if not exists ci_idx_discovery_source_kind_state
  on public.ci_discovery_sources(kind,state);
