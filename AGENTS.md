# AGENTS.md

This file provides repo-level guidance for agents working on `VRDex` planning and, later, implementation.

## Repo at a glance

- `VRDex` is a VRChat-first identity, profile, and events platform for people and communities.
- The product is open-source, self-hostable, public-docs-first, and intentionally opinionated toward agent-first software-factory delivery.
- Current stack direction is `Next.js + TypeScript + Convex + AWS + Stripe + Docusaurus + Vercel`.
- Locked `v0.5` auth target is Discord, Google, and email/password, with verified email required before claim-level actions.
- Current application/backend default is `Convex`.

## Product posture

- `VRDex` is ambitious, but the job is to turn ambition into shippable slices.
- Preserve the larger vision while pushing toward realistic versions that can launch.
- When a simpler design is sufficient for v1, recommend it clearly.
- Do not silently convert speculation into policy; label assumptions honestly.
- Treat `docs/planning/product-direction.md` as the durable product compass for what VRDex is trying to be, where the current niche lies, and how product-facing work should be shaped.

## Decision labeling

Prefer explicit labels in docs:

- `Locked decision`
- `Current recommendation`
- `Candidate direction`
- `Interview later`

## Core product direction

- People and communities are first-class entities.
- Public profiles are searchable even when unclaimed, but they must be clearly labeled as unverified/community-submitted.
- Customization target is polished link-page builder flexibility, not raw HTML/CSS.
- Community collaboration basics should not be paywalled by default.
- Paid tiers should lean toward premium customization, unlocks, and deeper insights.

## Community management rule

- Support ownership, ownership transfer, staff roles, and pragmatic permissions.
- Do not jump straight to a giant Discord-sized permission matrix.
- Treat `owner` as the special singleton role.
- Prefer familiar starter roles like `admin` and `mod`.
- Avoid assuming every non-owner role must stay permanently hard-coded.
- Start with a small capability set unless real usage proves the need for more.

## UI rule

- GPT should still attempt UI work.
- For meaningful UI changes, require a visual verification loop.
- Use screenshot evidence and VLM review before declaring UI work complete.
- Aim for slick, intentional design, not generic boilerplate.
- Prefer calm, minimal, trustworthy UX over noisy spectacle.
- Prefer shared design-system primitives and tokens over one-off Tailwind bubbles; if the shared primitive does not exist yet, keep new styling easy to promote into one.
- Default borders and controls to subtle radii; avoid pill/bubble shapes unless the design purpose is explicit.
- Cut AI-generated explanatory copy. Prefer crisp labels, direct data presentation, and intuitive structure over paragraphs describing every surface.
- Avoid redundant eyebrow/kicker labels above obvious headings, especially inside cards and public content sections. Use them only when they add new orientation that the heading, navigation, or layout cannot already provide.
- Do not expose implementation uncertainty as user-facing copy. Avoid phrases about adapters, provider checks, internal verification mechanics, or what VRDex cannot yet do unless the user must act on that detail.
- Keep public profile and event pages owner-centered. Do not fill hero space with slugs, disclaimers, trust essays, or explanatory filler; use minimal metadata and let creator/community content carry the page.
- Use badges sparingly. Do not use badges as the default way to show slugs, status, taxonomy, or reassurance; prefer plain text, layout, and hierarchy first.
- Contextual surfaces should appear only when they match the moment. A watch surface belongs to an event that is currently watchable, not every event that happens to have a stream link.
- Time displays should feel seamless. Public event schedule times should render in the viewer's local timezone across the app, including event cards, event pages, and set times; do not show a separate canonical event-timezone value or a duplicate "Your time" line unless the user explicitly needs timezone-authoring context.

## Public product copy rule

