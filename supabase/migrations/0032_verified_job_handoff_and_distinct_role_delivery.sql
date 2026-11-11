-- Milestone 1: restore verified handoff knowledge retrieval and count distinct jobs,
-- not only one employer over the entire lifetime of the account.
-- Source-of-truth approved knowledge uses ci_knowledge_versions.revision = content_sha;
-- git_sha tracks the repository snapshot and is NOT a version revision.
CREATE OR REPLACE FUNCTION public.ci_queue_verified_job_handoffs(p_job_id uuid)
 RETURNS boolean
 LANGUAGE plpgsql
 SET search_path TO 'public'
AS $function$
declare
  latest record;
  job record;
  workflow uuid;
  knowledge_available boolean;
  domain_verified boolean;
  inserted uuid;
begin
  if p_job_id is null then return false; end if;
  select a.id,a.status,a.expires_at into latest
    from ci_eligibility_assessments a where a.job_id=p_job_id
    order by a.assessed_at desc,a.id desc limit 1;
  if not found then return false; end if;
  if latest.status<>'verified_eligible' or
     (latest.expires_at is not null and latest.expires_at<=now()) then
    update ci_workflow_tasks t set state='cancelled',updated_at=now()
      where t.idempotency_key in ('ci:matching:'||p_job_id::text,'ci:people:'||p_job_id::text)
        and t.state in ('pending','awaiting_approval','blocked','retry_wait');
    return false;
  end if;
  select j.id,j.company_id,j.status,c.canonical_domain,c.identity_confidence
    into job from ci_jobs j join ci_companies c on c.id=j.company_id
    where j.id=p_job_id;
  if not found or job.status<>'open' or
     not exists(select 1 from ci_eligibility_evidence e where e.job_id=p_job_id)
    then return false; end if;

  select exists(
    select 1 from ci_knowledge_documents d
    join ci_knowledge_versions v on v.document_id=d.id
      and v.revision=d.content_sha
    where d.status='approved' and d.visibility in ('matching-safe','agents-safe')
      and length(trim(v.body))>0
  ) into knowledge_available;
  domain_verified := job.identity_confidence='verified'
    and job.canonical_domain is not null
    and job.canonical_domain ~ '^[a-zA-Z0-9][a-zA-Z0-9.-]{2,250}[a-zA-Z0-9]$';

  insert into ci_workflows(kind,status,version,correlation_key)
    values('verified-role','pending','verified-handoff-v1','ci:eligible:'||p_job_id::text)
  on conflict(correlation_key) do update set updated_at=now()
  returning id into workflow;

  insert into ci_workflow_tasks(
    workflow_id,task_type,state,priority,input_ref,idempotency_key
  ) values (
    workflow,'matching',
    case when knowledge_available then 'pending' else 'awaiting_approval' end,
    10,'job:'||p_job_id::text,'ci:matching:'||p_job_id::text
  ) on conflict(idempotency_key) do update set
    state=case
      when ci_workflow_tasks.state in ('cancelled','blocked','awaiting_approval') and
           excluded.state='pending' then 'pending'
      when ci_workflow_tasks.state='cancelled' then excluded.state
      else ci_workflow_tasks.state end,
    updated_at=now();

  insert into ci_workflow_tasks(
    workflow_id,task_type,state,priority,input_ref,idempotency_key
  ) values(
    workflow,'people_research',
    case when domain_verified then 'pending' else 'awaiting_approval' end,
    5,'company:'||job.company_id::text,'ci:people:'||p_job_id::text
  ) on conflict(idempotency_key) do update set
    state=case
      when ci_workflow_tasks.state in ('cancelled','blocked','awaiting_approval')
        and excluded.state='pending' then 'pending'
      when ci_workflow_tasks.state='cancelled' then excluded.state
      else ci_workflow_tasks.state end,
    updated_at=now();

  if domain_verified then
    insert into ci_contact_research_tasks(company_id,workflow_id,state)
      values(job.company_id,null,'pending')
    on conflict(company_id) where workflow_id is null do nothing;
  end if;
  return true;
end;
$function$;


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
$function$;


revoke all on function public.ci_queue_verified_job_handoffs(uuid) from public,anon,authenticated;
grant execute on function public.ci_queue_verified_job_handoffs(uuid) to service_role;
revoke all on function public.ci_generate_daily_batch(uuid,date,integer) from public,anon,authenticated;
grant execute on function public.ci_generate_daily_batch(uuid,date,integer) to service_role;
