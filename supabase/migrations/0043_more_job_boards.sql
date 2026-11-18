-- More free job boards: Jobicy (JSON API) and We Work Remotely (RSS), plus location
-- rules for Remotive. All are job-board evidence, labelled with the board at delivery.
-- Only ci_ objects are touched. Non-destructive: widens checks and replaces functions.

-- 1. Location rules may come from any of the four boards.
alter table ci_job_location_rules drop constraint if exists ci_job_location_rules_source_name_check;
alter table ci_job_location_rules add constraint ci_job_location_rules_source_name_check
  check(source_name in ('himalayas','remotive','jobicy','weworkremotely'));

-- 2. One cooldown table for every feed, shared by the claim and the planner.
create or replace function public.ci_feed_cooldown(p_action text)
returns interval language sql immutable set search_path=public as $cool$
  select case p_action
    when 'remotive' then interval '6 hours'        -- provider asks for at most 4 requests a day
    when 'himalayas' then interval '24 hours'      -- browse feed refreshes daily
    when 'jobicy' then interval '2 hours'
    when 'weworkremotely' then interval '1 hour'   -- RSS ttl is 60 minutes
  end;
$cool$;
revoke all on function public.ci_feed_cooldown(text) from public,anon,authenticated;
grant execute on function public.ci_feed_cooldown(text) to service_role;

create or replace function public.ci_claim_feed_slot(p_action text)
returns boolean language plpgsql security invoker set search_path=public as $ci_claim_feeds$
declare claimed text; cooldown interval;
begin
  cooldown:=ci_feed_cooldown(p_action);
  if cooldown is null then return false; end if;
  insert into ci_api_rate_limits(action,last_run_at) values(p_action,now())
  on conflict(action) do update set last_run_at=excluded.last_run_at
    where ci_api_rate_limits.last_run_at<=now()-cooldown
  returning action into claimed;
  return claimed is not null;
end;
$ci_claim_feeds$;
revoke all on function public.ci_claim_feed_slot(text) from public,anon,authenticated;
grant execute on function public.ci_claim_feed_slot(text) to service_role;

-- 3. Discovery demand: due searches plus feeds whose slot is open.
create or replace function public.ci_job_board_queries_due()
returns integer language sql stable security invoker set search_path=public as $due$
  select (select count(*)::integer from (
    select 'himalayas:'||p.applicant_country||':'||k.kw as query_key
    from ci_geo_target_preferences p
    cross join lateral (
      select kw from unnest(case when cardinality(p.role_keywords)>0
        then p.role_keywords[1:4] else array['*'] end) kw
    ) k
  ) q
  left join ci_source_query_progress s on s.query_key=q.query_key
  where s.query_key is null
     or ((s.last_run_at is null or s.last_run_at<=now()-interval '10 minutes')
         and (s.next_page>0 or s.cycle_started_at<=now()-interval '2 hours')))
  + (select count(*)::integer from unnest(array['remotive','himalayas','jobicy','weworkremotely']) f(action)
     left join ci_api_rate_limits l on l.action=f.action
     where l.action is null or l.last_run_at<=now()-ci_feed_cooldown(f.action));
$due$;
revoke all on function public.ci_job_board_queries_due() from public,anon,authenticated;
grant execute on function public.ci_job_board_queries_due() to service_role;

-- 4. Generic ingest for boards whose own job page is the application entry point.
-- The board URL is kept unchanged (both boards ask that apply links go to it).
create or replace function public.ci_ingest_board_job(
  p_source_name text,p_source_id text,p_company text,p_title text,p_url text,
  p_published_at timestamptz,p_location text
) returns uuid language plpgsql security invoker set search_path=public as $ingest_board$
declare v_company uuid; v_job uuid; name text;
begin
  name:=trim(p_company);
  if p_source_name is null or p_source_id is null or length(p_source_id) not between 1 and 200
     or name is null or length(name) not between 2 and 180
     or p_title is null or length(trim(p_title)) not between 3 and 250
     or p_url is null or length(p_url)>1000
     or p_published_at is null or p_published_at<now()-interval '7 days'
     or p_published_at>now()+interval '1 day' then return null; end if;
  if not ((p_source_name='jobicy' and p_source_id ~ '^[0-9]{1,20}$'
            and p_url ~ '^https://jobicy[.]com/jobs/[A-Za-z0-9_%-]+$')
       or (p_source_name='weworkremotely' and p_source_id ~ '^[A-Za-z0-9_%-]+$'
            and p_url='https://weworkremotely.com/remote-jobs/'||p_source_id)) then
    return null;
  end if;
  select id into v_company from ci_companies
    where canonical_domain is null and normalized_name=lower(name) limit 1;
  if v_company is null then
    insert into ci_companies(normalized_name,legal_name,identity_confidence)
      values(lower(name),name,'unverified')
    on conflict ((lower(normalized_name))) where canonical_domain is null
      do update set legal_name=excluded.legal_name
    returning id into v_company;
  end if;
  insert into ci_jobs(company_id,title,apply_url,canonical_apply_url,status,
     published_at,timestamp_source,timestamp_confidence,remote_text)
  values(v_company,trim(p_title),p_url,p_url,'unverified',
     p_published_at,p_source_name,'authoritative',left(coalesce(p_location,''),500))
  on conflict(company_id,canonical_apply_url) do update set
     title=excluded.title,remote_text=excluded.remote_text
  returning id into v_job;
  insert into ci_job_sources(job_id,source_name,source_job_id,source_url)
    values(v_job,p_source_name,p_source_id,p_url)
  on conflict(source_name,source_job_id) where source_job_id is not null
    do update set source_url=excluded.source_url,retrieved_at=now();
  return v_job;
end;
$ingest_board$;
revoke all on function public.ci_ingest_board_job(text,text,text,text,text,timestamptz,text) from public,anon,authenticated;
grant execute on function public.ci_ingest_board_job(text,text,text,text,text,timestamptz,text) to service_role;
