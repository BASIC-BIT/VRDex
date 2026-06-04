import { test } from "@playwright/test";

import {
  captureStorybookScreenshot,
  componentStories,
  gotoComponentStory,
  prepareStorybookVisualPage,
} from "./storybook-components";

test.beforeEach(async ({ page }) => {
  await prepareStorybookVisualPage(page);
});

for (const story of componentStories) {
  test(`${story.name} @storybook-visual`, async ({ page }, testInfo) => {
    await gotoComponentStory(page, story.id);
    await captureStorybookScreenshot(page, testInfo, story.name);
  });
}
