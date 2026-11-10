# Free Himalayas remote-job source

The unattended signed worker checks the public Himalayas jobs API once per 24 hours.
It fetches at most three pages of 20 listings and keeps only relevant software
jobs published within seven days.

Official documentation: https://himalayas.app/docs/remote-jobs-api

## Provider requirements

- **Use `applicationLink` unchanged** for the Apply action.
- Display a visible link to the original job on `himalayas.app` and attribute
  Himalayas as the source.
- Do not redistribute its listings to third-party aggregators.
- Respect upstream HTTP 429 and the 24-hour feed refresh.
- The API can be used without a key, so the zero-paid default stays intact.

All jobs enter as **unverified**. A `locationRestrictions` country value or
a “worldwide remote” phrase does **not** constitute legal proof that the
employer will hire an applicant based in Lagos, Nigeria. The official employer
eligibility workflow remains a separate gate.

The provider feed is database-rate-limited by `ci_claim_feed_slot('himalayas')`
to once per 24 hours and is distinct from Remotive's six-hour allowance.
The public link and `guid` are preserved in `ci_job_sources`; the user-facing
Opportunities page links to them.

## Constraints

This milestone adds one public feed, not exhaustive employer search.
It does not create a reliable 100-new-eligible-companies-per-day guarantee.
Job closure reconciliation with a provider's single-job endpoint is a separate
production reliability milestone.
