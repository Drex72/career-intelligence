-- Himalayas pubDate can represent the listing's LAST UPDATE, not its first publication.
-- Do not label an unknown original publication timestamp as authoritative or "new".
-- This maintains exact provider applicationLink attribution and the existing worker RPC contract.
update ci_jobs j
set updated_at=coalesce(j.updated_at,j.published_at),
    published_at=null,
    timestamp_source='himalayas_pubDate_last_updated',
    timestamp_confidence='unknown'
where j.timestamp_source='himalayas'
  and exists(select 1 from ci_job_sources s where s.job_id=j.id and s.source_name='himalayas')
  and not exists(select 1 from ci_job_sources s where s.job_id=j.id and s.source_name<>'himalayas');

create or replace function ci_ingest_himalayas_job(
 p_guid text,p_company text,p_title text,
 p_application_link text,p_published_at timestamptz,p_locations text
) returns uuid language plpgsql security invoker set search_path=public as $ci_ingest_h$
declare v_company uuid;v_job uuid;name text;
begin
 name:=trim(p_company);
 if p_guid is null or length(p_guid)>1000 or
    p_guid !~ '^https://himalayas[.]app/companies/[A-Za-z0-9_-]+/jobs/[A-Za-z0-9_-]+$' or
    name is null or length(name) not between 2 and 180 or
    p_title is null or length(trim(p_title)) not between 3 and 250 or
    p_application_link is null or length(p_application_link)>1800 or
    p_application_link !~ '^https://' or
    p_published_at is null or p_published_at<now()-interval '7 days' or
    p_published_at>now()+interval '1 day' then return null;
 end if;
 select id into v_company from ci_companies
   where canonical_domain is null and normalized_name=lower(name) limit 1;
 if v_company is null then
   insert into ci_companies(normalized_name,legal_name,identity_confidence)
     values(lower(name),name,'unverified')
   on conflict ((lower(normalized_name))) where canonical_domain is null
     do update set legal_name=excluded.legal_name
   returning id into v_company;
 end if;
 -- The upstream pubDate records a recent update, not proven original publication.
 -- Keep published_at null until original posting provenance is confirmed elsewhere.
 insert into ci_jobs(company_id,title,apply_url,canonical_apply_url,status,
    published_at,updated_at,timestamp_source,timestamp_confidence,remote_text)
 values(v_company,trim(p_title),p_application_link,p_application_link,'unverified',
    null,p_published_at,'himalayas_pubDate_last_updated','unknown',
    left(coalesce(p_locations,''),500))
 on conflict(company_id,canonical_apply_url) do update set
    title=excluded.title,remote_text=excluded.remote_text,
    updated_at=greatest(coalesce(ci_jobs.updated_at,excluded.updated_at),excluded.updated_at)
 returning id into v_job;
 insert into ci_job_sources(job_id,source_name,source_job_id,source_url)
   values(v_job,'himalayas',p_guid,p_guid)
 on conflict(source_name,source_job_id) where source_job_id is not null
   do update set source_url=excluded.source_url,retrieved_at=now();
 return v_job;
end;
$ci_ingest_h$;
revoke all on function ci_ingest_himalayas_job(text,text,text,text,timestamptz,text)
 from public,anon,authenticated;
grant execute on function ci_ingest_himalayas_job(text,text,text,text,timestamptz,text)
 to service_role;
