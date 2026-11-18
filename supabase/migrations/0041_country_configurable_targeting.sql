-- Country-configurable targeting (owner decision 2026-11-18).
--
-- The applicant country, optional employer country and role keywords are owner
-- settings, not code. A job qualifies for delivery in one of two labelled ways:
--   official_posting: the existing path (official ATS text explicitly permits the
--     applicant; the text classifier is still Nigeria-specific, so this path only
--     applies while applicant_country = 'NG').
--   job_board: a job board's structured location rule (worldwide, or a country
--     list that includes the applicant's country), recorded with its source and
--     an expiry. An official "ineligible" assessment always wins over it.
-- Every delivered item records which basis it used.

-- 1. Owner settings: any ISO country, optional employer country, role keywords.
alter table ci_geo_target_preferences
  drop constraint if exists ci_geo_target_preferences_applicant_country_check,
  drop constraint if exists ci_geo_target_preferences_employer_country_check;
alter table ci_geo_target_preferences alter column employer_country drop not null;
alter table ci_geo_target_preferences
  drop constraint if exists ci_geo_target_applicant_iso,
  drop constraint if exists ci_geo_target_employer_iso;
alter table ci_geo_target_preferences
  add constraint ci_geo_target_applicant_iso check (applicant_country ~ '^[A-Z]{2}$'),
  add constraint ci_geo_target_employer_iso check (employer_country is null or employer_country ~ '^[A-Z]{2}$');
alter table ci_geo_target_preferences
  add column if not exists role_keywords text[] not null default '{}'::text[];
alter table ci_geo_target_preferences
  drop constraint if exists ci_geo_target_role_keywords;
alter table ci_geo_target_preferences
  add constraint ci_geo_target_role_keywords check (cardinality(role_keywords) <= 8);

create or replace function public.ci_save_geo_target(
  p_owner uuid,p_applicant_country text,p_employer_country text,p_role_keywords text[])
returns boolean language plpgsql security invoker set search_path=public as $save_geo$
declare v_keywords text[];
begin
  if p_owner is null or not exists(select 1 from ci_workspace_owners where owner_user_id=p_owner)
    or p_applicant_country is null or p_applicant_country !~ '^[A-Z]{2}$'
    or (p_employer_country is not null and p_employer_country !~ '^[A-Z]{2}$')
    or p_role_keywords is null or cardinality(p_role_keywords) > 8
    or exists(select 1 from unnest(p_role_keywords) k
      where k is null or length(trim(k)) not between 2 and 60 or k !~ '^[A-Za-z0-9 +#./-]+$')
    then return false; end if;
  select coalesce(array_agg(distinct lower(trim(k))),'{}'::text[]) into v_keywords
    from unnest(p_role_keywords) k;
  insert into ci_discovery_preferences(owner_user_id) values(p_owner) on conflict do nothing;
  insert into ci_geo_target_preferences(owner_user_id,employer_country,applicant_country,remote_scope,role_keywords)
    values(p_owner,p_employer_country,p_applicant_country,'worldwide',v_keywords)
  on conflict(owner_user_id) do update set employer_country=excluded.employer_country,
    applicant_country=excluded.applicant_country,role_keywords=excluded.role_keywords,updated_at=now();
  return true;
end;
$save_geo$;
revoke all on function public.ci_save_geo_target(uuid,text,text,text[]) from public,anon,authenticated;
grant execute on function public.ci_save_geo_target(uuid,text,text,text[]) to service_role;

-- 2. Job-board location rules, kept apart from official eligibility evidence.
create table if not exists ci_job_location_rules(
  job_id uuid primary key references ci_jobs(id) on delete cascade,
  source_name text not null check(source_name in ('himalayas')),
  source_kind text not null default 'job_board' check(source_kind='job_board'),
  source_url text not null check(length(source_url) between 12 and 1500 and source_url ~ '^https://[^[:space:]]+$'),
  worldwide boolean not null,
  countries text[] not null default '{}'::text[] check(cardinality(countries) <= 260),
  observed_at timestamptz not null default now(),
  expires_at timestamptz not null,
  check(worldwide or cardinality(countries) > 0)
);
create index if not exists ci_job_location_rules_expiry_idx on ci_job_location_rules(expires_at);
alter table ci_job_location_rules enable row level security;
revoke all on ci_job_location_rules from public,anon,authenticated;
grant select,insert,update on ci_job_location_rules to service_role;

create or replace function public.ci_record_job_location_rule(
  p_job_id uuid,p_source_name text,p_source_url text,p_worldwide boolean,p_countries text[])
