-- Generate at most 100 never-before-delivered employers for an authenticated owner.
-- The gateway supplies the owner UUID after Supabase Auth and CI allowlist checks.
-- This function is service-role only and serializes overlapping requests per owner.
create or replace function ci_generate_daily_batch(
  p_owner_user_id uuid,
  p_local_date date,
  p_target integer default 100
) returns integer
language plpgsql
security invoker
set search_path = public
as $ci_batch$
declare
  v_batch_id uuid;
  v_rank integer;
  v_row record;
  v_claimed uuid;
  v_inserted integer := 0;
begin
  if p_owner_user_id is null or p_local_date is null or p_target not between 1 and 100 then
    raise exception 'Invalid batch parameters';
  end if;
  perform pg_advisory_xact_lock(hashtext('ci-delivery:' || p_owner_user_id::text));
  insert into ci_daily_batches(owner_user_id,local_date,target)
    values(p_owner_user_id,p_local_date,p_target)
    on conflict(owner_user_id,local_date) do update set target=greatest(ci_daily_batches.target,excluded.target)
    returning id into v_batch_id;

  select count(*) into v_rank from ci_daily_batch_items where batch_id=v_batch_id;
  if v_rank >= p_target then return 0; end if;
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
      and not exists (
        select 1 from ci_delivered_companies d
        where d.owner_user_id=p_owner_user_id and d.company_id=j.company_id
      )
      and not exists (
        select 1 from ci_delivered_jobs d
        where d.owner_user_id=p_owner_user_id and d.job_id=j.id
      )
    order by (j.published_at >= now()-interval '72 hours') desc,
      coalesce(m.score,0) desc,j.published_at desc,j.first_seen_at desc
    limit greatest(p_target*8,p_target)
  loop
    exit when v_rank >= p_target;
    v_claimed := null;
    insert into ci_delivered_companies(owner_user_id,company_id,first_batch_id)
      values(p_owner_user_id,v_row.company_id,v_batch_id)
      on conflict do nothing returning company_id into v_claimed;
    if v_claimed is null then continue; end if;
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
$ci_batch$;

revoke all on function ci_generate_daily_batch(uuid,date,integer) from public,anon,authenticated;
grant execute on function ci_generate_daily_batch(uuid,date,integer) to service_role;
