# Signed unattended discovery worker

## Security boundary
The `ci-worker` Edge Function is deliberately separate from the owner-facing `ci-api`.
Its platform-level JWT verification is disabled because scheduled database requests do not
contain a human Supabase Auth JWT. **Do not deploy it without the HMAC gate.**

- Migration 0018 generates a random 256-bit shared key **inside** PostgreSQL. Neither
  GitHub nor Vercel receives the key.
- Each cron request contains only a timestamp, random UUID nonce, and HMAC-SHA256
  of `nonce:timestamp`. The key is not transmitted in the HTTP request.
- Server-role RPC verification checks authenticity, a 120-second expiry, and a
  one-time nonce. Replay attempts return 401.
- All credential, nonce, and worker-history tables have RLS enabled and no
  anonymous or authenticated grants.
- The function has no user-supplied command, URL, recipient, or payment endpoint.
- It uses hard-coded public Remotive and official Greenhouse/Lever/Ashby endpoints.
- No Gmail, employer login automation, paid enrichment or email sending.

## Safe activation procedure

1. Merge the tested worker code and apply **0018 only** to Groundwork.
2. Deploy Supabase function `ci-worker`, including `index.ts`, `policy.mjs`,
   `ats.mjs`, `eligibility.mjs`, and `candidates.mjs`, with `verify_jwt=false`.
3. Verify a missing or invalid signature returns 401. Verify a valid signature
   once and replay rejection against a test request.
4. Apply **0019** to install the six-hour cron schedule. Never activate before
   authenticating the deployed function.
5. Monitor `ci_worker_runs` in Agent operations and Supabase Cron history.

The worker runs at 00:00, 06:00, 12:00 and 18:00 UTC. Each invocation
processes at most two ATS boards and two official-job reviews, plus one
rate-limited Remotive software feed. All job/source identities remain
unverified until independently evidenced. It does not guarantee a target
number of eligible companies per day.

## Stop immediately

```sql
select cron.unschedule('ci-unattended-public-research-6h');
```

To rotate its key: update `ci_worker_auth` using a new database-generated value
and invalidate outstanding nonces. Do not print or export the key.

## Availability limitations

This worker is a bounded two-role discovery/eligibility execution path.
Other LangGraph roles, full private-vault synchronization, Gmail OAuth,
human outreach authorization, and recurring conversation monitoring remain
separate PRD milestones.
