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

- People and clubs are first-class entities.
- Public profiles are searchable even when unclaimed, but they must be clearly labeled as unverified/community-submitted.
- Customization target is polished link-page builder flexibility, not raw HTML/CSS.
- Club collaboration basics should not be paywalled by default.
- Paid tiers should lean toward premium customization, unlocks, and deeper insights.

## Club management rule

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

## Process rule

- Manage PR review and recycle loops as a normal part of delivery.
- Parallelize through multiple OpenCode sessions when it materially helps.
- Do not overcomplicate workflows with subagents unless there is a clear payoff.

## Documentation rule

- Docusaurus docs are the human+agent source of truth.
- Skills should stay thin and mostly route to canonical docs.
- Update docs when behavior, architecture, workflows, or policies change.

## Testing rule

- Favor layered verification: lint, typecheck, unit, integration, e2e, visual, and policy checks where appropriate.
- If UI changes, include visual confidence work.
- If billing, permissions, or verification logic changes, prefer stronger automated coverage.
