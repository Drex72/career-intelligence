-- Volume and autonomy (owner decisions, 18 Nov 2026).
--
-- 1. Employer-stated "remote worldwide" postings (official page, current
--    worldwide remote-scope evidence, latest assessment likely_eligible) enter
--    the daily list with their own basis, 'employer_worldwide'. Postings that
--    the owner dismissed stay out. Explicit ineligible assessments never pass.
-- 2. Repeats: delivery is already de-duplicated per job (0032), so new roles
--    at an employer already recommended remain eligible. Unchanged here.
-- 3. Job-board searches restart from page 1 every 2 hours instead of every
--    24 hours, so roles posted during the day are found the same day.
-- 4. The specialist planner counts due job-board searches as discovery work,
--    so discovery runs even when every ATS board is in its 6-hour cooldown.
-- 5. Scheduling moves to Supabase pg_cron (exact, free): the worker pool every
--    10 minutes and an hourly top-up of today's list. The GitHub Actions live
--    scheduler must be disabled first (CI_GITHUB_ACTIONS_LIVE=false); its
--    runner refuses to dispatch while this cron job is active.

alter table ci_daily_batch_items drop constraint if exists ci_daily_batch_items_eligibility_basis_check;
alter table ci_daily_batch_items add constraint ci_daily_batch_items_eligibility_basis_check
  check(eligibility_basis is null or eligibility_basis in ('official_posting','job_board','employer_worldwide'));

create or replace function public.ci_job_employer_worldwide_allows(p_job uuid,p_owner uuid)
returns boolean language sql stable set search_path=public as $ww$
 select exists(
   select 1 from ci_geo_target_preferences p
    join ci_jobs j on j.id=p_job
   where p.owner_user_id=p_owner
     and exists(select 1 from ci_job_remote_scope_evidence r
       where r.job_id=j.id and r.scope='worldwide' and r.expires_at>now())
     and (p.employer_country is null or exists(select 1 from ci_company_country_evidence c
       where c.company_id=j.company_id and c.country=p.employer_country))
     and not exists(select 1 from ci_likely_tier_decisions d
       where d.owner_user_id=p_owner and d.job_id=j.id and d.decision='dismissed')
 );
$ww$;
revoke all on function public.ci_job_employer_worldwide_allows(uuid,uuid) from public,anon,authenticated;
grant execute on function public.ci_job_employer_worldwide_allows(uuid,uuid) to service_role;

create or replace function public.ci_claim_source_query(p_key text,p_cooldown_seconds integer)
returns integer language plpgsql security invoker set search_path=public as $claim_q$
declare v_page integer;
begin
  if p_key is null or length(p_key) not between 3 and 200
    or p_cooldown_seconds is null or p_cooldown_seconds not between 60 and 86400 then return null; end if;
  insert into ci_source_query_progress(query_key) values(p_key) on conflict do nothing;
  update ci_source_query_progress set
    next_page=case when cycle_started_at<=now()-interval '2 hours' then 1 else next_page end,
    cycle_started_at=case when cycle_started_at<=now()-interval '2 hours' then now() else cycle_started_at end,
    last_run_at=now()
  where query_key=p_key
    and (last_run_at is null or last_run_at<=now()-make_interval(secs=>p_cooldown_seconds))
    and (next_page>0 or cycle_started_at<=now()-interval '2 hours')
  returning next_page into v_page;
  return v_page;
end;
$claim_q$;

-- Same keys the worker builds: up to 4 keywords per target, or '*' without keywords.
create or replace function public.ci_job_board_queries_due()
returns integer language sql stable security invoker set search_path=public as $due$
  select count(*)::integer from (
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
         and (s.next_page>0 or s.cycle_started_at<=now()-interval '2 hours'));
$due$;
revoke all on function public.ci_job_board_queries_due() from public,anon,authenticated;
grant execute on function public.ci_job_board_queries_due() to service_role;

