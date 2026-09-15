import { randomUUID } from "node:crypto";
import { test, expect, type Page } from "@playwright/test";
import { ConvexHttpClient } from "convex/browser";
import { makeFunctionReference } from "convex/server";
import {
  clerkTestAuthAvailability,
  createClerkTestAccount,
  signInClerkTestAccount,
  cleanupClerkTestAccountData,
  deleteClerkTestAccountByEmail,
} from "./clerk-auth";
process.env.PLAYWRIGHT_NO_COPY_PROMPT = "1";
test.use({ trace: "off", video: "off", screenshot: "off" });
test.describe.configure({ retries: 0 });
let cleanupRun: (() => Promise<void>) | undefined;
test.afterEach(async () => {
  test.setTimeout(120000);
  try {
    await cleanupRun?.();
  } finally {
    cleanupRun = undefined;
  }
});
const query = (name: string) => makeFunctionReference<"query">(name);
const mutation = (name: string) => makeFunctionReference<"mutation">(name);
async function client(page: Page) {
  const token = await page.evaluate(async () =>
    (
      window as unknown as {
        Clerk: {
          session: {
            getToken(args: { template: string }): Promise<string | null>;
          };
        };
      }
    ).Clerk.session.getToken({ template: "convex" }),
  );
  if (!token) throw Error("Real Clerk token required");
  const c = new ConvexHttpClient(process.env.PLAYWRIGHT_CONVEX_URL!);
  c.setAuth(token);
  return c;
}
test("@flow real analytics history and persisted personal dashboard", async ({
  browser,
  request,
  baseURL,
}, info) => {
  test.skip(
    process.env.VRDEX_E2E_CLUB_ANALYTICS !== "true",
    "Explicit local analytics opt-in required",
  );
  test.setTimeout(180000);
  if (
    !clerkTestAuthAvailability().available ||
    !process.env.CLERK_SECRET_KEY?.startsWith("sk_test_")
  )
    throw Error("Development Clerk required");
  const url = new URL(process.env.PLAYWRIGHT_CONVEX_URL!);
  if (
    url.protocol !== "http:" ||
    !["localhost", "127.0.0.1"].includes(url.hostname)
  )
    throw Error("Local backend required");
  const runId = `analytics-${randomUUID()}`;
  info.annotations.push({ type: "fixture-run", description: runId });
  const helper = async (op: string, args: Record<string, unknown> = {}) => {
    const r = await request.post("/api/e2e/club-staff", {
      headers: { "x-vrdex-e2e-token": process.env.VRDEX_E2E_BROWSER_TOKEN! },
      data: { op, runId, ...args },
    });
    expect(r.status(), op).toBe(200);
    return r.json();
  };
  expect(await helper("lookup")).toBeNull();
  const emails: string[] = [];
  const provisioned = new Set<string>();
  const context = await browser.newContext({ baseURL });
  let fixture: { profileId: string; slug: string } | null = null;
  cleanupRun = async () => {
    fixture ??= await helper("lookup");
    if (fixture) {
      await helper("cleanupAnalytics", { profileId: fixture.profileId });
      await helper("cleanup", { profileId: fixture.profileId });
    }
    for (const email of emails) {
      if (provisioned.has(email)) {
        const r = await cleanupClerkTestAccountData(
          request,
          process.env.VRDEX_E2E_BROWSER_TOKEN!,
          { email },
        );
        expect(r?.ok()).toBe(true);
      }
      const r = await deleteClerkTestAccountByEmail(email);
      expect(r.checked && r.failed === 0).toBe(true);
    }
    await context.close();
  };
  const owner = await createClerkTestAccount(`${runId}-owner`, {
    onEmailReserved: (email) => emails.push(email),
  });
  const page = await context.newPage();
  page.setDefaultTimeout(15000);
  await signInClerkTestAccount(page, owner, {
    onAuthenticated: () => provisioned.add(owner.email),
  });
  fixture = await helper("seed", { ownerClerkUserId: owner.clerkUserId });
  const data = await helper("seedAnalytics", { profileId: fixture!.profileId });
  const ownerClient = await client(page);
  const club = { communitySlug: fixture!.slug };
  const root = `/account/communities/${fixture!.slug}`;
  await page.goto(root);
  await expect(
    page.getByRole("heading", { name: "Home", exact: true }),
  ).toBeVisible();
  await page.getByRole("button", { name: "Customize", exact: true }).click();
  await page.getByLabel("Preferred range").selectOption("7");
  await page
    .getByRole("button", { name: /Move .* down/ })
    .first()
    .click();
  await page
    .getByRole("button", { name: "Save dashboard", exact: true })
    .click();
  await expect(
    page.getByRole("button", { name: "Save dashboard", exact: true }),
  ).toHaveCount(0);
  const saved = await ownerClient.query(
    query("clubAnalytics:getContext"),
    club,
  );
  expect(saved.savedPersonal).toBe(true);
  expect(saved.preferences.rangeDays).toBe(7);
  await page.reload();
  await page.getByRole("button", { name: "Customize", exact: true }).click();
  await expect(page.getByLabel("Preferred range")).toHaveValue("7");
  expect(
    (await ownerClient.query(query("clubAnalytics:getContext"), club))
      .preferences.widgets,
  ).toEqual(saved.preferences.widgets);
  await page.getByRole("button", { name: "Close", exact: true }).click();
  await page.getByRole("link", { name: "Analytics", exact: true }).click();
  await expect(
    page.getByRole("heading", { name: "Analytics", exact: true }),
  ).toBeVisible();
  await page.getByLabel("Select month").fill("2026-09");
  await expect
    .poll(() => new URL(page.url()).searchParams.get("from"))
    .toBe("2026-09-01");
  await page.getByLabel("Inspect day").fill("2026-09-08");
  await expect
    .poll(() => new URL(page.url()).searchParams.get("day"))
    .toBe("2026-09-08");
  await page.goBack();
  await expect(page.getByLabel("Inspect day")).toHaveValue("");
  await page.goForward();
  await expect(page.getByLabel("Inspect day")).toHaveValue("2026-09-08");
  await page.goto(`${root}?from=2026-09-01&to=2026-09-30&day=2026-09-08`);
  await page
    .getByRole("button", { name: "VRChat instance", exact: true })
    .click();
  await expect
    .poll(() => new URL(page.url()).searchParams.get("instance"))
    .toBe(data.sessionId);
  await expect(
    page.getByText("Instance detail", { exact: true }),
  ).toBeVisible();
  await page.goBack();
  await expect(page.getByLabel("Inspect day")).toHaveValue("2026-09-08");
  await page.goForward();
  await expect(
    page.getByRole("button", { name: "Back to instances", exact: true }),
  ).toBeVisible();
  await page
    .getByRole("button", { name: "Back to instances", exact: true })
    .click();
  const bucket = await ownerClient.query(query("clubAnalytics:getBucket"), {
    ...club,
    startAt: data.startAt,
    endAt: data.endAt,
  });
  expect(bucket.population.peak).toBe(25);
  expect(bucket.membership.lastValue).toBeGreaterThan(1000);
  await page
    .getByRole("button", { name: "Back to range", exact: true })
    .click();
  await expect(page.getByLabel("Inspect day")).toHaveValue("");
  await ownerClient.mutation(mutation("clubStaff:seedPresetRoles"), club);
  const workspace = await ownerClient.query(
    query("clubStaff:getWorkspace"),
    club,
  );
  const role = workspace.roles.find(
    (r: { presetKey: string }) => r.presetKey === "event_staff",
  );
  const invite = await ownerClient.mutation(
    mutation("clubStaff:createStaffInvitation"),
    { ...club, roleIds: [role._id] },
  );
  const staff = await createClerkTestAccount(`${runId}-staff`, {
    onEmailReserved: (email) => emails.push(email),
  });
  const staffContext = await browser.newContext({ baseURL });
  try {
    const staffPage = await staffContext.newPage();
    await signInClerkTestAccount(staffPage, staff, {
      onAuthenticated: () => provisioned.add(staff.email),
    });
    const staffClient = await client(staffPage);
    await staffClient.mutation(mutation("clubStaff:acceptStaffInvitation"), {
      ...club,
      token: invite.token,
    });
    await ownerClient.mutation(mutation("clubStaff:setCategoryVisibility"), {
      ...club,
      category: "group_size",
      audience: "owner",
      staffRoleIds: null,
    });
    const restricted = await staffClient.query(
      query("clubAnalytics:getBucket"),
      { ...club, startAt: data.startAt, endAt: data.endAt },
    );
    expect(restricted.membership.lastValue).toBeNull();
    expect(restricted.membership.observedAt).toBeNull();
    expect(restricted.population.peak).toBe(25);
    await staffPage.goto(`${root}/analytics?from=2026-09-01&to=2026-09-30`);
    await expect(
      staffPage.getByRole("heading", { name: "Analytics", exact: true }),
    ).toBeVisible();
    expect(
      (await staffClient.query(query("clubAnalytics:getContext"), club))
        .readableCategories,
    ).not.toContain("group_size");
    expect(
      (await staffClient.query(query("clubAnalytics:getContext"), club))
        .savedPersonal,
    ).toBe(false);
  } finally {
    await staffContext.close();
  }
});
