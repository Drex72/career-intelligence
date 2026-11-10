-- Source-backed employee research. No guessed addresses, outbound messages, or
-- contact creation unless the company identity and canonical domain are verified.
alter table ci_contact_research_tasks
  add column if not exists attempt_count integer not null default 0,
  add column if not exists last_error text,
  add column if not exists updated_at timestamptz not null default now();

create or replace function ci_claim_people_task(p_task_id uuid)
returns boolean language plpgsql security invoker set search_path=public as $ci_people_claim$
declare v_task record;v_claim text;
begin
 if p_task_id is null then return false; end if;
 select t.id,t.state,t.company_id,c.canonical_domain,c.identity_confidence
   into v_task from ci_contact_research_tasks t
   join ci_companies c on c.id=t.company_id
   where t.id=p_task_id for update of t skip locked;
 if not found or v_task.state<>'pending' or v_task.identity_confidence<>'verified' or
    v_task.canonical_domain is null or
    v_task.canonical_domain !~ '^[A-Za-z0-9-]+([.][A-Za-z0-9-]+)+$'
    then return false; end if;
 insert into ci_api_rate_limits(action,last_run_at)
   values('people:'||v_task.company_id::text,now())
 on conflict(action) do update set last_run_at=excluded.last_run_at
   where ci_api_rate_limits.last_run_at<=now()-interval '6 hours'
 returning action into v_claim;
 if v_claim is null then return false; end if;
 update ci_contact_research_tasks set state='running',
   attempt_count=attempt_count+1,updated_at=now(),last_error=null
   where id=v_task.id;
 return true;
end;
$ci_people_claim$;
revoke all on function ci_claim_people_task(uuid) from public,anon,authenticated;
grant execute on function ci_claim_people_task(uuid) to service_role;

create or replace function ci_finish_people_task(
 p_task_id uuid,p_state text,p_error text default null
) returns boolean language plpgsql security invoker set search_path=public as $ci_people_finish$
declare result uuid;
begin
 if p_task_id is null or p_state not in ('completed','blocked') or
    (p_error is not null and p_error not in (
      'no_public_profiles','public_page_unavailable','unsafe_domain',
      'invalid_html','storage_error')) then return false; end if;
 update ci_contact_research_tasks set state=p_state,last_error=p_error,
    updated_at=now() where id=p_task_id and state='running'
 returning id into result;
 return result is not null;
end;
$ci_people_finish$;
revoke all on function ci_finish_people_task(uuid,text,text) from public,anon,authenticated;
grant execute on function ci_finish_people_task(uuid,text,text) to service_role;
