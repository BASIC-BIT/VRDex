import { expect, test } from "@playwright/test";
test("clearing member search restores the unfiltered directory @storybook-visual", async ({ page }) => {
  await page.goto("/iframe.html?id=clubs-members--owner&viewMode=story");
  await page.getByLabel("Search members").fill("Riley");
  await page.getByRole("button", { name: "Search", exact: true }).click();
  await expect(page.getByRole("button", { name: "Nova", exact: true })).toHaveCount(0);
  await page.getByRole("button", { name: "Clear search", exact: true }).click();
  await expect(page.getByLabel("Search members")).toHaveValue("");
  await expect(page.getByRole("button", { name: "Nova", exact: true })).toBeVisible();
  await expect(page.getByRole("button", { name: "Clear search", exact: true })).toHaveCount(0);
});

test("assigned bot remains inspectable when omitted from the directory @storybook-visual", async ({
  page,
}) => {
  await page.goto("/iframe.html?id=clubs-members--owner&viewMode=story");
  await page
    .getByRole("button", { name: "View assigned bot", exact: true })
    .click();
  await expect(
    page.getByRole("heading", { name: "Club bot", exact: true }),
  ).toBeVisible();
  await page.screenshot({
    path: `../../.cache/artifacts/member-bot-${test.info().project.name}.png`,
    fullPage: true,
  });
});
test("member search, pagination and confirmed actions @storybook-visual", async ({
  page,
}) => {
  await page.goto("/iframe.html?id=clubs-members--owner&viewMode=story");
  await expect(
    page.getByRole("button", { name: "Riley", exact: true }),
  ).toBeVisible();
  await page.getByRole("button", { name: "Next page" }).click();
  await expect(
    page.getByRole("button", { name: "Morgan", exact: true }),
  ).toBeVisible();
  await page.getByRole("button", { name: "Previous page" }).click();
  await page.getByRole("button", { name: "Riley", exact: true }).click();
  await expect(page.getByText("DJ", { exact: true })).toBeVisible();
  await page.getByRole("button", { name: "Close detail" }).click();
  await page.getByLabel("Search members").fill("Riley");
  await page.getByRole("button", { name: "Search", exact: true }).click();
  await expect(
    page.getByRole("button", { name: "Nova", exact: true }),
  ).toHaveCount(0);
  await page.getByRole("button", { name: "Ban member", exact: true }).click();
  await expect(page.getByText("Review action", { exact: true })).toBeVisible();
  await expect(page.getByText("Queued", { exact: true })).toHaveCount(0);
  await page.getByRole("button", { name: "Confirm action" }).click();
  await expect(page.getByText("Queued", { exact: true })).toBeVisible();
  await expect(page.getByText("Completed", { exact: true })).toHaveCount(0);
  await page
    .getByRole("button", { name: "Cancel action", exact: true })
    .click();
  await expect(page.getByText("Cancelled", { exact: true })).toBeVisible();
  expect(
    await page.evaluate(
      () => document.documentElement.scrollWidth <= innerWidth,
    ),
  ).toBe(true);
});
test("staff role picker only offers owner-permitted provider roles @storybook-visual", async ({
  page,
}) => {
  await page.goto("/iframe.html?id=clubs-members--staff&viewMode=story");
  await page
    .getByRole("checkbox", { name: "Select Riley", exact: true })
    .check();
  await expect(
    page.getByRole("option", { name: "DJ", exact: true }),
  ).toHaveCount(1);
  await expect(
    page.getByRole("option", { name: "Group admin", exact: true }),
  ).toHaveCount(0);
  await expect(
    page.getByRole("button", { name: "Ban member", exact: true }),
  ).toHaveCount(0);
  await expect(
    page.getByRole("tab", { name: "Bans", exact: true }),
  ).toHaveCount(0);
  await page
    .getByLabel("VRChat role", { exact: true })
    .selectOption({ label: "DJ" });
  await page
    .getByRole("button", { name: "Assign selected", exact: true })
    .click();
  await page.getByRole("button", { name: "Confirm action" }).click();
  await expect(page.getByText("Queued", { exact: true })).toBeVisible();
});
test("failed provider reads offer refresh without inventing members @storybook-visual", async ({
  page,
}) => {
  await page.goto("/iframe.html?id=clubs-members--read-failure&viewMode=story");
  await expect(page.getByRole("alert")).toContainText("Unable to load data");
  await expect(
    page.getByRole("button", { name: "Refresh", exact: true }),
  ).toBeEnabled();
  await expect(
    page.getByRole("button", { name: "Riley", exact: true }),
  ).toHaveCount(0);
});

test("requests support selected approval while removals remain individual @storybook-visual", async ({
  page,
}) => {
  await page.goto("/iframe.html?id=clubs-members--owner&viewMode=story");
  await page.getByRole("tab", { name: "Requests", exact: true }).click();
  await page
    .getByRole("checkbox", { name: "Select Riley", exact: true })
    .check();
  await page
    .getByRole("checkbox", { name: "Select Nova", exact: true })
    .check();
  await page
    .getByRole("button", { name: "Approve selected", exact: true })
    .click();
  await page
    .getByRole("button", { name: "Confirm action", exact: true })
    .click();
  await expect(page.getByText("Queued", { exact: true })).toHaveCount(2);
  await page.getByRole("tab", { name: "Invitations", exact: true }).click();
  await page
    .getByRole("button", { name: "Cancel invitation", exact: true })
    .first()
    .click();
  await page
    .getByRole("button", { name: "Confirm action", exact: true })
    .click();
  await expect(page.getByText("Queued", { exact: true })).toHaveCount(3);
  await page.getByRole("tab", { name: "Bans", exact: true }).click();
  await page
    .getByRole("button", { name: "Unban member", exact: true })
    .first()
    .click();
  await page
    .getByRole("button", { name: "Confirm action", exact: true })
    .click();
  await expect(page.getByText("Queued", { exact: true })).toHaveCount(4);
  await expect(page.getByRole("checkbox")).toHaveCount(0);
});

test("stale member pages disable new actions until refresh @storybook-visual", async ({
  page,
}) => {
  await page.clock.install();
  await page.goto("/iframe.html?id=clubs-members--owner&viewMode=story");
  await expect(
    page.getByRole("button", { name: "Ban member", exact: true }).first(),
  ).toBeEnabled();
  await page.clock.fastForward(61_000);
  await expect(
    page.getByRole("button", { name: "Ban member", exact: true }).first(),
  ).toBeDisabled();
  await expect(
    page.getByText("Refresh to continue.", { exact: true }),
  ).toBeVisible();
});

for (const skew of [-3600000, 3600000]) {
  test(`immediate member action with skew ${skew} @storybook-visual`, async ({
    page,
  }) => {
    await page.clock.setFixedTime(new Date(Date.now() + skew));
    await page.goto("/iframe.html?id=clubs-members--owner&viewMode=story");
    await page.getByLabel("Search members").fill("Riley");
    await page.getByRole("button", { name: "Search", exact: true }).click();
    await page.getByRole("button", { name: "Ban member", exact: true }).click();
    await page.getByRole("button", { name: "Confirm action" }).click();
    await expect(page.getByText("Queued", { exact: true })).toBeVisible();
  });
}
