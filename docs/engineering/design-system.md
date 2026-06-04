# Web Design System

## Status

Locked decision: VRDex web uses a small repo-owned Tailwind primitive layer for the application shell, cards, buttons, badges, forms, notices, and tables.

Current recommendation: extend the local primitives in `apps/web/src/components/ui/` before adding one-off Tailwind panels or importing a large component library.

Locked decision: Storybook is an interrelated but separate visual lane from full-route Playwright screenshots. It is designed around individual components and primitives, not the site as a whole.

## Intent

The design system keeps the public app visually consistent while preserving the warm VRDex identity. It should make common surfaces boring to implement: page shells, calm cards, clear actions, compact labels, readable forms, and status displays.

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
- `apps/web/src/lib/cn.ts`: class merging for primitive variants and local overrides.

## Rules

- Prefer shared primitives for pages, panels, buttons, badges, fields, notices, tables, and action cards.
- Use named radius tokens: `rounded-control`, `rounded-card`, `rounded-panel`, and `rounded-hero`.
- Use `shadow-panel` and `shadow-hero` instead of ad hoc arbitrary shadow values.
- Keep `rounded-full` for intentionally pill-shaped badges only.
- Keep new styling easy to promote into a primitive when a pattern repeats.
- Avoid adding Material UI or a broad shadcn dump unless the project explicitly reopens that decision.

## Copy And UX

- Prefer crisp labels and direct data over paragraphs explaining every surface.
- Keep trust states visible: unverified/community-submitted data should remain clearly labeled.
- Use calm, minimal, trustworthy layouts instead of noisy decorative treatments.

## Storybook Lane

Storybook documents and reviews primitives such as buttons, cards, badges, fields, notices, tables, page shells, and action cards.

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

## Review Checklist

- Search for `rounded-[`, `shadow-[`, `rounded-2xl`, and repeated eyebrow classes before opening a PR.
- Run the web typecheck and visual snapshot flows after meaningful UI changes.
- Update visual baselines only when the rendered change is intentional.
