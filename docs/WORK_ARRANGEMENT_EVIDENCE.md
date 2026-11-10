# ATS source-backed work arrangement and visa evidence

A restrictive Discovery Preferences setting must not match undocumented claims.

The live official ATS review path now extracts narrowly stated work arrangement and visa support from the exact 2,000-character excerpt stored for that job. It **does not infer visa sponsorship from "remote", worldwide hiring, or general eligibility for Nigerian residents**. A provider's unsupported/no-sponsorship statement overrides positive wording.

For a non-unknown classification the server calls `ci_record_ats_work_facts`, which requires a recent matching official ATS evidence excerpt, exact job ID, original listing URL, and approved service-role privileges. Facts expire in seven days. An expired or unknown work-mode/visa fact never satisfies a restrictive preference.

Statements not present within the saved excerpt are deliberately classified `unknown`, and the recommendation generator does not manufacture a match. Other external sources must be independently verified before their facts can enter the index.

Coverage: manually triggered ATS review and unattended CI worker review use the same source-scoped classifier. Remotive or Himalayas marketing descriptions alone cannot verify work-mode/visa facts. Source-independent reviewer confirmations and richer structured provider location metadata remain separate enhancements.
