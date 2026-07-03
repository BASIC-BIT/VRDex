---
name: vrdex-feature-design
description: Use for large VRDex feature-design work that needs product, UX, infrastructure, cost, security, provider, and implementation planning before coding.
compatibility: opencode
metadata:
  audience: maintainers
  domain: product-architecture
---

## Goal

Run a complete VRDex feature-design loop before large implementation work.

## Read First

- `AGENTS.md`
- `docs/agentic/feature-design-loop.md`
- `docs/planning/README.md`
- Relevant feature docs under `docs/planning/`
- Relevant backend/deployment docs under `docs/backend/`, `docs/deployment/`,
  and `docs/developers/`

## Workflow

1. Read the existing repo docs and issue context.
2. Research provider and ecosystem constraints from primary sources when
   possible.
3. Use cross-codebase or comparable-product research when it can reveal durable
   patterns.
4. Capture operator/user interview notes separately from verified facts.
5. Label conclusions as locked decisions, current recommendations, candidate
   directions, interview-later items, or open research.
6. Consider UX, infrastructure, cost, security, permissions, self-hosting,
   rollout, and marketability together.
7. Define a validation checkpoint when the feature is large enough that `v0.9`
   learning should happen before `v1` merge-ready scope.
8. For meaningful UI work, produce screenshot evidence and use visual review
   before calling the design complete.
9. Write durable docs before implementation so decisions do not live only in
   chat.
10. Split the result into fewer, larger implementation-ready issues or PR
    slices.

## Guardrails

- Do not promise provider behavior that has not been verified.
- Do not treat one interview example as universal product policy without
  validation.
- Do not expose implementation uncertainty as user-facing copy.
- Do not let a massive future vision block the smallest useful shippable slice.
- Do not let a validation checkpoint silently become the final shipped scope.
- Keep public pages calm, direct, and owner-centered.
- Preserve escape hatches for operator workflows that can fail during live
  events.
- Use parallel subagents for separable research or blind review only when the
  payoff justifies the context cost.
- Ask before changing global/shared skills or other global OpenCode
  configuration.

## Outputs

- Planning doc or ADR.
- Research checklist with confidence or disposition.
- Interview notes separated from verified provider facts.
- Open research and human clarification questions.
- Suggested issue slices.
- UI screenshot/VLM review plan when applicable.
- Docs updates for changed architecture, behavior, provider contracts, or
  workflow.
