import sharp from "sharp";
import { test, expect } from "@playwright/test";
import {
  gotoComponentStory,
  prepareStorybookVisualPage,
  captureStorybookScreenshot,
} from "./storybook-components";
test("trusted publication keeps declarations and publish separate @storybook-visual", async ({
  page,
}, testInfo) => {
  await prepareStorybookVisualPage(page);
  const candidate = await sharp(
    Buffer.from(
      '<svg xmlns="http://www.w3.org/2000/svg" width="640" height="640"><rect width="640" height="640" fill="#173e35"/><circle cx="320" cy="230" r="105" fill="#9bd9b9"/><path d="M120 600v-70a200 200 0 01400 0v70z" fill="#72b59b"/></svg>',
    ),
  )
    .png()
    .toBuffer();
  await page.route(
    "**/api/account/media-contributions/submissions/fixture/file?version=*",
    (route) =>
      route.fulfill({
        contentType: "image/png",
        body: candidate,
      }),
  );
  await gotoComponentStory(
    page,
    "account-trusted-publication--explicit-commands",
  );
  await expect(page.getByTestId("commands")).toHaveText("[]");
  await expect(
    page.getByRole("button", { name: "Confirm evidence" }),
  ).toBeDisabled();
  for (const label of [
    "Identity confirmed",
    "Attribution confirmed",
    "Publication permitted",
    "No known restrictions",
  ])
    await page.getByLabel(label).check();
  await expect(page.getByTestId("commands")).toHaveText("[]");
  await page.getByRole("button", { name: "Confirm evidence" }).click();
  await expect(page.getByText("Confirmed", { exact: true })).toBeVisible();
  await expect(page.getByTestId("commands")).not.toContainText(
    'command\\\":\\\"publish',
  );
  await expect(
    page.getByRole("button", { name: "Confirm evidence" }),
  ).toBeEnabled();
  await captureStorybookScreenshot(
    page,
    testInfo,
    "trusted-publication-evidence",
  );
  await page.getByRole("button", { name: "Publish", exact: true }).click();
  await expect(
    page.getByText("Independent review required", { exact: true }),
  ).toBeVisible();
  expect(await page.getByTestId("commands").textContent()).toContain("v2");
  expect(
    await page.evaluate(
      () => document.documentElement.scrollWidth <= window.innerWidth,
    ),
  ).toBe(true);
  await captureStorybookScreenshot(
    page,
    testInfo,
    "trusted-publication-refusal",
  );
  await page
    .getByRole("button", { name: "Independent review", exact: true })
    .click();
  await expect(
    page.getByRole("button", { name: "Publish", exact: true }),
  ).toHaveCount(0);
  await expect(
    page.getByRole("button", { name: "Inspect", exact: true }),
  ).toBeVisible();
});
