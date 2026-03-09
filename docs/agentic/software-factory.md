# Software Factory

## Status note

This document captures VRDex's repo-specific software-factory direction so the engine and the product can be designed together.

## Locked decisions

- `VRDex` is an opinionated repository, not a neutral sandbox.
- Safe routine progress should continue without repeatedly asking for permission.
- Global repo conventions belong in `AGENTS.md`.
- Personal/operator preferences belong in `AGENTS.local.md`, which should remain gitignored.
- Infrequent onboarding/setup material should live in docs and a repo onboarding skill, not in every-session `AGENTS.md` context.
- Durable markdown should live under `docs/` rather than accumulating at the repo root.

## Current recommendation

- treat product design and software-factory design as parallel workstreams
- when the agent behaves badly or asks a low-value question, finish the immediate task and then capture the process fix before moving on
- bias toward stronger human and agent onboarding so new sessions converge quickly on repo norms
- prefer discoverable, cross-linked artifacts over chat-only decisions

## Rigorous, not prescriptive

### Locked decision

- VRDex should be rigorous about review, verification, and documentation expectations.
- VRDex should not force every contributor to use one specific agent, model, or editor workflow.

### Current recommendation

- optimize for compatibility with multiple agents so long as they can operate inside the repo's review and verification system
- use the repo's review/recycle loops to catch slop and train quality without over-policing how people work locally

## Global vs local context model

### `AGENTS.md`

Use for:

- repo-wide behavior defaults
- autonomy and commit/push posture
- durable safety rules
- durable workflow expectations every agent should always know

Do not use for:

- long onboarding playbooks
- personal operator preferences
- fast-changing implementation details

### `AGENTS.local.md`

Use for:

- personal communication preferences
- local model preferences
- operator-specific autonomy bias and scratchpad habits
- anything that should not silently become repo policy

### Skills

Use for:

- onboarding flows
- repeatable multi-step setup
- model/tool/MCP orientation
- control-loop playbooks that are useful on demand but too large for every session

## Repo onboarding skill direction

The VRDex onboarding skill should cover:

- local agent setup expectations
- how this repo separates global policy from local operator preference
- supported agent roles and model-routing expectations
- how to think about agent development in this repo
- software-factory conventions, issue filing conventions, and documentation conventions
- typical development workflow from task intake to verification to merge

## Review-recycle loop

### Current recommendation

- treat review-recycle as a first-class normal development loop, not an exception
- use a fresh-context reviewer and a recycler that resumes the original implementer context when possible
- trigger recycler work on PR creation, draft->ready transitions, new review comments, failing checks, and mergeability regressions

### Candidate direction

- run first-pass reviewer/recycler loops outside GitHub when practical, then reflect the result back into GitHub once the branch is in better shape
- allow agents to request reviewer and recycler jobs from the common task pool directly

## Orchestrator / supervisor loop

### Current recommendation

- add an orchestrator or executive-assistant layer that sits above implementer sessions
- the orchestrator should decide one next action when an implementer stops: continue, ask one human question, dispatch another agent, or mark done
- prefer checkpointed incremental deltas over replaying giant transcripts

### Candidate direction

- keep implementer sessions persistent and resumable
- treat recycler work as resuming the original implementer session rather than spinning up a brand-new deep-context worker each time

## OpenCode server / task-pool direction

### Current recommendation

- move toward a common hosted OpenCode server that acts as a shared task pool
- prefer atomic jobs/tasks over thread-subscribed chats when that improves dispatch, accounting, and re-entry
- track active, idle, completed, and resumable agent sessions as discoverable system state

### Candidate direction

- let agents request new agents through an orchestrator-facing interface instead of directly spawning uncontrolled work
- expose parallelism ceilings, roster visibility, and resume-vs-new-session policy as explicit system controls

## Verification loops

VRDex should plan verification as a layered system, not a single test command.

### Required layers to design for

- lint and formatting validation
- typecheck/build validation
- unit and integration testing
- end-to-end testing
- screenshot and visual regression review
- VLM review of meaningful UI changes
- validation of scripts and ancillary automation code
- AST/policy checks where structural rules matter
- infrastructure verification for IaC and deployment automation

### Candidate direction

- feature-ready agents should present a video or screenshot-backed validation package to the human reviewer
- the human checkpoint should happen when the feature is already mergeable, not as a substitute for engineering verification

## Definition of ready

### Current recommendation

- every non-trivial feature should define how it will be reviewed, verified, rolled out, and measured before implementation begins
- definition-of-ready belongs in engineering/docs discipline, not just in a PM tool
- `docs/agentic/definition-of-ready.md` is the canonical checklist and issue-snippet reference for this repo

## Definition of done

### Current recommendation

- every non-trivial feature should close with an explicit done check, not just a claim that implementation landed
- definition-of-done should cover verification completion, documentation updates, rollout posture, and review closure
- `docs/agentic/definition-of-done.md` is the canonical closeout checklist and handoff-snippet reference for this repo

## Feature flags and analytics

### Current recommendation

- treat feature flags, experimentation, and product analytics as first-class design concerns for feature work
- default to asking whether a feature should be gated, progressively rolled out, or instrumented
- avoid stacking overlapping platforms too early; prefer one primary system per concern until a real gap appears
- `docs/agentic/product-analytics-and-feature-flags.md` is the canonical policy for tool roles, rollout posture, and product-signal expectations

## Trigger ideas worth encoding

- PR created in ready state
- PR moved from draft to ready
- new commit pushed to PR branch
- build/check failure on a PR
- new AI reviewer comments
- mergeability regression caused by base-branch movement or another PR merging

## Cross-repo promotion model

### Current recommendation

- solve repo-specific versions first inside `VRDex`
- once a pattern proves useful here, promote the generalized version into `basics-agentic-dogfooding`
- avoid over-generalizing before the repo-specific version has shown real value

## Contributor posture

### Current recommendation

- newer contributors should be helped by the system rather than forced to infer expectations from tribal knowledge
- reviewer agents and recycle loops should help raise quality without requiring maintainers to hand-police every sloppy draft
- protected branches, contributor roles, and org-level controls should arrive when collaboration volume justifies them

## Backlog direction

These ideas should be tracked as a distinct software-factory epic and linked child issues, separate from product features but allowed to start immediately.
