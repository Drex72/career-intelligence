# Deployment and production verification checklist

**No production deployment is present.** The current Docker configuration is a convenience for localhost evaluation. `compose.yaml` binds loopback and persists `/data`; it does not provide HTTPS, authentication sessions, monitoring, or managed backups.

## GitHub
- [ ] Authenticate the `Drex72` account with `gh auth login` in a connected development environment.
- [ ] Review code for secrets and personal data (`git grep` and local `.env` exclusions).
- [ ] Run `scripts/publish-github.sh` to create the private repository and draft feature PR.
- [ ] Confirm CI is green, review the PR, and merge only after review.
- [ ] Create a **separate private repository** for approved Obsidian knowledge; never push the unapproved private notes directory.

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