create or replace function public.ci_specialist_pool_plan()
returns jsonb language plpgsql security invoker set search_path=public as $specialist_plan$
declare
 cfg record; item record; roles jsonb:='[]'::jsonb; items jsonb;
 active_total integer; remaining_budget integer;
 due integer; current_active integer; total_runs integer; failed_runs integer;
 capacity integer; desired integer; spawn integer; available integer;
 applied integer; role_name text; throughput integer; slowdown numeric;
 observed_throughput numeric; metric_key text;
begin
 select * into cfg from ci_specialist_pool_config where id=1;
 if not found then raise exception 'specialist pool not configured'; end if;
 select count(*) into active_total from ci_worker_runs
   where state='running' and started_at>now()-interval '4 minutes';
 remaining_budget:=greatest(0,least(cfg.active_budget-active_total,cfg.dispatch_budget));
 foreach role_name in array array['eligibility','matching','discovery','people','outreach','conversation'] loop
  due:=0;
  throughput:=case role_name when 'discovery' then 6 when 'eligibility' then 8
     when 'matching' then 3 when 'people' then 2
     when 'outreach' then 4 else 12 end;
  case role_name
   when 'discovery' then
    select count(*) into due from ci_discovery_sources s
      left join ci_api_rate_limits l on l.action='ats:'||s.name
      where s.kind='ats' and s.state='active'
       and s.config->>'provider' in ('greenhouse','lever','ashby')
       and (l.last_run_at is null or l.last_run_at<=now()-interval '6 hours');
    -- Job-board searches are discovery work too, not only ATS boards past cooldown.
    due:=due+ci_job_board_queries_due();
   when 'eligibility' then
    select count(*) into due from ci_eligibility_review_queue q
      left join ci_api_rate_limits l on l.action='ats-review:'||q.job_id::text
      where q.state='pending' and (l.last_run_at is null or l.last_run_at<=now()-interval '6 hours')
       and exists(select 1 from ci_job_sources s where s.job_id=q.job_id
        and s.source_name in ('greenhouse','lever','ashby'));
   when 'matching' then
    select count(*) into due from ci_workflow_tasks
      where task_type='matching' and state='pending'
       and (next_retry_at is null or next_retry_at<=now());
   when 'people' then
    select count(*) into due from ci_workflow_tasks
      where task_type='people_research' and state in ('pending','retry_wait')
       and (next_retry_at is null or next_retry_at<=now());
   when 'outreach' then
    -- Only verified contacts in applications already submitted by the owner;
    -- no email sending permitted.
    select count(*) into due from ci_applications a
      join ci_jobs j on j.id=a.job_id and j.status='open'
      join ci_contacts c on c.company_id=j.company_id and c.identity_verified
      where a.status in ('applied','interviewing','offer') and a.applied_at is not null
        and exists(select 1 from ci_eligibility_assessments e where e.job_id=j.id
           and e.status='verified_eligible' and (e.expires_at is null or e.expires_at>now())
           and e.id=(select ee.id from ci_eligibility_assessments ee where ee.job_id=j.id
             order by ee.assessed_at desc,ee.id desc limit 1))
        and not exists(select 1 from ci_outreach_drafts d where d.owner_user_id=a.owner_user_id
          and d.job_id=j.id and d.contact_id=c.id);
   when 'conversation' then
    select count(*) into due from ci_conversation_events e
      where e.event_type='reply_received'
        and not exists(select 1 from ci_conversation_events c
           where c.event_type='reply_classified' and c.provider_message_id=e.provider_message_id)
        and e.provider_message_id is not null;
  end case;
  select count(*) into current_active from ci_worker_runs
   where specialist_role=role_name and state='running'
     and started_at>now()-interval '4 minutes';
  select count(*),count(*) filter(where state in ('failed','partial'))
    into total_runs,failed_runs from
    (select state from ci_worker_runs where specialist_role=role_name
     and finished_at is not null order by finished_at desc limit 20) s;
  -- Adapt the predicted work-per-invocation to recent completed actual results,
  -- never above the safety bound for a single signed invocation.
  metric_key:=case role_name
    when 'discovery' then 'boards_scanned'
    when 'eligibility' then 'reviewed'
    when 'matching' then 'matched'
    when 'people' then 'people_processed'
    when 'outreach' then 'drafts_prepared'
    else 'replies_classified' end;
  select avg(least(throughput,coalesce(
    case when (details->>metric_key) similar to '[0-9]+'
      then (details->>metric_key)::numeric else null end,0)))
    into observed_throughput
    from (select details from ci_worker_runs
      where specialist_role=role_name and finished_at is not null
        and state in ('completed','partial')
        and (details->>metric_key) similar to '[1-9][0-9]*'
      order by finished_at desc limit 12) recent;
  if observed_throughput is not null then
    throughput:=greatest(1,least(throughput,ceil(observed_throughput)::integer));
  end if;
  -- Error pressure backs off a role while leaving other roles operational.
  slowdown:=case when total_runs>=4 and failed_runs::numeric/total_runs>=0.5
    then 0.5 when total_runs>=4 and failed_runs::numeric/total_runs>=0.25
    then 0.75 else 1 end;
  desired:=ceil((due::numeric/greatest(1,throughput))*slowdown)::integer;
  spawn:=case when cfg.enabled then least(remaining_budget,greatest(0,desired-current_active)) else 0 end;
  remaining_budget:=remaining_budget-spawn;
  roles:=roles||jsonb_build_array(jsonb_build_object(
    'role',role_name,'queued',due,'active',current_active,
    'desired',desired,'spawn',spawn,'throughput_per_run',throughput,
    'health_factor',slowdown));
 end loop;
 return jsonb_build_object('enabled',cfg.enabled,'active_budget',cfg.active_budget,
  'dispatch_budget',cfg.dispatch_budget,'active_total',active_total,
  'remaining_dispatch_capacity',remaining_budget,'roles',roles);
