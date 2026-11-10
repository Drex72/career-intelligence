# Public ATS discovery — owner-managed source registry

The signed-in Career Intelligence owner can open **Agent operations**, register a public Greenhouse, Lever or Ashby board by provider slug and company name, and explicitly scan it.

- Fetches only three hardcoded provider public API hosts, never URLs submitted by users.
- Accepts listing links only on official ATS hosts for the registered board.
- Limits a board to one scan every six hours, enforced with a PostgreSQL atomic claim.
- Parses at most 100 software-job rows and attempts up to 30 ingestions per scan.
- Preserves real publication dates and does not invent them when absent.
- Maintains source provenance, idempotent listings and a service-only eligibility review queue.
- Does not infer Nigerian hiring eligibility, send email, or use paid providers.
- Board/company identity is self-reported until independently verified.

The SQL functions are service-role only. The Edge API verifies an active Supabase session AND membership in ci_workspace_owners. Client code has no service credentials.

## Still outstanding

Automatic web-wide discovery of unknown ATS boards, autonomous official-employer eligibility research, and persistent, recurring six-agent orchestration remain separate requirements. This milestone alone cannot deliver 100 newly verified eligible companies daily.
