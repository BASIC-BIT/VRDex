import { expect, test } from "@playwright/test";
test("anonymous operator route requires sign-in before private payload @flow @fixture", async ({
  page,
}) => {
  await page.goto(
    "/playwright-afterglow-social/events/playwright-event-host-view/operate",
  );
  await expect(page).toHaveURL(/sign-in/);
  await expect(
    page.getByRole("heading", { name: "Afterglow Harbor Sessions" }),
  ).toHaveCount(0);
});
test("operator keeps execution separate, recovers hold, prevents double next and confirms stop @flow @fixture", async ({
  page,
}, info) => {
  const errors: string[] = [];
  page.on("pageerror", (error) => errors.push(error.message));
  page.on("console", (message) => {
    if (message.type() === "error") errors.push(message.text());
  });
  await page.goto("/playwright/event-operator");
  await expect(
    page.getByRole("heading", { name: "Afterglow Harbor Sessions" }),
  ).toBeVisible();
  await expect(page.getByText("publishing", { exact: true })).toBeVisible();
  await expect(page.getByText("reconnecting", { exact: true })).toBeVisible();
  await expect(
    page.getByRole("button", { name: "Select Nova" }),
  ).toBeDisabled();
  await page.getByRole("button", { name: "Select Aurora" }).click();
  await expect(
    page.getByText("Command pending", { exact: true }),
  ).toBeVisible();
  await expect(
    page.getByText("Observed output", { exact: true }).locator(".."),
  ).toContainText("Hold");
  await expect(
    page.getByText("Observed output", { exact: true }).locator(".."),
  ).toContainText("Aurora");
  await page
    .getByRole("button", { name: "Next", exact: true })
    .evaluate((button) => {
      if (button instanceof HTMLButtonElement) {
        button.click();
        button.click();
      }
    });
  await expect(page.getByLabel("Command count")).toHaveText("2");
  await expect(page.getByText("Command pending", { exact: true })).toHaveCount(
    0,
  );
  await page.getByRole("button", { name: "Hold current", exact: true }).click();
  await expect(page.getByText("Command pending", { exact: true })).toHaveCount(
    0,
  );
  await expect(
    page.getByText("Observed output", { exact: true }).locator(".."),
  ).toContainText("Aurora");
  await expect(
    page.getByText("Observed mode", { exact: true }).locator(".."),
  ).toContainText("manual");
  await page.getByRole("button", { name: "Show slate", exact: true }).click();
  await expect(
    page.getByText("Observed mode", { exact: true }).locator(".."),
  ).toContainText("hold");
  await expect(page.getByText("Command pending", { exact: true })).toHaveCount(
    0,
  );
  await page
    .getByRole("button", { name: "Return to auto", exact: true })
    .click();
  await expect(
    page.getByText("Observed mode", { exact: true }).locator(".."),
  ).toContainText("automatic");
  await expect(page.getByText("Command pending", { exact: true })).toHaveCount(
    0,
  );
  await expect(
    page.getByText("Commanded source", { exact: true }).locator(".."),
  ).toContainText("None");
  expect(errors).toEqual([]);
  await page
    .getByTestId("event-operator-controls")
    .screenshot({ path: info.outputPath("event-operator.png") });
  expect(
    await page.evaluate(
      () => document.documentElement.scrollWidth <= innerWidth,
    ),
  ).toBe(true);
  await page.getByRole("button", { name: "Stop", exact: true }).click();
  await expect(page.getByLabel("Command count")).toHaveText("5");
  await page.getByRole("button", { name: "Cancel", exact: true }).click();
  await page.getByRole("button", { name: "Stop", exact: true }).click();
  await page.getByRole("button", { name: "Confirm stop", exact: true }).click();
  await expect(page.getByLabel("Command count")).toHaveText("6");
});
test("failed commands and revoked capability remain safe @flow @fixture", async ({
  page,
}, info) => {
  await page.goto("/playwright/event-operator");
  await page.getByRole("button", { name: "Fail commands" }).click();
  await page.getByRole("button", { name: "Next", exact: true }).click();
  await expect(page.getByText("Command failed", { exact: true })).toBeVisible();
  await page.getByRole("button", { name: "Revoke capability" }).click();
  await expect(
    page.getByRole("button", { name: "Next", exact: true }),
  ).toBeDisabled();
  await page.getByRole("button", { name: "Fail worker" }).click();
  await expect(
    page.getByText("Worker", { exact: true }).locator(".."),
  ).toContainText("error");
  await expect(
    page.getByRole("link", { name: "Host view", exact: true }),
  ).toBeVisible();
  await page
    .getByTestId("event-operator-controls")
    .screenshot({ path: info.outputPath("event-operator-failure.png") });
});