end;
$specialist_plan$;
revoke all on function public.ci_specialist_pool_plan() from public,anon,authenticated;
grant execute on function public.ci_specialist_pool_plan() to service_role;

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
      when j.status='open' and a.status='likely_eligible'
        and (a.expires_at is null or a.expires_at>now())
        and j.published_at>=now()-interval '7 days'
        and ci_job_employer_worldwide_allows(j.id,p_owner_user_id)
        then 'employer_worldwide'
      end as basis) b
    where b.basis is not null
      and ci_job_matches_preferences(j.id,p_owner_user_id)
      and ci_job_matches_role_keywords(j.id,p_owner_user_id)
      and not exists (
        select 1 from ci_delivered_jobs d
        where d.owner_user_id=p_owner_user_id and d.job_id=j.id
      )
    order by (b.basis='official_posting') desc,(b.basis='employer_worldwide') desc,
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

do $schedule_volume$
begin
  if exists(select 1 from pg_extension where extname='pg_cron') then
    if coalesce(current_setting('cron.timezone',true),'GMT') not in ('GMT','UTC','Etc/UTC') then
      raise exception 'CI schedules require UTC/GMT cron timezone';
    end if;
    -- Top up today's list (Lagos date) every hour; existing items are never repeated.
    execute 'select cron.schedule($1,$2,$3)' using
      'ci-daily-topup-hourly','41 * * * *',
      'select public.ci_generate_daily_batch(owner_user_id,(now() at time zone ''Africa/Lagos'')::date,100) from public.ci_workspace_owners';
    -- Worker clock. Name kept so the GitHub runner's dual-scheduler guard sees it.
    execute 'select cron.schedule($1,$2,$3)' using
      'ci-role-aware-specialist-pool-15m','*/10 * * * *',
      'select public.ci_run_specialist_pool(false)';
  end if;
end;
$schedule_volume$;
