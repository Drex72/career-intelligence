# Career Intelligence: production integrity and generation acceptance

The owner-facing **Agent operations** view now exposes a read-only integrity report from live PostgreSQL. This is separate from worker activity and is designed to prevent successful worker runs from being mistaken for verified recommendations.

The audit counts real sources, duplicate source identities, duplicate canonical jobs, HTTPS application-link violations, verified assessments missing evidence, and delivered jobs without any verification history. It also reports the owner’s saved daily target (default 25), currently eligible and not previously delivered jobs, and approved Obsidian documents.

**Interpretation:** `integrity_ok = true` means no listed consistency violations were found, **not** that there are qualified employers. `generation_ready = true` requires at least one currently eligible, sourced, recently published, undelivered opening compatible with the saved preferences. Neither is evidence of successful Gmail delivery.

## Verified live observations (2026-11-10)

- 16 public jobs from 14 companies; 16 provenance records
- No duplicate source identities, missing source records, duplicate canonical job records, or invalid apply URLs
- 0 completed eligibility assessments or official eligibility evidence
- 0 delivered company recommendations, 0 outbound emails
- 0 owner preference records: the default 25 company target applies
- One completed daily batch for 2026-11-10 containing 0 delivered items
- Signed worker runs completed with zero reported failures; most recent runs imported 0 new jobs due to provider source cooldowns
- Daily recommendation, eligibility expiry and six-hour worker cron jobs all active

A direct production call to `ci_generate_daily_batch(owner_user_id, current_lagos_date, 100)` returned 0 newly generated items, effective target 25, and 0 total delivery items. **No fake qualifying company was inserted**, and no message was sent.

The new audit function uses `security invoker` and is executable only by `service_role`. The owner-authenticated Edge API scopes reports to the signed-in workspace owner; the UI does not receive service credentials.

## Remaining gates

- Owner must set preferences in Agent operations to replace defaults
- At least one employer-backed role must pass explicit Nigeria eligibility research; the API must reject ambiguous worldwide-remote evidence
- A private Obsidian vault repository and narrowly scoped read-only connection must be configured before knowledge sync can contain approved notes
- A live end-to-end, signed-in UI validation must verify saved preferences, source review, research, and daily recommendations from authentic employer evidence
- Gmail OAuth and sending remain intentionally deferred
