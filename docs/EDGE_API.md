# Career Intelligence Supabase Edge API

The `ci-api` function is a private, owner-allowlisted backend for the Next.js dashboard. It uses `SUPABASE_URL` and `SUPABASE_SERVICE_ROLE_KEY` in Supabase Edge Functions, never in Vercel or the browser.

`ci_workspace_owners` has RLS enabled and no `anon` or `authenticated` grants. Add the authorized user's `auth.users.id` using private admin SQL after validating their identity; **do not commit an email address or UUID to GitHub**.

The gateway validates the incoming Supabase Auth access token using `auth.getUser(token)` and checks the owner allowlist on every request before querying Career Intelligence tables. Public routes and CORS are not enabled. It has no email-sending functionality.

Frontend backend environment variable: `CI_BACKEND_URL=https://<project-ref>.supabase.co/functions/v1/ci-api` (no trailing slash). The existing Next.js proxy forwards Bearer tokens to `/api/ci/` routes.

Endpoints: GET `metrics`, `jobs`, `people`, `knowledge`, `applications`, `outreach`, `conversations`, `operations`, `batches/YYYY-MM-DD`. POST `applications`, `outreach/drafts`, `conversations`. All other routes return 404. No automatic emails are sent.

**Deployment tests**: anonymous request must fail; non-owner signed-in request must fail; owner request must return only CI data; application updates must be owner-scoped; draft creation must refuse unverified opportunities; deleting owner allowance must immediately revoke access. Do not claim production acceptance until those checks are performed.
