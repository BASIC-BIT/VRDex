import { devices, expect, test } from "@playwright/test";
// Fixture controls never initiate live provider probes.
test.beforeEach(async ({page})=>{await page.route('**/operate/status?*',route=>route.fulfill({json:{}}));});
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
    page.getByRole("button", { name: "Take Nova" }),
  ).toBeDisabled();
  await page.getByRole("button", { name: "Take Aurora" }).click();
  await expect(
    page.getByText("Preparing", { exact: true }),
  ).toBeVisible();
  await expect(page.getByRole("button", {name: "Cut to slate"})).toBeEnabled();
  await expect(
    page.getByText("Observed output", { exact: true }).locator(".."),
  ).toContainText("Slate");
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
  await expect(page.getByText(/^(Command pending|Preparing|Promoting)$/)).toHaveCount(
    0,
  );
  await page.getByRole("button", { name: "Hold current", exact: true }).click();
  await expect(page.getByText(/^(Command pending|Preparing|Promoting)$/)).toHaveCount(
    0,
  );
  await expect(
    page.getByText("Observed output", { exact: true }).locator(".."),
  ).toContainText("Aurora");
  await expect(
    page.getByText("Observed mode", { exact: true }).locator(".."),
  ).toContainText("manual");
  await page.getByRole("button", { name: "Cut to slate", exact: true }).click();
  await expect(
    page.getByText("Observed mode", { exact: true }).locator(".."),
  ).toContainText("hold");
  await expect(page.getByText(/^(Command pending|Preparing|Promoting)$/)).toHaveCount(
    0,
  );
  await page
    .getByRole("button", { name: "Return to auto", exact: true })
    .click();
  await expect(
    page.getByText("Observed mode", { exact: true }).locator(".."),
  ).toContainText("automatic");
  await expect(page.getByText(/^(Command pending|Preparing|Promoting)$/)).toHaveCount(
    0,
  );
  await expect(
    page.getByText("Desired source", { exact: true }).locator(".."),
  ).toContainText("Automatic");
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
  ).toContainText("Unknown");
  await expect(page.getByText("publishing", { exact: true })).toHaveCount(0);
});

for (const scenario of ["lease", "observation", "disconnected"] as const)
  test(`headline observation expires for ${scenario} without disabling cleanup @flow @fixture`, async ({
    page,
  }, info) => {
    await page.clock.install();
    await page.goto("/playwright/event-operator");
    await page
      .getByRole("button", { name: "Observe live", exact: true })
      .click();
    await expect(
      page.getByText("Worker", { exact: true }).locator(".."),
    ).toContainText("live");
    await expect(
      page.getByText("Observed output", { exact: true }).locator(".."),
    ).toContainText("Aurora");
    if (scenario === "lease")
      await page
        .getByRole("button", { name: "Expire lease", exact: true })
        .click();
    if (scenario === "observation")
      await page
        .getByRole("button", { name: "Stale observation", exact: true })
        .click();
    if (scenario === "disconnected") await page.clock.fastForward(16000);
    for (const label of ["Worker", "Observed output", "Observed mode"])
      await expect(
        page.getByText(label, { exact: true }).locator(".."),
      ).toContainText("Unknown");
    await expect(page.getByText("publishing", { exact: true })).toHaveCount(0);
    await expect(
      page.getByRole("button", { name: "Stop", exact: true }),
    ).toBeEnabled();
    await page
      .getByTestId("event-operator-controls")
      .screenshot({ path: info.outputPath(`operator-${scenario}.png`) });
    await page.getByRole("button", { name: "Stop", exact: true }).click();
    await page
      .getByRole("button", { name: "Confirm stop", exact: true })
      .click();
    await expect(page.getByLabel("Command count")).toHaveText("1");
  });

for (const terminal of ["error", "ended"] as const)
  test(`terminal ${terminal} retains worker status without reusing source or mode @flow @fixture`, async ({
    page,
  }) => {
    await page.goto("/playwright/event-operator");
    await page
      .getByRole("button", { name: "Observe live", exact: true })
      .click();
    await page
      .getByRole("button", {
        name: terminal === "error" ? "Fail worker" : "End session",
        exact: true,
      })
      .click();
    await expect(
      page.getByText("Worker", { exact: true }).locator(".."),
    ).toContainText(terminal);
    for (const label of ["Observed output", "Observed mode"])
      await expect(
        page.getByText(label, { exact: true }).locator(".."),
      ).toContainText("Unknown");
  });


