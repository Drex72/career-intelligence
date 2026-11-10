# Career Intelligence — UI component architecture and evidence-driven visualization plan

Date: 2026-11-10
Status: proposed; implementation choices pending verification
Target: `apps/web` Next.js 16, React 19; plain CSS; **no Tailwind, Radix, Recharts or TanStack dependencies currently installed**.

## Research / reference components

- [AICSS](https://www.aicss.dev/): agent-conversation output widgets, tool states, approval cards, data tables and reasoning progress. Apply only when an actual agent activity or approval experience exists.
- [Radix Themes](https://www.radix-ui.com/themes/docs/components): accessible React controls (Dialog, Alert Dialog, Card, Tabs, Select, Badge, Tooltip, Text Field, Button, Callout, Avatar). Recommended base component library because the app currently uses plain CSS, not Tailwind.
- [TanStack Table](https://tanstack.com/table/latest): headless sorting, filtering, pagination, row selection and column visibility. Relevant for discovery and tracked records.
- [Recharts](https://recharts.org/): chart layer for *actual* distributions and timestamps, paired with a visible summary/table and text description.
- [Tremor](https://www.tremor.so/): accessible dashboard components including trackers, data bars and charts, but Tailwind-dependent. Use only if the app later adopts Tailwind/shadcn; do not load two competing design systems.
- [shadcn/ui](https://ui.shadcn.com/): viable alternative if Tailwind is explicitly selected; the repo lacks Tailwind, so this is a larger migration. Avoid mixing shadcn and Radix Themes as visual foundations.

## Route-to-component decision map

| Route | Primary job | Useful components | Chart? | Data available today | Data not available yet |
| --- | --- | --- | --- | --- | --- |
| Overview | Decide next action | Insight / KPI cards, recommendation data table, prominent current-batch status, action list | **No invented trajectory**; optional application-stage distribution after fetching applications | `metrics`: companies, jobs, delivered, applications; `batches/{date}`: delivered jobs | Historical match %, job growth rates, time-series profile strength |
| Opportunities | Explore and verify | TanStack data table with search, filters, sort, pagination, row details; Radix Dialog/Drawer for evidence; statuses, source links | Optional **eligibility breakdown** bars, derived from loaded `jobs`; show count and denominator | `jobs`: eligibility, title, company, date, score, source, expiry reason; job evidence endpoint | Historical hiring trend, salary analytics |
| Applications | Track progression | Application-stage bar chart + tabular stage counts, row actions, Radix Select, form validation, progress timeline per application | **Yes**: distribution of current stages from `applications` data. No fabricated conversion-rate history | `applications`: status, job, applied_at | Per-stage transition timestamps; stage duration statistics |
| People | Research contacts | Searchable cards, Avatar fallback, verification Badge, source/identity evidence Dialog | Generally **no**; individual people are not a useful chart dimension | `people`: names, companies, titles, verification, profile links | Engagement scores, social graphs |
| Outreach | Create and review drafts | Split form + draft preview Dialog, Draft Badge, disabled/confirmation states | **No**; drafts are content, not a metric | `outreach`: subject, body, status | Sent/reply rates if sending is disabled |
| Conversations | Record responses | Timeline / activity feed, source citation card, reply classification badges, evidence field | Only when time-stamped history is sufficiently complete | `conversations`: event_type, occurred_at, evidence | Verified cross-employer conversion funnel |
| Operations | Monitor jobs and approve sources | Worker run timeline, task-state tracker, queue table, Radix AlertDialog for destructive/reject decision, AICSS Approval Card for agent proposals | **Yes**: task-state distribution from `operations.states`; a per-run source breakdown only for actual returned run details | `operations`: states, delivery, workerRuns; `sources`, `source-candidates`, `eligibility-queue` | Latency SLA timeseries and fabricated agent accuracy |
| Knowledge | See approved documents | Data table with file identity, visibility Badge, revision metadata, sync guidance, source citation cards | **No**; avoid arbitrary document-type pie charts | `knowledge`: document path, visibility, git SHA, updated_at | Semantic coverage / personal skill gap scores |

## Canonical examples and acceptance criteria

### Application-stage distribution
Use real `applications[].status` values. Count each stage, display a labelled stacked or horizontal bar with explicit integer counts and a screen-reader-accessible table. Guard zero records with a purposeful empty state. This represents *current status only*, not a conversion funnel over time.

### Opportunity eligibility distribution
Use only `jobs[].eligibility` and keep `eligibility_expired`/unknown/pending visibly distinct. Count and label every segment. Never imply a job is eligible from a color or a stale assessment. Do not show a rate without a meaningful denominator.

### Operations state tracker
Use `operations.states` for a labelled horizontal bar list or compact tracker. Source metrics per worker run should include Remotive, Himalayas, ATS, reviewed, matched, candidate and failed counts only when present. Mark absent metrics as unavailable rather than fabricated zeros when appropriate.

### Evidence review dialog
Replace floating ad hoc evidence section with accessible Radix Dialog only after checking selection, focus trapping, screen-reader title, Escape close, and stale-request cancellation. Maintain link to official evidence and show dates/expiry/assessment reason prominently.

### Source approval card
AICSS approval card fits the moment the agent proposes a new ATS source. The user must explicitly approve/reject with human action. The controls call the **existing** `source-candidates/decision` API; never silently approve.

## Base system choice

**Recommended incremental stack:** Radix Themes for accessible components + TanStack Table for data grids + Recharts for real-data charts; optional AICSS only on agent-facing workflows.

Because the project currently only has Next.js, React, and Supabase runtime dependencies, installing and introducing these packages requires a tested `package-lock.json` update and GitHub Actions `npm ci` check. Do not edit package.json alone and break reproducible builds. A future migration to shadcn/Tailwind should be an explicit alternative, not mixed into this implementation.

## Phased rollout

1. Foundations: documented tokens, Radix Theme provider, button/card/badge/callout/form conventions, accessible states. Run typecheck/build and keyboard verification.
2. Opportunities: TanStack Table and evidence Dialog; test filters, sort, focus, stale response, 320px scroll behavior and expired eligibility.
3. Applications + Overview: Recharts current-stage distribution derived from live records; accessible counts/table and empty states.
4. Operations: task-state bar list, worker-run timeline and source approval cards with explicit confirmation.
5. People, Outreach, Conversations, Knowledge: add source detail overlays, draft preview, conversation timeline and consistent table where justified.
6. Optional agent activity: AICSS for live tool/approval/result surfaces if real progress events exist.

## Anti-patterns

- Do not add a line graph without dated history; a trend-looking graphic with one current value is deceptive.
- Do not render every object as a Card or use charts as decoration. Maintain compact tables for many comparable records.
- Do not show invented % changes, applicant scores, task completion rates, worker outcomes or company claims.
- Do not allow decorative components to override eligibility provenance, owner gating, or manual outreach controls.
- Do not install Radix Themes and shadcn/Tremor simultaneously as competing foundations.
- Use accessible contrast, controls, focus order, reduced-motion and readable fallback tables for every visualization.

## Verification

This is a **design analysis and component selection plan**, not proof that the libraries are installed, integrated or browser-tested. Existing implementation remains functional until incremental component migrations are built and verified.
