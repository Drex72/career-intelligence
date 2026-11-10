-- Explicit owner allowlist for Career Intelligence only.
-- Seeding is a separate, private administrator action. Never commit owner emails.
create table if not exists public.ci_workspace_owners (
  owner_user_id uuid primary key references auth.users(id) on delete cascade,
  added_at timestamptz not null default now()
);
alter table public.ci_workspace_owners enable row level security;
revoke all on public.ci_workspace_owners from anon, authenticated;
grant select on public.ci_workspace_owners to service_role;
