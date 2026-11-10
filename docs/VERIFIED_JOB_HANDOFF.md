# Verified-role handoff into matching and people research

When an authoritative, current eligibility assessment proves a specific open job eligible
and a source-evidence record exists, migration 0020 automatically creates a
`verified-role` workflow. The job triggers at most one matching and one people
research task under fixed idempotency keys.

- No approved matching-safe Obsidian document → matching stays `awaiting_approval`.
- Approved document and revision → matching task becomes `pending`; the signed worker
  computes a **lexical overlap only**, not an LLM hallucinated fit score.
- A role with no explicit job-side skill terminology receives score 0, not
  a fabricated proficiency claim.
- All matched and missing skills are stored with a SHA-256 knowledge revision.
- A role's employer must have `identity_confidence='verified'` **and**
  an independently verified canonical domain to enter the company-level
  people-research queue. Nothing creates contacts or guesses email addresses.
- An updated official eligibility exclusion cancels pending tasks. Older completed
  matches remain in history, but the current eligibility gate excludes the job.
- New approved knowledge versions invalidate completed match tasks and queue a
  fresh scored revision.
- The signed unattended worker processes at most three pending matches per run.

No Gmail sending or paid enrichment is introduced.

The current Groundwork project has no approved matching-safe vault documents,
so the live system will **not** claim to have match scores yet. Connect an
approved private Obsidian vault to unlock this agent safely.
