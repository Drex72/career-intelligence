-- Transactional, idempotent handoff from official eligibility assessment into
-- matching and people research. Do not create invented contacts or rank without notes.
create or replace function ci_queue_verified_job_handoffs(p_job_id uuid)
returns boolean language plpgsql security invoker set search_path=public as $ci_handoff$
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
      and v.revision=d.git_sha
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
$ci_handoff$;
revoke all on function ci_queue_verified_job_handoffs(uuid)
  from public,anon,authenticated;
grant execute on function ci_queue_verified_job_handoffs(uuid) to service_role;

create or replace function ci_on_eligibility_assessment_insert()
returns trigger language plpgsql security invoker set search_path=public as $ci_on_review$
begin
  perform ci_queue_verified_job_handoffs(new.job_id);
  return new;
end;
$ci_on_review$;
drop trigger if exists ci_eligible_role_handoff on ci_eligibility_assessments;
create trigger ci_eligible_role_handoff after insert on ci_eligibility_assessments
 for each row execute function ci_on_eligibility_assessment_insert();

create or replace function ci_on_company_domain_verified()
returns trigger language plpgsql security invoker set search_path=public as $ci_on_domain$
declare role_row record;
begin
 if new.canonical_domain is distinct from old.canonical_domain or
    new.identity_confidence is distinct from old.identity_confidence then
   for role_row in select j.id from ci_jobs j where j.company_id=new.id
     and j.status='open' order by j.first_seen_at desc limit 100 loop
     perform ci_queue_verified_job_handoffs(role_row.id);
   end loop;
 end if;
 return new;
end;
$ci_on_domain$;
drop trigger if exists ci_company_domain_handoff on ci_companies;
create trigger ci_company_domain_handoff
 after update of canonical_domain,identity_confidence on ci_companies
 for each row execute function ci_on_company_domain_verified();

-- Atomic task completion from the server-side matching worker.
-- A task must be pending; claim/complete is one transaction.
create or replace function ci_record_verified_match(
 p_job_id uuid,p_revision text,p_score integer,p_matched jsonb,p_gaps jsonb
) returns boolean language plpgsql security invoker set search_path=public as $ci_match$
declare task_row record;
begin
 if p_job_id is null or length(coalesce(p_revision,'')) not between 16 and 128 or
    p_score not between 0 and 100 or
    jsonb_typeof(p_matched)<>'array' or jsonb_typeof(p_gaps)<>'array'
    then return false; end if;
 select t.id,t.state into task_row from ci_workflow_tasks t
   where t.idempotency_key='ci:matching:'||p_job_id::text
   for update;
 if not found or task_row.state not in ('pending','retry_wait') then return false; end if;
 if not exists (
   select 1 from ci_jobs j
   join lateral (
     select a.status,a.expires_at from ci_eligibility_assessments a
       where a.job_id=j.id order by a.assessed_at desc,a.id desc limit 1
   ) a on true
   where j.id=p_job_id and j.status='open' and a.status='verified_eligible'
     and (a.expires_at is null or a.expires_at>now())
     and exists(select 1 from ci_eligibility_evidence e where e.job_id=j.id)
 ) then
   update ci_workflow_tasks set state='cancelled',updated_at=now() where id=task_row.id;
   return false;
 end if;
 insert into ci_job_matches(job_id,knowledge_revision,score,matched,gaps)
   values(p_job_id,p_revision,p_score,p_matched,p_gaps)
 on conflict(job_id,knowledge_revision) do update set
   score=excluded.score,matched=excluded.matched,gaps=excluded.gaps,computed_at=now();
 update ci_workflow_tasks
   set state='completed',output_ref='match:'||p_job_id::text||':'||p_revision,
       updated_at=now(),lease_until=null where id=task_row.id;
 insert into ci_task_events(task_id,event_type,payload)
   values(task_row.id,'matching_completed',jsonb_build_object('revision',p_revision,'score',p_score));
 return true;
end;
$ci_match$;
revoke all on function ci_record_verified_match(uuid,text,integer,jsonb,jsonb)
 from public,anon,authenticated;
grant execute on function ci_record_verified_match(uuid,text,integer,jsonb,jsonb)
 to service_role;
