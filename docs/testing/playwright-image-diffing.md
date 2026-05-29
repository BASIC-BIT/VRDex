# Playwright image diffing workflow

## Purpose

`Locked decision`: keep screenshot preview and image diffing as related but separate checks.

Screenshot preview proves the screenshots attached to a pull request came from a passing Playwright run. It is review evidence.

Image diffing proves the UI still matches committed screenshot baselines. It is a regression gate.

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

## Recommended workflow

1. Keep the current `Playwright Public Preview` job.
2. Add a separate `Playwright Image Diff` job that runs committed snapshot comparisons.
3. Commit approved baseline PNGs under an explicit screenshot baseline directory.
4. Fail the image diff job when a UI change is not accompanied by updated baselines.
5. Post inline only the screenshot baselines that are added or modified in the PR.
6. Keep actual/expected/diff failure artifacts in the Playwright report instead of committing generated failure files.

## Baseline layout

`Current recommendation`: use an explicit path rather than Playwright's default adjacent `*-snapshots` directories.

Proposed directory:

```text
apps/web/e2e/__screenshots__/<project-name>/<route-name>.png
```

Reasons:

- Keeps baseline images easy to find and diff in GitHub.
- Makes PR comment discovery simple with `git diff --name-status`.
- Keeps route names stable even if test file names change.

## Test design

Add a dedicated snapshot spec, for example `apps/web/e2e/public-routes.snapshots.spec.ts`:

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

Then configure `snapshotPathTemplate` in `apps/web/playwright.config.mjs` so snapshots land in the baseline directory.

## Update command

Baseline updates should be an explicit developer action, not a CI auto-commit.

PowerShell:

```powershell
pnpm --filter web exec playwright test --grep "@snapshot" --update-snapshots
```

POSIX shell:

```sh
pnpm --filter web exec playwright test --grep @snapshot --update-snapshots
```

## CI behavior

`Playwright Image Diff` should:

1. Run `pnpm --filter web exec playwright test --grep @snapshot` without `--update-snapshots`.
2. Upload the Playwright report and `test-results` artifacts on success or failure.
3. If the test passes, find added/modified PNG baselines in the PR diff.
4. Post or update a single PR comment with inline images for those added/modified baselines.
5. If no baseline PNGs changed, say that no baseline images changed instead of listing every route.

Candidate diff command:

```sh
git fetch origin main --depth=1
git diff --name-status origin/main...HEAD -- 'apps/web/e2e/__screenshots__/**/*.png'
```

Candidate markdown image URL for public repo baselines:

```text
https://raw.githubusercontent.com/BASIC-BIT/VRDex/<head-sha>/<path-to-png>
```

## PR comment shape

Keep the comment short and image-forward:

```md
<!-- vrdex-playwright-image-diff -->
## Playwright Image Diff
Outcome: success
Run: <actions-run-url>
Report: <artifact-url>

Changed screenshot baselines:

<details open>
<summary>desktop-chromium / home</summary>

![desktop-chromium home](https://raw.githubusercontent.com/BASIC-BIT/VRDex/<head-sha>/apps/web/e2e/__screenshots__/desktop-chromium/home.png)
</details>
```

Cap inline images to a reasonable number, such as 12, then link the artifact for the rest.

## Pushback and tradeoffs

`Current recommendation`: do not auto-update screenshots in CI.

Auto-updating makes the green path too easy for unintended visual regressions. The safer pattern is a failing diff gate, an explicit local `--update-snapshots` run, and a PR comment that displays only the reviewed changed baselines.

`Current recommendation`: do not replace the existing screenshot preview job with diffing.

Preview screenshots are still useful before baselines exist for every route and for broader human inspection. Diffing should become the stricter regression gate once baselines are committed.

`Candidate direction`: use `actions/upload-artifact@v7` with `archive: false` later for easier browsing of generated failure images, while keeping committed baseline PNGs as the inline PR comment source.

## Rollout plan

1. Add the snapshot spec and baseline directory for the existing public route set.
2. Generate and commit baseline PNGs for desktop and mobile Chromium.
3. Add `test:e2e:snapshots` and `test:e2e:snapshots:update` package scripts.
4. Add the `Playwright Image Diff` CI job.
5. Add a `github-script` step that comments inline changed/added baseline PNGs after the snapshot job passes.
6. Keep the current preview job artifact-only until the image diff job has stable baselines.
7. Tighten or loosen `maxDiffPixelRatio` based on CI noise after a few PRs.
