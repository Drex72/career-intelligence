-- Adaptive signed worker fleet. A dispatch is a real Edge Function invocation, not a fake agent.
-- Current ci-worker handles discovery, ATS review and matching within a single invocation;
-- demand-by-stage is advisory and the same invocation may process multiple stages.
-- The controller does not cancel already running requests: scale down means no new work is launched.
create table if not exists ci_worker_pool_config (
  id smallint primary key default 1 check (id=1),
  enabled boolean not null default true,
  max_instances integer not null default 10 check(max_instances between 1 and 10),
  reduced_instances integer not null default 5 check(reduced_instances between 1 and 10),
  reduce_after_delivered integer not null default 80 check(reduce_after_delivered between 0 and 100),
  min_wave_interval_seconds integer not null default 240 check(min_wave_interval_seconds between 60 and 3600),
  updated_at timestamptz not null default now(),
  check(reduced_instances<=max_instances)
);
insert into public.ci_worker_pool_config(id) values(1) on conflict(id) do nothing;
alter table ci_worker_pool_config enable row level security;
revoke all on public.ci_worker_pool_config from public,anon,authenticated;
grant select,update on public.ci_worker_pool_config to service_role;

create table if not exists ci_worker_pool_waves (
  id bigint generated always as identity primary key,
  observed_at timestamptz not null default clock_timestamp(),
  target integer not null check(target between 1 and 100),
  already_delivered integer not null check(already_delivered>=0),
  remaining integer not null check(remaining between 0 and 100),
  concurrency_ceiling integer not null check(concurrency_ceiling between 0 and 10),
  active_count integer not null check(active_count>=0),
  due_boards integer not null check(due_boards>=0),
  pending_reviews integer not null check(pending_reviews>=0),
  pending_matches integer not null check(pending_matches>=0),
  desired_instances integer not null check(desired_instances between 0 and 10),
  dispatched integer not null check(dispatched between 0 and 10),
  request_ids bigint[] not null default '{}',
  decision text not null check(decision in ('dispatch','idle','at_target','capacity_exhausted','cooldown','disabled','unavailable')),
  check(dispatched<=desired_instances)
);
create index if not exists ci_worker_pool_waves_recent_idx on public.ci_worker_pool_waves(observed_at desc,id desc);
alter table ci_worker_pool_waves enable row level security;
revoke all on public.ci_worker_pool_waves from public,anon,authenticated;
revoke all on sequence public.ci_worker_pool_waves_id_seq from public,anon,authenticated;
grant select,insert on public.ci_worker_pool_waves to service_role;
grant usage,select on sequence public.ci_worker_pool_waves_id_seq to service_role;

-- Pure policy function: at 0-79 existing deliveries max 10; at 80-99 max 5;
-- at target launch nothing. This is scheduling progress, not fit-quality proof.
create or replace function public.ci_worker_pool_ceiling(
  p_delivered integer,p_target integer,p_max integer,p_reduced integer,p_threshold integer)
returns integer language sql immutable strict as $ci_ceiling$
  select case when p_delivered>=p_target then 0
    when p_delivered>=p_threshold then p_reduced else p_max end
$ci_ceiling$;
revoke all on function public.ci_worker_pool_ceiling(integer,integer,integer,integer,integer)
  from public,anon,authenticated;
grant execute on function public.ci_worker_pool_ceiling(integer,integer,integer,integer,integer)
  to service_role;

-- Computes demand without making any external network request.
-- Counts of already-delivered roles are only a scheduling proxy; they are NOT
-- proof of the future, stricter requirements-based fit gate.
create or replace function public.ci_worker_pool_plan()
returns jsonb language plpgsql security invoker set search_path=public as $ci_pool_plan$
declare
  cfg record;
  target_total integer;
  delivered integer;
  gap integer;
  eligible_board_count integer;
  review_count integer;
  match_count integer;
  current_active integer;
  demand integer;
  ceiling integer;
  planned integer;
  age_limit interval;
