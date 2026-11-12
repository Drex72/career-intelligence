# Geographic search target: US employers, remote worldwide

**Owner intent:** Find roles with United States-based employers that can be performed remotely from anywhere in the world. The candidate is presently located in Nigeria. Do **not** search for jobs that require the candidate to be physically located in Nigeria, and do **not** treat "Remote (US only)" as worldwide remote.

This is an **employer-country** target, not a candidate-residence target. There are three independent dimensions:

1. **US employer:** official company-origin proof of US headquarters or corporate home base (table `ci_company_country_evidence`). A job on a US-region board does not prove a US employer.
2. **Worldwide role:** explicit job-scoped official remote geography. "Remote", "our customers are global", "remote US only", or broad company marketing copy are insufficient (table `ci_job_remote_scope_evidence`).
3. **Eligibility from Nigeria:** explicit job-specific hiring permission, in the original verified assessment. Even "Remote - Global" alone is recorded as `likely_eligible`, **not verified eligible**, pending evidence of legal remote hiring from Nigeria.

New table `ci_geo_target_preferences` stores `employer_country=US`, `applicant_country=NG`, `remote_scope=worldwide`. It is *owner-specific* and applies only when an owner has configured the target. Existing owners without a row retain their prior filtering. `ci_job_matches_geo_target()` is included in the actual daily batch function, so insufficient evidence fails closed at delivery.

**US employer headquarters attestation initially includes only organizations with official proof:** fal (company about page, San Francisco) and Mercor (company's published legal terms, San Francisco). This does **not** mean their individual positions are worldwide remote. We deliberately did not mark Supabase as headquartered in the United States: its official legal terms describe a Singapore contracting entity, while its careers page says it hires globally. US recruitment footprint and global remote work are distinct from a US corporate HQ.

Source examples:
- https://fal.ai/about
- https://www.mercor.com/terms-of-service/
- https://supabase.com/terms

**Scope limits:** The existing job matcher currently scores only title/location keyword overlap and has not proven mandatory requirements fit. A worldwide-location lead must not be counted as a *verified suitable job* solely because it passes the geography target. The 100 verified suitable jobs per day objective remains unmet.

## Rollout

1. Apply migration 0037 for owner/employer/remote-scope evidence, private permissions and role-scoped recording API.
2. Apply migration 0038 to add `ci_job_matches_geo_target` to actual daily delivery selection, preserving all prior evidence, freshness and dedup checks.
3. Insert the owner preference:
   ```sql
   insert into ci_geo_target_preferences(owner_user_id,employer_country,applicant_country,remote_scope)
   select owner_user_id,'US','NG','worldwide'
   from ci_discovery_preferences
   on conflict(owner_user_id) do update
     set employer_country='US',applicant_country='NG',remote_scope='worldwide',updated_at=now();
   ```
4. Deploy `ci-worker` with updated `eligibility.mjs` and `index.ts`, retaining signed request verification and no Gmail sends.
5. Review a bounded set of current *official-source* jobs again so they receive the new job-scoped remote-scope evidence. Previously completed assessments do not magically become worldwide verified because a company has a global workforce.
6. Check `ci_job_matches_geo_target(job_id,owner_id)` on verified, unknown, restricted, expired and worldwide cases. Observe the new job evidence records and today's qualified delivery count.

**Fail-closed behavior:** An employer with no official HQ proof or a job with no job-specific worldwide scope stays unqualified for this target, even if globally distributed marketing is promising.
