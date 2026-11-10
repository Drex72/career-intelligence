-- Career Intelligence owner revocation: cancel only unsent work.
-- "sending_unknown" is never auto-retried or silently declared cancelled.
create or replace function ci_revoke_outreach_approval(
  p_owner uuid,p_draft uuid
) returns text
language plpgsql security invoker set search_path=public as $revoke$
declare v_draft ci_outreach_drafts%rowtype;
        v_sent boolean; v_unknown boolean;
begin
  if p_owner is null or p_draft is null then return 'not_found'; end if;
  perform pg_advisory_xact_lock(hashtextextended('ci-outreach:'||p_owner::text,0));
  select * into v_draft from ci_outreach_drafts
    where id=p_draft and owner_user_id=p_owner for update;
  if not found then return 'not_found'; end if;

  update ci_outreach_approvals set revoked_at=now()
    where draft_id=p_draft and owner_user_id=p_owner and revoked_at is null;
  -- A provider request might already have been accepted if state is ambiguous.
  select exists(select 1 from ci_outbound_messages where draft_id=p_draft and status='sending_unknown')
    into v_unknown;
  select exists(select 1 from ci_outbound_messages where draft_id=p_draft and status='sent')
    into v_sent;
  update ci_outbound_messages set status='cancelled',error_code='approval_revoked'
    where draft_id=p_draft and status='pending';
  if not v_sent and not v_unknown then
    update ci_outreach_drafts set status='cancelled'
      where id=p_draft and status in ('draft','approved');
  end if;
  if v_unknown then return 'reconciliation_required'; end if;
  if v_sent then return 'already_sent'; end if;
  return 'revoked';
end;
$revoke$;
revoke all on function ci_revoke_outreach_approval(uuid,uuid)
  from public,anon,authenticated;
grant execute on function ci_revoke_outreach_approval(uuid,uuid) to service_role;
