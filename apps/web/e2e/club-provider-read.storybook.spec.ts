import { expect, test, type Page } from "@playwright/test";

async function open(page: Page, skew = 0) {
  await page.clock.install({ time: new Date(1_800_000_000_000 + skew) });
  await page.goto(
    "/iframe.html?id=clubs-provider-read--freshness&viewMode=story",
  );
  await expect(
    page.getByRole("button", { name: "Act", exact: true }),
  ).toBeEnabled();
}
const act = (page: Page) =>
  page.getByRole("button", { name: "Act", exact: true });

for (const skew of [-3_600_000, 3_600_000]) {
  test(`server-aged result expires with client clock skew ${skew} @storybook-visual`, async ({
    page,
  }) => {
    await open(page, skew);
    await page.clock.fastForward(10_000);
    await expect(act(page)).toBeEnabled();
    await page.clock.fastForward(5_100);
    await expect(act(page)).toBeDisabled();
  });
}

for (const action of [
  "Rerender",
  "Replay",
  "Remount",
  "Refresh",
  "Next page",
]) {
  test(`${action} does not renew cached observation age @storybook-visual`, async ({
    page,
  }) => {
    await open(page);
    await page.clock.fastForward(10_000);
    await page.getByRole("button", { name: action, exact: true }).click();
    await expect(act(page)).toBeEnabled();
    await page.clock.fastForward(5_100);
    await expect(act(page)).toBeDisabled();
    await page.getByRole("button", { name: "Remount", exact: true }).click();
    await expect(act(page)).toBeDisabled();
  });
}

test("long pending and running reads receive a fresh evaluation after success @storybook-visual", async ({
  page,
}) => {
  await open(page);
  await page.getByRole("button", { name: "Pending", exact: true }).click();
  await expect(act(page)).toBeDisabled();
  await page.clock.fastForward(70_000);
  await page.getByRole("button", { name: "Running", exact: true }).click();
  await expect(act(page)).toBeDisabled();
  await page
    .getByRole("button", { name: "Hold evaluation", exact: true })
    .click();
  await page
    .getByRole("button", { name: "Complete read", exact: true })
    .click();
  await expect(act(page)).toBeDisabled();
  await page
    .getByRole("button", { name: "Release evaluation", exact: true })
    .click();
  await expect(act(page)).toBeEnabled();
  await page.clock.fastForward(59_000);
  await expect(act(page)).toBeEnabled();
  await page.clock.fastForward(1_100);
  await expect(act(page)).toBeDisabled();
});

for (const action of [
  "Server stale",
  "Server failed",
  "Revoke access",
  "Expire request",
  "Clear params",
]) {
  test(`${action} overrides previously accepted evidence @storybook-visual`, async ({
    page,
  }) => {
    await open(page);
    await page.getByRole("button", { name: action, exact: true }).click();
    await expect(act(page)).toBeDisabled();
  });
}

test("a refresh returning a new observation enables actions again @storybook-visual", async ({
  page,
}) => {
  await open(page);
  await page.clock.fastForward(16_000);
  await expect(act(page)).toBeDisabled();
  await page
    .getByRole("button", { name: "Complete read", exact: true })
    .click();
  await page.getByRole("button", { name: "Refresh", exact: true }).click();
  await expect(act(page)).toBeEnabled();
  await page.clock.fastForward(59_000);
  await expect(act(page)).toBeEnabled();
  await page.clock.fastForward(1_100);
  await expect(act(page)).toBeDisabled();
});
