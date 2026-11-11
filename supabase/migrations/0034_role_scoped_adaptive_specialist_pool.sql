-- Resource-aware orchestration for six role-scoped specialist invocations.
-- Per-stage concurrency is derived from due work, claims, feedback and provider cooldown,
-- NEVER a fixed 10 -> 5 progress threshold. Global budget is an infrastructure safety limit.
alter table ci_worker_runs add column if not exists specialist_role text
  check(specialist_role in ('discovery','eligibility','matching','people','outreach','conversation'));
create index if not exists ci_worker_runs_role_active_idx
  on ci_worker_runs(specialist_role,started_at desc) where state='running';

create table if not exists ci_specialist_pool_config(
 id smallint primary key default 1 check(id=1),
 enabled boolean not null default false,
 active_budget integer not null default 32 check(active_budget between 1 and 128),
 dispatch_budget integer not null default 24 check(dispatch_budget between 1 and 128),
 interval_seconds integer not null default 120 check(interval_seconds between 30 and 3600),
 updated_at timestamptz not null default now()
);
insert into ci_specialist_pool_config(id) values(1) on conflict do nothing;
alter table ci_specialist_pool_config enable row level security;
revoke all on ci_specialist_pool_config from public,anon,authenticated;
grant select,update on ci_specialist_pool_config to service_role;

create table if not exists ci_specialist_pool_waves(
 id bigint generated always as identity primary key,
 observed_at timestamptz not null default now(),
 plan jsonb not null,
 dispatched jsonb not null default '{}'::jsonb,
 decision text not null,
 total_launched integer not null default 0 check(total_launched>=0)
);
alter table ci_specialist_pool_waves enable row level security;
revoke all on ci_specialist_pool_waves from public,anon,authenticated;
revoke all on sequence ci_specialist_pool_waves_id_seq from public,anon,authenticated;
grant select,insert on ci_specialist_pool_waves to service_role;
grant usage,select on sequence ci_specialist_pool_waves_id_seq to service_role;

-- Parallel outreach workers can see the same eligible contact; a unique
-- tuple makes draft creation idempotent. This never authorizes a send.
create unique index if not exists ci_outreach_drafts_owner_job_contact_uq
  on ci_outreach_drafts(owner_user_id,job_id,contact_id);

-- A crashed people worker must not permanently strand its claimed task.
create or replace function public.ci_reclaim_expired_people_leases()
returns integer language plpgsql security invoker set search_path=public as $reclaim_people$
declare n integer;
begin
 update ci_workflow_tasks set
    state=case when attempt_count>=max_attempts then 'blocked' else 'retry_wait' end,
    worker_id=null,lease_until=null,
    next_retry_at=case when attempt_count>=max_attempts then null else now() end,
    updated_at=now()
 where task_type='people_research' and state='leased'
   and lease_until is not null and lease_until<now();
 get diagnostics n=row_count;
 return n;
end;
$reclaim_people$;
revoke all on function public.ci_reclaim_expired_people_leases()
 from public,anon,authenticated;
grant execute on function public.ci_reclaim_expired_people_leases()
 to service_role;

-- Stage-bounded HMAC. The role is authenticated, preventing a caller
-- from changing "discovery" into "outreach" after signing.
create or replace function public.ci_verify_specialist_request(
 p_nonce uuid,p_timestamp bigint,p_signature text,p_role text)
returns boolean language plpgsql security invoker set search_path=public,extensions as $verify_role$
declare key text; expected text; recorded uuid;
begin
 if p_role not in ('discovery','eligibility','matching','people','outreach','conversation')
   or p_timestamp is null or p_signature !~ '^[0-9a-f]{64}$'
   or abs(extract(epoch from clock_timestamp())-p_timestamp)>120 then return false; end if;
 select shared_key into key from ci_worker_auth where id=1;
 if key is null then return false; end if;
 expected:=encode(extensions.hmac(
  convert_to(p_nonce::text||':'||p_timestamp::text||':'||p_role,'UTF8'),
  convert_to(key,'UTF8'),'sha256'),'hex');
 if expected<>p_signature then return false; end if;
 insert into ci_worker_nonces(nonce) values(p_nonce)
   on conflict do nothing returning nonce into recorded;
 return recorded is not null;
end;
$verify_role$;
revoke all on function public.ci_verify_specialist_request(uuid,bigint,text,text)
  from public,anon,authenticated;
grant execute on function public.ci_verify_specialist_request(uuid,bigint,text,text)
  to service_role;

create or replace function public.ci_emit_specialist_request(p_role text)
returns bigint language plpgsql security invoker set search_path=public,extensions as $emit_role$
declare key text; tick bigint; nonce uuid; signature text; request_id bigint;
begin
 if p_role not in ('discovery','eligibility','matching','people','outreach','conversation')
    or not exists(select 1 from pg_extension where extname='pg_net') then return null; end if;
 select shared_key into key from ci_worker_auth where id=1;
 if key is null then return null; end if;
 nonce:=gen_random_uuid();
 tick:=floor(extract(epoch from clock_timestamp()))::bigint;
 signature:=encode(extensions.hmac(
   convert_to(nonce::text||':'||tick::text||':'||p_role,'UTF8'),
   convert_to(key,'UTF8'),'sha256'),'hex');
 select net.http_post(
  url:='https://manqpbwiwmzqxgldhbdt.supabase.co/functions/v1/ci-worker',
  body:=jsonb_build_object('nonce',nonce::text,'timestamp',tick,
    'signature',signature,'role',p_role),
  headers:=jsonb_build_object('Content-Type','application/json'),
  timeout_milliseconds:=5000
 ) into request_id;
 return request_id;
