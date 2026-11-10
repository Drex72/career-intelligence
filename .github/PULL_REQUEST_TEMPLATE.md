## Summary

Implement the personal career intelligence platform foundation with authenticated local dashboard, public job ingestion, initial evidence-backed eligibility research, global company deduplication, approved Obsidian knowledge ingestion, employee research, draft-only outreach, Gmail send gate, and SQLite/PostgreSQL task-ledger contracts.

## Tests

Run `python -m pytest services/worker/tests -q`.

## Security

- No accounts, Gmail tokens, approved knowledge vault, or inbox contents committed.
- Outbound email requires prior approval and explicit OAuth credentials.
- API key access and paid enrichment default to disabled.
- PostgreSQL migrations require isolated database testing and full RLS review before deployment.

## Deployment blockers

Production Supabase, LangGraph checkpoint integration, cloud hosting, and live provider OAuth need private account provisioning and integration testing. Do not merge or deploy until those checks pass.