begin
  select * into cfg from ci_worker_pool_config where id=1;
  if not found then raise exception 'worker pool configuration missing'; end if;
  select coalesce(max(coalesce(p.daily_target,100)),100) into target_total
    from ci_workspace_owners o left join ci_discovery_preferences p on p.owner_user_id=o.owner_user_id;
  if not exists(select 1 from ci_workspace_owners) then
    return jsonb_build_object('target',target_total,'delivered',0,'remaining',target_total,
      'due_boards',0,'pending_reviews',0,'pending_matches',0,'active',0,
      'ceiling',0,'desired',0,'reason','no_owner');
  end if;
  select count(*) into delivered from ci_daily_batch_items i
     join ci_daily_batches b on b.id=i.batch_id
     where b.owner_user_id in (select owner_user_id from ci_workspace_owners)
       and b.local_date=(now() at time zone 'Africa/Lagos')::date;
  gap:=greatest(0,target_total-delivered);
  select count(*) into eligible_board_count
    from ci_discovery_sources s left join ci_api_rate_limits l on l.action='ats:'||s.name
    where s.kind='ats' and s.state='active'
      and s.config->>'provider' in ('greenhouse','lever','ashby')
      and (l.last_run_at is null or l.last_run_at<=now()-interval '6 hours');
  select count(*) into review_count from ci_eligibility_review_queue q
     left join ci_api_rate_limits l on l.action='ats-review:'||q.job_id::text
     where q.state='pending'
       and (l.last_run_at is null or l.last_run_at<=now()-interval '6 hours')
       and exists(select 1 from ci_job_sources s where s.job_id=q.job_id
         and s.source_name in ('greenhouse','lever','ashby'));
  select count(*) into match_count from ci_workflow_tasks
     where task_type='matching' and state='pending';
  select count(*) into current_active from ci_worker_runs
     where state='running' and started_at>now()-interval '4 minutes';

  ceiling:=case when cfg.enabled then ci_worker_pool_ceiling(
    delivered,target_total,cfg.max_instances,cfg.reduced_instances,cfg.reduce_after_delivered)
    else 0 end;
  -- Each ci-worker currently handles <=6 ATS boards, <=8 eligibility
  -- reviews and <=3 matching tasks. The demand is the MAX of stage needs,
  -- not their SUM, because one invocation serves all three.
  demand:=greatest(ceil(eligible_board_count::numeric/6)::int,
                  ceil(review_count::numeric/8)::int,
                  ceil(match_count::numeric/3)::int);
  planned:=least(ceiling,greatest(0,demand-current_active));
  return jsonb_build_object(
    'target',target_total,'delivered',delivered,'remaining',gap,
    'due_boards',eligible_board_count,'pending_reviews',review_count,
    'pending_matches',match_count,'active',current_active,
    'ceiling',ceiling,'desired',planned,
    'reason',case when not cfg.enabled then 'disabled'
        when gap=0 then 'at_target'
        when demand=0 then 'idle'
        when planned=0 then 'capacity_exhausted'
        else 'dispatch' end);
end;
$ci_pool_plan$;
revoke all on function public.ci_worker_pool_plan() from public,anon,authenticated;
grant execute on function public.ci_worker_pool_plan() to service_role;

-- Serialized controller: one wave per cooldown. Every actual invocation is
-- issued through the existing one-use HMAC nonce RPC, which owns the credential.
create or replace function public.ci_run_adaptive_worker_pool(p_dry_run boolean default false)
returns jsonb language plpgsql security invoker set search_path=public as $ci_pool_run$
declare
  plan jsonb; cfg record; last_wave timestamptz;
  n integer; j integer; r bigint; ids bigint[]:='{}';
  decision text; wave_id bigint;
begin
  if not pg_try_advisory_xact_lock(hashtext('ci:adaptive-worker-pool')) then
    return jsonb_build_object('decision','controller_busy','dispatched',0);
  end if;
  plan:=ci_worker_pool_plan();
  if p_dry_run then
    return plan||jsonb_build_object('dry_run',true,'dispatched',0);
  end if;
  select * into cfg from ci_worker_pool_config where id=1;
  select observed_at into last_wave from ci_worker_pool_waves
    where dispatched>0 order by observed_at desc limit 1;
  if last_wave is not null
     and last_wave>now()-make_interval(secs=>cfg.min_wave_interval_seconds) then
    return plan||jsonb_build_object('decision','cooldown','dispatched',0);
  end if;
  decision:=plan->>'reason';
  n:=least(10,coalesce((plan->>'desired')::integer,0));
  if n>0 then
    if not exists(select 1 from pg_extension where extname='pg_net') then
      decision:='unavailable';
    else
      for j in 1..n loop
        r:=ci_emit_signed_worker_request();
        if r is not null then ids:=array_append(ids,r); end if;
      end loop;
      decision:=case when cardinality(ids)>0 then 'dispatch' else 'unavailable' end;
    end if;
  end if;
  insert into ci_worker_pool_waves(
    target,already_delivered,remaining,concurrency_ceiling,active_count,
    due_boards,pending_reviews,pending_matches,desired_instances,
    dispatched,request_ids,decision)
    values((plan->>'target')::int,(plan->>'delivered')::int,
      (plan->>'remaining')::int,(plan->>'ceiling')::int,(plan->>'active')::int,
      (plan->>'due_boards')::int,(plan->>'pending_reviews')::int,
      (plan->>'pending_matches')::int,n,cardinality(ids),ids,decision)
    returning id into wave_id;
  return plan||jsonb_build_object('wave_id',wave_id,'decision',decision,
     'dispatched',cardinality(ids),'request_ids',to_jsonb(ids));
end;
$ci_pool_run$;
revoke all on function public.ci_run_adaptive_worker_pool(boolean) from public,anon,authenticated;
grant execute on function public.ci_run_adaptive_worker_pool(boolean) to service_role;

