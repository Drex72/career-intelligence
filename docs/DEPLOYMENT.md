# Deployment and production verification checklist

**No production deployment is present.** The current Docker configuration is a convenience for localhost evaluation. `compose.yaml` binds loopback and persists `/data`; it does not provide HTTPS, authentication sessions, monitoring, or managed backups.

## GitHub
- [x] Publish source on `Drex72/career-intelligence` using the GitHub integration. The repository is **public**; never commit private Obsidian data.
- [x] Open draft PR #1 from `feat/discovery-foundation` to `main`.
- [x] Initial GitHub Actions Python test workflow completed successfully.
- [ ] Review the PR and new commits before merging.
- [ ] Create a **separate private repository** for approved Obsidian knowledge; never push private notes to this public repository.

## Database / Supabase
- [ ] Explicitly select an organization and confirm project price is $0 before creating a dedicated project. Do not reuse unrelated user projects.
- [ ] Apply and verify migrations 0001–0007 against an isolated test project, inspect ownership/RLS and security advisor findings.
- [ ] Exercise atomic task leases, multi-worker idempotency, rollback, event audit records, knowledge changes, and all row-level permission policies.
- [ ] Configure encrypted automated database backups, and demonstrate restore against an empty test database.
- [ ] Move runtime from SQLite to tested PostgreSQL data repositories and checkpoint saver.

## Agents and background jobs
- [ ] Install and pin `langgraph`, checkpoint, and PostgreSQL dependencies in a connected environment.
- [ ] Run the six-role graph with real checkpoints and simulate worker failure/recovery.
- [ ] Deploy bounded scheduled workers with durable missed-run catch-up; verify service quotas and rate limits.
- [ ] Expand sources without violating robots, API quota, or provider terms.
- [ ] Verify country/contract eligibility against current employer evidence; test ambiguity escalation.

## Remote UI
- [ ] Deploy behind HTTPS and proper single-user authentication backed by Supabase Auth, not the development bearer-token prompt.
- [ ] Add CSRF protections for authenticated mutation routes, owner authorization checks, CORS boundaries, and XSS/CSP review.
- [ ] Ensure all browser-facing data is owner-scoped; remove developer secrets from static assets and logs.
- [ ] Verify application tracker, source attribution, research provenance, contact queue, and observability.

## Gmail and contact enrichment
- [ ] Configure Google OAuth and minimal permissions with explicit account owner consent.
- [ ] Obtain professional addresses only from permitted sources; no unverified private contact enrichment.
- [ ] Demonstrate manual-send approval, bounded auto-send, suppression, opt-out, quota enforcement, failure reconciliation, and kill switch.
- [ ] Do **not** turn on automatic sending until these tests pass and an explicit standing authorization policy is configured.

## No-cost guardrail
- [ ] Set external provider monetary budgets to zero and keep all paid providers disabled.
- [ ] Set job discovery and source-rate limits based on observed free quotas.
- [ ] Confirm the platform degrades to deterministic screening when local AI is offline.
- [ ] Record actual cloud usage before claiming that 100 eligible employers daily is sustainable at zero cost.

## Shared Groundwork Supabase database (`ci_` namespace)

Career Intelligence is configured to share the **Groundwork** Supabase project
only after the correct project reference has been verified. Its PostgreSQL
objects live in `public` and carry the `ci_` prefix (for example,
`ci_companies`, `ci_jobs`, `ci_workflow_tasks`, `ci_outreach_drafts`).

- Do **not** run pre-namespace migrations from older commits on a shared database.
- Do **not** apply the migrations to a project whose identity is not verified as Groundwork.
- Never use `REVOKE ... ON ALL TABLES IN SCHEMA public`, drop unrelated tables,
  or change Groundwork's existing policies. Versioned migrations only alter
  explicit `ci_` objects.
- Use only a server-side connection to `ci_` operational tables; do not expose
  a service-role credential in the browser. By default RLS denies client reads
  except explicit owner-scoped application/delivery tables.
- Before deployment, run migrations against a disposable PostgreSQL database
  containing a pre-existing non-`ci_` table and granted client permissions;
  verify its data and permissions remain unchanged.
- Apply approved migrations to Groundwork using a protected database
  connection **after** verifying the project ID and taking a restorable backup.
- The local SQLite mode is a separate development adapter with unprefixed
  internal tables, **not** the shared Supabase schema.

Never commit the Groundwork connection string, API keys, or Obsidian vault.

## Career Intelligence shared Groundwork database (ci_ namespace)

The `ci_` tables are isolated within Groundwork's existing Supabase project. The
new `0008_discovery_config.sql` migration adds only a `config` column to
`ci_discovery_sources` and an index with a `ci_` prefix. Apply it using the
normal tracked migration flow before enabling scheduled discovery.

The default GitHub Actions scheduled workflow is OFF. To enable it deliberately:

1. Configure Actions secret `CI_DATABASE_URL` with a restricted, server-side
   PostgreSQL connection string. Never put this secret in source or browser code.
2. Configure Actions secret `CI_OWNER_UUID` with the authenticated user's UUID.
3. Set Actions repository variable `CI_AUTO_RUN` to `true` after testing.
4. Confirm workflows remain within GitHub Actions and Supabase free quotas.

The scheduler only reads public job sources, records jobs and eligibility, and
materializes batches. It never sends emails, applies to jobs, or enables paid
providers. `pg-discover` can also be invoked manually with `DATABASE_URL` set.
Do not expose database credentials to the browser or a public dashboard.
