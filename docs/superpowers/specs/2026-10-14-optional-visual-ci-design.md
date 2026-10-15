# Optional visual CI for VRDex

## Proposed outcome and review decision

Make screenshot collection and image comparisons opt-in through the `ci:visuals` PR label. Keep the interaction assertions currently embedded in VRDex's visual suites automatic. This adapts Perkcord's explicit visual selection to VRDex's existing jobs and consolidated PR report.

**Current recommendation:** approve the bounded change below. Without the label, the two preview jobs run their browser assertions without collecting review screenshots, and the two image-diff jobs skip. With the label, all four retain their current visual behavior. Add automatic public-route smoke coverage using the existing spec. UI changes still require screenshots and visual review under AGENTS.md.

**Decision needing BASIC's approval:** accept assertion-only preview runs as the default. This avoids making existing editing, publication-recovery, and access checks optional. It saves less browser time than skipping every visual job because the assertions still run. The smaller alternative makes only image comparisons optional and continues automatic screenshot collection; it does not fully cover the requested screenshot opt-in behavior.

Status: proposed, awaiting BASIC's approval. Only this design has been written. Approval covers implementation, validation, and a separate PR, with no merge or deployment.

## Confirmed constraints

- Compare actual current Perkcord main, then adapt its useful behavior to VRDex.
- Keep PR368's event-editor snapshot failure independent. Selection changes cannot count as a fix for it.
- Preserve the shared checkouts and use an isolated VRDex worktree.
- Reuse Baseline Checks, existing scripts, artifacts, and the single PR verification report.
- No merge, deployment, provider mutation, production data changes, or changes to PR368/basic-infra PR39 branches.
- No public product copy or UI design changes.

## Source pattern and adaptations

Perkcord's current `CI` workflow reads `ci:visuals` on ordinary PR events, then selects both snapshot suites regardless of changed paths. Label edits do not launch application CI. Main pushes keep functional checks and skip snapshots. Its application gate requires selected jobs to succeed and unselected jobs to skip. Failure, cancellation, missing selection, or an unexpected skip fails the gate.

Its preview comment links changed committed PNGs and artifacts. Current-head and current-label checks prevent outdated publication. Removing the label marks existing preview evidence unselected without running application CI. Comparison CI never rewrites baselines. Linux refresh or reviewed failure artifacts provide intentional updates; runtime and selector failures are distinct from image mismatches.

Perkcord's manual `CI` dispatch is production promotion with exact-SHA confirmation. It is not a visual trigger and will not be copied. VRDex keeps its local commands. For CI evidence, label the PR before its next opened, synchronized, reopened, or ready-for-review run. A visual-only manual dispatch is deferred.

VRDex differs from Perkcord because its screenshot suites contain substantive functional assertions. `media-kit.visual.spec.ts` and `trusted-publication.visual.spec.ts` cover editing and publication recovery. Public-route and account specs also assert routing and access. The two preview jobs therefore stay automatic, with screenshot collection selected separately. This preserves those assertions without migrating their tests.

## Contributor experience

| Situation | Functional checks | Dedicated visual evidence |
| --- | --- | --- |
| PR without `ci:visuals` | Existing checks, both preview suites in assertion-only mode, public smoke, local mutation flow, configured hosted flow | Both image-diff jobs skip; report says screenshots and comparisons were not selected |
| PR with `ci:visuals` | Same assertions and functional checks | Both preview suites collect screenshots and both image-diff suites compare baselines |
| Label added or removed | No application CI run starts | Selection applies on the next normal PR run; disabling visuals marks existing visual claims historical |
| Main push | Existing main-push checks and deploy dependencies | No dedicated visual jobs, matching current VRDex PR-only scope |
| Local visual request | Existing commands run directly | Screenshots remain enabled by default; no PR label required |

A visual failure remains a failed check. Removing the label does not erase a completed failure or make it passing. The next normal run records its own selection and results.

Reports identify the exact commit and run selection. They distinguish assertion success from screenshot capture or comparison success, and distinguish not selected, not configured, failed, cancelled, unexpectedly skipped, and missing evidence. A changed-baseline gallery is source review evidence, not proof that comparison passed.

## Functional checks and capture mode

Add an automatic `Playwright Public Smoke` job using existing `public-routes.smoke.spec.ts` on desktop and mobile Chromium against local fixture servers. Keep local mutation coverage, hosted mutation coverage, auth configuration gates, and signed-in account assertions intact.

Introduce one explicit screenshot-collection setting, tentatively `PLAYWRIGHT_CAPTURE_SCREENSHOTS=false` for unselected CI preview runs. Local commands default to collection. Only review screenshot writes and attachments are conditional. Navigation, waiting for stable UI, assertions, mutations, and cleanup still execute. Keep failure diagnostics, traces, and mutation-flow evidence available.

Apply the setting in shared route and Storybook capture helpers and the few direct review screenshot calls. Assert-only mode must not create review PNGs or claim screenshots were captured. In the configured hosted lane, keep account assertions automatic and use the same selection for their review screenshot collection. Other functional-flow screenshots remain diagnostic evidence.

Do not modify `event-editor.snapshots.spec.ts`, its baselines, or root-owned branches. Root also reserves `public-routes.ts` during the PR368 diagnosis. Coordinate and obtain an ownership release before editing its capture helper; independent files can proceed first. Snapshot-only state assertions continue with the selected comparison suite, as in Perkcord. Retain existing nonvisual editor flow coverage. Any discovered critical behavior covered only in a snapshot test must be coordinated before changing its automatic execution.

