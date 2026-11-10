-- Owner-configured discovery preferences, retained in Career Intelligence's ci_ namespace.
-- No user preferences are inferred, and unknown work arrangements or visa policies never match restrictive requests.
create table if not exists ci_discovery_preferences (
  owner_user_id uuid primary key references auth.users(id) on delete cascade,
  daily_target integer not null default 25 check(daily_target between 1 and 100),
  job_families text[] not null default array['any']::text[],
  seniority_levels text[] not null default array['any']::text[],
  work_modes text[] not null default array['any']::text[],
  sponsorship text not null default 'any' check(sponsorship in ('any','confirmed_required')),
  updated_at timestamptz not null default now(),
  constraint ci_pref_families check (
    cardinality(job_families) between 1 and 7 and
    job_families <@ array['any','backend','frontend','fullstack','platform','ai_ml','security','data']::text[]),
  constraint ci_pref_levels check (
    cardinality(seniority_levels) between 1 and 5 and
    seniority_levels <@ array['any','intern','junior','mid','senior','staff']::text[]),
  constraint ci_pref_modes check (
    cardinality(work_modes) between 1 and 4 and
    work_modes <@ array['any','remote','hybrid','onsite']::text[])
);
alter table ci_discovery_preferences enable row level security;
revoke all on ci_discovery_preferences from public, anon, authenticated;
grant select,insert,update on ci_discovery_preferences to service_role;

-- Structured, official source-backed facts. The absence of an assessment is unknown, not false.
create table if not exists ci_job_work_facts (
  job_id uuid primary key references ci_jobs(id) on delete cascade,
  work_mode text not null check(work_mode in ('remote','hybrid','onsite','unknown')),
  sponsorship text not null default 'unknown' check(sponsorship in ('confirmed','not_offered','unknown')),
  source_evidence_id uuid references ci_eligibility_evidence(id),
  verified_at timestamptz not null default now(),
  expires_at timestamptz not null default (now()+interval '7 days'),
  constraint ci_work_fact_evidence check (
    (work_mode='unknown' and sponsorship='unknown') or source_evidence_id is not null)
);
alter table ci_job_work_facts enable row level security;
revoke all on ci_job_work_facts from public,anon,authenticated;
grant select,insert,update on ci_job_work_facts to service_role;

create or replace function ci_save_discovery_preferences(
  p_owner uuid,p_target integer,p_families text[],p_levels text[],
  p_modes text[],p_sponsorship text
) returns boolean
language plpgsql security invoker set search_path=public as $save$
begin
  if not exists(select 1 from ci_workspace_owners where owner_user_id=p_owner)
    or p_target not between 1 and 100
    or cardinality(p_families) not between 1 and 7
    or cardinality(p_levels) not between 1 and 5
    or cardinality(p_modes) not between 1 and 4
    or not p_families <@ array['any','backend','frontend','fullstack','platform','ai_ml','security','data']::text[]
    or not p_levels <@ array['any','intern','junior','mid','senior','staff']::text[]
    or not p_modes <@ array['any','remote','hybrid','onsite']::text[]
    or p_sponsorship not in ('any','confirmed_required')
    or (array_position(p_families,'any') is not null and cardinality(p_families)>1)
    or (array_position(p_levels,'any') is not null and cardinality(p_levels)>1)
    or (array_position(p_modes,'any') is not null and cardinality(p_modes)>1)
    then return false; end if;
  insert into ci_discovery_preferences
    (owner_user_id,daily_target,job_families,seniority_levels,work_modes,sponsorship)
  values(p_owner,p_target,p_families,p_levels,p_modes,p_sponsorship)
  on conflict(owner_user_id) do update set
    daily_target=excluded.daily_target,job_families=excluded.job_families,
    seniority_levels=excluded.seniority_levels,work_modes=excluded.work_modes,
    sponsorship=excluded.sponsorship,updated_at=now();
  return true;
end;
$save$;

create or replace function ci_job_matches_preferences(
 p_job uuid,p_owner uuid
) returns boolean
language plpgsql stable security invoker set search_path=public as $match$
declare v_pref ci_discovery_preferences%rowtype;
        v_title text;v_family text;v_level text;
        v_mode text;v_visa text;v_exp timestamptz;
begin
 select * into v_pref from ci_discovery_preferences where owner_user_id=p_owner;
 if not found then return true; end if;
 select lower(title) into v_title from ci_jobs where id=p_job;
 if v_title is null then return false; end if;
 -- Reject explicit non-technical sales roles even if an isolated title includes "engineer".
 if v_title ~ '(sales engineer|sales engineering|business development|customer success)' then return false; end if;
 v_family:=case
  when v_title ~ '(machine learning|(^|[^a-z])ai([^a-z]|$)|(^|[^a-z])ml([^a-z]|$)|llm|artificial intelligence)' then 'ai_ml'
  when v_title ~ '(cybersecurity|security engineer)' then 'security'
  when v_title ~ '(data engineer|data platform)' then 'data'
  when v_title ~ '(platform|devops|infrastructure|site reliability|cloud engineer|sre)' then 'platform'
  when v_title ~ '(full.?stack)' then 'fullstack'
  when v_title ~ '(frontend|front.end|react)' then 'frontend'
  when v_title ~ '(backend|back.end|server.side|api engineer)' then 'backend'
  else 'unknown' end;
 if not ('any'=any(v_pref.job_families) or v_family=any(v_pref.job_families)) then return false; end if;
 v_level:=case
  when v_title ~ '(intern|internship|placement)' then 'intern'
  when v_title ~ '(staff|principal|distinguished|lead engineer)' then 'staff'
  when v_title ~ '(senior|(^|[^a-z])sr([^a-z]|$))' then 'senior'
  when v_title ~ '(junior|entry.level|graduate|new grad)' then 'junior'
  when v_title ~ '(mid.level|intermediate)' then 'mid'
  else 'unknown' end;
 if not ('any'=any(v_pref.seniority_levels) or v_level=any(v_pref.seniority_levels)) then return false; end if;
 if 'any'=any(v_pref.work_modes) and v_pref.sponsorship='any' then return true; end if;
 select f.work_mode,f.sponsorship,f.expires_at into v_mode,v_visa,v_exp
 from ci_job_work_facts f where f.job_id=p_job;
 if v_exp is null or v_exp<=now() then return false; end if;
 if not ('any'=any(v_pref.work_modes) or v_mode=any(v_pref.work_modes)) then return false; end if;
 if v_pref.sponsorship='confirmed_required' and v_visa<>'confirmed' then return false; end if;
 return true;
end;
$match$;

revoke all on function ci_save_discovery_preferences(uuid,integer,text[],text[],text[],text),
  ci_job_matches_preferences(uuid,uuid) from public,anon,authenticated;
grant execute on function ci_save_discovery_preferences(uuid,integer,text[],text[],text[],text),
  ci_job_matches_preferences(uuid,uuid) to service_role;
