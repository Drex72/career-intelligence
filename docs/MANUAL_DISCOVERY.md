# Public job discovery (on demand)

The owner can click **Check public jobs** on the Opportunities page. This uses a private Supabase Edge API route that downloads the [Remotive public software-development feed](https://remotive.com/remote-jobs/api), checks publication dates and engineering titles, and stores at most 100 listings. **Remotive is the source**: every stored link resolves back to the original Remotive listing.

The request is limited to once every six hours, obeying the source recommendation of at most four requests daily. Jobs are stored as **unverified**, never as verified eligible or delivered-company recommendations. Nigeria hiring eligibility requires a separate official-role assessment.

The function has no Gmail, application submission, paid-provider, or contact-enrichment capability. It uses server-side `ci_` tables and a rate-limited, atomic SQL ingestion function available only to the Supabase service role.

This is not a replacement for the scheduled multi-source discovery worker or the target of up to 100 **verified eligible companies** per day.
