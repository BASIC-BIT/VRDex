import { test, expect } from "@playwright/test";

for (const scenario of ["owner-analytics-off", "management-only-staff"]) {
  test(`${scenario} can review and close a provider-live instance @storybook-visual`, async ({
    page,
  }) => {
    const now = new Date("2026-09-22T23:00:00Z");
    await page.clock.setFixedTime(now);
    await page.goto(
      `/iframe.html?id=clubs-live-instance-management--${scenario}&viewMode=story`,
    );
    const live = page.getByRole("region", {
      name: "Live instances",
      exact: true,
    });
    await expect(
      live.getByText("The Observatory", { exact: true }),
    ).toBeVisible();
    if (scenario === "management-only-staff") {
      await expect(
        page.getByText("Instance history is restricted.", { exact: true }),
      ).toBeVisible();
      await expect(
        page.getByText("Past instances", { exact: true }),
      ).toHaveCount(0);
      await expect(page.getByText("Peak", { exact: true })).toHaveCount(0);
    }
    await live
      .getByRole("button", { name: "Close instance", exact: true })
      .click();
    await expect(page.getByTestId("submitted-close")).toHaveText("null");
    await expect(
      live.getByText("Close this instance to prevent new joins?", {
        exact: true,
      }),
    ).toBeVisible();
    await expect(
      live.getByText("wrld_33333333-3333-3333-3333-333333333333", {
        exact: true,
      }),
    ).toBeVisible();
    await expect(
      live.getByText(
        "123~group(grp_44444444-4444-4444-4444-444444444444)~region(use)",
        { exact: true },
      ),
    ).toBeVisible();
    expect(
      await page.evaluate(
        () => document.documentElement.scrollWidth <= innerWidth,
      ),
    ).toBe(true);
    await page.screenshot({
      path: `../../.cache/artifacts/pr341-final-fix-${scenario}-${test.info().project.name}.png`,
      fullPage: true,
    });
    await live.getByRole("button", { name: "Keep open", exact: true }).click();
    await expect(page.getByTestId("submitted-close")).toHaveText("null");
    await live
      .getByRole("button", { name: "Close instance", exact: true })
      .click();
    await live
      .getByRole("button", { name: "Confirm closure", exact: true })
      .click();
    await expect(
      live.getByText("Closure queued.", { exact: true }),
    ).toBeVisible();
    const submitted = JSON.parse(
      (await page.getByTestId("submitted-close").textContent())!,
    );
    expect(submitted).toEqual({
      communityProfileId: "club-one",
      requestId: expect.any(String),
      payloads: [
        {
          kind: "close_instance",
          worldId: "wrld_33333333-3333-3333-3333-333333333333",
          instanceId:
            "123~group(grp_44444444-4444-4444-4444-444444444444)~region(use)",
        },
      ],
      schedule: { kind: "fixed", dueAt: now.getTime() },
    });
    await live
      .getByRole("button", { name: "Next instances", exact: true })
      .click();
    await expect(
      live.getByText("Midnight Atrium", { exact: true }),
    ).toBeVisible();
    await expect(
      live.getByText("Closure queued.", { exact: true }),
    ).toHaveCount(0);
    await expect(
      live.getByRole("button", { name: "Confirm closure", exact: true }),
    ).toHaveCount(0);
    await live
      .getByRole("button", { name: "Previous instances", exact: true })
      .click();
    await expect(
      live.getByText("The Observatory", { exact: true }),
    ).toBeVisible();
    await live
      .getByRole("button", { name: "Refresh instances", exact: true })
      .click();
    await expect(
      live.getByText("The Observatory", { exact: true }),
    ).toBeVisible();
  });
}
for (const scenario of ["denied-staff", "instances-disabled"]) {
  test(`${scenario} has no live management capability @storybook-visual`, async ({
    page,
  }) => {
    await page.goto(
      `/iframe.html?id=clubs-live-instance-management--${scenario}&viewMode=story`,
    );
    await expect(
      page.getByRole("heading", { name: "Instances", exact: true }),
    ).toBeVisible();
    await expect(
      page.getByRole("region", { name: "Live instances", exact: true }),
    ).toHaveCount(0);
    await expect(
      page.getByRole("button", { name: "Close instance", exact: true }),
    ).toHaveCount(0);
    await expect(page.getByTestId("submitted-close")).toHaveText("null");
  });
}
test("live instance read errors can be refreshed @storybook-visual", async ({
  page,
}) => {
  await page.goto(
    "/iframe.html?id=clubs-live-instance-management--read-error&viewMode=story",
  );
  await expect(page.getByRole("alert")).toHaveText(
    "Unable to load data. Try refreshing.",
  );
  await page
    .getByRole("button", { name: "Refresh instances", exact: true })
    .click();
  await expect(
    page.getByText("The Observatory", { exact: true }),
  ).toBeVisible();
  await expect(page.getByRole("alert")).toHaveCount(0);
});
