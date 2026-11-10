-- Record only official-ATS description facts tied to a newly saved source excerpt.
-- Caller must be trusted ci-api/ci-worker; no browser SQL execution.
create or replace function ci_record_ats_work_facts(
  p_job_id uuid,p_source_url text,p_excerpt text,p_work_mode text,p_sponsorship text
) returns boolean language plpgsql security invoker set search_path=public as $facts$
declare v_evidence_id uuid;v_existing ci_job_work_facts%rowtype;
begin
  if p_job_id is null or p_source_url is null or p_excerpt is null
     or length(p_excerpt) not between 1 and 2000
     or p_work_mode not in ('remote','hybrid','onsite','unknown')
     or p_sponsorship not in ('confirmed','not_offered','unknown')
     then return false;end if;
  -- Source URL, exact stored excerpt and very recent assessment must match.
  select e.id into v_evidence_id from ci_eligibility_evidence e
  join ci_job_sources s on s.job_id=e.job_id and s.source_url=e.source_url
  where e.job_id=p_job_id and e.source_url=p_source_url
    and e.excerpt=p_excerpt and e.source_kind='official_ats'
    and e.observed_at>=now()-interval '10 minutes'
    and s.source_name in ('greenhouse','lever','ashby')
  order by e.observed_at desc,e.id desc limit 1;
  if v_evidence_id is null then return false;end if;
  -- A copied/old evidence row cannot be used to circumvent a newer contradictory official finding.
  select * into v_existing from ci_job_work_facts where job_id=p_job_id for update;
  if found and v_existing.verified_at>now()+interval '1 minute' then return false;end if;
  insert into ci_job_work_facts(job_id,work_mode,sponsorship,source_evidence_id,verified_at,expires_at)
  values(p_job_id,p_work_mode,p_sponsorship,v_evidence_id,now(),now()+interval '7 days')
  on conflict(job_id) do update set
     work_mode=excluded.work_mode,sponsorship=excluded.sponsorship,
     source_evidence_id=excluded.source_evidence_id,
     verified_at=excluded.verified_at,expires_at=excluded.expires_at;
  return true;
end;
$facts$;
revoke all on function ci_record_ats_work_facts(uuid,text,text,text,text)
  from public,anon,authenticated;
grant execute on function ci_record_ats_work_facts(uuid,text,text,text,text)
  to service_role;
