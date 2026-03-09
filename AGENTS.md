# AGENTS.md

This file provides repo-level guidance for agents working on `VRDex` planning and, later, implementation.

## Product posture

- `VRDex` is ambitious, but the job is to turn ambition into shippable slices.
- Preserve the larger vision while pushing toward realistic versions that can launch.
- When a simpler design is sufficient for v1, recommend it clearly.
- Do not silently convert speculation into policy; label assumptions honestly.

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

## Repo opinionation

- This repo is intentionally opinionated toward software-factory principles and agent-first delivery.
- Safe, non-destructive progress should continue by default; do not treat intermediate summaries as a stop point.
- If the user intent is clear and the step is ship-safe, continue to commit and push without asking again.
- Ask before pushing only for risky/destructive/security/billing posture changes, or when the user explicitly asks to hold.

## Global vs local agent context

- Put repo-wide defaults, durable workflow rules, and opinionated project conventions in `AGENTS.md`.
- Put personal operator preferences in `AGENTS.local.md`, which is gitignored and should never be treated as repo policy.
- Keep onboarding-heavy material out of `AGENTS.md` when it is only needed occasionally; prefer a skill or canonical docs page for that.

## Process rule

- Manage PR review and recycle loops as a normal part of delivery.
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

## Testing rule

- Favor layered verification: lint, typecheck, unit, integration, e2e, visual, and policy checks where appropriate.
- If UI changes, include visual confidence work.
- If billing, permissions, or verification logic changes, prefer stronger automated coverage.
- Prefer video/screenshot evidence when asking the human to validate a nearly-mergeable feature.

## Onboarding rule

- Use the repo onboarding skill and docs for infrequent setup/orientation work.
- If a human says an agent is new here, load the onboarding material instead of bloating every normal session with introductory instructions.