Keep Build Web, Build Storybook, lint, typechecks, unit tests, API/MCP verification, security checks, and deploy dependencies unchanged. Build Storybook stays automatic because its browser assertions still run.

## Workflow and reporting

Use a small selection job or shared helper in Baseline Checks that emits an explicit boolean from PR labels. Both preview jobs receive capture mode, and both comparison jobs require selection plus their existing build dependency. Preserve existing job names, comparison commands, timeouts, artifact names, and baseline directories.

Extend PR Verification Report to consume selection and public smoke. Validate expected results: preview and required functional jobs must succeed; selected comparisons must succeed; unselected comparisons must skip. A requested run that failed setup or skipped unexpectedly must need attention and fail verification. Preserve the existing hosted configuration skip behavior. Do not use `continue-on-error` or missing-artifact success to hide a failure.

Reuse the single report marker and complete collapsed baseline gallery. Preview artifacts in assertion-only mode remain useful for reports and failure diagnostics, but must not be called screenshot evidence. Summaries must report capture selection and actual outcomes. Separate hosted assertion outcomes from screenshot collection status.

Before publishing, re-read the PR head and labels. Old-head evidence cannot replace current evidence. A selection change since the run must be called out, not treated as evidence of the new selection. A lightweight label-removal handler may invalidate an existing visual claim, without running application CI or deleting historical failures. Test interleaved old-head and label-change cases.

Keep fork checks secret-free and preserve the report's same-repository write restriction. No privileged workflow will check out untrusted code.

## Baselines and documentation

Keep current baseline directories and comparison tolerances. Comparison CI must never use `--update-snapshots`. Use existing local update commands in a Linux environment matching CI, or inspect downloaded failure artifacts and deliberately copy only reviewed actual PNGs to existing baseline paths. Do not port Perkcord's naming or adoption scripts because VRDex uses different paths.

Document artifact download, expected/actual/diff inspection, runtime failures versus pixel drift, next-run label selection, assertion-only summaries, and PNG review before committing. Update both Playwright testing docs, contributor guidance, and directly conflicting references. Replace stale per-job-comment instructions with VRDex's consolidated report. Preserve AGENTS.md's meaningful-UI visual review requirement.

## Validation and completion

- Test label absent/present, ordinary PR triggers, no application run on label edits, and main-push behavior.
- Test selected comparison success/failure/cancellation/unexpected skip and unselected comparison skip.
- Exercise capture enabled/disabled and prove assertions and cleanup still run while review PNG writes and attachments stop.
- Test report outcomes, missing evidence, artifact links, baseline gallery, current-head publication, label changes, and update-in-place behavior.
- Parse all workflow YAML and verify build, functional, hosted configuration, and deployment dependencies.
- Run representative local public smoke and a focused assertion-only preview, plus selected capture/comparison execution where supported. Use the selected PR run for Linux evidence. Report any baseline/runtime failure honestly and coordinate root-owned failures.
- Prepare and attach a separate PR on `codex/optional-visual-tests` after design approval and implementation.
- Triage exact-head checks, comments, inline threads, formal reviews, and mutable summaries. After the latest pushed commit is at least 30 minutes old, refresh every surface before claiming merge-ready. Each commit restarts the window.

Acceptance needs both a default run proving automatic browser assertions with visuals unselected and a selected run proving screenshot/comparison controls and truthful reporting. A green unselected run alone cannot establish that visuals work.

## Evidence appendix

Verified on 2026-10-14 using remote fetches and native GitHub identity/repository/ruleset reads:

- GitHub actor: BASIC-BIT, numeric ID 2165323.
- Source: `Perkcord/perkcord`, main `52e0daee9b7d6dd56712cd6acab1de408790c113`; local checkout `7643322b28dfbc8d84fc8b6d08792103343a8e7f`.
- Target: `BASIC-BIT/VRDex`, main `8a46d3eeeb1cec2722becbfff0d4228ae60230ec`.
- Isolated worktree: `C:/Users/steve/.codex/worktrees/optional-visual-tests/VRDex`.
- Perkcord sources: `.github/workflows/ci.yml`, `.github/workflows/snapshot-preview-opt-out.yml`, `scripts/change-plan.mjs`, `scripts/change-plan-core.mjs`, `scripts/ci-lane-gate.mjs`, `scripts/ci-gate-inputs.mjs`, `docs/ui-visual-protocol.md`, and `.opencode/skills/perkcord-ui-visuals/SKILL.md`.
- VRDex sources: `.github/workflows/baseline-checks.yml`, `.github/scripts/pr-verification-report.cjs`, its tests, `apps/web/package.json`, Playwright specs/configurations/capture helpers, and both Playwright testing docs.
- Active main ruleset 16811149 requires PR/thread resolution and scanning/review controls, with no required-status-check rule. Native classic branch-protection read returned 403; documented `gh` read fallback returned `404 Branch not protected`. No provider settings changed.
- Root-owned PR368 failure: head `bf843eef7d49d98b820cc46ce96e215bc88c3280`, run `38656814295`, job `116170188140`, scheduling states dark in `event-editor.snapshots.spec.ts`. This task has not independently diagnosed it.
