# Owner discovery preferences

On **Agent operations → Discovery preferences**, the Career Intelligence owner can save preferences that are enforced in the PostgreSQL recommendation generator.

- **Daily target:** 1–100 previously undelivered companies with one qualifying job per company (default 25). This is an upper bound, not a guarantee.
- **Job family:** all software roles, backend, frontend, full-stack, platform/infrastructure, AI/ML, security or data engineering.
- **Seniority:** any, internship, junior/graduate, mid-level, senior, staff/principal. Titles that do not indicate a level are unknown and excluded when a specific level is requested.
- **Work arrangement:** any, remote, hybrid or on-site.
- **Visa sponsorship:** no requirement, or **confirmed sponsorship required**.

## Data integrity

Work arrangement and sponsorship are stored in a separate service-only evidence table, `ci_job_work_facts`. Any non-unknown fact must point to a source evidence row and has a seven-day expiry. **No current feed silently infers sponsorship** from a generic remote label, role title, or country. Without documented proof, restrictive work-mode or visa requirements yield no recommendations.

The generator combines these settings with its existing hard gates: verified eligible for Nigeria, current official evidence, open status, original publication date in the last seven days, and lifetime non-duplication. It never pads the result with unsafe or uncertain jobs.

New preferences affect future batch attempts. Existing delivered rows are immutable; lowering the target below the number already delivered today cannot retract them. The scheduled 07:00 WAT job uses the same server-side function, so manual generation and scheduled batches cannot disagree.

This iteration changes delivery selection rather than globally suppressing the storage of source-attributed discovered jobs, which remains useful for audit and future preference changes. UI controls have no SQL access to the hidden employment facts: the backend owns the final decision.

## Notes

- A verified Nigeria-eligible remote job is **not automatically sponsorship-confirmed**.
- Sponsorship is relevant to a possible relocation visa and can differ from remote work eligibility. The distinction is deliberate.
- Settings are private to the allowlisted owner and are never shared with other users of the existing Groundwork Supabase project.
