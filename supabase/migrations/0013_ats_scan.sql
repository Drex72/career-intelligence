-- Fixed-host ATS board ingestion. Only server-side service_role can call these routines.
-- Does not mark a role eligible for Nigeria and does not send messages.
create table if not exists ci_eligibility_review_queue (
  job_id uuid primary key references ci_jobs(id) on delete cascade,
  state text not null default 'pending' check (state in ('pending','reviewed','blocked')),
  first_queued_at timestamptz not null default now(),
  last_seen_at timestamptz not null default now()
);
alter table ci_eligibility_review_queue enable row level security;
revoke all on ci_eligibility_review_queue from anon, authenticated;
grant select,insert,update,delete on ci_eligibility_review_queue to service_role;

create or replace function ci_claim_ats_slot(p_source_id uuid)
returns boolean language plpgsql security invoker set search_path=public as $$
declare source_name text; claimed text;
begin
  select name into source_name from ci_discovery_sources
    where id=p_source_id and kind='ats' and state='active';
  if source_name is null then return false; end if;
  insert into ci_api_rate_limits(action,last_run_at)
    values('ats:'||source_name,now())
  on conflict(action) do update set last_run_at=excluded.last_run_at
    where ci_api_rate_limits.last_run_at <= now()-interval '6 hours'
  returning action into claimed;
  return claimed is not null;
end;
$$;
revoke all on function ci_claim_ats_slot(uuid) from public, anon, authenticated;
grant execute on function ci_claim_ats_slot(uuid) to service_role;

create or replace function ci_ingest_ats_job(
  p_provider text, p_board text, p_source_job_id text,
  p_company text, p_title text, p_url text,
  p_published_at timestamptz, p_remote_text text
) returns uuid language plpgsql security invoker set search_path=public as $$
declare v_company_id uuid; v_job_id uuid; source_url_ok boolean;
begin
  if p_provider not in ('greenhouse','lever','ashby') or
     p_board is null or p_board !~ '^[A-Za-z0-9_-]{1,100}$' or
     p_source_job_id is null or length(p_source_job_id) not between 1 and 150 or
     p_source_job_id !~ '^[A-Za-z0-9_-]+$' or
     p_company is null or length(trim(p_company)) not between 2 and 180 or
     p_title is null or length(trim(p_title)) not between 3 and 250 or
     p_url is null or length(p_url)>1500 or
     p_published_at>now()+interval '1 day' then return null;
  end if;
  source_url_ok := case p_provider
    when 'greenhouse' then
      left(p_url,length('https://boards.greenhouse.io/'||p_board||'/'))='https://boards.greenhouse.io/'||p_board||'/'
      or left(p_url,length('https://job-boards.greenhouse.io/'||p_board||'/'))='https://job-boards.greenhouse.io/'||p_board||'/'
    when 'lever' then left(p_url,length('https://jobs.lever.co/'||p_board||'/'))='https://jobs.lever.co/'||p_board||'/'
    when 'ashby' then left(p_url,length('https://jobs.ashbyhq.com/'||p_board||'/'))='https://jobs.ashbyhq.com/'||p_board||'/'
    else false end;
  if not source_url_ok or p_url~'[?#]' then return null; end if;
  select id into v_company_id from ci_companies where canonical_domain is null
    and normalized_name=lower(trim(p_company)) limit 1;
  if v_company_id is null then
    insert into ci_companies(normalized_name,legal_name,identity_confidence)
      values(lower(trim(p_company)),trim(p_company),'unverified')
    on conflict ((lower(normalized_name))) where canonical_domain is null
      do update set legal_name=excluded.legal_name
    returning id into v_company_id;
  end if;
  insert into ci_jobs(company_id,title,apply_url,canonical_apply_url,
    status,published_at,timestamp_source,timestamp_confidence,remote_text,last_verified_at)
  values(v_company_id,trim(p_title),p_url,p_url,'open',p_published_at,
    case when p_published_at is null then 'unknown' else p_provider end,
    case when p_published_at is null then 'unknown' else 'authoritative' end,
    left(coalesce(p_remote_text,''),500),now())
  on conflict(company_id,canonical_apply_url) do update set
    title=excluded.title,remote_text=excluded.remote_text,
    last_verified_at=now(),
    status=case when ci_jobs.status='closed' then 'open' else ci_jobs.status end
  returning id into v_job_id;
  insert into ci_job_sources(job_id,source_name,source_job_id,source_url)
  values(v_job_id,p_provider,p_board||':'||p_source_job_id,p_url)
  on conflict(source_name,source_job_id) where source_job_id is not null
  do update set retrieved_at=now(),source_url=excluded.source_url;
  insert into ci_eligibility_review_queue(job_id)
    select v_job_id where not exists (
      select 1 from ci_eligibility_assessments e where e.job_id=v_job_id
    )
    on conflict(job_id) do update set last_seen_at=now();
  return v_job_id;
end;
$$;
revoke all on function ci_ingest_ats_job(text,text,text,text,text,text,timestamptz,text)
  from public, anon, authenticated;
grant execute on function ci_ingest_ats_job(text,text,text,text,text,text,timestamptz,text)
  to service_role;
