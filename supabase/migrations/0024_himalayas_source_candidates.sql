-- Allow verified-format Himalayas listing URLs as evidence for ATS board CANDIDATES.
-- Source candidates still require explicit owner approval before any ATS scan.
-- No job eligibility or company identity is automatically verified.
alter table ci_ats_source_candidates
  drop constraint if exists ci_ats_source_candidates_evidence_url_check;
alter table ci_ats_source_candidates
  add constraint ci_ats_source_candidates_evidence_url_check
  check (
    evidence_url ~ '^https://remotive[.]com/remote-jobs/'
    or evidence_url ~ '^https://himalayas[.]app/companies/[A-Za-z0-9_-]+/jobs/[A-Za-z0-9_-]+$'
  );
create or replace function ci_suggest_ats_board(
  p_provider text,p_board_slug text,p_company_name text,p_evidence_url text
) returns boolean language plpgsql security invoker set search_path=public as $ci_candidate$
declare inserted uuid; kind text;
begin
  if p_provider not in ('greenhouse','lever','ashby') or
     p_board_slug is null or p_board_slug !~ '^[a-zA-Z0-9_-]{1,100}$' or
     p_company_name is null or length(trim(p_company_name)) not between 2 and 180 or
     p_evidence_url is null or length(p_evidence_url)>1500 or
     (select count(*) from ci_ats_source_candidates)>=250
     then return false; end if;
  if p_evidence_url ~ '^https://remotive[.]com/remote-jobs/' then
    kind:='remotive';
  elsif p_evidence_url ~ '^https://himalayas[.]app/companies/[A-Za-z0-9_-]+/jobs/[A-Za-z0-9_-]+$' then
    kind:='himalayas';
  else
    return false;
  end if;
  insert into ci_ats_source_candidates(provider,board_slug,company_name,evidence_url,source_kind)
    values(p_provider,p_board_slug,trim(p_company_name),p_evidence_url,kind)
    on conflict(provider,board_slug) do nothing returning id into inserted;
  return inserted is not null;
end;
$ci_candidate$;
revoke all on function ci_suggest_ats_board(text,text,text,text) from public,anon,authenticated;
grant execute on function ci_suggest_ats_board(text,text,text,text) to service_role;
