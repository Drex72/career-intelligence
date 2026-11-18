-- Separate "likely eligible — needs owner confirmation" tier.
--
-- Owner decision (2026-11-18): roles whose official posting says remote
-- worldwide, but does not explicitly permit Nigeria, are shown in their own
-- clearly-labelled list. They never enter ci_daily_batch_items, never count
-- toward the verified daily target and never write ci_delivered_jobs, so a
-- job that later becomes verified can still be delivered normally. The strict
-- verified gate (0038) is unchanged.

create table if not exists ci_likely_tier_decisions(
  owner_user_id uuid not null,
  job_id uuid not null references ci_jobs(id) on delete cascade,
  decision text not null check(decision in ('confirmed','dismissed')),
  decided_at timestamptz not null default now(),
  primary key(owner_user_id,job_id)
);
alter table ci_likely_tier_decisions enable row level security;
revoke all on ci_likely_tier_decisions from public,anon,authenticated;
grant select,insert,update on ci_likely_tier_decisions to service_role;

create or replace function public.ci_likely_tier(p_owner_user_id uuid,p_limit integer default 50)
returns table(
  job_id uuid,company_id uuid,company_name text,title text,apply_url text,
  published_at timestamptz,reason text,assessed_at timestamptz,expires_at timestamptz,
  worldwide_scope boolean,us_employer_evidence boolean,decision text
)
language sql stable security invoker set search_path=public as $likely$
  select j.id,j.company_id,c.legal_name,j.title,j.apply_url,j.published_at,
    a.reasons->>0,a.assessed_at,a.expires_at,
    exists(select 1 from ci_job_remote_scope_evidence r
      where r.job_id=j.id and r.scope='worldwide' and r.expires_at>now()),
    exists(select 1 from ci_company_country_evidence e
      where e.company_id=j.company_id and e.country='US'),
    d.decision
  from ci_jobs j
  join ci_companies c on c.id=j.company_id
  join lateral (
    select x.status,x.reasons,x.assessed_at,x.expires_at from ci_eligibility_assessments x
    where x.job_id=j.id order by x.assessed_at desc,x.id desc limit 1
  ) a on true
  left join ci_likely_tier_decisions d
    on d.owner_user_id=p_owner_user_id and d.job_id=j.id
  where p_owner_user_id is not null
    and j.status='open'
    and a.status='likely_eligible'
    and (a.expires_at is null or a.expires_at>now())
    and j.published_at>=now()-interval '7 days'
    and ci_job_matches_preferences(j.id,p_owner_user_id)
    and not exists(select 1 from ci_delivered_jobs v
      where v.owner_user_id=p_owner_user_id and v.job_id=j.id)
    and d.decision is distinct from 'dismissed'
  order by
    exists(select 1 from ci_job_remote_scope_evidence r
      where r.job_id=j.id and r.scope='worldwide' and r.expires_at>now()) desc,
    j.published_at desc,j.id
  limit least(greatest(coalesce(p_limit,50),1),100)
$likely$;
revoke all on function public.ci_likely_tier(uuid,integer) from public,anon,authenticated;
grant execute on function public.ci_likely_tier(uuid,integer) to service_role;

-- A decision records the owner's own judgement only. Confirming does NOT
-- create eligibility evidence or move the job into the verified tier.
create or replace function public.ci_decide_likely_tier(
  p_owner_user_id uuid,p_job_id uuid,p_decision text)
returns boolean language plpgsql security invoker set search_path=public as $decide$
begin
  if p_owner_user_id is null or p_job_id is null
    or p_decision not in ('confirmed','dismissed') then return false; end if;
  if not exists(
    select 1 from ci_eligibility_assessments a
    where a.job_id=p_job_id and a.status='likely_eligible'
      and a.id=(select x.id from ci_eligibility_assessments x
        where x.job_id=p_job_id order by x.assessed_at desc,x.id desc limit 1)
  ) then return false; end if;
  insert into ci_likely_tier_decisions(owner_user_id,job_id,decision)
    values(p_owner_user_id,p_job_id,p_decision)
  on conflict(owner_user_id,job_id) do update
    set decision=excluded.decision,decided_at=now();
  return true;
end;
$decide$;
revoke all on function public.ci_decide_likely_tier(uuid,uuid,text) from public,anon,authenticated;
grant execute on function public.ci_decide_likely_tier(uuid,uuid,text) to service_role;
