-- Private, source-backed official ATS eligibility review. Existing Groundwork objects untouched.
create or replace function ci_claim_job_review_slot(p_job_id uuid)
returns boolean language plpgsql security invoker set search_path=public as $ci_review_claim$
declare claimed text;
begin
  if not exists(select 1 from ci_eligibility_review_queue
     where job_id=p_job_id and state='pending') then return false; end if;
  insert into ci_api_rate_limits(action,last_run_at)
    values('ats-review:'||p_job_id::text,now())
  on conflict(action) do update set last_run_at=excluded.last_run_at
    where ci_api_rate_limits.last_run_at <= now()-interval '6 hours'
  returning action into claimed;
  return claimed is not null;
end;
$ci_review_claim$;
revoke all on function ci_claim_job_review_slot(uuid) from public,anon,authenticated;
grant execute on function ci_claim_job_review_slot(uuid) to service_role;

create or replace function ci_record_ats_review(
  p_job_id uuid,p_source_url text,p_status text,
  p_confidence numeric,p_excerpt text,p_reason text
) returns boolean language plpgsql security invoker set search_path=public as $ci_review_record$
begin
  if p_job_id is null or p_source_url is null or
     p_status not in ('verified_eligible','likely_eligible','unknown','ineligible') or
     p_confidence is null or p_confidence<0 or p_confidence>1 or
     p_reason is null or length(p_reason) not between 8 and 240 or
     p_excerpt is null or length(p_excerpt)>2000 or
     not exists (
       select 1 from ci_job_sources s
       where s.job_id=p_job_id and s.source_url=p_source_url
         and s.source_name in ('greenhouse','lever','ashby')
     ) then return false; end if;
  -- Do not downgrade a still-valid, separately verified assessment with a weaker review.
  if exists(select 1 from ci_eligibility_assessments a where a.job_id=p_job_id
    and a.status='verified_eligible' and (a.expires_at is null or a.expires_at>now()))
    then return false; end if;
  if p_excerpt<>'' then
    insert into ci_eligibility_evidence(job_id,source_url,source_kind,excerpt,excerpt_hash,scope,claim,confidence)
    values(p_job_id,p_source_url,'official_ats',p_excerpt,md5(p_excerpt),'job',
      p_reason,case when p_status='verified_eligible' then 'verified' else 'unverified' end);
  end if;
  insert into ci_eligibility_assessments(
    job_id,status,confidence,reasons,contradictions,policy_version,expires_at
  ) values (
    p_job_id,p_status,p_confidence,jsonb_build_array(p_reason),'[]'::jsonb,'official-ats-v1',
    now()+case when p_status in ('verified_eligible','ineligible') then interval '7 days'
         when p_status='likely_eligible' then interval '2 days' else interval '1 day' end
  );
  update ci_eligibility_review_queue set state='reviewed',last_seen_at=now()
    where job_id=p_job_id and state='pending';
  return true;
end;
$ci_review_record$;
revoke all on function ci_record_ats_review(uuid,text,text,numeric,text,text)
  from public,anon,authenticated;
grant execute on function ci_record_ats_review(uuid,text,text,numeric,text,text)
  to service_role;
