# Career Intelligence Gmail authorization ledger

This milestone implements the **hybrid authorization gate** without sending an email or requiring Gmail credentials.

## Workflow

1. The signed-in Career Intelligence owner records an application as `applied` (or `interviewing`/`offer` with an application timestamp).
2. A draft is created for a researched, identity-verified company contact with a verified professional email.
3. `POST /api/ci/outreach/approve` with `{"draft_id":"<uuid>","mode":"manual"}` records an explicit active approval. `standing` is refused unless `ci_outreach_policies.auto_enabled` is already true.
4. `POST /api/ci/outreach/intents` with `{"draft_id":"<uuid>"}` creates **one idempotent pending intent**. Replays return its existing ID, never duplicate it.
5. The future dedicated Gmail Dispatcher must recheck revocation, opt-out suppression, budget, and provider state immediately before a send. After an ambiguous provider response, it must reconcile before retrying.

## Safety invariants

- A valid owner allowlist entry, role-specific current verified-eligible assessment, supporting evidence, open role, application, verified recipient and nonempty knowledge revision are mandatory.
- The recipient's normalized email is compared against owner-scoped SHA-256 suppression hashes.
- Daily limit defaults to 10; per-company daily limit defaults to 1. The database owner lock serializes concurrent reservations.
- The intent key is deterministic for owner and draft. Ambiguous or failed reservations count toward quotas; automatic retransmission is not implemented.
- Functions are accessible to the Supabase `service_role` only. Normal authenticated users cannot invoke them directly through PostgREST.
- **There is intentionally no Gmail send endpoint, OAuth token storage or provider message dispatch.** Queueing is not sending.

## API integration

The backend owner-authenticated Supabase Edge Function handles two routes, with matching allowlist additions in the Next.js same-origin proxy. A subsequent UI change can provide an accessible approve-and-queue workflow; UI PR #19 is owned by a separate agent and is not modified here.

This migration is additive and affects only `ci_` objects in the shared Groundwork Supabase database. Unit and disposable PostgreSQL integration tests cover owner isolation, application gating, identity and email verification, suppression, quotas, and idempotency.

## Owner revocation and status inspection (migration 0023)

- `POST /api/ci/outreach/revoke` with `{"draft_id":"<uuid>"}` revokes active approval and cancels only unsent, pending intents. Owner authentication is required.
- A `sending_unknown` result returns `reconciliation_required` and is **not** automatically cancelled, retried or marked sent.
- A `sent` result returns `already_sent`; cancelling future approval cannot recall delivered email.
- `GET /api/ci/outreach` now returns `drafts`, `approvals` (active approvals only), and `intents` (status metadata without contact email values), always scoped to the current owner.
- Functions are granted exclusively to `service_role`. The browser never receives a dispatch credential or unrestricted SQL access.

No Gmail calls or new OAuth scopes are introduced. The separate UI agent may implement visible approval/revoke controls using this API contract without rewriting the backend.