test("terminal failure permits Start only after command settlement and actual task stop @flow @fixture", async ({ page }, info) => {
  await page.goto("/playwright/event-operator");
  await page.getByLabel("Primary output", { exact: true }).selectOption("primary");
  await page.getByRole("button", { name: "Claim startup", exact: true }).click();
  await page.getByRole("button", { name: "Fail worker", exact: true }).click();
  await expect(page.getByRole("button", { name: "Start", exact: true })).toBeDisabled();
  await page.getByRole("button", { name: "Settle commands", exact: true }).click();
  await expect(page.getByRole("button", { name: "Start", exact: true })).toBeDisabled();
  await page.getByTestId("event-operator-controls").screenshot({ path: info.outputPath("terminal-held.png") });
  await page.getByRole("button", { name: "Confirm task stopped", exact: true }).click();
  await expect(page.getByRole("button", { name: "Start", exact: true })).toBeEnabled();
  await page.getByTestId("event-operator-controls").screenshot({ path: info.outputPath("terminal-recovered.png") });
  await page.getByRole("button", { name: "Start", exact: true }).click();
  await expect(page.getByLabel("Command count")).toHaveText("1");
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
});


test("pre-session intent permits Start with the selected output @flow @fixture", async ({ page }, info) => {
  await page.goto("/playwright/event-operator");
  await page.getByRole("button", { name: "Queue before session", exact: true }).click();
  await page.getByLabel("Primary output", { exact: true }).selectOption("primary");
  await expect(page.getByRole("button", { name: "Start", exact: true })).toBeEnabled();
  await expect(page.getByRole("button", { name: "Next", exact: true })).toBeDisabled();
  await page.getByTestId("event-operator-controls").screenshot({ path: info.outputPath("pre-session-start.png") });
  await page.getByRole("button", { name: "Start", exact: true }).click();
  await expect(page.getByLabel("Command count")).toHaveText("1");
  await expect(page.getByLabel("Started output")).toHaveText("primary");
  await expect(page.getByText("queued", { exact: true }).first()).toBeVisible();
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
});


test("preparation Cancel, Cut, failure, and Stop keep encoded output distinct @flow @fixture",async({page},info)=>{
 await page.goto('/playwright/event-operator');
 await page.getByRole('button',{name:'Observe live',exact:true}).click();
 await page.getByRole('button',{name:'Hold preparation',exact:true}).click();
 await page.getByRole('button',{name:'Take Custom',exact:true}).click();
 await expect(page.getByText('Preparing',{exact:true})).toBeVisible();
 await expect(page.getByRole("button", {name: "Cut to slate"})).toBeEnabled();
 await expect(page.getByText('Observed output',{exact:true}).locator('..')).toContainText('Aurora');
 await expect(page.getByText('Pending source',{exact:true}).locator('..')).toContainText('Custom');
 await page.getByTestId('event-operator-controls').screenshot({path:info.outputPath('task8-preparing.png')});
 await page.getByRole('group',{name:'Preparation',exact:true}).getByRole('button',{name:'Cancel',exact:true}).click();
 await expect(page.getByText('Preparing',{exact:true})).toHaveCount(0);
 await expect(page.getByText('Observed output',{exact:true}).locator('..')).toContainText('Aurora');
 await page.getByRole('button',{name:'Take Custom',exact:true}).click();
 await page.getByRole('button',{name:'Fail preparation',exact:true}).click();
 await expect(page.getByText('Observed output',{exact:true}).locator('..')).toContainText('Aurora');
 await page.getByRole('button',{name:'Take Custom',exact:true}).click();
 await page.getByRole('button',{name:'Promote preparation',exact:true}).click();
 await expect(page.getByText('Promoting',{exact:true})).toBeVisible();
 await expect(page.getByRole('group',{name:'Preparation',exact:true})).toHaveCount(0);
 await page.getByRole('button',{name:'Cut to slate',exact:true}).click();
 await expect(page.getByText('superseded',{exact:true}).first()).toBeVisible();
 await expect(page.getByText('Observed output',{exact:true}).locator('..')).toContainText('Slate');
 await page.getByRole('button',{name:'Return to auto',exact:true}).click();
 await expect(page.getByText('Desired source',{exact:true}).locator('..')).toContainText('Automatic');
 await page.getByRole('button',{name:'Stop',exact:true}).click();
 await page.getByRole('button',{name:'Confirm stop',exact:true}).click();
 await expect(page.getByRole('button',{name:'Cut to slate',exact:true})).toBeDisabled();
});

