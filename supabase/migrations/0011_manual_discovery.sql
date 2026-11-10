-- Private, bounded manual feed ingestion. All objects are Career Intelligence scoped.
create unique index if not exists ci_uq_unknown_domain_company_name
  on ci_companies ((lower(normalized_name))) where canonical_domain is null;

create table if not exists ci_api_rate_limits (
  action text primary key,
  last_run_at timestamptz not null default now()
);
alter table ci_api_rate_limits enable row level security;
revoke all on ci_api_rate_limits from anon, authenticated;
grant select, insert, update on ci_api_rate_limits to service_role;

create or replace function ci_claim_feed_slot(p_action text)
returns boolean language plpgsql security invoker set search_path = public as $claim$
declare claimed text;
begin
  if p_action <> 'remotive' then return false; end if;
  insert into ci_api_rate_limits(action,last_run_at) values(p_action,now())
  on conflict(action) do update set last_run_at=excluded.last_run_at
    where ci_api_rate_limits.last_run_at <= now() - interval '6 hours'
  returning action into claimed;
  return claimed is not null;
end;
$claim$;

create or replace function ci_ingest_remotive_job(
  p_source_id text,p_company text,p_title text,p_url text,
  p_published_at timestamptz,p_location text
) returns uuid language plpgsql security invoker set search_path = public as $ingest$
declare found_company uuid; found_job uuid; company_name text;
begin
  company_name := trim(p_company);
  if p_source_id is null or length(p_source_id)>100 or p_source_id !~ '^[0-9]+$'
     or length(company_name) < 2 or length(company_name)>180
     or length(trim(p_title)) < 3 or length(trim(p_title))>250
     or p_url !~ '^https://remotive[.]com/remote-jobs/'
     or p_published_at is null or p_published_at < now() - interval '7 days'
     or p_published_at > now() + interval '1 day' then return null;
  end if;
  select id into found_company from ci_companies
    where canonical_domain is null and normalized_name=lower(company_name)
    limit 1;
  if found_company is null then
    insert into ci_companies(normalized_name,legal_name,identity_confidence)
      values(lower(company_name),company_name,'unverified')
      on conflict ((lower(normalized_name))) where canonical_domain is null
      do update set legal_name=excluded.legal_name
      returning id into found_company;
  end if;
  insert into ci_jobs(company_id,title,apply_url,canonical_apply_url,
    status,published_at,timestamp_source,timestamp_confidence,remote_text)
    values(found_company,trim(p_title),p_url,p_url,'unverified',
      p_published_at,'remotive','authoritative',left(coalesce(p_location,''),500))
    on conflict(company_id,canonical_apply_url) do update set
      title=excluded.title,remote_text=excluded.remote_text
    returning id into found_job;
  insert into ci_job_sources(job_id,source_name,source_job_id,source_url)
    values(found_job,'remotive',p_source_id,p_url)
    on conflict(source_name,source_job_id) where source_job_id is not null
    do update set source_url=excluded.source_url,retrieved_at=now();
  return found_job;
end;
$ingest$;

revoke all on function ci_claim_feed_slot(text) from public, anon, authenticated;
revoke all on function ci_ingest_remotive_job(text,text,text,text,timestamptz,text) from public, anon, authenticated;
grant execute on function ci_claim_feed_slot(text) to service_role;
grant execute on function ci_ingest_remotive_job(text,text,text,text,timestamptz,text) to service_role;
