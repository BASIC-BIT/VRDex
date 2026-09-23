import { expect, test } from "@playwright/test";
import path from "node:path";
test("posts workspace saves drafts and queues confirmed writes @storybook-visual", async ({
  page,
  isMobile,
}) => {
  const errors: string[] = [];
  page.on("pageerror", (e) => errors.push(e.message));
  await page.goto(
    "/iframe.html?id=clubs-posts-workspace--owner&viewMode=story",
  );
  await expect(
    page.getByText("Welcome to Afterhours", { exact: true }),
  ).toBeVisible();
  await page.getByRole("button", { name: "New post", exact: true }).click();
  await page
    .getByRole("textbox", { name: "Title", exact: true })
    .fill("Friday doors");
  await page
    .getByRole("textbox", { name: "Post", exact: true })
    .fill("See you Friday.");
  await page.getByRole("button", { name: "Save draft" }).click();
  await expect(page.getByRole("status")).toHaveText("Draft saved.");
  await page.getByRole("button", { name: "Publish now" }).click();
  await expect(
    page.getByRole("dialog", { name: "Confirm post" }),
  ).toBeVisible();
  await page.getByRole("button", { name: "Confirm", exact: true }).click();
  await expect(page.getByRole("status")).toHaveText("Post queued.");
  await expect(
    page.getByText("pending", { exact: false }).first(),
  ).toBeVisible();
  await page.getByRole("button", { name: "Delete", exact: true }).click();
  await expect(
    page.getByRole("dialog", { name: "Delete post", exact: true }),
  ).toBeVisible();
  await page.getByRole("button", { name: "Cancel", exact: true }).click();
  await expect(
    page.getByText("Welcome to Afterhours", { exact: true }),
  ).toBeVisible();
  expect(
    await page.evaluate(
      () => document.documentElement.scrollWidth <= innerWidth,
    ),
  ).toBeTruthy();
  await page.screenshot({
    path: path.resolve(
      process.cwd(),
      "../../.cache/artifacts",
      `posts-workspace-${isMobile ? "mobile" : "desktop"}.png`,
    ),
    fullPage: true,
  });
  expect(errors).toEqual([]);
});
test("post preview and explicit scheduled confirmation @storybook-visual", async ({
  page,
  isMobile,
}) => {
  const errors: string[] = [];
  page.on("pageerror", (e) => errors.push(e.message));
  await page.goto("/iframe.html?id=clubs-posts--composer&viewMode=story");
  await page.getByRole("button", { name: "Preview", exact: true }).click();
  await expect(
    page.getByRole("article", { name: "Post preview" }),
  ).toContainText("Afterhours this Friday");
  await expect(
    page.getByRole("checkbox", { name: "Notify group members" }),
  ).not.toBeChecked();
  await page
    .getByRole("combobox", { name: "Publish", exact: true })
    .selectOption("event");
  await page
    .getByRole("combobox", { name: "Event", exact: true })
    .selectOption("fixture-event");
  await page.getByLabel("Minutes after event start").fill("-30");
  await page.getByRole("button", { name: "Schedule post" }).click();
  await expect(
    page.getByRole("dialog", { name: "Confirm post" }),
  ).toBeVisible();
  await expect(page.getByRole("status")).toHaveCount(0);
  await page.getByRole("button", { name: "Confirm", exact: true }).click();
  await expect(page.getByRole("status")).toHaveText(
    "Post queued: event_relative.",
  );
  expect(
    await page.evaluate(
      () => document.documentElement.scrollWidth <= innerWidth,
    ),
  ).toBeTruthy();
  await page.screenshot({
    path: path.resolve(
      process.cwd(),
      "../../.cache/artifacts",
      `posts-${isMobile ? "mobile" : "desktop"}.png`,
    ),
    fullPage: true,
  });
  expect(errors).toEqual([]);
});

for (const skew of [-3600000, 3600000]) {
  test(`immediate post retries saved revision after lost queue response with skew ${skew} @storybook-visual`, async ({
    page,
  }) => {
    await page.clock.setFixedTime(new Date(Date.now() + skew));
    await page.goto(
      "/iframe.html?id=clubs-posts-workspace--lost-queue-response&viewMode=story",
    );
    await page.getByRole("button", { name: "New post", exact: true }).click();
    await page
      .getByRole("textbox", { name: "Title", exact: true })
      .fill("Retry post");
    await page
      .getByRole("textbox", { name: "Post", exact: true })
      .fill("Same reviewed content.");
    await page
      .getByRole("button", { name: "Publish now", exact: true })
      .click();
    await page.getByRole("button", { name: "Confirm", exact: true }).click();
    await expect(page.getByRole("alert")).toHaveText("Queue response lost");
    await page.clock.setFixedTime(new Date(Date.now() + skew + 3600000));
    await page.getByRole("button", { name: "Confirm", exact: true }).click();
    await expect(page.getByRole("status")).toHaveText("Post queued.");
    await expect(page.getByRole("alert")).toHaveCount(0);
    await page.getByRole("button", { name: "Delete", exact: true }).click();
    await page
      .getByRole("button", { name: "Confirm deletion", exact: true })
      .click();
    await expect(page.getByRole("status")).toHaveText("Post deletion queued.");
    await page.getByRole("button", { name: "Edit", exact: true }).click();
    await page
      .getByRole("button", { name: "Queue changes", exact: true })
      .click();
    await page.getByRole("button", { name: "Confirm", exact: true }).click();
    await expect(page.getByRole("status")).toHaveText("Post queued.");
    await expect(page.getByRole("alert")).toHaveCount(0);
  });
}
