# Optional browser CI implementation plan

> **For agentic workers:** Use superpowers:executing-plans to implement this approved scope natively, then request one fresh whole-branch review.

**Goal:** Keep default CI focused on static checks and the web build. Select browser coverage only when a change needs it.

**Architecture:** One immutable run selection feeds all browser jobs and the Storybook build. The report validates required core jobs and whichever coverage was selected. Local commands, functional assertions and production deployment controls retain their current behavior.

**Tech Stack:** GitHub Actions YAML, Node CommonJS helpers and tests, TypeScript workflow contracts, pnpm.

**Spec:** [Approved scope](#approved-scope). BASIC approved this exact behavior in the supervising chat with “yup go for that” on 2026-10-15 and authorized this chat to implement it through merge readiness.

## Approved scope

| PR labels at the start of a normal run | Core checks and web build | All browser assertions and Storybook build | Review captures and both comparisons |
| --- | --- | --- | --- |
| None | Run | Skip | Skip |
| `ci:browsers` | Run | Run | Skip |
| `ci:visuals` (with or without `ci:browsers`) | Run | Run | Run |

Core coverage includes lint, types, unit tests, docs, API/MCP checks and the existing restream/backend checks. Browser coverage includes public smoke, local and hosted journeys, signed-in account assertions and both previews. Failure diagnostics remain enabled in browsers-only mode. Label edits do not launch another application pipeline. A normal PR event snapshots selection; reports preserve that snapshot when labels change later.

Required checks, artifact validation, stale-head rejection and removal invalidation must remain truthful. Default reports must explicitly say browser coverage was NOT SELECTED. Preserve local defaults, assertions, baselines and production deploy controls. Agents select `ci:browsers` for UI, authentication and navigation changes, and `ci:visuals` when visual evidence is needed.

There are no open product decisions. This plan records the approved implementation and creates no additional approval gate. No PR merge or deployment is authorized.

## Global constraints

- Start from actual current main in the existing isolated checkout, on a new `codex/` branch. Preserve shared checkouts and the merged PR branch.
- Preserve job identifiers, production deployment controls, local defaults, functional test definitions and baseline files.
- Default still runs required core jobs and the web build. Only selected browser consumers require the Storybook build.
- Invalid or inconsistent selection, missing evidence, cancellation, selected failures and unexpected skips must fail verification.
- The label-removal workflow executes only trusted inline code, with no PR checkout. Preserve failed history and serialize report changes.
- Validate all three modes on one final pushed head with three normal PR runs, using draft/ready transitions rather than artificial commits.
- Every new commit resets the 30-minute readiness gate. No merge or deployment.

## Review focus

- `ci:visuals` without `ci:browsers` must select every browser consumer and the Storybook build.
- A failed core job must fail a default report even when all browser jobs are intentionally skipped.
- Browser-only selection must retain assertions and diagnostics without collecting review PNGs or running comparisons.
- Label removal, re-addition during API reads, or a changed head must not create current-looking stale evidence.
- A required browser job, Storybook build or artifact must not disappear behind NOT SELECTED when selection is invalid or a job unexpectedly fails/skips.

### Task 1: Implement three-mode selection, truthful reports and docs

**Files:** `.github/scripts/visual-ci.cjs`, its tests, `pr-verification-report.cjs` and tests, `visual-label-removal.test.cjs`, both related workflows, `tests/scripts/workflow-definitions.test.ts`, contributor guidance and both Playwright docs.

**Interfaces:** `selectEvidence(eventName, labels)` returns `{ browsers: boolean, visuals: boolean }`. The existing selection job emits string outputs `browsers` and `visuals`. `evaluateVerification({needs, artifacts})` returns `{browsers: boolean | null, visuals: boolean | null, errors: string[]}`. Visuals implies browsers. All readers consume the same names. Core job results do not require browser artifacts; selected browser producers do.

- [x] Write failing selection/evaluation tests for all label combinations and non-PR events, default core failures, required Storybook build, all browser outcomes, missing/expired evidence, invalid/inconsistent selection and hosted configuration.
- [x] Write failing report/publisher/removal tests for all three modes, changed labels through the publisher, old/changed heads, both removal labels and API-read races. Preserve failure history.
- [x] Write failing workflow contracts for selection dependencies, Storybook gating, all browser consumers, required report dependencies, unchanged deploy controls and no label-triggered application run.
- [x] Run the focused contracts and confirm the expected failures. Implement the smallest changes that satisfy them, then pass all contracts.
- [x] Update agent selection guidance and docs. Apply unslop. Run full scripts, helper tests and docs verification; inspect the diff for changes to assertions, local defaults or baselines.
- [ ] Commit the independently testable implementation, then request one fresh whole-branch review. Address valid important findings with reproducing tests before publishing.

**Verification:** `node --import tsx --test .github/scripts/visual-ci.test.cjs .github/scripts/pr-verification-report.test.cjs .github/scripts/visual-label-removal.test.cjs tests/scripts/workflow-definitions.test.ts tests/scripts/review-capture-boundaries.test.ts`, `pnpm test:scripts`, `pnpm verify:docs`. Expected: focused contracts and docs pass; negative cases fail closed. Record unrelated whole-suite failures explicitly and require fresh Linux full-script success before readiness.

### Task 2: Publish, prove mode selection and complete the review gate

**Files:** PR description and the local owner receipt. No artificial source commits for CI triggers.

**Interfaces:** Uses Task 1's `browsers`/`visuals` outputs and stable job names. The owner receipt records worktree, branch, PR, exact head/timestamp, mode run IDs, evidence and remaining work.

- [ ] Push the reviewed head, create and attach a draft PR with no selection label. Verify default Linux CI has no browser jobs or Storybook build, while core checks and web build succeed.
- [ ] Add only `ci:browsers`, verify label edits launch no application run, then mark ready for one browsers-only run. Verify all assertions and hosted gates remain active, both comparisons skip and both previews produce zero review PNGs.
- [ ] Exercise removal/stale-head contracts on Linux and record the live trusted-workflow evidence boundary. Add only `ci:visuals` and use one draft/ready transition for the visuals run. Verify visuals implies browsers, captures exist and both comparisons run without baseline changes.
- [ ] Read actual job timestamps and report summed elapsed job minutes separately from selected coverage, billed dollars and guaranteed future savings.
- [ ] Refresh and triage every check, ordinary comment, inline thread, formal review and mutable summary for the current head. Reply/resolve valid feedback before follow-up pushes.
- [ ] After at least 30 minutes from the latest commit, refresh all surfaces and re-read mutable summaries. Require terminal acceptable checks, clean mergeability and no blocking feedback. Update the owner receipt and report verified readiness to the supervisor. No merge or deployment.

**Verification:** Three exact-head Linux runs, current provider policy reads, current-head report artifacts and a post-window feedback sweep followed by a re-read. Expected: default, browsers-only and visuals match the mode table; evidence gaps remain explicit.

## Verification evidence boundary

The trusted `pull_request_target` workflow runs from the base ref. Before this PR merges, its expanded `ci:browsers` removal handler can be verified by executing the exact inline script in Linux contracts, including selector combinations, failures, stale heads, and remove/re-add races. Live pre-merge removal exercises main's existing `ci:visuals` handler. A bounded live check of `ci:browsers` removal remains pending after merge; it must not be described as pre-merge live acceptance.

Local focused contracts and full docs verification passed. The unchanged Windows Gemini shutdown tests failed in the first full run (257 passed, two failed, one skipped) and in isolation (14 passed, one failed). Their source matches main. Keep those findings explicit and use fresh exact-head Linux full-script results as the whole-suite acceptance gate.