end;
$emit_role$;
revoke all on function public.ci_emit_specialist_request(text) from public,anon,authenticated;

-- Self-calibrating per-role work estimates. Existing shared-workload roles
-- have throughput floors from proven per-call bounded amounts; no user-specified
-- worker count nor delivery-progress threshold controls concurrency.
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
     case when details->>metric_key ~ '^[0-9]+
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

create or replace function public.ci_run_specialist_pool(p_dry_run boolean default false)
returns jsonb language plpgsql security invoker set search_path=public as $specialist_run$
declare
 plan jsonb; cfg record; last_time timestamptz;
 role_record record; i integer; req bigint; all_launched integer:=0;
 dispatched jsonb:='{}'::jsonb; role_launched integer;
 decision text; wave_id bigint;
begin
 if not pg_try_advisory_xact_lock(hashtext('ci:specialist-pool')) then
  return jsonb_build_object('decision','controller_busy','launched',0);end if;
 if not p_dry_run then perform ci_reclaim_expired_people_leases(); end if;
 plan:=ci_specialist_pool_plan();
 if p_dry_run then return plan||jsonb_build_object('dry_run',true,'launched',0); end if;
 select * into cfg from ci_specialist_pool_config where id=1;
 if not cfg.enabled then return plan||jsonb_build_object('decision','disabled','launched',0); end if;
 select observed_at into last_time from ci_specialist_pool_waves
   where total_launched>0 order by observed_at desc limit 1;
 if last_time is not null and last_time>now()-make_interval(secs=>cfg.interval_seconds) then
   return plan||jsonb_build_object('decision','cooldown','launched',0); end if;
 for role_record in select r.role,r.spawn from jsonb_to_recordset(plan->'roles')
  as r(role text,spawn int) loop
  role_launched:=0;
  if role_record.spawn>0 then
    for i in 1..role_record.spawn loop
      req:=ci_emit_specialist_request(role_record.role);
      if req is not null then
        role_launched:=role_launched+1;all_launched:=all_launched+1;
      end if;
    end loop;
  end if;
  dispatched:=dispatched||jsonb_build_object(role_record.role,role_launched);
 end loop;
 decision:=case when all_launched>0 then 'dispatch' else 'idle' end;
 insert into ci_specialist_pool_waves(plan,dispatched,decision,total_launched)
   values(plan,dispatched,decision,all_launched) returning id into wave_id;
 return plan||jsonb_build_object('wave_id',wave_id,'decision',decision,
   'dispatched',dispatched,'launched',all_launched);
end;
$specialist_run$;
revoke all on function public.ci_run_specialist_pool(boolean) from public,anon,authenticated;
grant execute on function public.ci_run_specialist_pool(boolean) to service_role;

       then (details->>metric_key)::numeric else null end,0)))
   into observed_throughput
   from (select details from ci_worker_runs
     where specialist_role=role_name and finished_at is not null
      and state in ('completed','partial')
     order by finished_at desc limit 12) recent;
  if observed_throughput is not null then
    throughput:=greatest(1,least(throughput,ceil(observed_throughput)::integer));
  end if;
  -- Feedback: high recent failure proportion reduces dispatch pressure.
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

create or replace function public.ci_run_specialist_pool(p_dry_run boolean default false)
returns jsonb language plpgsql security invoker set search_path=public as $specialist_run$
declare
 plan jsonb; cfg record; last_time timestamptz;
 role_record record; i integer; req bigint; all_launched integer:=0;
 dispatched jsonb:='{}'::jsonb; role_launched integer;
 decision text; wave_id bigint;
begin
 if not pg_try_advisory_xact_lock(hashtext('ci:specialist-pool')) then
  return jsonb_build_object('decision','controller_busy','launched',0);end if;
 if not p_dry_run then perform ci_reclaim_expired_people_leases(); end if;
 plan:=ci_specialist_pool_plan();
 if p_dry_run then return plan||jsonb_build_object('dry_run',true,'launched',0); end if;
 select * into cfg from ci_specialist_pool_config where id=1;
 if not cfg.enabled then return plan||jsonb_build_object('decision','disabled','launched',0); end if;
 select observed_at into last_time from ci_specialist_pool_waves
   where total_launched>0 order by observed_at desc limit 1;
 if last_time is not null and last_time>now()-make_interval(secs=>cfg.interval_seconds) then
   return plan||jsonb_build_object('decision','cooldown','launched',0); end if;
 for role_record in select r.role,r.spawn from jsonb_to_recordset(plan->'roles')
  as r(role text,spawn int) loop
  role_launched:=0;
  if role_record.spawn>0 then
    for i in 1..role_record.spawn loop
      req:=ci_emit_specialist_request(role_record.role);
      if req is not null then
        role_launched:=role_launched+1;all_launched:=all_launched+1;
      end if;
    end loop;
  end if;
  dispatched:=dispatched||jsonb_build_object(role_record.role,role_launched);
 end loop;
 decision:=case when all_launched>0 then 'dispatch' else 'idle' end;
 insert into ci_specialist_pool_waves(plan,dispatched,decision,total_launched)
   values(plan,dispatched,decision,all_launched) returning id into wave_id;
 return plan||jsonb_build_object('wave_id',wave_id,'decision',decision,
   'dispatched',dispatched,'launched',all_launched);
end;
$specialist_run$;
revoke all on function public.ci_run_specialist_pool(boolean) from public,anon,authenticated;
grant execute on function public.ci_run_specialist_pool(boolean) to service_role;
