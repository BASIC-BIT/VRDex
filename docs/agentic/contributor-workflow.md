# Contributor Workflow

## Status note

This document is the canonical contributor-friendly, agent-compatible workflow for `VRDex`.

It defines the repo's contribution contract without forcing everyone onto one IDE, one agent, or one local setup.

## Locked decision

- `VRDex` cares about output quality, not tool uniformity for its own sake
- contributors may use different agents, editors, and local workflows as long as the repo contract is satisfied
- readiness, verification, docs updates, and review quality are normal parts of delivery, not optional polish
- reviewer and recycler automation should help contributors improve quality, not act as hazing or tool lock-in

## Current recommendation

- use one repo-compatible contribution contract for everyone: humans, agents, maintainers, and outside contributors
- keep the contract explicit enough that newer programmers do not need tribal knowledge to succeed
- be flexible about local workflow and strict about what must be true before work is called ready or done

## The contribution contract

Every meaningful contribution should satisfy these expectations regardless of tool choice:

1. The problem and intended slice are clear.
2. The contributor understands the relevant repo docs before making changes.
3. The work includes required docs updates when behavior, workflow, or policy changed.
4. The work includes appropriate verification evidence.
5. The work can survive normal review and, when needed, recycle or human-validation loops.
6. The contributor leaves behind enough context that the next person does not have to reconstruct intent from scratch.

## Tool flexibility rule

Allowed examples:

- OpenCode, Copilot, Codex, Claude, or mostly manual work
- different editors or local environments
- different prompting styles and private helper workflows

Not acceptable:

- skipping repo docs because a tool guessed well enough
- skipping verification because another agent said it was probably fine
- hiding missing evidence behind vague status language
- forcing maintainers to reverse-engineer what changed and why

## Minimum workflow for non-trivial work

1. Start from a clear issue, spec, or documented task.
2. Use `docs/agentic/definition-of-ready.md` before implementation begins.
3. Implement the intended slice without silently expanding scope.
4. Update canonical docs if behavior, workflow, architecture, or policy changed.
5. Run the appropriate verification and keep the useful evidence.
6. Use `docs/agentic/definition-of-done.md` before calling the work complete.
7. Expect normal review; expect recycle loops or human validation when the work is risky, UI-heavy, or unclear.

## What contributors should read first

- `AGENTS.md`
- `docs/README.md`
- `docs/planning/README.md`
- `docs/agentic/README.md`
- `docs/agentic/definition-of-ready.md`
- `docs/agentic/definition-of-done.md`

Then read the issue-specific and area-specific docs that actually apply to the task.

## Expectations for newer contributors

- it should be normal to rely on the docs, templates, and review loops rather than guessing
- asking for clarification on real ambiguity is fine; skipping the documented workflow is not
- reviewer and recycler loops should be treated as coaching and quality support, not punishment

## Expectations for maintainers and reviewer agents

- enforce the repo contract consistently without becoming tool-prescriptive
- prefer pointing contributors to canonical docs over inventing one-off expectations in review comments
- when rejecting or recycling work, explain which contract item is missing: readiness, docs, verification, rollout posture, or closeout quality
- use follow-up issues for intentional gaps instead of forcing every change into one giant scope blob

## Verification expectations

- use the minimum verification that matches the risk of the change
- stronger checks are expected for permissions, billing, trust, identity, verification, and significant UI changes
- UI-heavy work should include visual evidence when appropriate
- docs-only and low-risk changes can use lighter verification when that is honest and explicit

## Review and recycle posture

- normal review is part of the default workflow
- recycle loops are appropriate when work is sloppy, unclear, under-verified, or only partially aligned with the issue
- the goal is to raise quality quickly, especially for newer contributors, not to create ceremony for its own sake
- future review-loop automation should plug into this workflow rather than replace contributor judgment

## Branch protection and org controls

### Current recommendation

- keep the contribution contract lightweight while collaboration volume is still small
- require a small baseline PR check set on `main` once the app scaffold exists
- keep the first required checks narrow and practical: lint, typecheck, and build for the currently bootstrapped surface
- add stronger protected-branch and contributor-role standards once contribution volume makes them worth the overhead

### Candidate direction

- tighten branch protections when multiple active contributors or parallel PR streams become normal
- introduce clearer contributor-role expectations once review load or release risk meaningfully increases

## Onboarding pointer rule

- onboarding docs and skills should point here instead of redefining the workflow in multiple places
- contributor-facing guidance should link to the canonical ready, done, and analytics docs where relevant

## Relationship to other docs

- `docs/agentic/definition-of-ready.md` defines start conditions for non-trivial work
- `docs/agentic/definition-of-done.md` defines closeout conditions for non-trivial work
- `docs/agentic/product-analytics-and-feature-flags.md` defines rollout and product-signal expectations
- `docs/planning/engineering-strategy.md` keeps the higher-level engineering rationale
- `docs/agentic/software-factory.md` places this workflow inside the broader delivery loop
