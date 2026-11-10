-- Daily 07:00 Lagos (06:00 UTC) batch generation.
-- No scraping, provider credentials, emails, or paid APIs.
-- Only jobs already verified eligible with evidence can be delivered.
-- The postgres runner uses the service-only function and existing owner allowlist.
do $ci_daily_schedule$
begin
  if exists(select 1 from pg_extension where extname='pg_cron') then
    if coalesce(current_setting('cron.timezone',true),'GMT') not in ('GMT','UTC','Etc/UTC') then
      raise exception 'Career Intelligence cron requires UTC/GMT scheduler timezone';
    end if;
    execute 'select cron.schedule($1,$2,$3)' using
      'ci-daily-recommendations-0700-wat',
      '0 6 * * *',
      'select public.ci_generate_daily_batch(owner_user_id,(now() at time zone ''Africa/Lagos'')::date,100) from public.ci_workspace_owners';
  end if;
end;
$ci_daily_schedule$;
