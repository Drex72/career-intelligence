-- Unique company-level contact research regardless of duplicate verified jobs.
create unique index if not exists ci_uq_company_default_contact_research
  on public.ci_contact_research_tasks(company_id) where workflow_id is null;
-- Harden a function introduced by Career Intelligence, without touching Groundwork functions.
alter function public.ci_prevent_task_event_mutation() set search_path = pg_catalog, public;
