# Career Intelligence — product interface

## Intent
A calm, credible operating workspace for evaluating real career opportunities, tracking applications, collecting hiring evidence, and managing authorized outreach. This is **an operational product**, not a marketing landing page. Source provenance and eligibility accuracy must remain obvious.

## Direction
Light, warm, colorful and editorially restrained, with information density appropriate to each workflow. A deep-indigo navigation rail anchors the interface; lavender surfaces, peach, mint and soft-blue cards help distinguish tasks. Violet is used for actions and focus, never to imply that an unverified opportunity is eligible.

## Canonical ownership
- **Runtime tokens:** `apps/web/src/app/globals.css` is the canonical token source. This document mirrors the selected values.
- **Shared navigation:** `apps/web/src/components/Navigation.tsx`.
- **Shared tables, status indicators, and async notices:** `apps/web/src/components/ResourceTable.tsx`.
- **Auth/data access:** Preserve the existing Supabase and API layers. A visual redesign must not invent records, eligibility signals, success statuses, or mutate the authorization lifecycle.
- **Locales:** English; dated batch labels use the existing Lagos-local implementation.

## Identity and color tokens
The brand symbol is an original compass/signal shape, in violet and amber: `apps/web/public/brand-mark.svg`. Use that SVG as the navigation mark, login identifier, and favicon.

| Role | Token | Value |
| --- | --- | --- |
| Lavender canvas | `--bg` | `#F8F6FC` |
| Indigo navigation | `--sidebar` | `#251F45` |
| Surface | `--panel` | `#FFFFFF` |
| Tinted surface | `--panel2` | `#F0ECFC` |
| Subtle border | `--border` | `#E8E3F1` |
| Primary ink | `--text` | `#24203C` |
| Secondary ink | `--muted` | `#605A78` |
| Action violet | `--accent` | `#7052D7` |
| Action tint | `--accent-soft` | `#EDE7FC` |
| Peach | `--peach` | `#FFE4DB` |
| Lilac | `--lilac` | `#EDE4FF` |
| Mint | `--mint` | `#E1F4EE` |
| Warm sunlight | `--sun` | `#FFF0D7` |

## Typography and composition
- **Plus Jakarta Sans** for expressive but restrained headings, strong display numerals and actions.
- **DM Sans** for legible body copy and dense functional text.
- Fonts use CSS-hosted Google Fonts with a local system fallback. If offline or the font service is blocked, the interface remains readable.
- A dark navigation rail contrasts with the warmer content region. Metric tiles alternate between pastel violet, mint, peach and blue. Use color to separate information types, not to suggest fabricated health/success.
- Avoid all-white page compositions. Reserve pure white for focused input/table surfaces, balanced against a tinted page canvas and supporting accent surfaces.
- Navigation becomes an explicit expandable menu on narrow screens. Tables scroll in their own region; all destinations stay accessible.
- Keep semantic status colors for eligibility and errors regardless of the decorative palette.

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