returns boolean language plpgsql security invoker set search_path=public as $rule$
begin
  if p_job_id is null or p_source_name is null or p_source_url is null or p_worldwide is null
    or p_countries is null or cardinality(p_countries) > 260
    or (not p_worldwide and cardinality(p_countries) = 0)
    or exists(select 1 from unnest(p_countries) c where c is null or c !~ '^[A-Z]{2}$')
    or not exists(select 1 from ci_job_sources s where s.job_id=p_job_id
      and s.source_name=p_source_name and s.source_url=p_source_url)
    then return false; end if;
  insert into ci_job_location_rules(job_id,source_name,source_url,worldwide,countries,expires_at)
    values(p_job_id,p_source_name,p_source_url,p_worldwide,
      (select coalesce(array_agg(distinct c order by c),'{}'::text[]) from unnest(p_countries) c),
      now()+interval '3 days')
  on conflict(job_id) do update set source_name=excluded.source_name,source_url=excluded.source_url,
    worldwide=excluded.worldwide,countries=excluded.countries,observed_at=now(),expires_at=excluded.expires_at;
  return true;
end;
$rule$;
revoke all on function public.ci_record_job_location_rule(uuid,text,text,boolean,text[]) from public,anon,authenticated;
grant execute on function public.ci_record_job_location_rule(uuid,text,text,boolean,text[]) to service_role;

-- 3. Paged, resumable source queries so a daily search can be walked over several runs.
create table if not exists ci_source_query_progress(
  query_key text primary key check(length(query_key) between 3 and 200),
  next_page integer not null default 1 check(next_page between 0 and 1000),
  cycle_started_at timestamptz not null default now(),
  last_run_at timestamptz
);
alter table ci_source_query_progress enable row level security;
revoke all on ci_source_query_progress from public,anon,authenticated;
grant select,insert,update on ci_source_query_progress to service_role;

-- Returns the page to start from, or null when the query is cooling down or its
-- daily walk is complete. next_page = 0 marks a finished walk until the next cycle.
create or replace function public.ci_claim_source_query(p_key text,p_cooldown_seconds integer)
returns integer language plpgsql security invoker set search_path=public as $claim_q$
declare v_page integer;
begin
  if p_key is null or length(p_key) not between 3 and 200
    or p_cooldown_seconds is null or p_cooldown_seconds not between 60 and 86400 then return null; end if;
  insert into ci_source_query_progress(query_key) values(p_key) on conflict do nothing;
  update ci_source_query_progress set
    next_page=case when cycle_started_at<=now()-interval '24 hours' then 1 else next_page end,
    cycle_started_at=case when cycle_started_at<=now()-interval '24 hours' then now() else cycle_started_at end,
    last_run_at=now()
  where query_key=p_key
    and (last_run_at is null or last_run_at<=now()-make_interval(secs=>p_cooldown_seconds))
    and (next_page>0 or cycle_started_at<=now()-interval '24 hours')
  returning next_page into v_page;
  return v_page;
end;
$claim_q$;
create or replace function public.ci_advance_source_query(p_key text,p_next_page integer)
returns boolean language sql security invoker set search_path=public as $advance_q$
  update ci_source_query_progress set next_page=p_next_page
  where query_key=p_key and p_next_page between 0 and 1000
  returning true;
$advance_q$;
revoke all on function public.ci_claim_source_query(text,integer),
  public.ci_advance_source_query(text,integer) from public,anon,authenticated;
grant execute on function public.ci_claim_source_query(text,integer),
  public.ci_advance_source_query(text,integer) to service_role;

-- 4. Gates.
-- Official path: unchanged evidence rules; employer country optional; the official
-- text classifier only proves Nigeria, so it applies only to applicant_country NG.
create or replace function public.ci_job_matches_geo_target(p_job uuid,p_owner uuid)
returns boolean language sql stable set search_path=public as $geo_gate$
 select not exists(select 1 from ci_geo_target_preferences p where p.owner_user_id=p_owner)
  or exists (
   select 1 from ci_geo_target_preferences p
    join ci_jobs j on j.id=p_job
    join ci_job_remote_scope_evidence r on r.job_id=j.id
      and r.scope=p.remote_scope and r.expires_at>now()
   where p.owner_user_id=p_owner
     and p.applicant_country='NG'
     and (p.employer_country is null or exists(select 1 from ci_company_country_evidence c
       where c.company_id=j.company_id and c.country=p.employer_country))
     and exists(select 1 from ci_eligibility_assessments a
       where a.job_id=j.id and a.status='verified_eligible'
       and (a.expires_at is null or a.expires_at>now())
       and a.id=(select x.id from ci_eligibility_assessments x
         where x.job_id=j.id order by x.assessed_at desc,x.id desc limit 1))
 );
$geo_gate$;
revoke all on function public.ci_job_matches_geo_target(uuid,uuid) from public,anon,authenticated;
grant execute on function public.ci_job_matches_geo_target(uuid,uuid) to service_role;

-- Job-board path: an unexpired structured rule that includes the applicant country
-- (or is worldwide), the optional employer-country evidence, and no official negative.
create or replace function public.ci_job_location_rule_allows(p_job uuid,p_owner uuid)
returns boolean language sql stable set search_path=public as $rule_gate$
 select exists (
   select 1 from ci_geo_target_preferences p
    join ci_jobs j on j.id=p_job
    join ci_job_location_rules r on r.job_id=j.id and r.expires_at>now()
   where p.owner_user_id=p_owner
     and (r.worldwide or p.applicant_country=any(r.countries))
     and (p.employer_country is null or exists(select 1 from ci_company_country_evidence c
       where c.company_id=j.company_id and c.country=p.employer_country))
     and coalesce((select x.status from ci_eligibility_assessments x where x.job_id=j.id
       order by x.assessed_at desc,x.id desc limit 1),'')<>'ineligible'
 );