test("Cut is independent of a held ordinary request and stale diagnostics @flow @fixture",async({page},info)=>{
 await page.clock.install();await page.goto('/playwright/event-operator');
 await page.getByRole('button',{name:'Hold request',exact:true}).click();
 await page.getByRole('button',{name:'Next',exact:true}).click();
 await expect(page.getByText('Command pending',{exact:true})).toBeVisible();
 await page.clock.fastForward(30_000);
 await page.getByText('Diagnostics',{exact:true}).click();
 await expect(page.getByText('CPU',{exact:true}).locator('..')).toContainText('Unknown');
 await expect(page.getByRole('button',{name:'Cut to slate',exact:true})).toBeEnabled();
 await page.getByRole('button',{name:'Cut to slate',exact:true}).click();
 await expect(page.getByLabel('Command count')).toHaveText('2');
 await page.getByTestId('event-operator-controls').screenshot({path:info.outputPath('task8-stale-diagnostics.png')});
});

test("custom replacement preserves source identity and active settings stay separate @flow @fixture",async({page},info)=>{
 await page.goto('/playwright/event-operator');
 await page.getByRole('button',{name:'Take Custom',exact:true}).click();
 await expect(page.getByText('Observed output',{exact:true}).locator('..')).toContainText('Custom');
 await page.getByRole('button',{name:'Replace Custom',exact:true}).click();
 await page.getByLabel('Source label',{exact:true}).fill('Replacement');
 await page.getByLabel('Source URL',{exact:true}).fill('https://www.twitch.tv/replacement');
 await page.getByRole('button',{name:'Replace source',exact:true}).click();
 await expect(page.getByRole('article',{name:'Replacement',exact:true})).toBeVisible();
 await expect(page.getByRole('article',{name:'Custom',exact:true})).toBeVisible();
 await expect(page.getByText('Observed output',{exact:true}).locator('..')).toContainText('Custom');
 await page.getByRole('button',{name:'Remove Replacement',exact:true}).click();
 await expect(page.getByRole('article',{name:'Replacement',exact:true})).toHaveCount(0);
 await expect(page.getByRole('button',{name:'Remove Aurora',exact:true})).toHaveCount(0);
 await page.getByLabel('Resolution',{exact:true}).selectOption('1080');
 await page.getByLabel('Frame rate',{exact:true}).selectOption('60');
 await page.getByLabel('Audio bitrate',{exact:true}).selectOption('320');
 await page.getByRole('button',{name:'Save settings',exact:true}).click();
 await expect(page.getByText('Active',{exact:true}).first().locator('..')).toContainText('720p30');
 await expect(page.getByText('Next start',{exact:true}).locator('..')).toContainText('1080p60');
 await page.getByTestId('event-operator-controls').screenshot({path:info.outputPath('task8-custom-settings.png')});
});

test.describe("Pixel 7 operator console", () => {
  const { defaultBrowserType, ...mobile } = devices["Pixel 7"];
  // Keep the project's browser worker; pass the device screen through contextOptions.
  test.use({ ...mobile, contextOptions: mobile });

  test("mobile preparation controls, diagnostics and next-start settings @flow @fixture", async ({ page }, info) => {
    info.annotations.push({
      type: "device-emulation",
      description: `Pixel 7 (${defaultBrowserType}) in ${info.project.name}; viewport ${mobile.viewport.width}x${mobile.viewport.height}; mobile/touch context, not a physical device`,
    });
    await page.goto("/playwright/event-operator");
    await page.getByRole("button", { name: "Observe live", exact: true }).click();
    await page.getByRole("button", { name: "Hold preparation", exact: true }).click();
    await page.getByRole("button", { name: "Take Custom", exact: true }).click();
    const controls = page.getByTestId("event-operator-controls");
    const cancel = page.getByRole("group", { name: "Preparation", exact: true })
      .getByRole("button", { name: "Cancel", exact: true });
    await expect(page.getByText("Preparing", { exact: true })).toBeVisible();
    await expect(page.getByRole("button", { name: "Cut to slate", exact: true })).toBeVisible();
    await expect(page.getByRole("button", { name: "Cut to slate", exact: true })).toBeEnabled();
    await expect(cancel).toBeVisible();
    await expect(cancel).toBeEnabled();
    const diagnostics = page.getByText("Diagnostics", { exact: true });
    await expect(diagnostics).toBeVisible();
    await expect(diagnostics).toBeEnabled();
    await diagnostics.click();
    await expect(page.getByText("CPU", { exact: true })).toBeVisible();
    await expect(page.getByText("Memory", { exact: true })).toBeVisible();
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
    await controls.screenshot({ path: info.outputPath("task8-operator-mobile-preparing.png") });

    await cancel.click();
    await expect(page.getByText(/^(Command pending|Preparing|Promoting)$/)).toHaveCount(0);
    await expect(page.getByText("Observed output", { exact: true }).locator("..")).toContainText("Aurora");
    await page.getByLabel("Resolution", { exact: true }).selectOption("1080");
    await page.getByLabel("Frame rate", { exact: true }).selectOption("60");
    await page.getByLabel("Audio bitrate", { exact: true }).selectOption("320");
    await page.getByRole("button", { name: "Save settings", exact: true }).click();
    await expect(page.getByText("Active", { exact: true }).first().locator("..")).toContainText("720p30 · 160 kbps");
    await expect(page.getByText("Next start", { exact: true }).locator("..")).toContainText("1080p60 · 320 kbps");
    await expect(page.getByText("CPU", { exact: true })).toBeVisible();
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
    await page.screenshot({ path: info.outputPath("task8-operator-mobile-settings.png"), fullPage: true });
  });
});

