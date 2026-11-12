-- One-time, evidence-preserving refresh of weak ATS decisions after location parser upgrades.
-- The cutoff is fixed when this migration is installed: later assessments are not requeued.
create table if not exists ci_eligibility_policy_refreshes (
  revision text primary key,
  cutoff_at timestamptz not null default clock_timestamp()
);
insert into public.ci_eligibility_policy_refreshes(revision)
values ('ashby-secondary-and-structured-nigeria-v1') on conflict do nothing;

create table if not exists ci_eligibility_policy_refresh_ledger (
  revision text not null references public.ci_eligibility_policy_refreshes(revision),
  job_id uuid not null references public.ci_jobs(id) on delete cascade,
  queued_at timestamptz not null default clock_timestamp(),
  primary key(revision,job_id)
);
alter table public.ci_eligibility_policy_refreshes enable row level security;
alter table public.ci_eligibility_policy_refresh_ledger enable row level security;
revoke all on public.ci_eligibility_policy_refreshes,public.ci_eligibility_policy_refresh_ledger
  from public,anon,authenticated;
grant select on public.ci_eligibility_policy_refreshes to service_role;
grant select,insert on public.ci_eligibility_policy_refresh_ledger to service_role;

create or replace function public.ci_requeue_policy_reviews(p_limit integer default 30)
returns integer language plpgsql security invoker set search_path=public
as $requeue_policy$
declare changed integer := 0;
begin
  if p_limit is null or p_limit not between 1 and 100 then return 0; end if;
  with candidates as materialized (
    select q.job_id
    from ci_eligibility_review_queue q
    join ci_jobs j on j.id=q.job_id and j.status='open'
    join lateral (
      select a.status,a.assessed_at from ci_eligibility_assessments a
      where a.job_id=q.job_id
      order by a.assessed_at desc,a.id desc limit 1
    ) a on true
    join ci_eligibility_policy_refreshes policy
      on policy.revision='ashby-secondary-and-structured-nigeria-v1'
    where q.state='reviewed'
      and a.status in ('unknown','likely_eligible')
      and a.assessed_at<policy.cutoff_at
      and not exists (
        select 1 from ci_eligibility_policy_refresh_ledger l
        where l.revision=policy.revision and l.job_id=q.job_id
      )
      and exists (
        select 1 from ci_job_sources src
        where src.job_id=q.job_id
          and src.source_name in ('greenhouse','lever','ashby')
      )
    order by a.assessed_at asc,q.job_id
    limit p_limit
    for update of q skip locked
  ), updated as (
    update ci_eligibility_review_queue q
    set state='pending',last_seen_at=clock_timestamp()
    from candidates c where q.job_id=c.job_id
    returning q.job_id
  ), recorded as (
    insert into ci_eligibility_policy_refresh_ledger(revision,job_id)
    select 'ashby-secondary-and-structured-nigeria-v1',u.job_id from updated u
    on conflict do nothing returning job_id
  )
  select count(*) into changed from recorded;
  return changed;
end;
$requeue_policy$;
revoke all on function public.ci_requeue_policy_reviews(integer)
  from public,anon,authenticated;
grant execute on function public.ci_requeue_policy_reviews(integer) to service_role;

-- Once per hour, enqueue at most 30 older weak assessments.
-- GitHub Actions remains the *only* specialist dispatcher.
do $schedule_policy_refresh$
begin
  if exists(select 1 from pg_extension where extname='pg_cron') then
    if coalesce(current_setting('cron.timezone',true),'GMT') not in ('GMT','UTC','Etc/UTC') then
      raise exception 'CI review policy refresh requires UTC/GMT cron timezone';
    end if;
    execute 'select cron.schedule($1,$2,$3)' using
      'ci-policy-eligibility-refresh-hourly','13 * * * *',
      'select public.ci_requeue_policy_reviews(30)';
  end if;
end;
$schedule_policy_refresh$;
