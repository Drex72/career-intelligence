-- Independently rate-limited, attributed public Himalayas jobs feed.
-- The upstream feed refreshes once a day. Listings remain unverified.
create or replace function ci_claim_feed_slot(p_action text)
returns boolean language plpgsql security invoker set search_path=public as $ci_claim_feeds$
declare claimed text; cooldown interval;
begin
  if p_action='remotive' then cooldown:=interval '6 hours';
  elsif p_action='himalayas' then cooldown:=interval '24 hours';
  else return false; end if;
  insert into ci_api_rate_limits(action,last_run_at) values(p_action,now())
  on conflict(action) do update set last_run_at=excluded.last_run_at
    where ci_api_rate_limits.last_run_at<=now()-cooldown
  returning action into claimed;
  return claimed is not null;
end;
$ci_claim_feeds$;
revoke all on function ci_claim_feed_slot(text) from public,anon,authenticated;
grant execute on function ci_claim_feed_slot(text) to service_role;

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
 -- Keep the provider's applicationLink unchanged as its attribution terms require.
 insert into ci_jobs(company_id,title,apply_url,canonical_apply_url,status,
    published_at,timestamp_source,timestamp_confidence,remote_text)
 values(v_company,trim(p_title),p_application_link,p_application_link,'unverified',
    p_published_at,'himalayas','authoritative',left(coalesce(p_locations,''),500))
 on conflict(company_id,canonical_apply_url) do update set
    title=excluded.title,remote_text=excluded.remote_text
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
