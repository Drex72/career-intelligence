-- Read-only, owner-scoped production data integrity report.
-- This measures data quality, not simulated agent success or hiring eligibility.
create or replace function ci_pipeline_integrity_report(p_owner uuid)
returns jsonb language plpgsql stable security invoker set search_path=public as $audit$
declare v_jobs integer;v_sources integer;v_missing integer;v_duplicate_sources integer;
v_duplicate_jobs integer;v_bad_urls integer;v_delivered integer;v_delivered_unverified integer;
v_missing_evidence integer;v_effective_target integer;v_currently_eligible integer;
v_approved_notes integer;v_problems integer;
begin
  if p_owner is null or not exists (
    select 1 from ci_workspace_owners where owner_user_id=p_owner
  ) then return null; end if;

  select count(*) into v_jobs from ci_jobs;
  select count(*) into v_sources from ci_job_sources;
  select count(*) into v_missing from ci_jobs j where not exists (
    select 1 from ci_job_sources s where s.job_id=j.id);
  select count(*) into v_duplicate_sources from (
    select source_name,source_job_id from ci_job_sources
    where source_job_id is not null group by 1,2 having count(*)>1
  ) q;
  select count(*) into v_duplicate_jobs from (
    select company_id,canonical_apply_url from ci_jobs
    group by 1,2 having count(*)>1
  ) q;
  select count(*) into v_bad_urls from ci_jobs
    where apply_url is null or apply_url !~ '^https://[^/]+/';
  select count(*) into v_missing_evidence from ci_eligibility_assessments a
    where a.status='verified_eligible' and not exists (
      select 1 from ci_eligibility_evidence e where e.job_id=a.job_id);
  select count(*) into v_delivered from ci_daily_batch_items i
    join ci_daily_batches b on b.id=i.batch_id
    where b.owner_user_id=p_owner;
  select count(*) into v_delivered_unverified from ci_daily_batch_items i
    join ci_daily_batches b on b.id=i.batch_id
    where b.owner_user_id=p_owner and not exists (
      select 1 from ci_eligibility_assessments a
      where a.job_id=i.job_id and a.status='verified_eligible');
  select coalesce(daily_target,25) into v_effective_target
    from ci_discovery_preferences where owner_user_id=p_owner;
  v_effective_target:=coalesce(v_effective_target,25);
  select count(*) into v_currently_eligible from ci_jobs j
    join lateral (select a.status,a.expires_at from ci_eligibility_assessments a
      where a.job_id=j.id order by a.assessed_at desc,a.id desc limit 1) a on true
    where j.status='open'
      and a.status='verified_eligible'
      and (a.expires_at is null or a.expires_at>now())
      and j.published_at>=now()-interval '7 days'
      and exists(select 1 from ci_eligibility_evidence e where e.job_id=j.id)
      and ci_job_matches_preferences(j.id,p_owner)
      and not exists(select 1 from ci_delivered_companies d
        where d.owner_user_id=p_owner and d.company_id=j.company_id);
  select count(*) into v_approved_notes from ci_knowledge_documents
    where status='approved';
  v_problems:=v_missing+v_duplicate_sources+v_duplicate_jobs+
    v_bad_urls+v_missing_evidence+v_delivered_unverified;
  return jsonb_build_object(
    'checked_at',now(),
    'integrity_ok',v_problems=0,
    'integrity_violations',v_problems,
    'jobs',v_jobs,'source_records',v_sources,
    'jobs_missing_sources',v_missing,
    'duplicate_source_ids',v_duplicate_sources,
    'duplicate_canonical_jobs',v_duplicate_jobs,
    'invalid_apply_urls',v_bad_urls,
    'verified_assessments_without_evidence',v_missing_evidence,
    'delivered_without_any_verified_assessment',v_delivered_unverified,
    'delivered_jobs',v_delivered,
    'eligible_undelivered_jobs_now',v_currently_eligible,
    'approved_knowledge_documents',v_approved_notes,
    'daily_target',v_effective_target,
    'generation_ready',v_currently_eligible>0 and v_problems=0
  );
end;
$audit$;
revoke all on function ci_pipeline_integrity_report(uuid)
  from public,anon,authenticated;
grant execute on function ci_pipeline_integrity_report(uuid) to service_role;