- Status: locked decision. BASIC approved this wording on 2026-07-27.
- Use `VR Johnny` as BASIC's internal tone-risk stress test: a stand-in for one ordinary VR-community user who may reject copy that feels corporate, patronizing, AI-promotional, AI-generated, or slop-like. It is not a demographic category, observed evidence, or a claim that all VR users react alike.
- Every substantive new word of public-facing product or website prose must be evaluated through the VR Johnny lens.
- Obvious one- or two-word utility labels and exact strings matching an already-approved pattern may proceed. When in doubt, treat copy as reviewable.
- New taglines, marketing copy, onboarding or help prose, explanatory cards, empty-state prose, profile or media-kit guidance, and other authored sentences require BASIC's review of the exact copy before shipping unless BASIC already approved that exact copy.
- Do not foreground or mention AI to users without explicit owner direction.
- Never use an em-dash (`—`) in public-facing copy. Locked decision: BASIC ruled this on 2026-08-05. A double hyphen (`--`) is not a substitute and is equally banned; a single hyphen (`-`) is fine where a hyphen is what you actually want. Reach for another device instead: split the sentence, use a colon for a reveal, a comma for an aside, or parentheses for a true digression. This is about the glyph in copy only, not code comments or engineering prose.
- Fable and blind review may improve a draft but cannot substitute for BASIC's approval.
- Preserve existing approved copy unless a task has a concrete reason to change it. Do not invent explanatory prose because a layout has space.
- This rule applies to public-facing product copy. It does not apply to code, tests, internal engineering prose, accessibility names that must be explicit, or required safety and legal text.
- A task that changes public prose must show the exact proposed wording in its handoff and identify BASIC's approval before shipping.
- `VR Johnny` can veto or simplify tone; it cannot be cited as evidence for adding, prioritizing, or designing features.

## Repo opinionation

- This repo is intentionally opinionated toward software-factory principles and agent-first delivery.
- Safe, non-destructive progress should continue by default; do not treat intermediate summaries as a stop point.
- If the user intent is clear and the step is ship-safe, continue to commit and push without asking again.
- Ask before pushing only for risky/destructive/security/billing posture changes, or when the user explicitly asks to hold.

## Infrastructure and environment rule

- Prefer infrastructure-as-code or checked-in configuration for infrastructure, CI settings, and environment variable definitions whenever the platform supports it.
- Especially avoid undocumented dashboard-only environment variables; if a secret value must stay in a provider secret store, commit the expected variable name, scope, owner, and rotation/recreation path.
- Manual provider changes are acceptable only as a bootstrap or emergency step, and should be followed by docs, scripts, Terraform, or workflow changes that make the desired state reproducible.

## Global vs local agent context

- Put repo-wide defaults, durable workflow rules, and opinionated project conventions in `AGENTS.md`.
- Put personal operator preferences in `AGENTS.local.md`, which is gitignored and should never be treated as repo policy.
- Keep onboarding-heavy material out of `AGENTS.md` when it is only needed occasionally; prefer a skill or canonical docs page for that.

## Process rule

- Manage PR review and recycle loops as a normal part of delivery.
- Before pushing a follow-up commit on an open PR, triage every outstanding PR review comment.
- For each addressed PR review comment, leave a reaction or reply with the disposition, then resolve the thread before pushing.
- Do not silently resolve review comments; if a comment is rejected or only partially applied, say why in the thread.
- PR descriptions should not list routine branch-policy verification every time; include only non-obvious, manual, risk-specific, or otherwise useful verification notes beyond the checks required for merge.
- Keep issue and PR updates focused on decisions, evidence, blockers, and next actions. Omit defensive boilerplate such as assurances that no secrets, credentials, or unrelated changes were included unless that fact is necessary to explain a security incident or remediation.
- When a final message reports PR readiness, cleanliness, green checks, mergeability, or review readiness, include the PR URL.
- Parallelize through multiple OpenCode sessions when it materially helps.
- Do not overcomplicate workflows with subagents unless there is a clear payoff.
- Prefer fewer, larger, independently testable issues over deeply nested issue trees.
- Avoid tracking hell; split only when it materially improves execution or review.
- When agent behavior is annoying or underspecified, finish the current task, then capture the improvement in repo docs/issues before moving on.

## Documentation rule

- Docusaurus docs are the human+agent source of truth.
- Keep most durable markdown under `docs/` instead of letting the repo root sprawl.
- Skills should stay thin and mostly route to canonical docs.
- Update docs when behavior, architecture, workflows, or policies change.
- Avoid docs drift as part of every PR: while editing code/config/tests, actively look for docs that need the same update and patch them alongside the implementation, not as an afterthought.
- Before pushing a PR update, check whether changed behavior affects public docs, developer docs, engineering docs, deployment docs, skills, README files, or issue-linked planning docs.

## Testing rule

- Favor layered verification: lint, typecheck, unit, integration, e2e, visual, and policy checks where appropriate.
- If UI changes, include visual confidence work.
- If billing, permissions, or verification logic changes, prefer stronger automated coverage.
- Prefer video/screenshot evidence when asking the human to validate a nearly-mergeable feature.

## Onboarding rule

- Use the repo onboarding skill and docs for infrequent setup/orientation work.
- If a human says an agent is new here, load the onboarding material instead of bloating every normal session with introductory instructions.
