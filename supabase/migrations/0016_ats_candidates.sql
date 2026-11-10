-- Candidate ATS boards are untrusted suggestions until the workspace owner approves.
-- All objects are CI-scoped, with no changes to Groundwork's existing data.
create table ci_ats_source_candidates (
 id uuid primary key default gen_random_uuid(),
 provider text not null check(provider in ('greenhouse','lever','ashby')),
 board_slug text not null check(board_slug ~ '^[a-zA-Z0-9_-]{1,100}$'),
 company_name text not null check(length(company_name) between 2 and 180),
 evidence_url text not null check(evidence_url ~ '^https://remotive[.]com/remote-jobs/'),
 source_kind text not null default 'remotive',
 state text not null default 'pending' check(state in ('pending','approved','rejected')),
 discovered_at timestamptz not null default now(),
 reviewed_at timestamptz,
 unique(provider,board_slug)
);
alter table ci_ats_source_candidates enable row level security;
revoke all on ci_ats_source_candidates from anon,authenticated;
grant select,insert,update on ci_ats_source_candidates to service_role;

create or replace function ci_suggest_ats_board(
 p_provider text,p_board_slug text,p_company_name text,p_evidence_url text
) returns boolean language plpgsql security invoker set search_path=public as $ci_candidate$
declare inserted uuid;
begin
 if p_provider not in ('greenhouse','lever','ashby') or
    p_board_slug is null or p_board_slug !~ '^[a-zA-Z0-9_-]{1,100}$' or
    p_company_name is null or length(trim(p_company_name)) not between 2 and 180 or
    p_evidence_url is null or length(p_evidence_url)>1500 or
    p_evidence_url !~ '^https://remotive[.]com/remote-jobs/' or
    (select count(*) from ci_ats_source_candidates)>=250
    then return false; end if;
 insert into ci_ats_source_candidates(provider,board_slug,company_name,evidence_url)
 values(p_provider,p_board_slug,trim(p_company_name),p_evidence_url)
 on conflict(provider,board_slug) do nothing returning id into inserted;
 return inserted is not null;
end;
$ci_candidate$;
revoke all on function ci_suggest_ats_board(text,text,text,text) from public,anon,authenticated;
grant execute on function ci_suggest_ats_board(text,text,text,text) to service_role;

create or replace function ci_decide_ats_candidate(
 p_candidate_id uuid,p_decision text
) returns boolean language plpgsql security invoker set search_path=public as $ci_decide$
declare c record; registered text;
begin
 if p_candidate_id is null or p_decision not in ('approved','rejected') then return false; end if;
 select * into c from ci_ats_source_candidates where id=p_candidate_id and state='pending' for update;
 if not found then return false; end if;
 if p_decision='approved' then
   if (select count(*) from ci_discovery_sources where kind='ats')>=50 then return false; end if;
   registered:='ats:'||c.provider||':'||c.board_slug;
   if exists(select 1 from ci_discovery_sources where name=registered) then
     return false;
   end if;
   insert into ci_discovery_sources(name,kind,state,discovery_method,config)
   values(registered,'ats','active','owner-approved-feed-candidate',
     jsonb_build_object('provider',c.provider,'slug',c.board_slug,'company_name',c.company_name));
 end if;
 update ci_ats_source_candidates set state=p_decision,reviewed_at=now() where id=p_candidate_id;
 return true;
end;
$ci_decide$;
revoke all on function ci_decide_ats_candidate(uuid,text) from public,anon,authenticated;
grant execute on function ci_decide_ats_candidate(uuid,text) to service_role;
