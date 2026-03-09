# Definition of Done

## Status note

This document is the canonical repo-level definition of done for feature work.

Use it to decide whether work is actually finished, not just coded.

## Locked decision

- work is not done just because code or docs exist locally
- definition of done should reflect verification, rollout readiness, and documentation expectations
- definition of done complements acceptance criteria; it does not replace them

## Current recommendation

- keep the done check short enough to use on every non-trivial feature
- make it work for docs, code, and mixed changes
- prefer explicit `not needed` notes over silent omission when a done item does not apply

## Canonical checklist

For non-trivial work, do not call the issue done until these points are satisfied:

1. The intended scope is implemented.
2. Acceptance criteria are satisfied or explicitly updated.
3. Verification is complete and the expected evidence exists.
4. Docs and decision records are updated where needed.
5. Rollout and flag state are ready for the intended ship path.
6. Signals, analytics, or success-tracking hooks are in place when appropriate.
7. Review, recycle, and human-validation expectations are satisfied when appropriate.

## What good answers look like

### Scope implemented

- the shipped work matches the agreed slice
- non-goals were not silently pulled into the change unless the issue was updated

### Acceptance criteria

- each criterion is satisfied, superseded, or deliberately revised in the issue/spec
- unresolved edge cases are visible rather than hidden

### Verification complete

- required checks were run or intentionally delegated
- failures are fixed or explicitly documented
- UI work includes screenshot, visual diff, or manual validation evidence when expected

### Docs and decision records

- canonical docs are updated when behavior, workflow, architecture, or policy changed
- issue comments or PR notes link to the most important evidence when useful

### Rollout and flag state

- the feature is in the intended release posture: direct ship, flagged, or staged
- kill-switch or rollback posture is understood when relevant

### Signals or analytics

- required instrumentation or success-signal hooks are present
- if richer analytics were deferred, the issue makes that visible

### Review, recycle, and human validation

- required reviewer/recycler loops are complete
- blocking review feedback is addressed or explicitly deferred
- human validation artifacts are attached when the work calls for them

## Issue or PR closeout snippet

Use this block in PR descriptions, closeout comments, or agent handoff notes for non-trivial work:

```md
## Definition of done

- Scope delivered: <what shipped>
- Acceptance criteria: <met / updated / follow-up needed>
- Verification: <checks run and evidence>
- Docs updated: <paths or "not needed" with reason>
- Rollout state: <direct ship, flagged, staged, or "not needed" with reason>
- Signals: <instrumented, placeholder, deferred, or "not needed" with reason>
- Review status: <review/recycle/human validation state>
```

## Workflow rule

- do not mark non-trivial work done while verification or docs are still obviously missing
- if review reveals missing done criteria, reopen the work instead of pretending it is complete
- if a feature ships with an intentional gap, record the gap explicitly and create follow-up work when needed

## Relationship to other docs

- `docs/agentic/definition-of-ready.md` defines what should be clear before implementation starts
- `docs/planning/engineering-strategy.md` explains why VRDex wants this discipline
- `docs/agentic/software-factory.md` places done criteria inside the wider review, recycle, and orchestration model
