-- Activate only AFTER deploying and verifying the standalone ci-worker
-- function with verify_jwt=false and a DB-backed HMAC authentication gate.
do $ci_activate_worker$
begin
 if not exists(select 1 from pg_extension where extname='pg_cron') or
    not exists(select 1 from pg_extension where extname='pg_net') then
    raise notice 'worker schedule is not enabled without pg_cron and pg_net';
    return;
 end if;
 if coalesce(current_setting('cron.timezone',true),'GMT') not in ('GMT','UTC','Etc/UTC') then
   raise exception 'Career Intelligence worker schedule requires GMT/UTC';
 end if;
 execute 'select cron.schedule($1,$2,$3)' using
   'ci-unattended-public-research-6h',
   '0 */6 * * *',
   'select public.ci_emit_signed_worker_request()';
end;
$ci_activate_worker$;
