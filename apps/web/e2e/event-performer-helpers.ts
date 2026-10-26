import { expect, type Locator } from "@playwright/test";

export async function manualPerformer(field: Locator, label: string) {
  const input = field.getByRole("textbox", { name: "Performer", exact: true });
  if (await input.count()) await input.fill(label);
  else {
    await field.getByRole("combobox", { name: "Performer", exact: true }).fill(label);
    await field.getByRole("button", { name: "Add manual entry", exact: true }).click();
  }
  await expect(field.getByText("Unlinked", { exact: true })).toBeVisible();
}

export async function linkedPerformer(field: Locator, name: string) {
  const change = field.getByRole("button", { name: /^(Change|Link profile)$/ });
  if (await change.count()) await change.click();
  await field.getByRole("combobox", { name: "Performer", exact: true }).fill(name);
  await field.getByRole("option", { name: new RegExp(name, "i") }).click();
  await expect(field.getByTestId("selected-identity")).toContainText(name);
}
