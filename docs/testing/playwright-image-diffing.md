# Playwright image diffing workflow

## Purpose

`Locked decision`: keep screenshot preview and image diffing as related but separate checks.

Screenshot preview proves the screenshots attached to a pull request came from a passing Playwright run. It is review evidence.

When selected with `ci:visuals`, image diffing compares the UI with committed screenshot baselines and fails on differences. Without the label, comparison jobs skip. Browser assertions continue in the preview and functional jobs. See [visual preview selection](./playwright-visual-preview.md#ci-behavior) for triggers and assertion-only behavior.

## Research notes

- Playwright Test has built-in visual comparison through `expect(page).toHaveScreenshot()`. The first update run creates reference screenshots; later runs compare actual screenshots against those references.
- Playwright supports tolerances such as `maxDiffPixels`, `maxDiffPixelRatio`, and image comparison `threshold`. Use the smallest tolerance that avoids font and anti-aliasing noise on GitHub-hosted Linux runners.
- Playwright failure output includes expected, actual, and diff images in the test output/report, which should stay attached as artifacts for diagnosis.
- GitHub Actions artifacts are useful for full reports, but artifact URLs are not a stable markdown image-hosting mechanism for inline PR comments.
- Because VRDex is public, committed PNG baselines can be rendered inline in PR comments through `raw.githubusercontent.com` URLs pinned to the pull request head SHA.
- GitHub Actions added browsable non-zipped artifacts in `actions/upload-artifact@v7` with `archive: false`, which is useful for easier artifact browsing, but it still should not be the primary inline-comment image source.

References:

- Playwright snapshots: `https://playwright.dev/docs/test-snapshots`
- Playwright configuration tolerances: `https://playwright.dev/docs/test-configuration`
- GitHub non-zipped artifacts changelog: `https://github.blog/changelog/2026-02-26-github-actions-now-supports-uploading-and-downloading-non-zipped-artifacts/`

## Current workflow

1. Keep the current `Playwright Public Preview` job.
2. Run a separate `Playwright Image Diff` job that performs committed snapshot comparisons.
3. Commit approved baseline PNGs under an explicit screenshot baseline directory.
4. Fail a selected image-diff job on unexpected baseline differences. Investigate before updating baselines.
5. Post inline only the screenshot baselines that are added or modified in the PR.
6. Keep actual/expected/diff failure artifacts in the Playwright report instead of committing generated failure files.

## Baseline layout

`Locked decision`: use an explicit path rather than Playwright's default adjacent `*-snapshots` directories.

Baseline directory:

```text
apps/web/e2e/__screenshots__/<project-name>/<route-name>.png
```

Reasons:

- Keeps baseline images easy to find and diff in GitHub.
- Makes PR comment discovery simple with `git diff --name-status`.
- Keeps route names stable even if test file names change.

## Test design

The dedicated snapshot spec lives at `apps/web/e2e/public-routes.snapshots.spec.ts`:

```ts
import { expect, test } from "@playwright/test";

import { capturedRoutes, prepareVisualPage } from "./public-routes";

test.beforeEach(async ({ page }) => {
  await prepareVisualPage(page);
});

for (const route of capturedRoutes) {
  test(`${route.name} @snapshot`, async ({ page }) => {
    await page.goto(route.path);
    await route.expectPage(page);
    await expect(page).toHaveScreenshot(`${route.name}.png`, {
      fullPage: true,
      maxDiffPixelRatio: 0.002,
    });
  });
}
```

`apps/web/playwright.config.mjs` configures `expect.toHaveScreenshot.pathTemplate` so snapshots land in the baseline directory.

## Update command

Baseline updates should be an explicit developer action, not a CI auto-commit.

Generate baselines with Linux Chromium matching the CI Playwright version. Windows and macOS font metrics can change text wrapping and page height, so their screenshots are not interchangeable with the Linux baselines.

PowerShell:

```powershell
pnpm --filter web exec playwright test --grep "@snapshot" --update-snapshots
```

POSIX shell:

```sh
pnpm --filter web exec playwright test --grep @snapshot --update-snapshots
```

## CI behavior

`Playwright Image Diff` and `Storybook Image Diff` run only when the PR has `ci:visuals` at the start of a normal PR run. The label selects both suites regardless of changed paths. Label edits do not launch application CI. Both jobs skip on main pushes.

Comparison jobs run the existing commands without `--update-snapshots` and upload reports, results, and expected/actual/diff PNGs on success or failure. Preserve their failures. An unselected run does not prove comparisons pass.

The single `PR Verification Report` records selection, job results, and artifact links. Its collapsed gallery shows every added or modified committed baseline, pinned to the PR head. These source images are review material; a gallery alone does not establish that the comparison passed. Individual image-diff jobs do not write comments.

## Inspect and update baselines

Download the matching run's artifact:

```sh
gh run download <run-id> --name playwright-image-diff --dir .cache/visual-review/playwright
gh run download <run-id> --name storybook-image-diff --dir .cache/visual-review/storybook
```

Open the HTML report and inspect the expected, actual, and diff PNGs. A selector, navigation, server, or fixture error without a diff image is a runtime failure. Fix that failure before considering baseline updates. Dimension differences may indicate unintended layout or screenshot-scope changes.

Generate intentional baseline updates using the existing `test:e2e:snapshots:update` and `test:storybook:snapshots:update` commands in a Linux environment matching CI. Do not adopt Windows rendering as Linux evidence. Alternatively, inspect the failure artifact and manually copy only reviewed actual images into the matching existing baseline paths. Remove the generated `-actual` suffix and preserve each project and snapshot name.

Open every updated PNG, confirm the intended state, and commit only baseline images. Keep failure reports and generated diff files out of Git. Re-run the selected comparisons after updating. A changed PNG is not permission to raise tolerances or bypass a selector failure.

## Pushback and tradeoffs

`Current recommendation`: do not auto-update screenshots in CI.

Auto-updating makes the green path too easy for unintended visual regressions. The safer pattern is a failing diff gate, an explicit local `--update-snapshots` run, and a PR comment that displays only the reviewed changed baselines.

`Current recommendation`: do not replace the existing screenshot preview job with diffing.

Preview screenshots are still useful before baselines exist for every route and for broader human inspection. Diffing should become the stricter regression gate once baselines are committed.

`Candidate direction`: use `actions/upload-artifact@v7` with `archive: false` later for easier browsing of generated failure images, while keeping committed baseline PNGs as the inline PR comment source.

## Implemented rollout

1. Added the snapshot spec and baseline directory for the existing public route set.
2. Generated and committed baseline PNGs for desktop and mobile Chromium.
3. Added `test:e2e:snapshots` and `test:e2e:snapshots:update` package scripts.
4. Added the `Playwright Image Diff` CI job.
5. Consolidated baseline galleries and artifact links into `PR Verification Report`.
6. Kept the current preview job artifact-only.
7. Keep `maxDiffPixelRatio` unchanged unless CI noise appears after real PR traffic.
