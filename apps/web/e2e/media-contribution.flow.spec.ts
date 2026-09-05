import { createHash, randomBytes } from "node:crypto";
import { expect, test, type APIRequestContext, type Page } from "@playwright/test";
import {
  clerkTestAuthAvailability,
  cleanupClerkTestAccountData,
  createClerkTestAccount,
  deleteClerkTestAccountByEmail,
  signInClerkTestAccount,
} from "./clerk-auth";
import { mediaFixtureRunId } from "./media-run-id";

// Deliberately opt-in: a normal hosted smoke must not create media or claim fixtures.
const enabled = process.env.VRDEX_E2E_MEDIA_LIFECYCLE === "true";
test.use({ trace: "off", video: "off", actionTimeout: 15_000, navigationTimeout: 30_000 }); // OAuth exchanges must not enter retained traces.
test.describe.configure({ retries: 0 }); // Cleanup failure must never become a successful flaky run.

let cleanupFixture: (() => Promise<void>) | undefined;
test.afterEach(async () => {
  test.setTimeout(120_000); // Separate teardown budget even when the test times out.
  await cleanupFixture?.();
  cleanupFixture = undefined;
});

type Submission = { submissionId: string; status: string; approvedAssetId?: string };
type MediaResult = { replayed: boolean; submission: Submission };
type RpcResult<T> = { isError?: boolean; structuredContent?: T; content?: { type: string; text?: string }[] };

async function rpc<T>(request: APIRequestContext, token: string | undefined, name: string, args: Record<string, unknown>) {
  const response = await request.post("/mcp", {
    headers: {
      accept: "application/json, text/event-stream",
      ...(token ? { authorization: `Bearer ${token}` } : {}),
    },
    data: { jsonrpc: "2.0", id: 1, method: "tools/call", params: { name, arguments: args } },
  });
  const text = await response.text();
  const json = text.trim().startsWith("{") ? text : text.split(/\r?\n/).find((line) => line.startsWith("data: "))?.slice(6);
  const packet = json ? JSON.parse(json) as { result?: RpcResult<T>; error?: unknown } : undefined;
  return { status: response.status(), result: packet?.result, error: packet?.error };
}

async function call<T>(request: APIRequestContext, token: string | undefined, name: string, args: Record<string, unknown>) {
  const response = await rpc<T>(request, token, name, args);
  expect(response.status, `${name} HTTP status`).toBe(200);
  expect(Boolean(response.error), `${name} JSON-RPC error`).toBe(false);
  expect(response.result?.isError, `${name} tool error`).not.toBe(true);
  expect(response.result?.structuredContent !== undefined, `${name} structured result`).toBe(true);
  return response.result!.structuredContent!;
}

function expectRefusal(response: Awaited<ReturnType<typeof rpc>>, text: string) {
  expect(response.status, "Refusal HTTP status").toBe(200);
  expect(response.error, "Refusal must be a tool result").toBeUndefined();
  expect(response.result?.isError).toBe(true);
  expect(response.result?.content).toEqual([{ type: "text", text }]);
}

async function grant(page: Page, request: APIRequestContext, origin: string, runId: string) {
  const scopes = ["mcp:read", "mcp:write", "assets:contribute"];
  const redirectUri = `${origin}/oauth/e2e-callback`;
  const response = await page.request.post("/api/developer/oauth-apps", {
    headers: { origin },
    data: { clientType: "public", displayName: `Media fixture ${runId}`, redirectUris: [redirectUri], allowedScopes: scopes },
  });
  expect(response.status(), "Create narrow fixture OAuth application").toBe(200);
  const body = await response.json() as { application: { clientId: string } };
  const verifier = randomBytes(32).toString("base64url");
  const resource = `${origin}/mcp`;
  const params = new URLSearchParams({
    client_id: body.application.clientId, redirect_uri: redirectUri, resource,
    response_type: "code", scope: scopes.join(" "), state: runId,
    code_challenge: createHash("sha256").update(verifier).digest("base64url"), code_challenge_method: "S256",
  });
  await page.goto(`/oauth/authorize?${params}`);
  const transaction = await page.locator('input[name="transaction"]').inputValue();
  const consent = await page.request.post("/oauth/authorize/consent", {
    headers: { origin }, form: { decision: "approve", transaction }, maxRedirects: 0,
  });
  expect(consent.status(), "Authorize narrow contributor grant").toBe(303);
  const callback = new URL(consent.headers().location, origin);
  expect(callback.searchParams.get("state")).toBe(runId);
  const exchange = await request.post("/oauth/token", { form: {
    client_id: body.application.clientId, code: callback.searchParams.get("code")!,
    code_verifier: verifier, grant_type: "authorization_code", redirect_uri: redirectUri, resource,
  } });
  expect(exchange.status(), "Exchange contributor authorization code").toBe(200);
  const tokens = await exchange.json() as { access_token: string; refresh_token: string; scope: string };
  expect(tokens.scope.split(/\s+/).sort()).toEqual(scopes.sort());
  return { ...tokens, clientId: body.application.clientId };
}

