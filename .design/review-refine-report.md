# Career Intelligence — review and refine

Review scope: authenticated workspace (eight routes), sign-in, navigation, shared data and status components.

## Audit (source-backed)

| Priority | Finding | Evidence | Resolution |
| --- | --- | --- | --- |
| High | Screen architecture was dominated by indistinguishable bordered panels, making task intent hard to scan | Original Overview, Opportunities, Applications, People, Outreach and Conversations source | Overview uses an action rail and recommendation area; Opportunities uses a searchable/filterable explorer; Applications separates history and update; People uses profile cards; outreach/replies separate authoring from history |
| High | Search and research tasks lacked an integrated eligibility breakdown | Original Opportunities only supported free-text search | Explicit eligibility filter controls plus dedicated source/assessment/claim panel; selected state is announced with aria-expanded |
| High | Repeated navigation was not skippable | Original private layout contained sidebar before main with no skip link | Added skip-to-content link, semantic main target and visible focus |
| Medium | Shared record tables lacked descriptive focusable overflow regions and stable row-key support | Original ResourceTable used index keys and an unlabeled overflow div | Added region labels, keyboard scroll access, and optional stable row identifiers; source-specific pages pass stable IDs |
| Medium | Empty/loading states were text-only and inconsistent | Original shared component and route-specific fallback strings | Shared BlankSlate, loading spinner, error notice and semantic status components |
| Medium | People research was another dense table despite being a small contact research collection | Original People route | Searchable professional cards with source links, identity state and true empty state |
| Medium | Login did not communicate the product's job or control boundaries | Original compact centered sign-in | Split desktop authentication layout with purpose statement; same Supabase auth preserved |
| Medium | Small-screen forms may trigger browser zoom and wide navigation may clip | Original global CSS | 16px mobile form inputs; horizontally scrollable navigation; reduced-motion support |

## Design principles
- Distinguish **monitor**, **explore**, **record**, and **research** surface types.
- Use a calm light neutral canvas with a single restrained action color.
- Use status color only with a readable text label and dot, never as the sole carrier of eligibility state.
- Present only data returned from real application resources.
- Do not add autonomous sending controls or imply unverified hiring eligibility.

## Review and refinement actions
1. Replaced the global dark-first CSS theme and established documented tokens in root `DESIGN.md`.
2. Added shared `WorkspaceUI` components, expanded `ResourceTable`, and rebuilt navigation.
3. Rebuilt Overview, Opportunities, Applications, People, and sign-in page compositions.
4. Refined Knowledge, Operations, Outreach and Conversations to the same shared hierarchy; grouped monitoring and separated entry forms from history.
5. Added responsive breakpoints, keyboard focus, skip navigation, source/error states, and reduced-motion support.

## Verification evidence
- GitHub Actions `Python and PostgreSQL Tests` workflow run **42838043758** (commit `941898956`) completed successfully; included dashboard behavior tests, TypeScript typecheck and Next.js build.
- A subsequent commit includes the final communication/operations layout; use its latest run to verify before merging.
- Static JSX/CSS source review performed across changed routes and components.
- No browser screenshots, assistive technology walkthrough, keyboard-only interaction test, 200% zoom check, or live production smoke test were executed in this session.
- Vercel reported a preview failure due to its deployment build-rate limit. This is **not** evidence of a Next.js compilation failure.

## Pre-merge acceptance
- Confirm latest GitHub Actions web-tests job is green.
- Review desktop at 1440px and tablet/mobile at 768px and 375px; include 200% zoom and 320px reflow.
- Verify keyboard: skip link, nav, filters, evidence toggle, form labels and async feedback.
- Verify signed-in flows with real data: discover, inspect evidence, generate batch, save application, draft, record reply and operations source actions.
- Reconcile concurrent infrastructure-agent changes to main before merging this PR.

## Scope boundary
This work touches UI files and design documentation only. No API implementation, Supabase authorization policy, worker, migration, or delivery logic is changed.

## Follow-up remediation — November 10, 2026

An additional source-level review and GitHub CI pass identified and addressed:

- **Mobile navigation discoverability:** the original horizontally scrollable link row hid navigation choices. A labelled expand/collapse menu now presents all eight destinations, has a clear active state, and supports Escape-to-close with button focus restoration.
- **Evidence panel race:** rapid selection of different jobs could render the earlier request's data in the currently selected panel. Each request is now sequence-guarded; closing invalidates in-flight results and restores focus to the evidence trigger.
- **Filter completeness:** exposed an explicit Ineligible category and conservatively assigns all unknown/pending statuses to Needs verification, without upgrading them to eligible. Added four Node regression tests for categorization and search behavior.
- **Type safety regression:** new JavaScript filter initially caused unknown inferred row types (GitHub web job failed at commit 282a0a95). Fixed in commit a9172efd; GitHub CI run 42839861073 completed successfully.
- **Small-text contrast:** measured lighter small-text colors and increased contrast of labels, hints, table headings, placeholder and navigation text.
- **Missing external URLs:** link actions now render unavailable text instead of broken or unsafe-protocol destinations.
- **Application setup:** exposes loading, failure, and empty-discovery states; does not let an unavailable job list submit.
- **Recoverability:** shared request failure notice now supports a user-triggered Try again action, wired to Overview, Opportunities, Applications, and People.

### Verified versus still outstanding

- Verified through GitHub Actions on commit a9172efd (run 42839861073): Node tests (including eligibility filters), TypeScript typecheck and Next.js build.
- Later recovery-action and stylesheet commits require successful final-head GitHub CI before merge. Do not infer success from earlier commits.
- No authenticated browser screenshot capture or real keyboard/screen-reader walkthrough could be performed in this session. Vercel's preview build rate limit remains an external deployment constraint. This is a documented **remaining QA gate**, not a confirmed defect fixed by code review.
- Changes must remain unmerged until those final gates and concurrent infrastructure compatibility are checked.
