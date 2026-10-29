import { expect, test } from "@playwright/test";

test("primary group requires explicit selection and clears when its link is removed @storybook-visual", async ({page}) => {
  await page.goto("/iframe.html?id=profiles-profile-editor--primary-group&viewMode=story");
  const primary = page.getByRole("combobox", {name: "Primary group", exact: true});
  await expect(primary).toHaveValue("https://vrc.group/TEST.1234");
  expect(await page.locator("form").evaluate(form => new FormData(form as HTMLFormElement).get("primaryGroupUrl"))).toBeNull();
  if (process.env.PLAYWRIGHT_CAPTURE_SCREENSHOTS !== "false") await page.screenshot({path: `../../.cache/artifacts/task-3-primary-group-${test.info().project.name}.png`, fullPage: true});
  await page.getByRole("button", {name: "Remove link", exact: true}).click();
  await expect(primary).toHaveValue("");
  await page.getByRole("button", {name: "Add link", exact: true}).click();
  await page.getByPlaceholder("https://", {exact: true}).fill("https://vrc.group/NEXT.1234");
  await expect(primary).toHaveValue("");
  await primary.selectOption("https://vrc.group/NEXT.1234");
  await expect(primary).toHaveValue("https://vrc.group/NEXT.1234");
  expect(await page.locator("form").evaluate(form => new FormData(form as HTMLFormElement).get("primaryGroupUrl"))).toBe("https://vrc.group/NEXT.1234");
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
});

test("a sole group is automatic until the contributor explicitly chooses None @storybook-visual", async ({page}) => {
  await page.goto("/iframe.html?id=profiles-profile-editor--sole-group&viewMode=story");
  const primary = page.getByRole("combobox", {name: "Primary group", exact: true});
  await expect(primary).toHaveValue("https://vrc.group/TEST.1234");
  expect(await page.locator("form").evaluate(form => new FormData(form as HTMLFormElement).get("primaryGroupUrl"))).toBeNull();
  await primary.selectOption("");
  expect(await page.locator("form").evaluate(form => new FormData(form as HTMLFormElement).get("primaryGroupUrl"))).toBe("");
  await primary.selectOption("https://vrc.group/TEST.1234");
  expect(await page.locator("form").evaluate(form => new FormData(form as HTMLFormElement).get("primaryGroupUrl"))).toBe("https://vrc.group/TEST.1234");
});