$rule_gate$;
create or replace function public.ci_job_matches_role_keywords(p_job uuid,p_owner uuid)
returns boolean language sql stable set search_path=public as $kw$
 select coalesce((select cardinality(p.role_keywords)=0
     or exists(select 1 from ci_jobs j, unnest(p.role_keywords) k
       where j.id=p_job and position(k in lower(j.title))>0)
   from ci_geo_target_preferences p where p.owner_user_id=p_owner),true);
$kw$;
revoke all on function public.ci_job_location_rule_allows(uuid,uuid),
  public.ci_job_matches_role_keywords(uuid,uuid) from public,anon,authenticated;
grant execute on function public.ci_job_location_rule_allows(uuid,uuid),
  public.ci_job_matches_role_keywords(uuid,uuid) to service_role;

-- 5. Delivery records its basis.
alter table ci_daily_batch_items add column if not exists eligibility_basis text
  check(eligibility_basis is null or eligibility_basis in ('official_posting','job_board'));

create or replace function public.ci_generate_daily_batch(p_owner_user_id uuid,p_local_date date,p_target integer default 100)
returns integer language plpgsql set search_path to 'public' as $function$
declare
  v_batch_id uuid;
  v_rank integer;
  v_row record;
  v_claimed uuid;
  v_inserted integer := 0;
  v_effective_target integer;
begin
  if p_owner_user_id is null or p_local_date is null or p_target not between 1 and 100 then
    raise exception 'Invalid batch parameters';
  end if;
  perform pg_advisory_xact_lock(hashtext('ci-delivery:' || p_owner_user_id::text));
  select least(p_target,coalesce((select daily_target from ci_discovery_preferences
       where owner_user_id=p_owner_user_id),25)) into v_effective_target;
  insert into ci_daily_batches(owner_user_id,local_date,target)
    values(p_owner_user_id,p_local_date,v_effective_target)
    on conflict(owner_user_id,local_date) do update set target=excluded.target
    returning id into v_batch_id;

  select count(*) into v_rank from ci_daily_batch_items where batch_id=v_batch_id;
  if v_rank >= v_effective_target then return 0; end if;
  for v_row in
    select j.id as job_id,j.company_id,b.basis
    from ci_jobs j
    left join lateral (
      select a.status,a.expires_at from ci_eligibility_assessments a
      where a.job_id=j.id order by a.assessed_at desc,a.id desc limit 1
    ) a on true
    left join lateral (
      select m.score from ci_job_matches m
      where m.job_id=j.id order by m.computed_at desc limit 1
    ) m on true
    cross join lateral (select case
      when j.status='open' and a.status='verified_eligible'
        and (a.expires_at is null or a.expires_at>now())
        and j.published_at>=now()-interval '7 days'
        and exists (select 1 from ci_eligibility_evidence e where e.job_id=j.id)
        and ci_job_matches_geo_target(j.id,p_owner_user_id)
        then 'official_posting'
      when j.status in ('open','unverified')
        and coalesce(j.published_at,j.updated_at)>=now()-interval '7 days'
        and ci_job_location_rule_allows(j.id,p_owner_user_id)
        then 'job_board'
      end as basis) b
    where b.basis is not null
      and ci_job_matches_preferences(j.id,p_owner_user_id)
      and ci_job_matches_role_keywords(j.id,p_owner_user_id)
      and not exists (
        select 1 from ci_delivered_jobs d
        where d.owner_user_id=p_owner_user_id and d.job_id=j.id
      )
    order by (b.basis='official_posting') desc,
      (coalesce(j.published_at,j.updated_at) >= now()-interval '72 hours') desc,
      coalesce(m.score,0) desc,coalesce(j.published_at,j.updated_at) desc,j.first_seen_at desc
    limit greatest(v_effective_target*8,v_effective_target)
  loop
    exit when v_rank >= v_effective_target;
    v_claimed := null;
    insert into ci_delivered_companies(owner_user_id,company_id,first_batch_id)
      values(p_owner_user_id,v_row.company_id,v_batch_id)
      on conflict do nothing returning company_id into v_claimed;
    insert into ci_delivered_jobs(owner_user_id,job_id)
      values(p_owner_user_id,v_row.job_id)
      on conflict do nothing;
    v_rank:=v_rank+1;
    insert into ci_daily_batch_items(batch_id,company_id,job_id,rank,eligibility_basis)
      values(v_batch_id,v_row.company_id,v_row.job_id,v_rank,v_row.basis);
    v_inserted:=v_inserted+1;
  end loop;
  update ci_daily_batches set state='completed' where id=v_batch_id;
  return v_inserted;
end;
$function$;
revoke all on function public.ci_generate_daily_batch(uuid,date,integer) from public,anon,authenticated;
grant execute on function public.ci_generate_daily_batch(uuid,date,integer) to service_role;
