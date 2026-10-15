# Optional visual CI implementation plan

Historical implementation: the [approved optional browser CI scope](./2026-10-15-optional-browser-ci.md) supersedes the automatic-browser default described here.

> **For agentic workers:** Use superpowers:executing-plans to implement this plan task-by-task. Track completion below and in the local execution ledger.

**Goal:** Make visual evidence opt-in while preserving automatic browser assertions.

**Architecture:** One PR-label selection feeds capture mode and comparison conditions. The existing consolidated report validates expected results and artifacts, and rejects stale publication. Existing capture helpers skip only review PNG writes when collection is disabled.

**Tech stack:** GitHub Actions YAML, Node CommonJS helpers/tests, TypeScript Playwright fixtures, pnpm.

**Spec:** [Approved design](../specs/2026-10-14-optional-visual-ci-design.md), approved by BASIC in chat on 2026-10-14.

## Global constraints

- Keep `event-editor.snapshots.spec.ts`, baselines, and owner branches unchanged.
- Coordinate before changing reserved `public-routes.ts`.
- Preserve assertions, stabilization, cleanup, hosted configuration gates, diagnostics, build jobs, and deploy dependencies.
- `ci:visuals` selects captures and both comparison suites on ordinary PR events. Label edits do not launch application CI. No new manual dispatch.
- No auto-updates, tolerance changes, provider mutations, merge, or deployment.

## Review focus

- A label changes while a run is pending: report historical selection truthfully.
- An old head finishes last: it cannot overwrite current evidence.
- A selected job succeeds without artifacts: verification fails.
- Capture disabled: assertions and cleanup still execute; review PNGs do not appear.
- Label removal: preserve failures and invalidate visual claims without executing PR code.

## Task 1: Selection, workflow wiring, and report contracts

**Files:** `.github/scripts/visual-ci.cjs`, its `.test.cjs`, existing `pr-verification-report.cjs` and `.test.cjs`, `.github/workflows/baseline-checks.yml`, a label-removal workflow, `tests/scripts/workflow-definitions.test.ts`.

**Interfaces:** `selectVisuals(eventName, labels)` returns a boolean; workflow output `selected` is exactly `true` or `false`. Report consumes `needs['visual-selection'].outputs.selected` and job results/artifacts. Its evaluation returns explicit errors for failed, unexpectedly skipped, or evidence-free required jobs.

- [x] Write and run failing selection/report tests for default/selected jobs, missing artifacts, cancellation, unexpected skips, old heads, changed labels, and removal invalidation.
- [x] Implement strict selection, automatic public smoke, capture-mode env wiring, comparison job conditions, and report validation. Reuse existing names, marker, gallery, and upload paths.
- [x] Run Node helper tests and workflow YAML/contract tests. Expected: pass, no selected failure can report success.
- [ ] Commit this independently testable workflow/report change.

## Task 2: Capture mode preserves functional execution

**Files:** shared route/Storybook capture helpers, all tagged specs with direct review screenshot calls, focused capture-mode tests, and `tests/scripts/review-capture-boundaries.test.ts`.

**Interfaces:** `PLAYWRIGHT_CAPTURE_SCREENSHOTS=false` suppresses review screenshot writes/attachments only. Unset retains local capture behavior. Snapshot comparison commands do not depend on this switch.

- [x] After ownership release, write a failing behavioral test that runs a browser with capture disabled, asserts page state and cleanup, and verifies no review images/attachments; enabled mode must produce them.
- [x] Guard only capture writes after existing stabilization. Cover direct screenshot calls through the same setting. Keep hosted account assertions automatic.
- [x] Run the focused browser test in both modes and representative public smoke. Expected: assertions pass in both modes, PNGs appear only when selected.
- [ ] Commit the capture implementation.

## Task 3: Documentation, representative CI, review, and PR

**Files:** both Playwright testing docs, contributor guidance, approved design status, this plan.

- [x] Update selection/rerun instructions, assertion-only semantics, Linux baseline updates and failure-artifact inspection. Remove stale per-job-comment guidance. Apply unslop and verify docs.
- [ ] Run full script tests, relevant typecheck/lint and helper tests. Verify functional and selected capture/comparison execution; preserve unrelated failures as named findings.
- [ ] Request a fresh whole-branch review, address valid findings, commit, push, create and attach a separate PR.
- [ ] Obtain both default and selected CI evidence. Inspect every feedback surface for the exact head, recycle valid feedback, and refresh after the latest commit is at least 30 minutes old before calling merge-ready.

## Execution decision

BASIC's approval authorizes implementation and PR preparation. Execute natively in this existing managed worktree and request one fresh final review. This plan refines the approved scope and creates no additional approval gate.
