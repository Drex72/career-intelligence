# Himalayas ATS candidate discovery

The scheduled worker already imports recent software-engineering jobs from the Himalayas public jobs API. This milestone additionally examines **the official application link supplied for each successfully imported Himalayas job**.

If that link points to an official Greenhouse, Lever or Ashby board, the worker proposes a source candidate with the original, canonical Himalayas job page as evidence. It does not open arbitrary application URLs, invent board identifiers, or mark employers eligible.

Security and review invariants:

- Candidate extraction accepts only official ATS job-link hosts and canonical `https://himalayas.app/companies/{company}/jobs/{job}` source pages.
- New database candidates have `source_kind='himalayas'` and `state='pending'`.
- Owner approval through Agent operations remains mandatory before an ATS board becomes a scannable source.
- The worker caps all source suggestions to ten per run.
- Duplicate provider/board pairs retain their existing candidate and cannot silently change identity or provenance.
- Source discovery never changes job eligibility or triggers any email.

This broadens unattended **candidate discovery**. It does not guarantee discovering 100 eligible employers a day or automate owner approval.

## Tracked application links and feed pagination

Himalayas often returns a tracked Himalayas `applicationLink`. The worker now inspects *both* that link and any official ATS link appearing within the provider's bounded description HTML. It preserves `applicationLink` unchanged for the application's Apply action.

Feed traversal uses `nextCursor`, URL-encoded and capped to three pages per scheduled fetch. The previous deprecated `offset` pagination has been removed. This honors the provider's current public API contract and avoids fabricating job IDs or positions when the cursor is absent.

A description that contains no independently recognizable public ATS link produces **no source suggestion**, which is the intended safe result.
