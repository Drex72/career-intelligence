-- Stop re-checking postings the employer has taken down, and stop scanning job boards
-- that no longer exist. Only ci_ objects. Non-destructive: rows are updated, never deleted.

-- 1. The employer's own ATS no longer lists the posting: close the job and take it off the
-- eligibility queue. Closed jobs are already excluded from delivery and from requeueing.
create or replace function public.ci_close_missing_posting(p_job_id uuid,p_source_url text)
returns boolean language plpgsql security invoker set search_path=public as $close$
begin
  if p_job_id is null or p_source_url is null or not exists(
      select 1 from ci_job_sources s where s.job_id=p_job_id and s.source_url=p_source_url
        and s.source_name in ('greenhouse','lever','ashby')) then
    return false;
  end if;
  update ci_jobs set status='closed' where id=p_job_id and status<>'closed';
  update ci_eligibility_review_queue set state='blocked',last_seen_at=now()
    where job_id=p_job_id and state='pending';
  return true;
end;
$close$;
revoke all on function public.ci_close_missing_posting(uuid,text) from public,anon,authenticated;
grant execute on function public.ci_close_missing_posting(uuid,text) to service_role;

-- 2. A board that answers "not found" three scans in a row is paused (state 'paused'),
-- so it no longer counts as discovery work or fails every run. Any successful scan resets it.
create or replace function public.ci_record_board_missing(p_source_id uuid)
returns text language plpgsql security invoker set search_path=public as $missing$
declare misses integer; new_state text;
begin
  update ci_discovery_sources
    set rate_limit_json=jsonb_set(coalesce(rate_limit_json,'{}'::jsonb),'{missing_count}',
      to_jsonb(coalesce((rate_limit_json->>'missing_count')::integer,0)+1))
    where id=p_source_id and kind='ats' and state='active'
    returning (rate_limit_json->>'missing_count')::integer into misses;
  if misses is null then return null; end if;
  if misses>=3 then
    update ci_discovery_sources set state='paused' where id=p_source_id;
    new_state:='paused';
  else
    new_state:='active';
  end if;
  return new_state;
end;
$missing$;
create or replace function public.ci_reset_board_missing(p_source_id uuid)
returns boolean language sql security invoker set search_path=public as $reset$
  update ci_discovery_sources set rate_limit_json=rate_limit_json-'missing_count'
    where id=p_source_id and kind='ats' and rate_limit_json ? 'missing_count'
  returning true;
$reset$;
revoke all on function public.ci_record_board_missing(uuid),public.ci_reset_board_missing(uuid)
  from public,anon,authenticated;
grant execute on function public.ci_record_board_missing(uuid),public.ci_reset_board_missing(uuid)
  to service_role;
