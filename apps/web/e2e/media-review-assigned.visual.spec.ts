import sharp from "sharp";
import { test, expect } from "@playwright/test";
import {
  gotoComponentStory,
  prepareStorybookVisualPage,
  captureStorybookScreenshot,
} from "./storybook-components";
test("own lifecycle loads older decisions in the production panel @storybook-visual", async ({
  page,
}, testInfo) => {
  await prepareStorybookVisualPage(page);
  await gotoComponentStory(
    page,
    "account-assigned-media-review--own-inventory",
  );
  await expect(
    page.getByText("Older photographer", { exact: true }),
  ).toHaveCount(0);
  await page.getByRole("button", { name: "Load more", exact: true }).click();
  await expect(page.getByText("Older decision", { exact: true })).toBeVisible();
  await expect(
    page.getByRole("button", { name: "Load more", exact: true }),
  ).toHaveCount(0);
  await expect(
    page.getByRole("button", { name: "Withdraw", exact: true }),
  ).toHaveCount(0);
  await captureStorybookScreenshot(page, testInfo, "own-older-decision");
});
for (const operation of ["Approve", "Rebase"]) {
  test(`production ${operation} retains exact command after response loss @storybook-visual`, async ({
    page,
  }, testInfo) => {
    await prepareStorybookVisualPage(page);
    const candidate = await sharp({
      create: { width: 320, height: 320, channels: 3, background: "#173e35" },
    })
      .png()
      .toBuffer();
    await page.route(
      "**/api/account/media-review/submissions/fixture/file",
      (route) => route.fulfill({ contentType: "image/png", body: candidate }),
    );
    await gotoComponentStory(
      page,
      "account-assigned-media-review--production-uncertain",
    );
    await expect(
      page.getByRole("img", {
        name: "Candidate for Local photographer",
        exact: true,
      }),
    ).toHaveJSProperty("naturalWidth", 320);
    await page
      .getByLabel("Private review reason")
      .fill("Inspected exact snapshot");
    await page.getByLabel("Public rejection reason").fill("Reason");
    await page.getByRole("button", { name: operation, exact: true }).click();
    await expect(
      page.getByText("Outcome unknown", { exact: true }),
    ).toBeVisible();
    await expect(page.getByLabel("Private review reason")).toBeDisabled();
    await expect(
      page.getByRole("button", { name: "Reject", exact: true }),
    ).toBeDisabled();
    await expect(
      page.getByRole("button", {
        name: operation === "Approve" ? "Rebase" : "Approve",
        exact: true,
      }),
    ).toBeDisabled();
    await captureStorybookScreenshot(page, testInfo, `uncertain-${operation}`);
    await page.getByRole("button", { name: "Retry", exact: true }).click();
    const calls = JSON.parse(
      (await page.getByTestId("panel-mutations").textContent())!,
    );
    expect(calls).toHaveLength(2);
    expect(calls[1]).toEqual(calls[0]);
    if (operation === "Approve")
      await expect(page.getByLabel("Private review reason")).toHaveCount(0);
    else await expect(page.getByLabel("Private review reason")).toBeEnabled();
  });
}
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
