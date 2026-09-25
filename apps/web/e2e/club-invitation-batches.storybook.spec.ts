import { test, expect } from "@playwright/test";
import path from "node:path";
const alice = "usr_11111111-1111-1111-1111-111111111111";
const bob = "usr_22222222-2222-2222-2222-222222222222";

test("an expired instance read cannot confirm an open invitation review @storybook-visual", async ({ page }) => {
  await page.goto("/iframe.html?id=clubs-invitation-batches--expiring-instance&viewMode=story");
  await page.getByLabel("Saved list").selectOption("list-one");
  await page.getByRole("combobox", { name: "Instance", exact: true }).selectOption("visible-instance");
  await page.getByRole("button", { name: "Review invitations", exact: true }).click();
  await expect(page.getByRole("button", { name: "Confirm invitations" })).toBeEnabled();
  await page.getByRole("button", { name: "Expire instance check" }).click();
  await expect(page.getByRole("button", { name: "Confirm invitations" })).toHaveCount(0);
  await expect(page.getByRole("combobox", { name: "Instance", exact: true })).toHaveValue("");
  await page.getByRole("button", { name: "Refresh instance check" }).click();
  await expect(page.getByRole("button", { name: "Confirm invitations" })).toHaveCount(0);
  await expect(page.getByTestId("queued-review")).toHaveCount(0);
});

test("a fresh result missing the reviewed instance clears its selection @storybook-visual", async ({ page }) => {
  await page.goto("/iframe.html?id=clubs-invitation-batches--omitted-instance&viewMode=story");
  await page.getByLabel("Saved list").selectOption("list-one");
  await page.getByRole("combobox", { name: "Instance", exact: true }).selectOption("visible-instance");
  await page.getByRole("button", { name: "Review invitations", exact: true }).click();
  await expect(page.getByRole("button", { name: "Confirm invitations" })).toBeEnabled();
  await page.getByRole("button", { name: "Omit instance" }).click();
  await expect(page.getByRole("button", { name: "Confirm invitations" })).toHaveCount(0);
  await expect(page.getByRole("combobox", { name: "Instance", exact: true })).toHaveValue("");
  await page.getByRole("button", { name: "Restore instance" }).click();
  await expect(page.getByRole("button", { name: "Confirm invitations" })).toHaveCount(0);
  await expect(page.getByLabel("VRChat user IDs")).toHaveValue(`${alice}\n${bob}`);
});

test("staff can load older pending invitations past the first hundred @storybook-visual", async ({ page }) => {
  await page.goto("/iframe.html?id=clubs-workspace--staff-invitations&viewMode=story");
  const revoke = page.getByRole("button", { name: "Revoke invitation" });
  await expect(revoke).toHaveCount(50);
  await page.getByRole("button", { name: "Load more invitations" }).click();
  await expect(revoke).toHaveCount(100);
  await page.getByRole("button", { name: "Load more invitations" }).click();
  await expect(revoke).toHaveCount(101);
  await expect(page.getByRole("button", { name: "Load more invitations" })).toHaveCount(0);
});

test("individual invitation eligibility requires an explicit check @storybook-visual", async ({
  page,
  isMobile,
}) => {
  await page.goto(
    "/iframe.html?id=clubs-invitations-workspace--owner&viewMode=story",
  );
  await page.getByLabel("Saved list").selectOption("list-one");
  await page.getByLabel("Destination").selectOption("instance");
  await page
    .getByRole("combobox", { name: "Instance", exact: true })
    .selectOption("instance-one");
  await page
    .getByRole("button", { name: "Review invitations", exact: true })
    .click();
  const rows = page
    .getByRole("list", { name: "Reviewed recipients" })
    .getByRole("listitem");
  await expect(
    page.getByText("Eligibility not checked", { exact: true }),
  ).toHaveCount(2);
  await rows.nth(0).getByRole("button", { name: "Check eligibility" }).click();
  await expect(rows.nth(0)).toContainText("Invitation check passed");
  await expect(page.getByRole("button", { name: "Confirm invitations" })).toBeEnabled();
  await expect(rows.nth(1)).toContainText("Eligibility not checked");
  await rows.nth(1).getByRole("button", { name: "Check eligibility" }).click();
  await expect(rows.nth(1)).toContainText("Not friends with bot");
  await expect(
    page.getByRole("link", { name: "Open assigned bot in VRChat" }),
  ).toBeVisible();
  await page.screenshot({
    path: path.resolve(
      process.cwd(),
      "../../.cache/artifacts",
      `invitation-eligibility-${isMobile ? "mobile" : "desktop"}.png`,
    ),
    fullPage: true,
  });
});

