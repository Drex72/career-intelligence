-- Career Intelligence outreach authorization ledger.
-- These functions create approvals and durable PENDING intents; they NEVER call Gmail.
-- Credentials and actual send/ambiguous-send reconciliation belong to the separate dispatcher.
create unique index if not exists ci_one_active_approval_per_draft
  on ci_outreach_approvals(draft_id,owner_user_id) where revoked_at is null;

create or replace function ci_outreach_draft_ready(
  p_owner uuid,p_draft uuid
) returns boolean
language plpgsql security invoker set search_path=public,extensions as $ready$
declare v_email text;
begin
  if p_owner is null or p_draft is null or
     not exists(select 1 from ci_workspace_owners where owner_user_id=p_owner)
  then return false; end if;
  -- An application is a prerequisite, not merely a saved/shortlisted job.
  if not exists (
    select 1
    from ci_outreach_drafts d
    join ci_jobs j on j.id=d.job_id
    join ci_contacts c on c.id=d.contact_id and c.company_id=j.company_id
    join ci_applications a on a.job_id=j.id and a.owner_user_id=d.owner_user_id
    where d.id=p_draft and d.owner_user_id=p_owner
      and d.status in ('draft','approved')
      and d.knowledge_revision is not null and length(d.body) between 20 and 12000
      and a.status in ('applied','interviewing','offer') and a.applied_at is not null
      and c.identity_verified and j.status='open'
      and exists (
        select 1 from ci_eligibility_assessments e
        where e.job_id=j.id and e.status='verified_eligible'
          and (e.expires_at is null or e.expires_at>now())
          and e.id=(select ee.id from ci_eligibility_assessments ee
            where ee.job_id=j.id order by ee.assessed_at desc,ee.id desc limit 1)
      )
      and exists (select 1 from ci_eligibility_evidence ev where ev.job_id=j.id)
  ) then return false; end if;
  -- Only a verified professional address for this contact may be used.
  select lower(btrim(cm.value)) into v_email
    from ci_outreach_drafts d
    join ci_contact_methods cm on cm.contact_id=d.contact_id
      and cm.method='professional_email' and cm.verified
    where d.id=p_draft and d.owner_user_id=p_owner
      and length(cm.value) between 6 and 254
      and cm.value ~* '^[A-Z0-9._%+-]+@[A-Z0-9.-]+\.[A-Z]{2,}$'
    order by cm.observed_at desc,cm.id desc limit 1;
  if v_email is null then return false; end if;
  if exists (
    select 1 from ci_suppression_records s
    where s.owner_user_id=p_owner
      and s.normalized_contact_hash=encode(extensions.digest(v_email,'sha256'),'hex')
  ) then return false; end if;
  return true;
end;
$ready$;

create or replace function ci_approve_outreach_draft(
  p_owner uuid,p_draft uuid,p_mode text default 'manual'
) returns boolean
language plpgsql security invoker set search_path=public,extensions as $approve$
declare v_draft ci_outreach_drafts%rowtype; v_auto boolean;
begin
  if p_mode not in ('manual','standing') or p_owner is null or p_draft is null
    then return false; end if;
  perform pg_advisory_xact_lock(hashtextextended('ci-outreach:'||p_owner::text,0));
  select * into v_draft from ci_outreach_drafts
    where id=p_draft and owner_user_id=p_owner for update;
  if not found or not ci_outreach_draft_ready(p_owner,p_draft) then return false; end if;
  select auto_enabled into v_auto from ci_outreach_policies
    where owner_user_id=p_owner;
  if p_mode='standing' and not coalesce(v_auto,false) then return false; end if;
  update ci_outreach_drafts set status='approved'
    where id=p_draft and owner_user_id=p_owner and status='draft';
  insert into ci_outreach_approvals(draft_id,owner_user_id,mode,policy_snapshot)
  values(p_draft,p_owner,p_mode,
    jsonb_build_object('authorization','owner_approved','mode',p_mode))
  on conflict(draft_id,owner_user_id) where revoked_at is null do nothing;
  return true;
end;
$approve$;

create or replace function ci_prepare_outreach_intent(
  p_owner uuid,p_draft uuid
) returns uuid
language plpgsql security invoker set search_path=public,extensions as $intent$
declare v_draft ci_outreach_drafts%rowtype; v_policy ci_outreach_policies%rowtype;
        v_approval ci_outreach_approvals%rowtype; v_id uuid; v_key text;
        v_daily int; v_company_daily int;
begin
  if p_owner is null or p_draft is null then return null; end if;
  perform pg_advisory_xact_lock(hashtextextended('ci-outreach:'||p_owner::text,0));
  select * into v_draft from ci_outreach_drafts
    where id=p_draft and owner_user_id=p_owner and status='approved' for update;
  if not found then return null; end if;
  v_key:='ci:gmail:v1:'||p_owner::text||':'||p_draft::text;
  select id into v_id from ci_outbound_messages where intent_key=v_key;
  if v_id is not null then return v_id; end if;
  if not ci_outreach_draft_ready(p_owner,p_draft) then return null; end if;
  select * into v_approval from ci_outreach_approvals
    where owner_user_id=p_owner and draft_id=p_draft and revoked_at is null
    order by approved_at desc limit 1;
  if not found then return null; end if;
  select * into v_policy from ci_outreach_policies where owner_user_id=p_owner;
  if v_approval.mode='standing' and not coalesce(v_policy.auto_enabled,false) then return null; end if;
  v_daily:=least(coalesce(v_policy.daily_limit,10),20);
  v_company_daily:=least(coalesce(v_policy.per_company_daily_limit,1),2);
  if v_daily<1 or v_company_daily<1 then return null; end if;
  if (select count(*) from ci_outbound_messages m
      join ci_outreach_drafts d on d.id=m.draft_id
      where d.owner_user_id=p_owner and m.status in ('pending','sending_unknown','sent','failed')
        and m.created_at >= date_trunc('day',now() at time zone 'Africa/Lagos') at time zone 'Africa/Lagos'
     )>=v_daily then return null; end if;
  if (select count(*) from ci_outbound_messages m
      join ci_outreach_drafts d on d.id=m.draft_id
      join ci_jobs j on j.id=d.job_id
      where d.owner_user_id=p_owner and j.company_id=(select company_id from ci_jobs where id=v_draft.job_id)
        and m.status in ('pending','sending_unknown','sent','failed')
        and m.created_at >= date_trunc('day',now() at time zone 'Africa/Lagos') at time zone 'Africa/Lagos'
     )>=v_company_daily then return null; end if;
  insert into ci_outbound_messages(draft_id,intent_key,provider,status)
    values(p_draft,v_key,'gmail','pending')
    on conflict(intent_key) do nothing returning id into v_id;
  if v_id is null then select id into v_id from ci_outbound_messages where intent_key=v_key; end if;
  return v_id;
end;
$intent$;

revoke all on function ci_outreach_draft_ready(uuid,uuid),
  function ci_approve_outreach_draft(uuid,uuid,text),
  function ci_prepare_outreach_intent(uuid,uuid) from public,anon,authenticated;
grant execute on function ci_outreach_draft_ready(uuid,uuid),
  function ci_approve_outreach_draft(uuid,uuid,text),
  function ci_prepare_outreach_intent(uuid,uuid) to service_role;