test('editor broadcast inputs preserve legacy VRCDN selection through save, reload and reset @flow @fixture',async({page})=>{
 await page.goto('/playwright/event-lineup?editor');
 await page.getByRole('navigation',{name:'Event editor',exact:true}).getByRole('button',{name:'Lineup',exact:true}).click();
 const rows=page.locator('[data-lineup-row]');
 await rows.nth(2).getByRole('combobox',{name:'Broadcast input',exact:true}).selectOption('vrcdn:lumen-main');
 await rows.first().getByRole('combobox',{name:'Broadcast input',exact:true}).selectOption('twitch:aurora');
 page.once('dialog',dialog=>dialog.accept());
 await page.getByRole('button',{name:'Unpublish and save draft',exact:true}).click();
 // The existing fixture starts published; accept its normal unpublish confirmation.
 await expect(page.getByRole('button',{name:'Save draft',exact:true})).toBeVisible();
 const stored=await page.evaluate(()=>JSON.parse(localStorage.getItem('event-lineup-fixture-v1-submission')!));
 expect(stored.lineup[2].selectedStreamId).toBe('removed-source');
 expect(stored.lineup[2].broadcastInput).toEqual({kind:'vrcdn',streamId:'lumen-main'});
 expect(stored.lineup[0].broadcastInput).toEqual({kind:'twitch',channel:'aurora'});
 await page.reload();
 await page.getByRole('navigation',{name:'Event editor',exact:true}).getByRole('button',{name:'Lineup',exact:true}).click();
 await expect(rows.first().getByRole('combobox',{name:'Broadcast input',exact:true})).toHaveValue('twitch:aurora');
 await rows.first().getByRole('combobox',{name:'Broadcast input',exact:true}).selectOption('');
 await page.getByRole('button',{name:'Save draft',exact:true}).click();
 await expect.poll(()=>page.evaluate(()=>JSON.parse(localStorage.getItem('event-lineup-fixture-v1-submission')!).lineup[0].broadcastInput)).toBeNull();
});

test('custom source creation rejects fetch endpoints and keeps provider failure independent from Take @flow @fixture',async({page})=>{
 await page.route('**/operate/status?*',route=>route.fulfill({status:503,json:{}}));
 await page.goto('/playwright/event-operator');
 await page.getByText('Custom source',{exact:true}).click();
 await page.getByLabel('Source label',{exact:true}).fill('New source');
 await page.getByLabel('Source URL',{exact:true}).fill('https://example.invalid/private');
 await page.getByRole('button',{name:'Add source',exact:true}).click();
 await expect(page.getByText('Save failed',{exact:true})).toBeVisible();
 await expect(page.getByRole('article',{name:'New source',exact:true})).toHaveCount(0);
 await page.getByLabel('Source URL',{exact:true}).fill('https://www.twitch.tv/new_source');
 await page.getByRole('button',{name:'Add source',exact:true}).click();
 const source=page.getByRole('article',{name:'New source',exact:true});
 await expect(source.getByRole('link',{name:'Open',exact:true})).toHaveAttribute('href','https://www.twitch.tv/new_source');
 await expect(source.getByRole('button',{name:'Take New source',exact:true})).toBeEnabled();
 await source.getByRole('button',{name:'Remove New source',exact:true}).click();await expect(source).toHaveCount(0);
});