test("connected invitation workspace saves lists and cancels only unsent outcomes @storybook-visual", async ({
  page,
  isMobile,
}) => {
  const errors: string[] = [];
  page.on("pageerror", (error) => errors.push(error.message));
  await page.goto(
    "/iframe.html?id=clubs-invitations-workspace--owner&viewMode=story",
  );
  await page.getByLabel("Saved list").selectOption("list-one");
  await page.getByLabel("List name").fill("Friday attendees");
  await page.getByRole("button", { name: "Update list" }).click();
  await expect(page.getByRole("status")).toHaveText("List saved.");
  await page.getByLabel("Saved list").selectOption("list-one");
  await expect(page.getByLabel("List name")).toHaveValue("Friday attendees");
  await page
    .getByRole("button", { name: "Review invitations", exact: true })
    .click();
  await page.getByRole("button", { name: "Confirm invitations" }).click();
  await expect(page.getByRole("status")).toHaveText("Invitations queued.");
  await expect(page.getByText("Submitted", { exact: true })).toBeVisible();
  await expect(page.getByText("Pending", { exact: true })).toBeVisible();
  await page
    .getByRole("button", { name: "Cancel unsent invitations", exact: true })
    .click();
  await page.getByRole("button", { name: "Confirm cancellation" }).click();
  await expect(page.getByText("Cancelled", { exact: true })).toBeVisible();
  await expect(page.getByText("Submitted", { exact: true })).toBeVisible();
  expect(
    await page.evaluate(
      () => document.documentElement.scrollWidth <= innerWidth,
    ),
  ).toBeTruthy();
  await page.screenshot({
    path: path.resolve(
      process.cwd(),
      "../../.cache/artifacts",
      `invitation-workspace-${isMobile ? "mobile" : "desktop"}.png`,
    ),
    fullPage: true,
  });
  expect(errors).toEqual([]);
});

test("invitation list editing and frozen review @storybook-visual", async ({
  page,
  isMobile,
}) => {
  const errors: string[] = [];
  page.on("pageerror", (error) => errors.push(error.message));
  await page.goto(
    "/iframe.html?id=clubs-invitation-batches--composer&viewMode=story",
  );
  await page.getByLabel("Saved list").selectOption("list-one");
  await expect(page.getByLabel("VRChat user IDs")).toHaveValue(
    `${alice}\n${bob}`,
  );
  await page.getByLabel("List name").fill("Friday guests");
  await page.getByRole("button", { name: "Update list" }).click();
  await expect(page.getByRole("status")).toHaveText("List saved.");
  await page.getByLabel("VRChat user IDs").fill(`${alice},${bob},${alice}`);
  await page
    .getByRole("button", { name: "Review invitations", exact: true })
    .click();
  const review = page.getByRole("region", { name: "Review invitations" });
  await expect(review).toContainText("Duplicates removed: 1");
  await expect(
    page
      .getByRole("list", { name: "Reviewed recipients" })
      .getByRole("listitem"),
  ).toHaveCount(2);
  await expect(page.getByTestId("queued-review")).toHaveCount(0);
  await page.screenshot({
    path: path.resolve(
      process.cwd(),
      "../../.cache/artifacts",
      `invitation-review-${isMobile ? "mobile" : "desktop"}.png`,
    ),
    fullPage: true,
  });
  await page.getByRole("button", { name: "Confirm invitations" }).click();
  await expect(page.getByTestId("queued-review")).toHaveText(
    "2 recipients · group · immediate",
  );
  await page.getByLabel("Saved list").selectOption("list-one");
  await page.getByRole("button", { name: "Delete list", exact: true }).click();
  await page.getByRole("button", { name: "Confirm deletion" }).click();
  await expect(page.getByLabel("Saved list").locator("option")).toHaveCount(1);
  expect(errors).toEqual([]);
});

