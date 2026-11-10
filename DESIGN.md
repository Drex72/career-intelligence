# Career Intelligence — product interface

## Intent
A calm, credible operating workspace for evaluating real career opportunities, tracking applications, collecting hiring evidence, and managing authorized outreach. This is **an operational product**, not a marketing landing page. Source provenance and eligibility accuracy must remain obvious.

## Direction
Light, crisp, editorially restrained, high-information-density when displaying records. The accent is reserved for interactive navigation, focus, and primary actions; never use it to imply that an unverified opportunity is eligible.

## Canonical ownership
- **Runtime tokens:** `apps/web/src/app/globals.css` is the canonical token source. This document mirrors the selected values.
- **Shared navigation:** `apps/web/src/components/Navigation.tsx`.
- **Shared tables, status indicators, and async notices:** `apps/web/src/components/ResourceTable.tsx`.
- **Auth/data access:** Preserve the existing Supabase and API layers. A visual redesign must not invent records, eligibility signals, success statuses, or mutate the authorization lifecycle.
- **Locales:** English; dated batch labels use the existing Lagos-local implementation.

## Color tokens
| Role | Token | Value |
| --- | --- | --- |
| Canvas | `--bg` | `#f7f8fa` |
| App rail and surfaces | `--sidebar`, `--panel` | `#ffffff` |
| Tinted surface | `--panel2` | `#f3f5f7` |
| Subtle border | `--border` | `#e5e9ee` |
| Primary ink | `--text` | `#18232f` |
| Secondary ink | `--muted` | `#627181` |
| Interactive blue | `--accent` | `#245b91` |
| Action tint | `--accent-soft` | `#e9f1fa` |
| Error | `--danger` | `#b53d42` |
| Positive evidence | `--success` | `#246b4c` |

## Type and composition
System-compatible Inter stack; medium-weight body text, tightly tracked headings, tabular figures. Tall navigation rail on desktop and horizontally scrollable navigation on narrow screens. Generous page gutters, compact table rows with readable labels, 14px surface radii, hairline borders, almost imperceptible elevation.

## Behavioral contract
1. **Evidence first:** Verified eligible is distinct from likely/unverified. Do not visually promote unverified opportunities as eligible.
2. **Pending/empty/failure:** Render real loading/error/empty states. Never show placeholder data as if it were live.
3. **Actions:** Preserve explicit consent for sending and state-changing operations. Labels describe real capabilities.
4. **Navigation:** Indicate route with `aria-current`; nested pages keep their parent active.
5. **Accessibility:** Meaningful contrast, visible keyboard focus, native semantic controls, reduced-motion support.
6. **Responsive:** No page-level horizontal clipping; wide data tables may scroll within their own region. Mobile nav remains available without hiding destinations.
7. **Production isolation:** UI-only branches must not modify backend workers, database migrations, secrets, or service authorization.

## Review checklist
Check Overview, Opportunities, Applications, Agent operations, Login, and one empty/error state at desktop and narrow-mobile widths. Verify that filtering, form submission, navigation, source links, and action feedback remain functional. Run Next.js build/type checks and a visual browser pass before production merge.
