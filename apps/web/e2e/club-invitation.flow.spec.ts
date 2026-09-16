import { randomUUID } from "node:crypto";
import { clerk, setupClerkTestingToken } from "@clerk/testing/playwright";
import { expect, test, type Page } from "@playwright/test";
import { ConvexHttpClient } from "convex/browser";
import { makeFunctionReference } from "convex/server";
import {
  clerkTestAuthAvailability,
  cleanupClerkTestAccountData,
  createClerkTestAccount,
  deleteClerkTestAccountByEmail,
  signInClerkTestAccount,
} from "./clerk-auth";

// Tokens and one-time sign-in tickets must not enter retained browser artifacts.
process.env.PLAYWRIGHT_NO_COPY_PROMPT = "1";
test.use({ trace: "off", video: "off", screenshot: "off" });
test.describe.configure({ retries: 0 });
const enabled = process.env.VRDEX_E2E_CLUB_INVITATIONS === "true";
let cleanupFixture: (() => Promise<void>) | undefined;
test.afterEach(async () => {
  test.setTimeout(120_000);
  try {
    await cleanupFixture?.();
  } finally {
    cleanupFixture = undefined;
  }
});

async function sessionClient(page: Page, url: string) {
  const jwt = await page.evaluate(async () => {
    const clerkWindow = window as unknown as {
      Clerk: {
        session: {
          getToken(args: { template: string }): Promise<string | null>;
        };
      };
    };
    return clerkWindow.Clerk.session.getToken({ template: "convex" });
  });
  if (!jwt)
    throw new Error("A real Clerk convex-template session is required.");
  const client = new ConvexHttpClient(url);
  client.setAuth(jwt);
  return client;
}
const mutation = (name: string) =>
  makeFunctionReference<"mutation">(`clubStaff:${name}`);
const workspaceQuery = makeFunctionReference<"query">("clubStaff:getWorkspace");
const privateQuery = makeFunctionReference<"query">(
  "communityTelemetry:getPrivateDashboard",
);