test("instance-only staff review a creation with event-relative timing @storybook-visual", async ({
  page,
  isMobile,
}) => {
  await page.goto(
    "/iframe.html?id=clubs-invitation-batches--instance-staff&viewMode=story",
  );
  await expect(
    page.getByLabel("Destination").locator('option[value="group"]'),
  ).toHaveCount(0);
  await page.getByLabel("Saved list").selectOption("list-one");
  await page.getByLabel("Destination").selectOption("scheduled_instance");
  await page
    .getByRole("combobox", { name: "Instance creation", exact: true })
    .selectOption("creation-one");
  await expect(
    page.getByRole("link", { name: "Open assigned bot in VRChat" }),
  ).toHaveAttribute("href", `https://vrchat.com/home/user/${alice}`);
  await page.getByRole("button", { name: "Review invitations", exact: true }).click();
  await expect(page.getByRole("region", { name: "Review invitations" })).toContainText("Now");
  await page.getByRole("button", { name: "Confirm invitations" }).click();
  await expect(page.getByRole("alert")).toContainText("Invitations cannot run before instance creation.");
  await page.getByRole("button", { name: "Back to edit" }).click();
  await page.getByLabel("Send invitations").selectOption("event");
  await page
    .getByRole("combobox", { name: "Event", exact: true })
    .selectOption("event-one");
  await page.getByLabel("Minutes after event start").fill("-15");
  expect(
    await page.evaluate(
      () => document.documentElement.scrollWidth <= innerWidth,
    ),
  ).toBeTruthy();
  await page.screenshot({
    path: path.resolve(
      process.cwd(),
      "../../.cache/artifacts",
      `invitation-composer-${isMobile ? "mobile" : "desktop"}.png`,
    ),
    fullPage: true,
  });
  await page
    .getByRole("button", { name: "Review invitations", exact: true })
    .click();
  await expect(
    page.getByRole("region", { name: "Review invitations" }),
  ).toContainText("9:45 PM");
  await page.getByRole("button", { name: "Confirm invitations" }).click();
  await expect(page.getByTestId("queued-review")).toHaveText(
    "2 recipients · scheduled_instance · event_relative",
  );
});


test("changed creation requires a fresh invitation review @storybook-visual", async ({ page }) => {
  await page.goto("/iframe.html?id=clubs-invitation-batches--changed-creation&viewMode=story");
  await page.getByLabel("Saved list").selectOption("list-one");
  await page.getByLabel("Destination").selectOption("scheduled_instance");
  await page.getByRole("combobox", { name: "Instance creation", exact: true }).selectOption("creation-one");
  await page.getByLabel("Send invitations").selectOption("event");
  await page.getByRole("combobox", { name: "Event", exact: true }).selectOption("event-one");
  await page.getByRole("button", { name: "Review invitations", exact: true }).click();
  const review = page.getByRole("region", { name: "Review invitations" });
  await expect(review).toContainText("wrld_33333333-3333-3333-3333-333333333333");
  await page.getByRole("button", { name: "Change creation" }).click();
  await expect(review).toContainText("wrld_33333333-3333-3333-3333-333333333333");
  await page.getByRole("button", { name: "Confirm invitations" }).click();
  await expect(page.getByRole("alert")).toHaveText("Instance creation is unavailable.");
  await expect(page.getByTestId("queued-review")).toHaveCount(0);
  await page.getByRole("button", { name: "Back to edit" }).click();
  await page.getByRole("button", { name: "Review invitations", exact: true }).click();
  await expect(review).toContainText("wrld_55555555-5555-5555-5555-555555555555");
  await page.getByRole("button", { name: "Confirm invitations" }).click();
  await expect(page.getByTestId("queued-review")).toHaveAttribute("data-creation-revision", "8");
});

for (const skew of [-3600000, 3600000]) {
  test(`immediate invitation review with skew ${skew} @storybook-visual`, async ({
    page,
  }) => {
    await page.clock.setFixedTime(new Date(Date.now() + skew));
    await page.goto(
      "/iframe.html?id=clubs-invitation-batches--composer&viewMode=story",
    );
    await page.getByLabel("Saved list").selectOption("list-one");
    await page
      .getByRole("button", { name: "Review invitations", exact: true })
      .click();
    await page.getByRole("button", { name: "Confirm invitations" }).click();
    await expect(page.getByTestId("queued-review")).toHaveText(
      "2 recipients · group · immediate",
    );
  });
}
