-- Owner-targeted employer market and global-remote role evidence.
-- The applicant may live in Nigeria while targeting US-headquartered employers.
-- "Remote US" is NOT "remote worldwide", and company HQ does not prove job eligibility.

create table if not exists ci_geo_target_preferences(
 owner_user_id uuid primary key references ci_discovery_preferences(owner_user_id) on delete cascade,
 employer_country char(2) not null check(employer_country='US'),
 applicant_country char(2) not null check(applicant_country='NG'),
 remote_scope text not null default 'worldwide' check(remote_scope='worldwide'),
 updated_at timestamptz not null default now()
);
alter table ci_geo_target_preferences enable row level security;
revoke all on ci_geo_target_preferences from public,anon,authenticated;
grant select,insert,update on ci_geo_target_preferences to service_role;

-- An employer's headquarters must be independently attested to by
-- its own official website. Never infer HQ from an ATS domain or a US job.
create table if not exists ci_company_country_evidence(
 company_id uuid primary key references ci_companies(id) on delete cascade,
 country char(2) not null check(country ~ '^[A-Z]{2}$'),
 source_url text not null check(length(source_url) between 12 and 500 and source_url ~ '^https://[^[:space:]]+$'),
 source_kind text not null default 'official_company' check(source_kind='official_company'),
 observed_at timestamptz not null default now()
);
alter table ci_company_country_evidence enable row level security;
revoke all on ci_company_country_evidence from public,anon,authenticated;
grant select,insert,update on ci_company_country_evidence to service_role;

-- "worldwide" is evidence of job-scoped remote geography, *not* a claim of
-- legal permission to employ a particular applicant. That remains a separate
-- official ATS eligibility assessment (Nigeria evidence required).
create table if not exists ci_job_remote_scope_evidence(
 job_id uuid primary key references ci_jobs(id) on delete cascade,
 scope text not null check(scope in ('worldwide','restricted','unknown')),
 source_url text not null check(length(source_url) between 12 and 1500 and source_url ~ '^https://[^[:space:]]+$'),
 observed_at timestamptz not null default now(),
 expires_at timestamptz not null,
 policy_version text not null default 'official-remote-scope-v1'
);
create index if not exists ci_job_remote_scope_lookup_idx
 on ci_job_remote_scope_evidence(scope,expires_at);
alter table ci_job_remote_scope_evidence enable row level security;
revoke all on ci_job_remote_scope_evidence from public,anon,authenticated;
grant select,insert,update on ci_job_remote_scope_evidence to service_role;

create or replace function public.ci_record_ats_remote_scope(
 p_job_id uuid,p_source_url text,p_scope text)
returns boolean language plpgsql set search_path=public as $scope_write$
begin
 if p_job_id is null or p_scope not in ('worldwide','restricted','unknown')
   or p_source_url is null or not exists (
    select 1 from ci_job_sources s where s.job_id=p_job_id
    and s.source_url=p_source_url and s.source_name in ('ashby','lever','greenhouse')
   ) or not exists (
    select 1 from ci_eligibility_assessments a
    where a.job_id=p_job_id and a.assessed_at>now()-interval '10 minutes'
   ) then return false; end if;
 insert into ci_job_remote_scope_evidence(job_id,scope,source_url,expires_at)
 values(p_job_id,p_scope,p_source_url,now()+interval '2 days')
 on conflict(job_id) do update set scope=excluded.scope,source_url=excluded.source_url,
  observed_at=now(),expires_at=excluded.expires_at,policy_version=excluded.policy_version;
 return true;
end;
$scope_write$;
revoke all on function public.ci_record_ats_remote_scope(uuid,text,text) from public,anon,authenticated;
grant execute on function public.ci_record_ats_remote_scope(uuid,text,text) to service_role;

-- This gate applies only to owners who explicitly selected a geographic target.
-- Unknown US employer country, worldwide-scope claims, and expired evidence
-- do NOT qualify. Unknown eligibility is separately excluded by daily delivery.
create or replace function public.ci_job_matches_geo_target(p_job uuid,p_owner uuid)
returns boolean language sql stable set search_path=public as $geo_gate$
 select not exists(select 1 from ci_geo_target_preferences p where p.owner_user_id=p_owner)
  or exists (
   select 1 from ci_geo_target_preferences p
    join ci_jobs j on j.id=p_job
    join ci_company_country_evidence c on c.company_id=j.company_id
      and c.country=p.employer_country
    join ci_job_remote_scope_evidence r on r.job_id=j.id
      and r.scope=p.remote_scope and r.expires_at>now()
   where p.owner_user_id=p_owner
     and exists(select 1 from ci_eligibility_assessments a
       where a.job_id=j.id and a.status='verified_eligible'
       and (a.expires_at is null or a.expires_at>now())
       and a.id=(select x.id from ci_eligibility_assessments x
         where x.job_id=j.id order by x.assessed_at desc,x.id desc limit 1))
 );
$geo_gate$;
revoke all on function public.ci_job_matches_geo_target(uuid,uuid) from public,anon,authenticated;
grant execute on function public.ci_job_matches_geo_target(uuid,uuid) to service_role;

-- Evidence-based known-US employers in current catalog. HQ evidence does not
-- assert remote-worldwide eligibility for any individual role.
insert into ci_company_country_evidence(company_id,country,source_url)
 select id,'US','https://fal.ai/about' from ci_companies
 where normalized_name='fal'
on conflict(company_id) do update set
 country=excluded.country,source_url=excluded.source_url,observed_at=now();
insert into ci_company_country_evidence(company_id,country,source_url)
 select id,'US','https://www.mercor.com/terms-of-service/' from ci_companies
 where normalized_name='mercor'
on conflict(company_id) do update set
 country=excluded.country,source_url=excluded.source_url,observed_at=now();