test("@flow @club-invitations real invitation sign-in, acceptance and denials", async ({
  browser,
  request,
  baseURL,
}, testInfo) => {
  test.skip(
    !enabled,
    "Set VRDEX_E2E_CLUB_INVITATIONS=true with the documented disposable Clerk test setup.",
  );
  test.setTimeout(180_000);
  const auth = clerkTestAuthAvailability();
  if (!auth.available) throw new Error(auth.reason);
  const convexUrl =
    process.env.PLAYWRIGHT_CONVEX_URL ??
    process.env.NEXT_PUBLIC_CONVEX_URL ??
    process.env.CONVEX_URL;
  const browserToken = process.env.VRDEX_E2E_BROWSER_TOKEN;
  if (!baseURL || !convexUrl || !browserToken)
    throw new Error(
      "Base URL, matching Convex URL and E2E browser token are required.",
    );
  const target = new URL(convexUrl);
  if (
    !(
      target.origin === "https://scrupulous-corgi-247.convex.cloud" ||
      (target.protocol === "http:" &&
        ["127.0.0.1", "localhost"].includes(target.hostname))
    )
  )
    throw new Error(
      "Club invitation tests only run on local Convex or the designated staging deployment.",
    );
  if (!process.env.CLERK_SECRET_KEY?.startsWith("sk_test_"))
    throw new Error("A Clerk development instance is required.");
  const runId = `invite-${randomUUID()}`;
  testInfo.annotations.push({ type: "fixture-run", description: runId });
  const helper = async (op: string, args: Record<string, unknown> = {}) => {
    const response = await request.post("/api/e2e/club-staff", {
      headers: { "x-vrdex-e2e-token": browserToken },
      data: { op, runId, ...args },
    });
    expect(response.status(), `Club fixture ${op} status`).toBe(200);
    return response.json();
  };
  // Fail before creating Clerk accounts if this revision's helper is unavailable.
  expect(await helper("lookup")).toBeNull();
  const emails: string[] = [];
  const provisioned = new Set<string>();
  const contexts: Awaited<ReturnType<typeof browser.newContext>>[] = [];
  const pageFor = async () => {
    const context = await browser.newContext({ baseURL });
    contexts.push(context);
    return context.newPage();
  };
  let fixture: { profileId: string; slug: string } | null = null;
  cleanupFixture = async () => {
    try {
      // Recover even when the seed response was lost after the transaction committed.
      fixture ??= await helper("lookup");
      if (fixture) await helper("cleanup", { profileId: fixture.profileId });
      for (const email of emails) {
        if (provisioned.has(email)) {
          const response = await cleanupClerkTestAccountData(
            request,
            browserToken,
            { email },
          );
          if (!response?.ok())
            throw new Error(
              `Convex account cleanup failed for fixture run ${runId}.`,
            );
        }
        const cleanup = await deleteClerkTestAccountByEmail(email);
        expect(
          cleanup.checked && cleanup.failed === 0,
          "Disposable Clerk account cleanup",
        ).toBe(true);
      }
    } finally {
      await Promise.all(contexts.map((context) => context.close()));
    }
  };
  const owner = await createClerkTestAccount(`${runId}-owner`, {
    onEmailReserved: (email) => emails.push(email),
  });
  const ownerPage = await pageFor();
  await signInClerkTestAccount(ownerPage, owner, {
    onAuthenticated: () => provisioned.add(owner.email),
  });
  fixture = await helper("seed", { ownerClerkUserId: owner.clerkUserId });
  const ownerClient = await sessionClient(ownerPage, convexUrl);
  const club = { communitySlug: fixture!.slug };
  await ownerClient.mutation(mutation("seedPresetRoles"), club);
  const ownerWorkspace = await ownerClient.query(workspaceQuery, club);
  const eventRole = ownerWorkspace.roles.find(
    (role: { presetKey?: string }) => role.presetKey === "event_staff",
  );
  if (!eventRole) throw new Error("Event staff preset was not created.");
  const invite = await ownerClient.mutation(mutation("createStaffInvitation"), {
    ...club,
    roleIds: [eventRole._id],
  });
  const expired = await ownerClient.mutation(
    mutation("createStaffInvitation"),
    { ...club, roleIds: [eventRole._id] },
  );
  const revoked = await ownerClient.mutation(
    mutation("createStaffInvitation"),
    { ...club, roleIds: [eventRole._id] },
  );
  await helper("expireInvitation", {
    profileId: fixture!.profileId,
    invitationId: expired.invitationId,
  });
  await ownerClient.mutation(mutation("revokeStaffInvitation"), {
    ...club,
    invitationId: revoked.invitationId,
  });
  const recipient = await createClerkTestAccount(`${runId}-recipient`, {
    onEmailReserved: (email) => emails.push(email),
  });
  const recipientPage = await pageFor();
  await signInClerkTestAccount(recipientPage, recipient, {
    onAuthenticated: () => provisioned.add(recipient.email),
  });
  const recipientClient = await sessionClient(recipientPage, convexUrl);
  const root = `/account/communities/${fixture!.slug}`;
  await recipientPage.goto(root);
  await expect(
    recipientPage.getByText("You do not have access to this page.", {
      exact: true,
    }),
  ).toBeVisible();
  expect(await recipientClient.query(workspaceQuery, club)).toBeNull();
  await expect(recipientClient.query(privateQuery, club)).rejects.toThrow(
    /do not have access/,
  );
  await clerk.signOut({ page: recipientPage });
  await recipientPage.goto(root);
  await expect
    .poll(() => new URL(recipientPage.url()).pathname)
    .toBe("/sign-in");
  expect(new URL(recipientPage.url()).searchParams.get("returnTo")).toBe(root);

  const invitationPath = `${root}/invite/${invite.token}`;
  await recipientPage.goto(invitationPath);
  await expect(
    recipientPage.getByRole("link", { name: "Sign in to accept" }),
  ).toBeVisible();
  await recipientPage.getByRole("link", { name: "Sign in to accept" }).click();
  await expect
    .poll(() => new URL(recipientPage.url()).pathname === "/sign-in")
    .toBe(true);
  // Boolean assertions avoid echoing the one-time invitation URL in failure reports.
  expect(
    new URL(recipientPage.url()).searchParams.get("returnTo") ===
      invitationPath,
  ).toBe(true);
  await setupClerkTestingToken({ page: recipientPage });
  await clerk.signIn({ page: recipientPage, emailAddress: recipient.email });
  // No manual goto here: the mounted real SignIn must honor its return destination.
  await expect
    .poll(() => new URL(recipientPage.url()).pathname === invitationPath)
    .toBe(true);
  await expect(
    recipientPage.getByRole("button", { name: "Accept invitation" }),
  ).toBeVisible();
  await recipientPage
    .getByRole("button", { name: "Accept invitation" })
    .click();
  await expect
    .poll(() => new URL(recipientPage.url()).pathname === root)
    .toBe(true);
  await expect(
    recipientPage.getByRole("link", { name: "Home", exact: true }),
  ).toBeVisible();
  const acceptedClient = await sessionClient(recipientPage, convexUrl);
  expect((await acceptedClient.query(workspaceQuery, club)).actor.kind).toBe(
    "staff",
  );
  await acceptedClient.query(privateQuery, club); // May be null without a group connection, but must authorize.
  for (const invalid of [expired, revoked, invite]) {
    await recipientPage.goto(`${root}/invite/${invalid.token}`);
    await expect(
      recipientPage.getByText("This invitation is no longer valid.", {
        exact: true,
      }),
    ).toBeVisible();
    await expect(
      recipientPage.getByRole("button", { name: "Accept invitation" }),
    ).toHaveCount(0);
    await expect(
      acceptedClient.mutation(mutation("acceptStaffInvitation"), {
        ...club,
        token: invalid.token,
      }),
    ).rejects.toThrow(/no longer valid/);
  }
});
