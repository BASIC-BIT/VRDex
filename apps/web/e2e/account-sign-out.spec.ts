import { expect, test } from "@playwright/test";

test("sign-out confirmation supports cancel, keyboard dismissal, and a single confirm request", async ({ page }) => {
  await page.goto("/playwright/sign-out");

  const trigger = page.getByRole("button", { name: "Sign out" });
  await trigger.focus();
  await page.keyboard.press("Enter");

  const dialog = page.getByRole("dialog", { name: "Sign out?" });
  await expect(dialog).toBeVisible();
  await expect(dialog.getByText("This signs the current session out.")).toBeVisible();
  await expect(dialog.getByRole("button", { name: "Cancel" })).toBeFocused();

  await page.keyboard.press("Escape");
  await expect(dialog).toBeHidden();
  await expect(trigger).toBeFocused();
  await expect(page.getByLabel("Sign-out attempts")).toHaveText("Attempts: 0");

  await trigger.click();
  await dialog.getByRole("button", { name: "Cancel" }).click();
  await expect(dialog).toBeHidden();
  await expect(page.getByLabel("Sign-out attempts")).toHaveText("Attempts: 0");

  await trigger.click();
  const confirm = dialog.getByRole("button", { name: "Sign out" });
  await confirm.evaluate((element) => {
    const button = element as HTMLButtonElement;
    button.click();
    button.click();
  });
  await expect(dialog.getByRole("button", { name: "Signing out…" })).toBeDisabled();
  await expect(dialog.getByRole("button", { name: "Cancel" })).toBeDisabled();
  await expect(page.getByText("Signed out", { exact: true })).toBeVisible();
  await expect(page.getByLabel("Sign-out attempts")).toHaveText("Attempts: 1");
});

test("failed sign-out stays open, explains the failure, and can be retried", async ({ page }) => {
  await page.goto("/playwright/sign-out?state=failure");
  await page.getByRole("button", { name: "Sign out" }).click();

  const dialog = page.getByRole("dialog", { name: "Sign out?" });
  await dialog.getByRole("button", { name: "Sign out" }).click();

  await expect(dialog.getByRole("alert")).toHaveText("We couldn’t sign you out. Try again.");
  await expect(dialog.getByRole("button", { name: "Sign out" })).toBeEnabled();
  await expect(dialog.getByRole("button", { name: "Cancel" })).toBeEnabled();
  await expect(page.getByLabel("Sign-out attempts")).toHaveText("Attempts: 1");
});
