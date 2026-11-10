-- Require current official source authority: a newly observed explicit Nigeria restriction
-- must supersede a previous still-valid verified decision.
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
     not exists (select 1 from ci_eligibility_review_queue q
                 where q.job_id=p_job_id and q.state='pending') or
     not exists (
       select 1 from ci_job_sources s
       where s.job_id=p_job_id and s.source_url=p_source_url
         and s.source_name in ('greenhouse','lever','ashby')
     ) then return false; end if;
  if p_excerpt<>'' then
    insert into ci_eligibility_evidence(job_id,source_url,source_kind,excerpt,excerpt_hash,scope,claim,confidence)
    values(p_job_id,p_source_url,'official_ats',p_excerpt,md5(p_excerpt),'job',
      p_reason,case when p_status='verified_eligible' then 'verified' else 'unverified' end);
  end if;
  insert into ci_eligibility_assessments(
    job_id,status,confidence,reasons,contradictions,policy_version,expires_at
  ) values (
    p_job_id,p_status,p_confidence,jsonb_build_array(p_reason),'[]'::jsonb,'official-ats-v2',
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
grant execute on function ci_record_ats_review(uuid,text,text,numeric,text,text) to service_role;

-- Read-only decision expiry check with bounded requeue; no external requests or emails.
create or replace function ci_requeue_expired_reviews(p_limit integer default 100)
returns integer language plpgsql security invoker set search_path=public as $ci_requeue$
declare changed integer:=0;
begin
 if p_limit is null or p_limit not between 1 and 100 then return 0; end if;
 with expired as (
   select q.job_id from ci_eligibility_review_queue q
   join ci_jobs j on j.id=q.job_id
   join lateral (
     select a.expires_at,a.status from ci_eligibility_assessments a
     where a.job_id=q.job_id order by a.assessed_at desc,a.id desc limit 1
   ) current_assessment on true
   where q.state='reviewed'
     and j.status='open'
     and current_assessment.expires_at<=now()
     and exists (select 1 from ci_job_sources src where src.job_id=j.id
        and src.source_name in ('greenhouse','lever','ashby'))
   order by current_assessment.expires_at asc
   limit p_limit
   for update of q skip locked
 )
 update ci_eligibility_review_queue q set state='pending',last_seen_at=now()
 from expired where expired.job_id=q.job_id;
 get diagnostics changed=row_count;
 return changed;
end;
$ci_requeue$;
revoke all on function ci_requeue_expired_reviews(integer) from public,anon,authenticated;
grant execute on function ci_requeue_expired_reviews(integer) to service_role;

-- The Groundwork project's scheduler is UTC/GMT. 05:00 UTC = 06:00 WAT,
-- one hour before verified-only daily delivery assembly.
do $ci_daily_review_schedule$
begin
 if exists(select 1 from pg_extension where extname='pg_cron') then
   if coalesce(current_setting('cron.timezone',true),'GMT') not in ('GMT','UTC','Etc/UTC') then
     raise exception 'CI review schedule requires UTC/GMT timezone';
   end if;
   execute 'select cron.schedule($1,$2,$3)' using
     'ci-review-expired-0600-wat',
     '0 5 * * *',
     'select public.ci_requeue_expired_reviews(100)';
 end if;
end;
$ci_daily_review_schedule$;
