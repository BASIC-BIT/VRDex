import { expect, test } from "@playwright/test";

import { componentStories, gotoComponentStory, prepareStorybookVisualPage } from "./storybook-components";

test.beforeEach(async ({ page }) => {
  await prepareStorybookVisualPage(page);
});

for (const story of componentStories) {
  test(`${story.name} @storybook-snapshot`, async ({ page }) => {
    await gotoComponentStory(page, story.id);
    await expect(page).toHaveScreenshot(`storybook-${story.name}.png`, {
      animations: "disabled",
      caret: "hide",
      fullPage: true,
      maxDiffPixelRatio: 0.002,
      scale: "css",
      threshold: 0.2,
    });
  });
}
