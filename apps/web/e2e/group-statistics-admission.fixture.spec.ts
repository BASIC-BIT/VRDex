import { test, expect } from "@playwright/test";
import path from "node:path";
const route = "/playwright/group-statistics-admission";
const group = "grp_00000000-0000-4000-8000-000000000005";
const bot = "usr_00000000-0000-4000-8000-000000000005";
const evidence = path.resolve(process.cwd(), "../../.cache/group-statistics-admission-ui");

test("direct unclaimed community entry confirms the exact request once @visual", async ({ page }, info) => {
  await page.goto(route);
  await expect(page.getByRole("heading", { name: "Afterglow Social" })).toBeVisible();
  await expect(page.getByText("Unclaimed", { exact: true })).toBeVisible();
  const trigger = page.getByRole("button", { name: "Request to join", exact: true });
  await trigger.click();
  await page.getByRole("button", { name: "Back", exact: true }).click();
  await expect(trigger).toBeFocused();
  await trigger.click();
  await page.keyboard.press("Escape");
  await expect(trigger).toBeFocused();
  await trigger.click();
  const dialog = page.getByRole("dialog");
  await expect(dialog.getByText(group, { exact: true })).toBeVisible();
  await expect(dialog.getByText("Afterglow VRChat Group", { exact: true })).toBeVisible();
  await expect(dialog.getByText("public / request", { exact: true })).toBeVisible();
  await expect(dialog.getByText("Metadata checked", { exact: true })).toBeVisible();
  await expect(dialog.getByText(bot, { exact: true })).toBeVisible();
  await expect(dialog.getByRole("button", { name: "Confirm request" })).toBeDisabled();
  await dialog.getByLabel("Reason").fill("Aggregate statistics for this public community");
  await page.screenshot({ path: path.join(evidence, `${info.project.name}-request-confirmation.png`), fullPage: true });
  await dialog.getByRole("button", { name: "Confirm request" }).dblclick();
  await expect(page.getByText("Waiting for approval", { exact: true })).toBeVisible();
  await expect(page.getByTestId("calls")).toHaveText("admit");
  await expect(page.getByRole("button", { name: "Check status" })).toBeFocused();
  await page.reload();
  await expect(page.getByText("Waiting for approval", { exact: true })).toBeVisible();
  await page.getByRole("button", { name: "Check status" }).click();
  await expect(page.getByTestId("calls")).toHaveText("check");
  await page.getByRole("button", { name: "Cancel admission" }).click();
  await expect(page.getByText("Cleanup pending", { exact: true })).toBeVisible();
  await expect(page.getByText("Inspect the assigned bot in VRChat. Withdraw a remaining request manually. Cleanup requires operator reconciliation before capacity can be released.", { exact: true })).toBeVisible();
  await expect(page.getByRole("button", { name: "Request to join", exact: true })).toHaveCount(0);
  await page.evaluate(() => window.scrollTo(0, 0));
  await page.screenshot({ path: path.join(evidence, `${info.project.name}-cleanup-pending.png`), fullPage: true });
});

test("invite assignment exposes a fixed profile link and reports clipboard failure @visual", async ({ page }, info) => {
  await page.addInitScript(() => Object.defineProperty(navigator, "clipboard", { value: { writeText: () => Promise.reject(new Error("denied")) } }));
  await page.goto(`${route}?state=invite`);
  await page.getByRole("button", { name: "Assign bot", exact: true }).click();
  await page.getByRole("dialog").getByLabel("Reason").fill("Public aggregate invitation");
  await page.getByRole("button", { name: "Confirm assignment" }).click();
  await expect(page.getByText("Waiting for invitation", { exact: true })).toBeVisible();
  await expect(page.getByText("Ask a group admin to invite the displayed bot as an ordinary member.", { exact: true })).toBeVisible();
  await expect(page.getByRole("link", { name: "Open bot profile" })).toHaveAttribute("href", `https://vrchat.com/home/user/${bot}`);
  await page.getByRole("button", { name: "Copy bot ID" }).click();
  await expect(page.getByRole("region", { name: "Operator view: Group statistics" }).getByRole("alert")).toHaveText("Could not copy bot ID.");
  await page.evaluate(() => window.scrollTo(0, 0));
  await page.screenshot({ path: path.join(evidence, `${info.project.name}-invite-waiting.png`), fullPage: true });
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBeTruthy();
});

test("non-admin absence, capacity and lifecycle blocks", async ({ page }) => {
  await page.goto(`${route}?state=non-admin`);
  await expect(page.getByRole("heading", { name: "Group statistics" })).toHaveCount(0);
  for (const state of ["no-capacity", "paused", "ended", "cleanup_pending"]) {
    await page.goto(`${route}?state=${state}`);
    await expect(page.getByRole("button", { name: "Request to join", exact: true })).toHaveCount(state === "no-capacity" ? 1 : 0);
    if (state === "no-capacity") await expect(page.getByRole("button", { name: "Request to join", exact: true })).toBeDisabled();
  }
});

test("changed selection closes confirmation and requires review; server failure stays beside control", async ({ page }) => {
  await page.goto(`${route}?state=changed`);
  await page.getByRole("button", { name: "Request to join", exact: true }).click();
  await page.getByRole("dialog").getByLabel("Reason").fill("Review changed selection");
  await page.getByRole("button", { name: "Confirm request" }).click();
  await expect(page.getByRole("region", { name: "Operator view: Group statistics" }).getByRole("alert")).toContainText("Refresh required");
  await expect(page.getByRole("dialog")).not.toBeVisible();
  await expect(page.getByText("Collector Two", { exact: true })).toBeVisible();
  await expect(page.getByRole("button", { name: "Request to join", exact: true })).toBeFocused();
  await expect(page.getByTestId("calls")).toHaveText("admit");
});


test("stale metadata refreshes without admission, and clipboard success is reported", async ({ page }) => {
  await page.addInitScript(() => Object.defineProperty(navigator, "clipboard", { value: { writeText: () => Promise.resolve() } }));
  await page.goto(`${route}?state=stale`);
  await expect(page.getByRole("button", { name: "Request to join", exact: true })).toBeDisabled();
  await page.getByRole("button", { name: "Refresh metadata" }).click();
  await expect(page.getByTestId("calls")).toHaveText("refresh");
  await page.getByRole("button", { name: "Copy bot ID" }).click();
  await expect(page.getByRole("button", { name: "Bot ID copied" })).toBeVisible();
});

test("confirmed outstanding request cancellation explains manual reconciliation", async ({ page }) => {
  await page.goto(route);
  await page.getByRole("button", { name: "Request to join", exact: true }).click();
  await page.getByRole("dialog").getByLabel("Reason").fill("Confirm request cleanup");
  await page.getByRole("button", { name: "Confirm request" }).click();
  await page.getByRole("button", { name: "Cancel admission" }).click();
  await expect(page.getByText("Inspect the assigned bot in VRChat. Withdraw a remaining request manually. Cleanup requires operator reconciliation before capacity can be released.", { exact: true })).toBeVisible();
});