test("stop stays available while a command is pending @flow @fixture", async ({
  page,
}) => {
  await page.goto("/playwright/event-operator");
  await page.getByRole("button", { name: "Hold request", exact: true }).click();
  await page.getByRole("button", { name: "Next", exact: true }).click();
  await expect(
    page.getByText("Command pending", { exact: true }),
  ).toBeVisible();
  expect(
    await page.getByRole("button", { name: "Stop", exact: true }).isEnabled(),
  ).toBe(true);
  await page.getByRole("button", { name: "Stop", exact: true }).click();
  await page
    .getByRole("button", { name: "Confirm stop", exact: true })
    .evaluate((button) => {
      if (button instanceof HTMLButtonElement) {
        button.click();
        button.click();
      }
    });
  await expect(page.getByLabel("Command count")).toHaveText("2");
  await expect(
    page.getByText("Worker", { exact: true }).locator(".."),
  ).toContainText("stopping");
});

test("stopped Twitch setup requires authorization and stays opt-in @flow @fixture", async ({
  page,
}) => {
  await page.goto("/playwright/event-operator");
  await page.getByText("Twitch setup", { exact: true }).click();
  await expect(
    page.getByLabel("Output account", { exact: true }),
  ).toBeDisabled();
  await page.getByRole("button", { name: "End session", exact: true }).click();
  await page
    .getByLabel("Output account", { exact: true })
    .selectOption("organizer-twitch");
  await expect(page.getByLabel("Channel", { exact: true })).toHaveValue(
    "afterglow",
  );
  await expect(page.getByLabel("Simulcast", { exact: true })).not.toBeChecked();
  await expect(
    page.getByRole("button", { name: "Save Twitch", exact: true }),
  ).toBeDisabled();
  await page
    .getByRole("checkbox", {
      name: "I confirm I am authorized to publish this event through the selected output account.",
    })
    .check();
  await page.getByLabel("Simulcast", { exact: true }).check();
  await page.getByRole("button", { name: "Save Twitch", exact: true }).click();
  await expect(page.getByLabel("Command count")).toHaveText("1");
});

test("expired destination observations never remain publishing @flow @fixture", async ({
  page,
}) => {
  await page.clock.install();
  await page.goto("/playwright/event-operator");
  await expect(page.getByText("publishing", { exact: true })).toBeVisible();
  await page.getByRole("button", { name: "Hold request", exact: true }).click();
  await page.getByRole("button", { name: "Next", exact: true }).click();
  await expect(
    page.getByText("Command pending", { exact: true }),
  ).toBeVisible();
  await page.clock.fastForward(16000);
  await expect(page.getByText("publishing", { exact: true })).toHaveCount(0);
  await expect(
    page.getByText("Unknown", { exact: true }).first(),
  ).toBeVisible();
});

test("stopped policy and start submit without claiming live output @flow @fixture", async ({
  page,
}) => {
  await page.goto("/playwright/event-operator");
  await page.getByRole("button", { name: "End session", exact: true }).click();
  await page.getByLabel("Maximum overrun (minutes)", { exact: true }).fill("5");
  await page.getByRole("button", { name: "Save policy", exact: true }).click();
  await expect(page.getByLabel("Command count")).toHaveText("1");
  await page
    .getByLabel("Primary output", { exact: true })
    .selectOption("primary");
  await page.getByRole("button", { name: "Start", exact: true }).click();
  await expect(page.getByLabel("Command count")).toHaveText("2");
  await expect(
    page.getByText("Worker", { exact: true }).locator(".."),
  ).toContainText("starting");
  await expect(page.getByText("publishing", { exact: true })).toHaveCount(0);
});
