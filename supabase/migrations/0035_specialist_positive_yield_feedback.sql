-- A signed idle canary (0 work) is not a throughput observation.
-- Only positive completed work recalibrates each specialist's expected capacity.
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
