-- Owner-selectable US employer/remote worldwide gate at actual delivery.
CREATE OR REPLACE FUNCTION public.ci_generate_daily_batch(p_owner_user_id uuid, p_local_date date, p_target integer DEFAULT 100)
 RETURNS integer
 LANGUAGE plpgsql
 SET search_path TO 'public'
AS $function$
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
    select j.id as job_id,j.company_id
    from ci_jobs j
    join lateral (
      select a.status,a.expires_at from ci_eligibility_assessments a
      where a.job_id=j.id order by a.assessed_at desc,a.id desc limit 1
    ) a on true
    left join lateral (
      select m.score from ci_job_matches m
      where m.job_id=j.id order by m.computed_at desc limit 1
    ) m on true
    where j.status='open'
      and a.status='verified_eligible'
      and (a.expires_at is null or a.expires_at>now())
      and j.published_at>=now()-interval '7 days'
      and exists (select 1 from ci_eligibility_evidence e where e.job_id=j.id)
      and ci_job_matches_preferences(j.id,p_owner_user_id)
      and ci_job_matches_geo_target(j.id,p_owner_user_id)
      and not exists (
        select 1 from ci_delivered_jobs d
        where d.owner_user_id=p_owner_user_id and d.job_id=j.id
      )
    order by (j.published_at >= now()-interval '72 hours') desc,
      coalesce(m.score,0) desc,j.published_at desc,j.first_seen_at desc
    limit greatest(v_effective_target*8,v_effective_target)
  loop
    exit when v_rank >= v_effective_target;
    v_claimed := null;
    insert into ci_delivered_companies(owner_user_id,company_id,first_batch_id)
      values(p_owner_user_id,v_row.company_id,v_batch_id)
      on conflict do nothing returning company_id into v_claimed;
    -- Company ledger is retained for provenance, not used to suppress distinct roles.
    insert into ci_delivered_jobs(owner_user_id,job_id)
      values(p_owner_user_id,v_row.job_id)
      on conflict do nothing;
    v_rank:=v_rank+1;
    insert into ci_daily_batch_items(batch_id,company_id,job_id,rank)
      values(v_batch_id,v_row.company_id,v_row.job_id,v_rank);
    v_inserted:=v_inserted+1;
  end loop;
  update ci_daily_batches set state='completed'
    where id=v_batch_id;
  return v_inserted;
end;
$function$