test("contributor A submits and different owner B reviews media @media-lifecycle", async ({ browser, request, baseURL }, testInfo) => {
  test.skip(!enabled, "Explicit VRDEX_E2E_MEDIA_LIFECYCLE=true is required.");
  test.setTimeout(240_000);
  if (baseURL !== "https://staging.vrdex.net") throw new Error("Media lifecycle requires the designated staging origin.");
  if (!clerkTestAuthAvailability().available) throw new Error("Staging Clerk test auth is required.");
  const token = process.env.VRDEX_E2E_BROWSER_TOKEN;
  const expectedCommit = process.env.VRDEX_E2E_EXPECTED_COMMIT;
  if (!token || !/^[a-f0-9]{40}$/.test(expectedCommit ?? "")) throw new Error("Browser token and exact expected candidate SHA are required.");
  const headers = { "x-vrdex-e2e-token": token };
  const deployment = await request.get("/api/deployment");
  expect((await deployment.json()).commit).toBe(expectedCommit);
  const preflight = await request.get("/api/e2e/media", { headers });
  expect(preflight.status(), "Staging media flags, storage and fixture preflight").toBe(200);
  const sourceUrl = `${baseURL}/test-media/profile-image.png`;
  const source = await request.get(sourceUrl);
  expect(source.status(), "Public synthetic image source must be enabled before creating fixtures").toBe(200);
  expect(source.headers()["content-type"]).toMatch(/^image\//);

  const runId = mediaFixtureRunId(process.env);
  const existing = await request.post("/api/e2e/media", { headers, data: { op: "lookup", runId } });
  expect(existing.status(), "Check for an earlier fixture before creating accounts").toBe(200);
  expect((await existing.json()).profileId, "Recover an existing run before reusing its ID").toBeNull();
  console.info(`Media recovery run: ${runId}`);
  const emails: string[] = [];
  const contexts = await Promise.all([browser.newContext({ baseURL }), browser.newContext({ baseURL })]);
  const fixture: { profileId?: string; profileSlug?: string } = {};
  const stages: string[] = [];
  cleanupFixture = async () => {
    const { profileId, profileSlug } = fixture;
    const cleanupErrors: string[] = [];
    // An authenticated browser reprovisions a missing users row. Stop those
    // clients before deleting identities, including when the test timed out.
    const closed = await Promise.allSettled(contexts.map((context) => context.close()));
    if (closed.some((result) => result.status === "rejected")) cleanupErrors.push("browser context closure");
    if (profileId) {
      const cleanup = await request.delete("/api/e2e/media", { headers, data: { runId, profileId } }).catch(() => undefined);
      if (!cleanup?.ok()) cleanupErrors.push("media/profile cleanup");
      else if (profileSlug) {
        try {
          const absent = await rpc(request, undefined, "vrdex_get_profile", { slug: profileSlug });
          expectRefusal(absent, `Profile was not found for slug "${profileSlug}".`);
        } catch {
          cleanupErrors.push("profile absence readback");
        }
      }
    } else {
      // Creation may commit before its response is lost. No media call has run
      // without profileId, so the existing run-scoped profile cleanup is sufficient.
      const cleanup = await request.delete("/api/e2e/profile-submissions", { headers, data: { runId } }).catch(() => undefined);
      if (!cleanup?.ok()) cleanupErrors.push("profile creation recovery");
    }
    // Keep the fixture identities reachable if media cleanup needs operator recovery.
    if (cleanupErrors.length === 0) {
      for (const email of emails) {
        const cleaned = await cleanupClerkTestAccountData(request, token, { email }).catch(() => undefined);
        if (!cleaned?.ok()) { cleanupErrors.push("Convex account cleanup"); continue; }
        const deleted = await deleteClerkTestAccountByEmail(email);
        if (!deleted.checked || deleted.failed > 0) cleanupErrors.push("Clerk account cleanup");
        const absent = await cleanupClerkTestAccountData(request, token, { email }).catch(() => undefined);
        if (!absent?.ok() || (await absent.json()).deleted !== false) cleanupErrors.push("Convex account absence readback");
        const clerkAbsent = await deleteClerkTestAccountByEmail(email);
        if (!clerkAbsent.checked || clerkAbsent.failed > 0 || clerkAbsent.deleted !== 0) cleanupErrors.push("Clerk account absence readback");
      }
    }

    if (cleanupErrors.length) {
      await testInfo.attach("media-cleanup-recovery", { body: JSON.stringify({ runId, profileId, cleanupErrors }), contentType: "application/json" });
    }
    expect(cleanupErrors, "All fixture cleanup operations must succeed").toEqual([]);
    await testInfo.attach("media-lifecycle-evidence", { body: JSON.stringify({ candidate: expectedCommit, stages, cleanup: "verified", authority: "B assigned synthetic profile ownership; no live claim/provider proof" }), contentType: "application/json" });

  };
  const a = await createClerkTestAccount(`${runId}-contributor`, { onEmailReserved: (email) => emails.push(email) });
  const b = await createClerkTestAccount(`${runId}-reviewer`, { onEmailReserved: (email) => emails.push(email) });
  expect(a.clerkUserId === b.clerkUserId).toBe(false);
  const pageA = await contexts[0].newPage();
  const pageB = await contexts[1].newPage();
  await signInClerkTestAccount(pageA, a);
  await signInClerkTestAccount(pageB, b);
  const authA = await grant(pageA, request, baseURL, `${runId}-a`);
  const authB = await grant(pageB, request, baseURL, `${runId}-b`);

  const created = await request.post("/api/e2e/profile-submissions", { headers, data: {
    runId, profileType: "person", displayName: `Media test ${runId}`, roleTags: ["dj"],
  } });
  expect(created.status()).toBe(200);
  const profile = await created.json() as { profileId: string; slug: string };
  const profileId = profile.profileId;
  fixture.profileId = profileId;
  fixture.profileSlug = profile.slug;
  const before = await call<{ updatedAt: number; avatarImageUrl?: string }>(request, undefined, "vrdex_get_profile", { slug: profile.slug });
  const input = {
    slug: profile.slug, expectedUpdatedAt: before.updatedAt, idempotencyKey: `${runId}-image`,
    sourceUrl,
    credit: "VRDex synthetic staging fixture", altText: "Synthetic solid-color profile image",
  };
  const stale = await rpc(request, authA.access_token, "vrdex_profile_media_submit", {
    ...input, expectedUpdatedAt: before.updatedAt - 1, idempotencyKey: `${runId}-stale`,
  });
  expectRefusal(stale, "The profile changed after it was read. Read it again and submit with its current updatedAt and a new idempotency key.");
  const submitted = await call<MediaResult>(request, authA.access_token, "vrdex_profile_media_submit", input);
  expect(submitted.replayed).toBe(false);
  expect(submitted.submission.status).toBe("submitted");
  const replay = await call<MediaResult>(request, authA.access_token, "vrdex_profile_media_submit", input);
  expect(replay.replayed).toBe(true);
  expect(replay.submission.submissionId).toBe(submitted.submission.submissionId);
  const conflict = await rpc(request, authA.access_token, "vrdex_profile_media_submit", { ...input, credit: "Conflicting credit" });
  expectRefusal(conflict, "That idempotency key was already used for a different media submission request.");
  stages.push("submit, same-key replay and conflicting-key refusal");

  const own = await call<{ submissions: Submission[] }>(request, authA.access_token, "vrdex_list_my_media_submissions", {});
  expect(own.submissions.map((row) => row.submissionId)).toContain(submitted.submission.submissionId);
  const other = await call<{ submissions: Submission[] }>(request, authB.access_token, "vrdex_list_my_media_submissions", {});
  expect(other.submissions).toEqual([]);
  const unpublished = await call<{ avatarImageUrl?: string }>(request, undefined, "vrdex_get_profile", { slug: profile.slug });
  expect(unpublished.avatarImageUrl).toBe(before.avatarImageUrl);
  const inspect = await request.post("/api/e2e/media", { headers, data: { op: "inspect", runId, profileId } });
  expect(inspect.status()).toBe(200);
  expect((await inspect.json()).assets).toEqual([]);
  const privateFile = `/api/account/media-review/submissions/${submitted.submission.submissionId}/file`;
  const anonymousFile = await request.get(privateFile);
  expect(anonymousFile.status()).toBe(401);
  expect(await anonymousFile.json()).toEqual({ error: "Sign in required." });
  const contributorFile = await pageA.request.get(privateFile);
  expect(contributorFile.status()).toBe(403);
  expect(await contributorFile.json()).toEqual({ error: "Profile media review access is required." });
  await pageA.goto("/account/media-review");
  await expect(pageA.getByText("Profile media review access is required.")).toBeVisible();
  stages.push("caller-only status, public isolation and contributor review refusal");

  const assign = await request.post("/api/e2e/media", { headers, data: { op: "assign-review-owner", runId, profileId, reviewerEmail: b.email } });
  expect(assign.status(), "Assign only this synthetic profile to B").toBe(200);
  const claimedProfile = await call<{ updatedAt: number }>(request, undefined, "vrdex_get_profile", { slug: profile.slug });
  const claimed = await rpc(request, authA.access_token, "vrdex_profile_media_submit", {
    ...input, expectedUpdatedAt: claimedProfile.updatedAt, idempotencyKey: `${runId}-claimed`,
  });
  expectRefusal(claimed, "The public profile is claimed, so its owner manages profile media.");
  await pageB.goto("/account/media-review");
  await pageB.getByRole("button", { name: "Start review", exact: true }).click();
  await pageB.getByRole("combobox", { name: "Status", exact: true }).selectOption("under_review");
  await pageB.getByLabel("Private review reason", { exact: true }).fill("Synthetic two-user staging acceptance.");
  await pageB.getByRole("button", { name: "Approve", exact: true }).click();
  await expect.poll(async () => {
    const history = await call<{ submissions: Submission[] }>(request, authA.access_token, "vrdex_list_my_media_submissions", {});
    return history.submissions.find((row) => row.submissionId === submitted.submission.submissionId)?.status;
  }).toBe("approved");
  const approved = await request.post("/api/e2e/media", { headers, data: { op: "inspect", runId, profileId } });
  const approvedState = await approved.json() as { assets: { id: string; source: string; state: string }[] };
  expect(approvedState.assets).toHaveLength(1);
  expect(approvedState.assets[0].source).toBe("community_submitted");
  const published = await call<{ avatarImageUrl?: string }>(request, undefined, "vrdex_get_profile", { slug: profile.slug });
  expect(published.avatarImageUrl).toBeTruthy();
  expect((await request.get(published.avatarImageUrl!)).ok()).toBe(true);
  stages.push("different owner browser approval and one public community_submitted asset");

  const revoke = await request.post("/oauth/revoke", { form: { client_id: authA.clientId, token: authA.refresh_token, token_type_hint: "refresh_token" } });
  expect(revoke.status()).toBe(200);
  const refused = await rpc(request, authA.access_token, "vrdex_list_my_media_submissions", {});
  expect(refused.status).toBe(401);
  await call(request, undefined, "vrdex_get_profile", { slug: profile.slug });
  stages.push("revoked grant refusal with anonymous reads preserved");

});
