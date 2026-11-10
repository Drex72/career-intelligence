-- Signed internal worker gate: no service key in GitHub/Vercel or pg_net queue.
-- Uses pgcrypto for HMAC and a per-project DB-only secret (server roles only).
create schema if not exists extensions;
create extension if not exists pgcrypto with schema extensions;

create table ci_worker_auth (
  id smallint primary key default 1 check(id=1),
  shared_key text not null check(length(shared_key)>=64),
  created_at timestamptz not null default now()
);
insert into ci_worker_auth(id,shared_key)
values(1,encode(extensions.gen_random_bytes(32),'hex'))
on conflict(id) do nothing;
alter table ci_worker_auth enable row level security;
revoke all on ci_worker_auth from anon,authenticated;
grant select on ci_worker_auth to service_role;

create table ci_worker_nonces (
  nonce uuid primary key,
  seen_at timestamptz not null default now()
);
alter table ci_worker_nonces enable row level security;
revoke all on ci_worker_nonces from anon,authenticated;
grant insert,select,delete on ci_worker_nonces to service_role;

create table ci_worker_runs (
  id uuid primary key default gen_random_uuid(),
  started_at timestamptz not null default now(),
  finished_at timestamptz,
  state text not null default 'running' check(state in ('running','completed','partial','failed')),
  details jsonb not null default '{}'::jsonb
);
alter table ci_worker_runs enable row level security;
revoke all on ci_worker_runs from anon,authenticated;
grant select,insert,update on ci_worker_runs to service_role;

create or replace function ci_verify_worker_request(
 p_nonce uuid,p_timestamp bigint,p_signature text
) returns boolean language plpgsql security invoker set search_path=public,extensions as $ci_verify$
declare key text; expected text; recorded uuid;
begin
  if p_nonce is null or p_timestamp is null or p_signature is null or
     p_signature !~ '^[0-9a-f]{64}$' or
     abs(extract(epoch from clock_timestamp())-p_timestamp::numeric)>120
  then return false; end if;
  select shared_key into key from ci_worker_auth where id=1;
  if key is null then return false; end if;
  expected:=encode(extensions.hmac(
    convert_to(p_nonce::text||':'||p_timestamp::text,'UTF8'),
    convert_to(key,'UTF8'),'sha256'),'hex');
  if expected<>p_signature then return false; end if;
  insert into ci_worker_nonces(nonce) values(p_nonce)
    on conflict do nothing returning nonce into recorded;
  return recorded is not null;
end;
$ci_verify$;
revoke all on function ci_verify_worker_request(uuid,bigint,text)
  from public,anon,authenticated;
grant execute on function ci_verify_worker_request(uuid,bigint,text)
  to service_role;

-- Worker-ping builder for pg_cron. No secrets are transmitted;
-- only a signed, single-use nonce and short-lived timestamp.
create or replace function ci_emit_signed_worker_request()
returns bigint language plpgsql security invoker set search_path=public,extensions as $ci_emit$
declare key text; tick bigint; request_nonce uuid; signature text; request_id bigint;
begin
  if not exists(select 1 from pg_extension where extname='pg_net') then return null; end if;
  select shared_key into key from ci_worker_auth where id=1;
  if key is null then return null; end if;
  request_nonce:=gen_random_uuid();
  tick:=floor(extract(epoch from clock_timestamp()))::bigint;
  signature:=encode(extensions.hmac(
    convert_to(request_nonce::text||':'||tick::text,'UTF8'),
    convert_to(key,'UTF8'),'sha256'),'hex');
  select net.http_post(
    url:='https://manqpbwiwmzqxgldhbdt.supabase.co/functions/v1/ci-worker',
    body:=jsonb_build_object('nonce',request_nonce::text,'timestamp',tick,'signature',signature),
    headers:=jsonb_build_object('Content-Type','application/json'),
    timeout_milliseconds:=5000
  ) into request_id;
  delete from ci_worker_nonces where seen_at<now()-interval '24 hours';
  return request_id;
end;
$ci_emit$;
revoke all on function ci_emit_signed_worker_request() from public,anon,authenticated;
-- Cron executes as the owner of the scheduled database job (postgres), not a web user.
