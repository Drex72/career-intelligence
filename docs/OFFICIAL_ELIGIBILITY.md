# Official ATS eligibility review

The owner can review a pending ATS job from **Agent operations**. The server retrieves that job's current public Greenhouse, Lever or Ashby posting from a fixed provider API, matches its recorded source job identifier, extracts a bounded plain-text description and records a scoped, expiring assessment.

Decision policy:
- Explicit official language that permits Nigeria-based candidates may become verified eligible.
- Explicit Nigeria exclusions override positive language.
- Global remote / worldwide wording is **likely**, never verified on its own.
- A missing, stale or ambiguous description stays unknown and cannot be delivered in the daily recommendations.
- Decisions are recorded in ci_eligibility_assessments, source excerpts in ci_eligibility_evidence, with an expiry and policy version.
- Every review is owner-gated, limited to one per six hours per job, and SQL writes are service-role only.
- A valid separately verified decision is not downgraded by a weaker review.

No email sending, recruitment-site login, human relationship inference, or paid API calls are added.

This is a conservative deterministic eligibility gate, not a replacement for independent employer policy research, recruiter confirmation, or manual dispute resolution. Employer policies and job descriptions can change.
