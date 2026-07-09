# Web Design System

## Status

Locked decision: VRDex web uses a small repo-owned Tailwind primitive layer for the application shell, cards, buttons, badges, forms, notices, and tables.

Current recommendation: extend the local primitives in `apps/web/src/components/ui/` before adding one-off Tailwind panels or importing a large component library.

Locked decision: Storybook is an interrelated but separate visual lane from full-route Playwright screenshots. It is designed around individual components and primitives, not the site as a whole.

Current maturity assessment: the web design system now has a stronger
charcoal-neutral semantic token baseline and a Storybook lane for token and
schedule review. It is still not mature enough for broad theme exploration
until the remaining page-specific color treatments are pulled into shared
tokens and primitives.

## Intent

The design system keeps the public app visually consistent while preserving a
calm, data-forward VRDex identity. It should make common surfaces boring to
implement: page shells, calm cards, clear actions, compact labels, readable
forms, status displays, and schedule rows.

## Source Files

- `apps/web/src/app/globals.css`: theme colors, type tokens, radius tokens, and shared shadow tokens.
- `apps/web/src/components/ui/button.tsx`: action variants and shared sizing.
- `apps/web/src/components/ui/card.tsx`: panels, section headings, and eyebrow labels.
- `apps/web/src/components/ui/badge.tsx`: status and taxonomy labels.
- `apps/web/src/components/ui/field.tsx`: labels, inputs, textareas, and field help text.
- `apps/web/src/components/ui/notice.tsx`: inline user-facing status blocks.
- `apps/web/src/components/ui/table.tsx`: table containers and cells.
- `apps/web/src/components/ui/page-shell.tsx`: page background, width containers, nav, and brand link.
- `apps/web/src/components/ui/action-card.tsx`: repeated call-to-action cards.
- `apps/web/src/components/ui/event-schedule.tsx`: compact time-oriented event schedule rows.
- `apps/web/src/lib/cn.ts`: class merging for primitive variants and local overrides.

## Rules

- Prefer shared primitives for pages, panels, buttons, badges, fields, notices, tables, and action cards.
- Prefer semantic color roles such as `background`, `surface`, `surface-strong`,
  `accent`, `danger`, `success`, `warning`, `muted`, `subtle`, and `border`
  over raw color literals.
- Use named radius tokens: `rounded-control`, `rounded-card`, `rounded-panel`, and `rounded-hero`.
- Use `shadow-panel` and `shadow-hero` instead of ad hoc arbitrary shadow values.
- Keep `rounded-full` for intentionally pill-shaped badges only.
- Keep new styling easy to promote into a primitive when a pattern repeats.
- Avoid adding Material UI or a broad shadcn dump unless the project explicitly reopens that decision.

## Token Gaps

Current recommendation: continue maturing the token layer before a major
homepage redesign or multi-theme pass.

Needed tokens and primitives:

- text-role tokens for display, title, section, body, caption, mono metadata, dense table text, and public-card labels
- spacing and size steps for shell padding, compact cards, dense event rows, icon buttons, media thumbnails, and schedule gutters
- layout width and density rules for public pages, operator views, lookup tables, and mobile-first schedule lists
- entity-card primitives for people, communities, worlds, and events
- event schedule primitives that can show local viewer time, set times, host/community, venue/world, watch state, and saved/followed context
- theme presets expressed as token mappings rather than page-specific Tailwind or CSS overrides

Avoid treating one route's CSS as the design system. If a style is useful for Home, event pages, profile pages, and lookup, promote the repeatable piece into tokens or a primitive before copying it.

## Copy And UX

- Prefer crisp labels and direct data over paragraphs explaining every surface.
- Keep trust states visible: unverified/community-submitted data should remain clearly labeled.
- Use calm, minimal, trustworthy layouts instead of noisy decorative treatments.
- For homepage copy, use the taste-review process in `docs/planning/homepage-discovery-direction.md` before treating AI-drafted language as production-ready.

## Storybook Lane

Storybook documents and reviews primitives such as buttons, cards, badges,
fields, notices, tables, page shells, action cards, tokens, and event schedule
rows.

Current scope:

- Add stories for the local primitives before adding page-specific stories.
- Include desktop and narrow/mobile story viewports for components with responsive behavior.
- Keep Storybook screenshot tests wired into CI as a separate component-focused lane.
- Prefer PR-visible changed screenshots for intentional visual changes, either from Storybook screenshots, Playwright route screenshots, or both.
- Keep full-route Playwright screenshots for user-flow confidence; use Storybook screenshots for smaller component regressions.
- Do not replace full-route Playwright baselines with Storybook baselines; route and component visual tests catch different classes of regressions.

Current scripts:

- `pnpm --filter web storybook`: run the component workbench locally.
- `pnpm test:storybook:snapshots`: compare component screenshot baselines.
- `pnpm test:storybook:snapshots:update`: update intentional component screenshot baseline changes.
- `pnpm test:storybook:visual`: capture current component screenshots as Playwright artifacts for review.

## Visual Iteration Workflow

Current recommendation: keep the production source of truth in code-owned
tokens and Storybook until VRDex has a designer-owned Figma file. Once the
component set stabilizes, mirror the semantic token names into Figma variables
and connect Figma components back to React primitives with Figma Code Connect.

- Figma should be used for taste review, component composition, homepage
  mockups, and future shared design review.
- Code should remain the first source of truth for token names, primitive APIs,
  accessibility states, and shipped behavior.
- Figma Code Connect is the right bridge once we have stable components because
  it maps Figma components to actual repository components instead of relying
  on autogenerated snippets.
- Mobbin is useful for pattern research around search, schedule, event, profile,
  and dense dashboard layouts. Treat it as reference material, not as a source
  to copy.
- Storybook stays the implementation review surface: every new primitive should
  have a story before it is depended on by multiple pages.

Reference links:

- [Figma Code Connect](https://developers.figma.com/docs/code-connect/)
- [Mobbin](https://mobbin.com/)
- [Storybook for Next.js with Vite](https://storybook.js.org/docs/get-started/frameworks/nextjs-vite)

## Review Checklist

- Search for `rounded-[`, `shadow-[`, `rounded-2xl`, and repeated eyebrow classes before opening a PR.
- Run the web typecheck and visual snapshot flows after meaningful UI changes.
- Update visual baselines only when the rendered change is intentional.
