import { test, expect } from "@playwright/test";
import {
  gotoComponentStory,
  prepareStorybookVisualPage,
  captureStorybookScreenshot,
} from "./storybook-components";
test("assigned review local provenance and retained selections @storybook-visual", async ({
  page,
}, testInfo) => {
  await prepareStorybookVisualPage(page);
  await page.route(
    "**/api/account/media-review/submissions/fixture/file",
    (route) =>
      route.fulfill({
        contentType: "image/svg+xml",
        body: '<svg xmlns="http://www.w3.org/2000/svg" width="640" height="640"><rect width="640" height="640" fill="#1b4538"/><path d="M120 420L320 120l200 300z" fill="#7dd3a8"/></svg>',
      }),
  );
  await gotoComponentStory(
    page,
    "account-assigned-media-review--local-provenance",
  );
  await expect(
    page.getByText("Local photographer", { exact: true }),
  ).toBeVisible();
  await expect(page.getByRole("link", { name: "Open source" })).toHaveCount(0);
  await page
    .getByLabel("Private review reason")
    .fill("Examined the current placement and local portrait.");
  await page
    .getByRole("button", { name: "Select approval", exact: true })
    .click();
  await page
    .getByRole("button", { name: "Decide selected", exact: true })
    .click();
  await expect(
    page.getByText(
      "Local photographer: Review changed. Inspect the current images before deciding again.",
      { exact: true },
    ),
  ).toBeVisible();
  await expect(
    page.getByText("Selected (1/20)", { exact: true }),
  ).toBeVisible();
  expect(
    await page.evaluate(
      () => document.documentElement.scrollWidth <= window.innerWidth,
    ),
  ).toBe(true);
  await captureStorybookScreenshot(
    page,
    testInfo,
    "assigned-review-local-provenance",
  );
  await page.getByRole("button", { name: "Rebase", exact: true }).click();
  await expect(page.getByText("Rebased", { exact: true })).toBeVisible();
  await captureStorybookScreenshot(page, testInfo, "assigned-review-rebased");
  await expect(
    page.getByText(
      "Review changed. Inspect the current images before deciding again.",
      { exact: true },
    ),
  ).toBeVisible();
  await page
    .getByRole("button", { name: "Select approval", exact: true })
    .click();
  await expect(
    page.getByText(
      "Review changed. Inspect the current images before deciding again.",
      { exact: true },
    ),
  ).toHaveCount(0);
  await expect(
    page.getByText("Selected (1/20)", { exact: true }),
  ).toBeVisible();
  await captureStorybookScreenshot(
    page,
    testInfo,
    "assigned-review-reselected",
  );
});

test("production panel normalizes whitespace optional reason @storybook-visual", async ({
  page,
}) => {
  await gotoComponentStory(
    page,
    "account-assigned-media-review--production-whitespace",
  );
  await page.getByLabel("Private review reason").fill("Examined both images");
  await page.getByLabel("Public rejection reason").fill("   ");
  await page
    .getByRole("button", { name: "Select approval", exact: true })
    .click();
  await page
    .getByRole("button", { name: "Decide selected", exact: true })
    .click();
  await expect(
    page.getByText("Local photographer: Approved.", { exact: true }),
  ).toBeVisible();
  const calls = JSON.parse(
    (await page.getByTestId("panel-mutations").textContent()) ?? "[]",
  );
  expect(calls).toHaveLength(1);
  expect(calls[0].publicReason).toBeUndefined();
  await expect(
    page.getByText("Selected (0/20)", { exact: true }),
  ).toBeVisible();
});
test("production panel recovers runner failure and retains selected command @storybook-visual", async ({
  page,
}) => {
  await gotoComponentStory(
    page,
    "account-assigned-media-review--production-failure",
  );
  await page.getByLabel("Private review reason").fill("Examined both images");
  await page
    .getByRole("button", { name: "Select approval", exact: true })
    .click();
  await page
    .getByRole("button", { name: "Decide selected", exact: true })
    .click();
  await expect(
    page.getByText("Decision failed.", { exact: true }),
  ).toBeVisible();
  await expect(
    page.getByText("Selected (1/20)", { exact: true }),
  ).toBeVisible();
  await expect(
    page.getByRole("button", { name: "Decide selected", exact: true }),
  ).toBeEnabled();
  await expect(
    page.getByRole("button", { name: "Remove", exact: true }),
  ).toBeEnabled();
  await expect(page.getByTestId("panel-mutations")).toHaveText("[]");
  await page
    .getByRole("button", { name: "Decide selected", exact: true })
    .click();
  await expect(
    page.getByText("Local photographer: Approved.", { exact: true }),
  ).toBeVisible();
  expect(
    JSON.parse(
      (await page.getByTestId("panel-mutations").textContent()) ?? "[]",
    ),
  ).toHaveLength(1);
});
