# Definition of Ready

## Status note

This document is the canonical repo-level definition of ready for feature work.

Use it before starting non-trivial implementation so contributors and agents do not skip rollout, verification, or success-thinking by accident.

## Locked decision

- non-trivial feature work should have a documented ready check before implementation starts
- trivial fixes should not be forced through heavyweight ceremony
- definition of ready does not replace issue acceptance criteria; it complements them

## Current recommendation

- keep the checklist short enough to be used consistently
- make it easy to paste into GitHub issues, planning docs, and agent handoff notes
- require explicit `not needed` reasoning when rollout, feature flags, analytics, or reviewer expectations do not apply

## When the full checklist applies

Use the full ready check for work that is meaningfully feature-like, risky, or cross-cutting.

Common examples:

- new user-facing behavior or workflows
- schema, permissions, billing, or trust-model changes
- features that may need staged rollout or a kill switch
- work that needs non-obvious verification beyond a quick local check
- issues likely to involve review-recycle loops or human validation artifacts

## Lightweight path for trivial work

Do not require the full ready check for small changes where extra process would be pure drag.

Common examples:

- typo, copy, or formatting fixes
- narrow docs cleanup with no policy change
- tiny refactors with no behavior change
- obvious broken-test or lint fixes where intent is already clear

If a change starts looking larger during implementation, promote it back to the full checklist.

## Canonical checklist

For non-trivial work, the issue or spec should answer these points before implementation begins:

1. Problem statement is clear.
2. Scope and non-goals are clear.
3. Dependency position is clear.
4. Verification plan is clear.
5. Rollout or feature-flag plan is clear when appropriate.
6. Analytics or success-signal plan is clear when appropriate.
7. Reviewer, recycler, or human-validation expectations are clear when appropriate.

## What good answers look like

### Problem statement

- explain the user or system problem being solved
- say why now if timing matters

### Scope and non-goals

- define what this issue will do
- define what it will intentionally not do so the slice stays shippable

### Dependency position

- link hard blockers and relevant soft dependencies
- say whether the issue can proceed now or should wait on another decision

### Verification plan

- name the expected checks before the work is called done
- be specific enough that a contributor can tell what evidence is required
- include stronger validation for risky areas like permissions, billing, trust, or UI

### Rollout or feature-flag plan

- say whether the feature ships directly, behind a flag, or via staged rollout
- if no flag is needed, say why that is acceptable

### Analytics or success-signal plan

- say how we will know the feature is useful or healthy
- if formal instrumentation is unnecessary, say what simpler signal is enough
- until issue `#46` is resolved more fully, a brief placeholder plan is acceptable if it is explicit

### Reviewer, recycler, or human-validation expectations

- say whether normal review is enough or whether the work needs extra reviewer/recycler attention
- call out screenshot, video, or manual validation expectations for UI-heavy changes

## Issue template snippet

Use this block in non-trivial feature issues:

```md
## Definition of ready

- Problem: <clear problem statement>
- Scope: <what this issue will do>
- Non-goals: <what this issue will not do>
- Dependencies: <hard blockers, soft dependencies, or "none">
- Verification: <tests, checks, screenshots, manual validation>
- Rollout: <direct ship, feature flag, staged rollout, or "not needed" with reason>
- Signals: <analytics, success signals, or "not needed" with reason>
- Review notes: <normal review, extra recycler/reviewer loop, human validation artifacts, or "not needed">
```

## Workflow rule

- if a non-trivial issue is missing ready information, fill the gap before implementation rather than carrying ambiguity forward
- if the work is already underway and the ready check is missing, backfill it as early as possible
- if a supposedly trivial task grows into feature work, stop and add the ready block

## Relationship to other docs

- `docs/agentic/definition-of-done.md` defines what must be true before non-trivial work is called finished
- `docs/planning/engineering-strategy.md` explains why VRDex wants this discipline
- `docs/agentic/software-factory.md` places it in the wider review, recycle, and orchestration model
- contributor and onboarding docs should link here instead of redefining the checklist in multiple places
