# Feature Design Loop

## Status

Current recommendation for repeatable feature-design work in VRDex. This doc is
intended to back a repo-local AI skill and, if it proves broadly reusable, a
future shared OpenCode skill.

## Purpose

Large VRDex features often need the same loop:

- research the ecosystem and constraints
- gather operator/user interview notes when the feature depends on real workflow
  nuance
- capture product decisions and open risks
- design user experience, infrastructure, security, scalability, cost, and
  business model together
- produce screenshots or mockups for meaningful UI surfaces
- use visual review and human guidance before treating UI as done
- turn the result into implementation-ready issues

This document keeps that loop durable so it is not reinvented in chat every
time.

## When To Use

Use this loop for features that affect more than one of:

- core product strategy
- public UX
- infrastructure or provider dependencies
- cost or billing exposure
- permissions, secrets, or compliance
- integrations with Discord, VRChat, AWS, Stripe, PostHog, VRCDN, or other
  providers
- operator workflows during live events
- features intended to become marketable product value

Skip it for narrow bug fixes, small copy edits, and already-scoped
implementation issues.

## Required Lenses

For a substantial feature, explicitly consider:

- user value and marketability
- simplicity and adoption friction
- UX flow and visual design
- data model and source-of-truth boundaries
- infrastructure and scalability
- cost controls and unit economics
- security, permissions, secrets, and audit logs
- provider terms and operational constraints
- self-hosting and infrastructure-as-code posture
- public docs, developer docs, and support/operator docs
- observability and failure modes
- test strategy, visual verification, and rollout controls

## Workflow

1. Read existing repo docs and issue context.
2. Research external provider docs and ecosystem behavior from primary sources
   where possible.
3. Pull examples from comparable products or codebases when the feature has an
   ecosystem analogue.
4. Ask for operator/user context when real-world workflow details are likely to
   beat assumptions.
5. Separate locked decisions, current recommendations, candidate directions,
   interview-later items, and open research questions.
6. Define the smallest useful slice, but keep future compatibility constraints
   visible.
7. Add a checkpoint version when useful, such as `v0.9` for validation and `v1`
   for merge-ready completeness.
8. Sketch or implement UI enough to put a screenshot in front of the human when
   UX matters.
9. Review screenshots with a VLM or visual inspection loop before calling UI
   complete.
10. Capture the architecture, UX, cost, security, and business implications in
    docs.
11. Split follow-up work into fewer, larger, independently testable issues.
12. Update skills or agent docs only when the workflow is repeatable beyond one
    issue.

## Decision Labels

Use the repo's normal labels:

- `Locked decision`
- `Current recommendation`
- `Candidate direction`
- `Interview later`

## Research Rules

- Prefer official provider docs, product docs, and public ecosystem sources.
- Preserve source boundaries and note when a conclusion comes from community
  reports rather than official docs.
- Do not turn one observed example into deterministic product policy unless it
  reveals a stable named rule.
- If a provider's terms or technical API do not clearly support a workflow, mark
  it as open research instead of promising it.
- Use parallel research only when the questions are separable and the payoff
  exceeds the context overhead.
- Bring research back as decisions, recommendations, explicit risks, or
  checklist items. Do not leave source dumps as the only output.

## Interview Notes

When the feature depends on lived operator behavior, capture human notes
separately from verified facts.

Use this shape:

- `Observed workflow`: what the human says people currently do.
- `Implication`: what that suggests for product design.
- `Risk`: what might be false, local to one community, or provider-dependent.
- `Follow-up`: what needs research, user testing, or a prototype.

Do not convert one user's workflow into universal policy without a named general
rule or follow-up validation.

## Cross-Codebase Research

Use this when a feature has analogues in other products, OSS repos, or prior
BASIC-BIT projects.

- Search for durable patterns, not code to cargo-cult.
- Note what problem the other project solved and what context differs from
  VRDex.
- Prefer architecture, validation, and failure-handling lessons over UI mimicry.
- Keep findings in planning docs unless the pattern is ready to become a repo
  rule or skill.

## Checkpointing

For large features, define a validation checkpoint before the merge-ready
version.

- `v0.9`: enough real behavior to test direction, watch output, gather operator
  feedback, or validate risk.
- `v1`: complete enough to merge as product behavior, with transitions, docs,
  failure paths, and verification aligned to the feature's risk.

The checkpoint should reduce uncertainty without silently becoming the final
shipped scope.

## Token and Failure-Mode Rules

- Keep durable conclusions in docs, not chat transcripts.
- Use subagents for fanout research or blind review, not as a default way to
  avoid thinking.
- Summarize subagent results into bounded deltas before patching docs.
- Avoid expanding a feature with speculative requirements just because research
  surfaced possibilities.
- If the design loop starts generating a giant issue tree, regroup into fewer
  logical buckets.
- Stop and ask the human when the next step changes global policy, billing
  posture, provider commitments, or public disclosure boundaries.

## UX Rules

- Aim for a delightful operator path, not broadcast-engineering complexity
  exposed as UI.
- Avoid explanatory filler on public pages.
- Keep implementation uncertainty out of viewer-facing copy.
- Keep emergency actions obvious and reversible where possible.
- For public/event pages, let creator and community content carry the page
  instead of trust essays or disclaimers.

## Output Shape

A completed planning pass should usually produce:

- a planning doc or ADR
- updated product/architecture docs when needed
- a short open-question list for the human
- a research checklist with confidence or disposition for each major dependency
- issue-ready implementation slices
- a note about skipped or deferred risks
- screenshots or mockups when UI direction matters

When the resulting implementation is large enough to benefit from local parallel
worktrees, hand off to `docs/agentic/parallel-worktree-delivery.md` instead of
inventing a new coordination pattern in chat.

## Skill Promotion Path

Current recommendation:

- Keep the first version repo-local as
  `.opencode/skills/vrdex-feature-design/SKILL.md`.
- If the same loop is useful across multiple repos, promote a generalized
  `feature-design-loop` skill to the shared toolbox.
- Before promotion, research at least a few existing BASIC-BIT planning/review
  docs or feature-design sessions so the global skill reflects recurring
  practice instead of one VRDex restreaming session.
- Before a global/shared promotion, use a human question gate because global
  skill changes affect future sessions beyond VRDex.
