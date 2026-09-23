import { test, expect } from "@playwright/test";
test("normal close requires confirmation and reports queued only @storybook-visual", async ({
  page,
}) => {
  await page.clock.setFixedTime(new Date(Date.now() - 3600000));
  await page.goto("/iframe.html?id=clubs-analytics--instances&viewMode=story");
  await page
    .getByRole("button", { name: "Midnight Atrium", exact: true })
    .first()
    .click();
  await page
    .getByRole("button", { name: "Close instance", exact: true })
    .click();
  await expect(
    page.getByText("Close this instance to prevent new joins?", {
      exact: true,
    }),
  ).toBeVisible();
  await expect(page.getByText("Closure queued.", { exact: true })).toHaveCount(
    0,
  );
  await page.getByRole("button", { name: "Keep open", exact: true }).click();
  await page
    .getByRole("button", { name: "Close instance", exact: true })
    .click();
  await page
    .getByRole("button", { name: "Confirm closure", exact: true })
    .click();
  await expect(
    page.getByText("Closure queued.", { exact: true }),
  ).toBeVisible();
});
test("instance options and event-relative schedule preserve reviewed values @storybook-visual", async ({
  page,
}) => {
  const now = new Date("2026-09-14T20:00:00Z");
  await page.clock.setFixedTime(now);
  await page.goto(
    "/iframe.html?id=clubs-instance-actions--create&viewMode=story",
  );
  await page
    .getByLabel("VRChat world ID")
    .fill("wrld_11111111-1111-1111-1111-111111111111");
  await page.getByLabel("18+", { exact: true }).check();
  await page.getByLabel("Restrict to group roles").check();
  await page.getByLabel("Performers", { exact: true }).check();
  await page.getByLabel("Linked event").selectOption("fixture-event");
  await page
    .getByRole("combobox", { name: "Create", exact: true })
    .selectOption("event_relative");
  await page.getByLabel("Minutes from event start").fill("-45");
  await expect(
    page.getByTestId("instance-scheduled-time").locator("time"),
  ).toHaveAttribute(
    "datetime",
    new Date(now.getTime() + 7 * 86400_000 - 45 * 60_000).toISOString(),
  );
  await page
    .getByRole("button", { name: "Schedule instance", exact: true })
    .click();
  await expect(page.getByRole("status")).toHaveText("Creation scheduled.");
  const submitted = JSON.parse(
    (await page.getByTestId("submitted-payload").textContent()) ?? "{}",
  );
  expect(submitted.value).toMatchObject({
    kind: "create_instance",
    access: "members",
    region: "use",
    ageGated: true,
    roleIds: ["grol_33333333-3333-3333-3333-333333333333"],
  });
  expect(submitted.schedule).toEqual({
    kind: "event_relative",
    eventId: "fixture-event",
    offsetMs: -2700000,
  });
  expect(
    await page.evaluate(
      () => document.documentElement.scrollWidth <= innerWidth,
    ),
  ).toBe(true);
  await page.screenshot({
    path: `../../.cache/artifacts/instance-actions-${test.info().project.name}.png`,
    fullPage: true,
  });
});
test("invalid world and missing event do not submit @storybook-visual", async ({
  page,
}) => {
  await page.goto(
    "/iframe.html?id=clubs-instance-actions--create&viewMode=story",
  );
  await page.getByLabel("VRChat world ID").fill("bad-id");
  await page
    .getByRole("button", { name: "Create instance", exact: true })
    .click();
  await expect(page.getByRole("alert")).toHaveText(
    "Enter a valid VRChat world ID.",
  );
  await page
    .getByLabel("VRChat world ID")
    .fill("wrld_11111111-1111-1111-1111-111111111111");
  await page
    .getByRole("combobox", { name: "Create", exact: true })
    .selectOption("event_relative");
  await page
    .getByRole("button", { name: "Schedule instance", exact: true })
    .click();
  await expect(page.getByRole("alert")).toHaveText("Select an event.");
  await expect(page.getByTestId("submitted-payload")).toHaveText("");
});

for (const skew of [-3600000, 3600000]) {
  test(`immediate creation preserves selected event with skew ${skew} @storybook-visual`, async ({
    page,
  }) => {
    await page.clock.setFixedTime(new Date(Date.now() + skew));
    await page.goto(
      "/iframe.html?id=clubs-instance-actions--create&viewMode=story",
    );
    await page
      .getByLabel("VRChat world ID")
      .fill("wrld_11111111-1111-1111-1111-111111111111");
    await page.getByLabel("Linked event").selectOption("fixture-event");
    await page
      .getByRole("button", { name: "Create instance", exact: true })
      .click();
    const submitted = JSON.parse(
      (await page.getByTestId("submitted-payload").textContent()) ?? "{}",
    );
    expect(submitted.schedule).toEqual({
      kind: "immediate",
      eventId: "fixture-event",
    });
  });
}
test("known event worlds prefill, switch and clear without replacing a staff override @storybook-visual", async ({
  page,
}, testInfo) => {
  await page.clock.setFixedTime(new Date("2026-09-14T20:00:00Z"));
  await page.goto(
    "/iframe.html?id=clubs-instance-actions--create&viewMode=story",
  );
  const world = page.getByLabel("VRChat world ID");
  const events = page.getByLabel("Linked event");
  const first = "wrld_11111111-1111-1111-1111-111111111111";
  const second = "wrld_22222222-2222-2222-2222-222222222222";
  const custom = "wrld_33333333-3333-3333-3333-333333333333";
  await expect(world).toHaveValue("");
  await events.selectOption("fixture-event");
  await expect(world).toHaveValue(first);
  await page
    .getByRole("combobox", { name: "Create", exact: true })
    .selectOption("event_relative");
  await page.getByLabel("Minutes from event start").fill("-45");
  await page.screenshot({
    path: `../../.cache/artifacts/event-world-prefill-${testInfo.project.name}.png`,
    fullPage: true,
  });
  await events.selectOption("second-event");
  await expect(world).toHaveValue(second);
  await expect(
    page.getByTestId("instance-scheduled-time").locator("time"),
  ).toHaveAttribute("datetime", "2026-09-22T19:15:00.000Z");
  await page.screenshot({
    path: `../../.cache/artifacts/event-world-switched-${testInfo.project.name}.png`,
    fullPage: true,
  });
  await events.selectOption("missing-world");
  await expect(world).toHaveValue("");
  await events.selectOption("fixture-event");
  await expect(world).toHaveValue(first);
  await events.selectOption("ambiguous-world");
  await expect(world).toHaveValue("");
  await events.selectOption("second-event");
  await expect(world).toHaveValue(second);
  await events.selectOption("");
  await expect(world).toHaveValue("");
  await events.selectOption("fixture-event");
  await world.fill(custom);
  for (const event of [
    "second-event",
    "missing-world",
    "ambiguous-world",
    "",
    "fixture-event",
  ]) {
    await events.selectOption(event);
    await expect(world).toHaveValue(custom);
  }
  await page
    .getByRole("button", { name: "Schedule instance", exact: true })
    .click();
  const submitted = JSON.parse(
    (await page.getByTestId("submitted-payload").textContent()) ?? "{}",
  );
  expect(submitted.value.worldId).toBe(custom);
  expect(submitted.schedule).toEqual({
    kind: "event_relative",
    eventId: "fixture-event",
    offsetMs: -2700000,
  });
  expect(
    await page.evaluate(
      () => document.documentElement.scrollWidth <= innerWidth,
    ),
  ).toBe(true);
});
