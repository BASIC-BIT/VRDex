import { expect, test } from "@playwright/test";
test("older notifications appear automatically after empty filtered pages @storybook-visual", async ({
  page,
}, testInfo) => {
  await page.goto(
    "/iframe.html?id=clubs-scheduled--older-notifications&viewMode=story",
  );
  const section = page.getByRole("region", { name: "Action notifications" });
  await expect(
    section.getByRole("link", { name: "Publish post" }),
  ).toHaveAttribute("href", "/account/communities/afterhours/scheduled");
  await expect(
    section.getByRole("button", { name: "Load more notifications" }),
  ).toHaveCount(0);
  await page.screenshot({
    path: `../../.cache/artifacts/notifications-${testInfo.project.name}.png`,
    fullPage: true,
  });
  await section.getByRole("button", { name: "Dismiss" }).click();
  await expect(section).toHaveCount(0);
});
test("scheduled edits preserve real queue outcomes and support event-relative timing @storybook-visual", async ({
  page,
}) => {
  await page.goto("/iframe.html?id=clubs-scheduled--owner&viewMode=story");
  await expect(
    page.getByRole("region", { name: "Action notifications" }),
  ).toBeVisible();
  await page.getByRole("button", { name: "Dismiss", exact: true }).click();
  await expect(
    page.getByRole("region", { name: "Action notifications" }),
  ).toHaveCount(0);
  await page
    .getByRole("button", { name: "Edit action", exact: true })
    .first()
    .click();
  await page.getByLabel("Title", { exact: true }).fill("Doors at midnight");
  await page
    .getByLabel("Timing", { exact: true })
    .selectOption("event_relative");
  await page
    .getByLabel("Event", { exact: true })
    .selectOption({ label: "Afterhours Friday" });
  await page
    .getByLabel("Minutes after event start", { exact: true })
    .fill("-30");
  await page.getByRole("button", { name: "Save action", exact: true }).click();
  await expect(
    page.getByText("Doors at midnight", { exact: true }),
  ).toBeVisible();
  await expect(
    page.getByText("-30 minutes after event start", { exact: true }),
  ).toBeVisible();
  await page
    .getByRole("button", { name: "Cancel action", exact: true })
    .first()
    .click();
  await expect(page.getByText("Cancel action?", { exact: true })).toBeVisible();
  await page
    .getByRole("button", { name: "Confirm cancellation", exact: true })
    .click();
  await expect(page.getByText("Cancelled", { exact: true })).toBeVisible();
  await page.getByRole("tab", { name: "History", exact: true }).click();
  await expect(
    page.getByText("Outcome unknown", { exact: true }),
  ).toBeVisible();
  await expect(page.getByText("Missed", { exact: true })).toBeVisible();
  await expect(
    page.getByRole("button", { name: "Edit action", exact: true }),
  ).toHaveCount(0);
  expect(
    await page.evaluate(
      () => document.documentElement.scrollWidth <= innerWidth,
    ),
  ).toBe(true);
});
test("staff can edit their own action but cannot edit another actor's action without schedule permission @storybook-visual", async ({
  page,
}) => {
  await page.goto("/iframe.html?id=clubs-scheduled--staff&viewMode=story");
  await expect(
    page.getByRole("button", { name: "Edit action", exact: true }),
  ).toHaveCount(1);
  await expect(
    page.getByRole("button", { name: "Cancel action", exact: true }),
  ).toHaveCount(1);
});

test("immediate scheduled editor saves Now and preserves explicit timing choices @storybook-visual", async ({
  page,
}, testInfo) => {
  await page.clock.setFixedTime(new Date("2026-09-23T10:00:00Z"));
  await page.goto("/iframe.html?id=clubs-scheduled--immediate&viewMode=story");
  await page
    .getByRole("button", { name: "Edit action", exact: true })
    .first()
    .click();
  await expect(page.getByLabel("Timing", { exact: true })).toHaveValue(
    "immediate",
  );
  await expect(page.getByLabel("Execution time", { exact: true })).toHaveCount(
    0,
  );
  await expect(
    page.getByLabel("Minutes after event start", { exact: true }),
  ).toHaveCount(0);
  await page.getByLabel("Title", { exact: true }).fill("Immediate edit");
  await page.screenshot({
    path: `../../.cache/artifacts/immediate-editor-${testInfo.project.name}.png`,
    fullPage: true,
  });
  expect(
    await page.evaluate(
      () => document.documentElement.scrollWidth <= innerWidth,
    ),
  ).toBe(true);
  await page.getByRole("button", { name: "Save action", exact: true }).click();
  await expect(page.getByText("Immediate edit", { exact: true })).toBeVisible();
  await page
    .getByRole("button", { name: "Edit action", exact: true })
    .first()
    .click();
  await expect(page.getByLabel("Timing", { exact: true })).toHaveValue(
    "immediate",
  );
  await page.getByLabel("Timing", { exact: true }).selectOption("fixed");
  await page
    .getByLabel("Execution time", { exact: true })
    .fill("2026-09-24T19:30");
  await page.getByRole("button", { name: "Save action", exact: true }).click();
  await page
    .getByRole("button", { name: "Edit action", exact: true })
    .first()
    .click();
  await expect(page.getByLabel("Timing", { exact: true })).toHaveValue("fixed");
});
test("an obsolete editor must close and reopen before saving a newer revision @storybook-visual", async ({
  page,
}) => {
  await page.goto(
    "/iframe.html?id=clubs-scheduled--concurrent-edit&viewMode=story",
  );
  await page
    .getByRole("button", { name: "Edit action", exact: true })
    .first()
    .click();
  await page.getByLabel("Title", { exact: true }).fill("Stale title");
  await page.getByRole("button", { name: "Simulate other editor" }).click();
  await expect(
    page.getByText("Updated by Morgan", { exact: true }),
  ).toBeVisible();
  await page.getByRole("button", { name: "Save action", exact: true }).click();
  await expect(page.getByRole("alert")).toHaveText("Refresh to continue.");
  await expect(page.getByLabel("Title", { exact: true })).toHaveValue(
    "Stale title",
  );
  await page.getByRole("button", { name: "Save action", exact: true }).click();
  await expect(page.getByRole("alert")).toHaveText("Refresh to continue.");
  await page.getByRole("button", { name: "Cancel edit", exact: true }).click();
  await page
    .getByRole("button", { name: "Edit action", exact: true })
    .first()
    .click();
  await expect(page.getByLabel("Title", { exact: true })).toHaveValue(
    "Updated by Morgan",
  );
  await page.getByLabel("Title", { exact: true }).fill("Reviewed title");
  await page.getByRole("button", { name: "Save action", exact: true }).click();
  await expect(page.getByText("Reviewed title", { exact: true })).toBeVisible();
  await expect(page.getByRole("alert")).toHaveCount(0);
});
