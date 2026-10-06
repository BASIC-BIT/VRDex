import sharp from "sharp";
import type { PublishedContributionDetail } from "@vrdex/api-contracts";
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
import { mediaCleanupFailure } from "./media-recovery-cleanup";

// Deliberately opt-in: a normal hosted smoke must not create media or claim fixtures.
const cleanupOnly = process.env.VRDEX_E2E_MEDIA_CLEANUP_PROOF === "true";
const uploadCleanupOnly = process.env.VRDEX_E2E_MEDIA_UPLOAD_CLEANUP_PROOF === "true";
const enabled = cleanupOnly || uploadCleanupOnly || process.env.VRDEX_E2E_MEDIA_LIFECYCLE === "true";
test.use({ trace: "off", video: "off", actionTimeout: 15_000, navigationTimeout: 30_000 }); // OAuth exchanges must not enter retained traces.
test.describe.configure({ retries: 0 }); // Cleanup failure must never become a successful flaky run.

let cleanupFixture: (() => Promise<void>) | undefined;
test.afterEach(async () => {
  test.setTimeout(cleanupOnly ? 120_000 : 13 * 60_000); // A minted S3 POST must expire before teardown.
  await cleanupFixture?.();
  cleanupFixture = undefined;
});

type Submission = { submissionId: string; status: string; approvedAssetId?: string; publicDisposition?: string };
type MediaResult = { replayed: boolean; submission: Submission };
type UploadTarget = { intentId: string; expiresAt: number; transfer: { method: "POST"; url: string; fields: Record<string, string>; fileField: "file" } };
type UploadReceipt = { operationId: string; operationState: string; resourceId?: string };
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
  const scopes = ["mcp:read", "assets:review:read", "mcp:write", "assets:contribute", "assets:publish", "assets:review:write"];
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

test("contributor A submits and distinct assigned reviewer B reviews media @media-lifecycle", async ({ browser, request, baseURL }, testInfo) => {
  test.skip(!enabled, "Explicit media lifecycle or cleanup proof opt-in is required.");
  if ([cleanupOnly, uploadCleanupOnly, process.env.VRDEX_E2E_MEDIA_LIFECYCLE === "true"].filter(Boolean).length !== 1)
    throw new Error("Select one media proof mode.");
  test.setTimeout(420_000);
  if (baseURL !== "https://staging.vrdex.net") throw new Error("Media lifecycle requires the designated staging origin.");
  if (!clerkTestAuthAvailability().available) throw new Error("Staging Clerk test auth is required.");
  const token = process.env.VRDEX_E2E_BROWSER_TOKEN;
  const expectedCommit = process.env.VRDEX_E2E_EXPECTED_COMMIT;
  if (!token || !/^[a-f0-9]{40}$/.test(expectedCommit ?? "")) throw new Error("Browser token and exact expected candidate SHA are required.");
  const headers = { "x-vrdex-e2e-token": token };
  const deployment = await request.get("/api/deployment");
  expect((await deployment.json()).commit).toBe(expectedCommit);
  const preflight = await request.get(cleanupOnly ? "/api/e2e/media?mode=cleanup" : "/api/e2e/media", { headers });
  expect(preflight.status(), "Staging media flags, storage and fixture preflight").toBe(200);
  const sourceUrl = `${baseURL}/test-media/profile-image.png`;
  const source = await request.get(sourceUrl);
  expect(source.status(), "Public synthetic image source must be enabled before creating fixtures").toBe(200);
  expect(source.headers()["content-type"]).toMatch(/^image\//);
  const rejectionSourceUrl = `${baseURL}/test-media/rejected-image.png`;
  const rejectionSource = await request.get(rejectionSourceUrl);
  expect(rejectionSource.status()).toBe(200);
  expect(rejectionSource.headers()["content-type"]).toMatch(/^image\//);

  const runId = mediaFixtureRunId(process.env);
  const existing = await request.post("/api/e2e/media", { headers, data: { op: "lookup", runId } });
  expect(existing.status(), "Check for an earlier fixture before creating accounts").toBe(200);
  expect((await existing.json()).profileId, "Recover an existing run before reusing its ID").toBeNull();
  console.info(`Media recovery run: ${runId}`);
  const emails: string[] = [];
  const contexts = await Promise.all([browser.newContext({ baseURL }), browser.newContext({ baseURL })]);
  const fixture: { profileId?: string; profileSlug?: string; expectedReservations?: number;
    expiringTransfer?: { url: string; fields: Record<string, string>; fileField: "file"; image: Buffer };
    pendingUpload?: { intentId: string; safeAfter: number } } = {};
  const stages: string[] = [];
  cleanupFixture = async () => {
    const { profileId, profileSlug } = fixture;
    const cleanupErrors: string[] = [];
    // An authenticated browser reprovisions a missing users row. Stop those
    // clients before deleting identities, including when the test timed out.
    const closed = await Promise.allSettled(contexts.map((context) => context.close()));
    if (closed.some((result) => result.status === "rejected")) cleanupErrors.push("browser context closure");
    if (profileId) {
      if (fixture.pendingUpload && fixture.expiringTransfer && cleanupErrors.length === 0) {
        while (Date.now() < fixture.pendingUpload.safeAfter)
          await new Promise((resolve) => setTimeout(resolve,
            Math.min(60_000, Math.max(1_000, fixture.pendingUpload!.safeAfter - Date.now() + 1_000))));
        const replay = await request.post(fixture.expiringTransfer.url, { multipart: {
          ...fixture.expiringTransfer.fields,
          [fixture.expiringTransfer.fileField]: {
            name: "fixture.png", mimeType: "image/png", buffer: fixture.expiringTransfer.image,
          },
        } }).catch(() => undefined);
        if (replay?.status() !== 403) cleanupErrors.push("expired abandoned S3 POST replay refusal");
        else {
          fixture.expiringTransfer = undefined;
          const proof = await request.post("/api/e2e/media", { headers, data: {
            op: "worker-upload-proof", runId, profileId, intentId: fixture.pendingUpload.intentId,
          } }).catch(() => undefined);
          const result = await proof?.json().catch(() => null) as { workerReclaimedUpload?: boolean } | null | undefined;
          if (!proof?.ok() || !result?.workerReclaimedUpload)
            cleanupErrors.push("authenticated abandoned upload worker cleanup");
          else stages.push("abandoned direct S3 upload reclaimed by worker with exact object and capacity readback");
        }
      }
      let cleanup: Awaited<ReturnType<typeof request.delete>> | undefined;
      const deadline = Date.now() + 12 * 60_000;
      while (cleanupErrors.length === 0 && Date.now() < deadline) {
        const attempt = await request.delete("/api/e2e/media", { headers, data: { runId, profileId } }).catch(() => undefined);
        if (attempt?.status() !== 409) { cleanup = attempt; break; }
        const pending = await attempt.json().catch(() => null) as { retryAt?: number } | null;
        if (typeof pending?.retryAt !== "number") { cleanup = attempt; break; }
        const retryAt = pending.retryAt;
        await new Promise((resolve) => setTimeout(resolve,
          Math.min(60_000, Math.max(1_000, retryAt - Date.now() + 1_000))));
        if (fixture.expiringTransfer && Date.now() >= retryAt) {
          const replay = await request.post(fixture.expiringTransfer.url, { multipart: {
            ...fixture.expiringTransfer.fields,
            [fixture.expiringTransfer.fileField]: {
              name: "fixture.png", mimeType: "image/png", buffer: fixture.expiringTransfer.image,
            },
          } }).catch(() => undefined);
          if (replay?.status() !== 403) {
            cleanupErrors.push("expired minted S3 POST replay refusal");
            break; // Preserve the frozen fixture and its object keys for recovery.
          }
          stages.push("expired minted S3 POST replay refused before exact object deletion");
          fixture.expiringTransfer = undefined;
        }
      }
      if (cleanupErrors.length === 0 && !cleanup?.ok())
        cleanupErrors.push(cleanup
          ? mediaCleanupFailure(cleanup.status(), await cleanup.json().catch(() => null))
          : "media/profile cleanup (no response)");
      if (cleanup?.ok()) {
        const result = await cleanup.json() as { alreadyDeleted?: boolean; deletedObjects?: number; releasedReservations?: number };
        if (!result.alreadyDeleted && fixture.expectedReservations !== undefined &&
          (result.releasedReservations !== fixture.expectedReservations || !result.deletedObjects))
          cleanupErrors.push("exact S3 and reservation cleanup readback");
      }
      if (cleanup?.ok() && profileSlug) {
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
    await testInfo.attach("media-lifecycle-evidence", { body: JSON.stringify({ candidate: expectedCommit, stages, cleanup: "verified", authority: "B assigned media_reviewer for publication/replacement; synthetic ownership only for final claim refusal" }), contentType: "application/json" });

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
  if (uploadCleanupOnly) {
    const image = await source.body();
    const target = await call<UploadTarget>(request, authA.access_token, "vrdex_media_upload_begin", {
      mode: "contributor", profileId, expectedUpdatedAt: before.updatedAt,
      placement: "profile_image", contentType: "image/png", byteLength: image.byteLength,
      sha256: createHash("sha256").update(image).digest("hex"),
      credit: "VRDex synthetic staging fixture", sourceDescription: "Synthetic solid-color profile image",
      idempotencyKey: `${runId}-abandoned`,
    });
    expect(target.transfer.method).toBe("POST");
    expect(target.expiresAt).toBeGreaterThan(Date.now());
    fixture.expiringTransfer = { ...target.transfer, image };
    const transfer = await request.post(target.transfer.url, { multipart: {
      ...target.transfer.fields,
      [target.transfer.fileField]: { name: "fixture.png", mimeType: "image/png", buffer: image },
    } });
    expect([201, 204], "Abandoned S3 multipart transfer").toContain(transfer.status());
    fixture.pendingUpload = { intentId: target.intentId, safeAfter: target.expiresAt + 60_000 };
    fixture.expectedReservations = 1;
    stages.push("run-scoped contributor upload posted to minted S3 endpoint and left pending");
    return;
  }
  const input = {
    slug: profile.slug, expectedUpdatedAt: before.updatedAt, idempotencyKey: `${runId}-image`,
    sourceUrl: rejectionSourceUrl,
    credit: "VRDex synthetic staging fixture", altText: "Synthetic solid-color profile image",
  };
  const stale = await rpc(request, authA.access_token, "vrdex_profile_media_submit", {
    ...input, expectedUpdatedAt: before.updatedAt - 1, idempotencyKey: `${runId}-stale`,
  });
  expectRefusal(stale, "The profile changed after it was read. Read it again and submit with its current updatedAt and a new idempotency key.");
  const rejectedCandidate = await call<MediaResult>(request, authA.access_token, "vrdex_profile_media_submit", input);
  expect(rejectedCandidate.replayed).toBe(false);
  expect(rejectedCandidate.submission.status).toBe("submitted");
  const cooldown = await rpc(request, authA.access_token, "vrdex_profile_media_submit", {
    ...input, idempotencyKey: `${runId}-cooldown`,
  });
  expectRefusal(cooldown, "Media submissions are temporarily rate limited. Wait before trying a new request.");
  // One genuine cooldown refusal, without changing rate policy or flooding requests.
  stages.push("sanitized submission cooldown refusal");
  const replay = await call<MediaResult>(request, authA.access_token, "vrdex_profile_media_submit", input);
  expect(replay.replayed).toBe(true);
  expect(replay.submission.submissionId).toBe(rejectedCandidate.submission.submissionId);
  const conflict = await rpc(request, authA.access_token, "vrdex_profile_media_submit", { ...input, credit: "Conflicting credit" });
  expectRefusal(conflict, "That idempotency key was already used for a different media submission request.");
  stages.push("submit, same-key replay and conflicting-key refusal");

  const own = await call<{ submissions: Submission[] }>(request, authA.access_token, "vrdex_list_my_media_submissions", {});
  expect(own.submissions.map((row) => row.submissionId)).toContain(rejectedCandidate.submission.submissionId);
  const other = await call<{ submissions: Submission[] }>(request, authB.access_token, "vrdex_list_my_media_submissions", {});
  expect(other.submissions).toEqual([]);
  const unpublished = await call<{ avatarImageUrl?: string }>(request, undefined, "vrdex_get_profile", { slug: profile.slug });
  expect(unpublished.avatarImageUrl).toBe(before.avatarImageUrl);
  const inspect = await request.post("/api/e2e/media", { headers, data: { op: "inspect", runId, profileId } });
  expect(inspect.status()).toBe(200);
  expect((await inspect.json()).assets).toEqual([]);
  const earlyPrivateFile = `/api/account/media-review/submissions/${rejectedCandidate.submission.submissionId}/file`;
  const anonymousFile = await request.get(earlyPrivateFile);
  expect(anonymousFile.status()).toBe(401);
  expect(await anonymousFile.json()).toEqual({ error: "Sign in required." });
  const contributorFile = await pageA.request.get(earlyPrivateFile);
  expect(contributorFile.status()).toBe(403);
  expect(await contributorFile.json()).toEqual({ error: "Profile media review access is required." });
  await pageA.goto("/account/media-review");
  await expect(pageA.getByText("Profile media review access is required.")).toBeVisible();
  stages.push("caller-only status, public isolation and contributor review refusal");

  if (cleanupOnly) {
    fixture.expectedReservations = 1;
    const assign = await request.post("/api/e2e/media", { headers, data: { op: "assign-review-owner", runId, profileId, reviewerEmail: b.email } });
    expect(assign.status(), "Assign only this synthetic profile to B").toBe(200);
    await pageB.goto("/account/media-review");
    const file = `/api/account/media-review/submissions/${rejectedCandidate.submission.submissionId}/file`;
    const card = pageB.locator("section").filter({ has: pageB.locator(`img[src="${file}"]`) });
    await card.getByLabel("Private review reason", { exact: true }).fill("Synthetic worker cleanup proof.");
    await card.getByLabel("Public rejection reason", { exact: true }).fill("Synthetic candidate rejected.");
    await card.getByRole("button", { name: "Reject", exact: true }).click();
    await expect.poll(async () => {
      const history = await call<{ submissions: Submission[] }>(request, authA.access_token, "vrdex_list_my_media_submissions", {});
      return history.submissions.find((row) => row.submissionId === rejectedCandidate.submission.submissionId)?.status;
    }).toBe("rejected");
    const proof = await request.post("/api/e2e/media", { headers, data: {
      op: "worker-cleanup-proof", runId, profileId,
      submissionId: rejectedCandidate.submission.submissionId,
    } });
    expect(proof.status(), "Worker must delete the exact rejected fixture").toBe(200);
    expect(await proof.json()).toMatchObject({ workerDeleted: true });
    stages.push("rejected URL import deleted by authenticated cleanup worker with DB and S3 readback");
    return;
  }

  // Let the normal creation cooldown expire before the second proposal.
  // The refused key is durable and must not be reused for this request.
  await new Promise((resolve) => setTimeout(resolve, 31_000));
  const grants = await request.post("/api/e2e/media", { headers, data: { op: "grant-publication-actors", runId, profileId } });
  expect(grants.status()).toBe(200);
  const { batchId } = await grants.json() as { batchId: string };
  const publisherImage = await sharp({ create: { width: 64, height: 48, channels: 3, background: "#173e35" } }).png().toBuffer();
  const publisherKey = `${runId}-publisher-upload`;
  const publisherTarget = await call<UploadTarget>(request, authA.access_token, "vrdex_media_upload_begin", {
    mode: "contributor", profileId, expectedUpdatedAt: before.updatedAt, placement: "gallery", contentType: "image/png", byteLength: publisherImage.length,
    sha256: createHash("sha256").update(publisherImage).digest("hex"), credit: input.credit, sourceDescription: "Synthetic publisher image", idempotencyKey: publisherKey,
  });
  fixture.expiringTransfer = { ...publisherTarget.transfer, image: publisherImage };
  fixture.expectedReservations = 2;
  const publisherTransfer = await request.post(publisherTarget.transfer.url, { multipart: { ...publisherTarget.transfer.fields, [publisherTarget.transfer.fileField]: { name: "publisher.png", mimeType: "image/png", buffer: publisherImage } } });
  expect([201, 204]).toContain(publisherTransfer.status());
  const publisherCompletion = await call<UploadReceipt>(request, authA.access_token, "vrdex_media_upload_complete", { intentId: publisherTarget.intentId, idempotencyKey: publisherKey });
  expect(publisherCompletion.operationState).toBe("committed");
  const publishedSubmissionId = publisherCompletion.resourceId!;
  await pageA.goto("/account/media-contributions");
  const publisherCard = pageA.locator("section").filter({ has: pageA.locator(`img[src^="/api/account/media-contributions/submissions/${publishedSubmissionId}/file"]`) });
  await expect(publisherCard.getByRole("checkbox")).toHaveCount(0);
  await expect(publisherCard.getByRole("button", { name: "Confirm evidence" })).toHaveCount(0);
  await publisherCard.getByRole("button", { name: "Publish", exact: true }).click();
  await expect.poll(async () => (await call<{ submissions: Submission[] }>(request, authA.access_token, "vrdex_list_my_media_submissions", {})).submissions.find(row => row.submissionId === publishedSubmissionId)?.status).toBe("approved");
  let publishedDetail = await call<PublishedContributionDetail>(request, authA.access_token, "vrdex_media_contribution_get", { submissionId: publishedSubmissionId });
  const publishedFile = `/api/v0/profiles/${profile.slug}/assets/${publishedDetail.assetId}/file`;
  const publishedCard = pageA.locator("section").filter({ has: pageA.locator(`img[src="${publishedFile}"]`) });
  const afterPublish = await call<{ avatarImageUrl?: string }>(request, undefined, "vrdex_get_profile", { slug: profile.slug });
  expect(afterPublish.avatarImageUrl).toBe(before.avatarImageUrl);
  await pageB.goto(`/${profile.slug}`);
  await expect(pageB.getByRole("heading", { name: "Media kit" })).toBeVisible();
  await expect(pageB.locator(`img[src="${publishedFile}"]`)).toBeVisible();
  const staleSelectionVersion = publishedDetail.contributionVersion;
  const downloaded = await request.get(`${publishedFile}?download=1`);
  expect(downloaded.ok(), "Public kit download must succeed").toBe(true);
  const decoded = await sharp(await downloaded.body()).metadata();
  expect(decoded.width).toBeGreaterThan(0);
  expect(decoded.height).toBeGreaterThan(0);
  expect(await pageB.locator(`img[src="${publishedFile}"]`).evaluate((image: HTMLImageElement) => image.complete && image.naturalWidth > 0)).toBe(true);
  const capturePicture = async (state: string) => {
    await pageB.goto(`/${profile.slug}`);
    for (const [size, width, height] of [["desktop", 1280, 900], ["mobile", 390, 844]] as const) {
      await pageB.setViewportSize({ width, height });
      await testInfo.attach(`public-kit-${state}-${size}`, { body: await pageB.screenshot({ fullPage: true }), contentType: "image/png" });
    }
    await pageB.setViewportSize({ width: 1280, height: 900 });
  };
  await capturePicture("unchanged");
  await publishedCard.getByRole("button", { name: "Select picture" }).click();
  await expect(publishedCard.getByRole("button", { name: "Remove", exact: true })).toHaveCount(0);
  const selectedPublic = await call<{ avatarImageUrl?: string }>(request, undefined, "vrdex_get_profile", { slug: profile.slug });
  expect(selectedPublic.avatarImageUrl).toContain(publishedDetail.assetId);
  await capturePicture("selected");
  const staleSelection = await rpc<UploadReceipt>(request, authA.access_token, "vrdex_media_contribution_place", { submissionId: publishedSubmissionId, expectedContributionVersion: staleSelectionVersion, action: "clear_primary", idempotencyKey: `${runId}-stale-selection` });
  expect(staleSelection.result?.structuredContent).toMatchObject({ operationState: "refused", code: "contribution_changed" });
  await publishedCard.getByRole("button", { name: "Clear picture" }).click();
  expect((await call<{ avatarImageUrl?: string }>(request, undefined, "vrdex_get_profile", { slug: profile.slug })).avatarImageUrl).toBe(before.avatarImageUrl);
  await capturePicture("restored");
  publishedDetail = await call<PublishedContributionDetail>(request, authA.access_token, "vrdex_media_contribution_get", { submissionId: publishedSubmissionId });
  const rpcSelect = { submissionId: publishedSubmissionId, expectedContributionVersion: publishedDetail.contributionVersion, action: "select_primary", idempotencyKey: `${runId}-rpc-select` };
  const selectedReceipt = await call<UploadReceipt>(request, authA.access_token, "vrdex_media_contribution_place", rpcSelect);
  expect(selectedReceipt.operationState).toBe("committed");
  expect(await call(request, authA.access_token, "vrdex_media_contribution_place", rpcSelect)).toEqual(selectedReceipt);
  publishedDetail = await call<PublishedContributionDetail>(request, authA.access_token, "vrdex_media_contribution_get", { submissionId: publishedSubmissionId });
  const rpcClear = { ...rpcSelect, expectedContributionVersion: publishedDetail.contributionVersion, action: "clear_primary", idempotencyKey: `${runId}-rpc-clear` };
  const clearReceipt = await call<UploadReceipt>(request, authA.access_token, "vrdex_media_contribution_place", rpcClear);
  expect(clearReceipt.operationState).toBe("committed");
  expect(await call(request, authA.access_token, "vrdex_media_contribution_place", rpcClear)).toEqual(clearReceipt);
  publishedDetail = await call<PublishedContributionDetail>(request, authA.access_token, "vrdex_media_contribution_get", { submissionId: publishedSubmissionId });
  const rpcMetadata = { submissionId: publishedSubmissionId, expectedContributionVersion: publishedDetail.contributionVersion, action: "update_metadata", metadata: { credit: "Synthetic RPC corrected credit" }, idempotencyKey: `${runId}-rpc-metadata` };
  const metadataReceipt = await call<UploadReceipt>(request, authA.access_token, "vrdex_media_contribution_manage", rpcMetadata);
  expect(metadataReceipt.operationState).toBe("committed");
  expect(await call(request, authA.access_token, "vrdex_media_contribution_manage", rpcMetadata)).toEqual(metadataReceipt);
  stages.push("authenticated MCP select, undo and metadata correction with exact-key recovery");
  await publishedCard.getByRole("button", { name: "Edit metadata" }).click();
  await publishedCard.getByLabel("Title", { exact: true }).fill("Synthetic publisher title");
  await publishedCard.getByRole("button", { name: "Save", exact: true }).click();
  await expect(publishedCard.getByRole("heading", { name: "Synthetic publisher title" })).toBeVisible();
  await publishedCard.getByRole("button", { name: "Select picture" }).click();
  publishedDetail = await call<PublishedContributionDetail>(request, authA.access_token, "vrdex_media_contribution_get", { submissionId: publishedSubmissionId });
  expect(publishedDetail.canClearPrimary).toBe(true);
  expect(publishedDetail.canRemove).toBe(false);
  const ownPicture = await call<{ avatarImageUrl?: string }>(request, undefined, "vrdex_get_profile", { slug: profile.slug });
  expect((await request.post("/api/e2e/media", { headers, data: { op: "exercise-publication-guards", action: "reselect_primary", runId, profileId } })).status()).toBe(200);
  publishedDetail = await call<PublishedContributionDetail>(request, authA.access_token, "vrdex_media_contribution_get", { submissionId: publishedSubmissionId });
  expect(publishedDetail.canClearPrimary).toBe(false);
  const protectedUndo = await call<UploadReceipt>(request, authA.access_token, "vrdex_media_contribution_place", { submissionId: publishedSubmissionId, expectedContributionVersion: publishedDetail.contributionVersion, action: "clear_primary", idempotencyKey: `${runId}-protected-same-asset-undo` });
  expect(protectedUndo).toMatchObject({ operationState: "refused", code: "selection_changed" });
  expect((await call<{ avatarImageUrl?: string }>(request, undefined, "vrdex_get_profile", { slug: profile.slug })).avatarImageUrl).toBe(ownPicture.avatarImageUrl);
  stages.push("trusted website kit publication without declarations or hero change, selection undo and metadata correction");
  await new Promise(resolve => setTimeout(resolve, 31_000));
  const refreshed = await call<{ updatedAt: number }>(request, undefined, "vrdex_get_profile", { slug: profile.slug });
  const image = await source.body();
  const directKey = `${runId}-direct`;
  const target = await call<UploadTarget>(request, authA.access_token, "vrdex_media_upload_begin", {
    mode: "contributor", profileId, expectedUpdatedAt: refreshed.updatedAt,
    placement: "gallery", contentType: "image/png", byteLength: image.byteLength,
    sha256: createHash("sha256").update(image).digest("hex"),
    credit: input.credit, sourceDescription: input.altText, idempotencyKey: directKey,
  });
  expect(target.transfer.method).toBe("POST");
  expect(target.transfer.fileField).toBe("file");
  expect(new URL(target.transfer.url).protocol).toBe("https:");
  expect(target.expiresAt).toBeGreaterThan(Date.now());
  fixture.expiringTransfer = { ...target.transfer, image }; // Recover even if transport or completion fails.
  const transfer = await request.post(target.transfer.url, {
    multipart: {
      ...target.transfer.fields,
      [target.transfer.fileField]: { name: "fixture.png", mimeType: "image/png", buffer: image },
    },
  });
  expect([201, 204], "Minted S3 multipart transfer").toContain(transfer.status());
  const completed = await call<UploadReceipt>(request, authA.access_token, "vrdex_media_upload_complete", {
    intentId: target.intentId, idempotencyKey: directKey,
  });
  expect(completed.operationState).toBe("committed");
  expect(completed.resourceId).toBeTruthy();
  expect(await call<UploadReceipt>(request, authA.access_token, "vrdex_media_upload_complete", {
    intentId: target.intentId, idempotencyKey: directKey,
  })).toEqual(completed);
  const submitted = { submission: { submissionId: completed.resourceId!, status: "submitted" } };
  const directHistory = await call<{ submissions: Submission[] }>(request, authA.access_token, "vrdex_list_my_media_submissions", {});
  expect(directHistory.submissions.find((row) => row.submissionId === submitted.submission.submissionId)?.status).toBe("submitted");
  expect(submitted.submission.submissionId).not.toBe(rejectedCandidate.submission.submissionId);
  const directState = await request.post("/api/e2e/media", { headers, data: { op: "inspect", runId, profileId } });
  expect(directState.status()).toBe(200);
  const directInspection = await directState.json();
  expect(directInspection.counts.reservations).toBe(3);
  expect(directInspection.mediaKitEnabled, "Deployed backend media-kit gate").toBe(true);
  expect(directInspection.mediaKitPublic, "Fixture public media-kit field visibility").toBe(true);
  fixture.expectedReservations = 3;
  stages.push("minted direct S3 multipart transfer, completion replay and private contributor readback");
  expect((await request.post("/api/e2e/media", { headers, data: { op: "grant-publication-actors", runId, profileId } })).status()).toBe(200);

  await pageB.goto("/account/media-review");
  await pageB.getByRole("combobox", { name: "Collection", exact: true }).selectOption(batchId);
  const rejectFile = `/api/account/media-review/submissions/${rejectedCandidate.submission.submissionId}/file`;
  const rejectCard = pageB.locator("section").filter({ has: pageB.locator(`img[src="${rejectFile}"]`) });
  const privateRejection = `Private fixture rejection ${runId}`;
  const disposition = "Synthetic candidate rejected.";
  await rejectCard.getByLabel("Private review reason", { exact: true }).fill(privateRejection);
  await rejectCard.getByLabel("Public rejection reason", { exact: true }).fill(disposition);
  await rejectCard.getByRole("button", { name: "Reject", exact: true }).click();
  await expect.poll(async () => {
    const history = await call<{ submissions: Submission[] }>(request, authA.access_token, "vrdex_list_my_media_submissions", {});
    const rejected = history.submissions.find((row) => row.submissionId === rejectedCandidate.submission.submissionId);
    expect(JSON.stringify(history)).not.toContain(privateRejection);
    return { status: rejected?.status, disposition: rejected?.publicDisposition, asset: rejected?.approvedAssetId };
  }).toEqual({ status: "rejected", disposition, asset: undefined });
  const rejectedState = await request.post("/api/e2e/media", { headers, data: { op: "inspect", runId, profileId } });
  expect(rejectedState.status()).toBe(200);
  expect((await rejectedState.json()).assets).toHaveLength(1);
  const stillUnpublished = await call<{ avatarImageUrl?: string }>(request, undefined, "vrdex_get_profile", { slug: profile.slug });
  expect(stillUnpublished.avatarImageUrl).toContain(publishedDetail.assetId);
  for (const privateValue of [privateRejection, disposition, sourceUrl, rejectionSourceUrl])
    expect(JSON.stringify(stillUnpublished)).not.toContain(privateValue);
  const reviewerHistory = await call<{ submissions: Submission[] }>(request, authB.access_token, "vrdex_list_my_media_submissions", {});
  expect(reviewerHistory.submissions).toEqual([]);
  stages.push("distinct assigned reviewer rejection, private reason isolation and no public rejected asset");

  const reviewBeforeRebase = await call<{ reviewVersion: string }>(request, authB.access_token, "vrdex_media_review_get", {
    submissionId: submitted.submission.submissionId,
  });
  const rebaseInput = {
    submissionId: submitted.submission.submissionId,
    expectedReviewVersion: reviewBeforeRebase.reviewVersion,
    idempotencyKey: `${runId}-rebase`,
  };
  const rebased = await call<UploadReceipt>(request, authB.access_token, "vrdex_media_review_rebase", rebaseInput);
  expect(rebased).toMatchObject({ operationState: "committed", resourceId: submitted.submission.submissionId });
  expect(await call(request, authB.access_token, "vrdex_media_review_rebase", rebaseInput)).toEqual(rebased);
  const review = await call<{ reviewVersion: string; targetProfileUpdatedAt: number; currentProfileUpdatedAt: number }>(
    request, authB.access_token, "vrdex_media_review_get", { submissionId: submitted.submission.submissionId },
  );
  expect(review.reviewVersion).not.toBe(reviewBeforeRebase.reviewVersion);
  expect(review.targetProfileUpdatedAt).toBe(review.currentProfileUpdatedAt);
  const preview = await rpc(request, authB.access_token, "vrdex_media_review_preview", {
    submissionId: submitted.submission.submissionId,
    expectedReviewVersion: review.reviewVersion,
  });
  expect(preview.result?.content?.some((item) => item.type === "image")).toBe(true);
  const privateFile = `/api/account/media-review/submissions/${submitted.submission.submissionId}/file`;
  const self = await rpc(request, authA.access_token, "vrdex_media_review_decide", {
    submissionId: submitted.submission.submissionId,
    expectedReviewVersion: review.reviewVersion,
    decision: "approve",
    privateReason: "Synthetic unauthorized review refusal.",
    idempotencyKey: `${runId}-unauthorized-review`,
  });
  expect(self.status).toBe(200);
  expect(self.error).toBeUndefined();
  expect(self.result?.isError).toBe(true);
  expect(self.result?.structuredContent).toMatchObject({
    operationState: "refused", code: "MEDIA_REVIEW_ACCESS_REQUIRED",
    retryCategory: "authority", nextAction: "restore_access",
  });
  const decisionInput = {
    submissionId: submitted.submission.submissionId,
    expectedReviewVersion: review.reviewVersion,
    decision: "approve",
    privateReason: "Synthetic two-user staging acceptance.",
    idempotencyKey: `${runId}-accept`,
  };
  const accepted = await call<{ operationId: string; operationState: string; resourceId?: string }>(
    request, authB.access_token, "vrdex_media_review_decide", decisionInput,
  );
  expect(accepted).toMatchObject({ operationState: "committed", resourceId: submitted.submission.submissionId });
  expect(await call(request, authB.access_token, "vrdex_media_review_decide", decisionInput)).toEqual(accepted);
  await expect.poll(async () => {
    const history = await call<{ submissions: Submission[] }>(request, authA.access_token, "vrdex_list_my_media_submissions", {});
    return history.submissions.find((row) => row.submissionId === submitted.submission.submissionId)?.status;
  }).toBe("approved");
  const approved = await request.post("/api/e2e/media", { headers, data: { op: "inspect", runId, profileId } });
  const approvedState = await approved.json() as { assets: { id: string; source: string; state: string }[] };
  expect(approvedState.assets).toHaveLength(2);
  expect(approvedState.assets[0].source).toBe("community_submitted");
  const published = await call<{ avatarImageUrl?: string }>(request, undefined, "vrdex_get_profile", { slug: profile.slug });
  expect(published.avatarImageUrl).toBe(stillUnpublished.avatarImageUrl);
  expect((await request.get(published.avatarImageUrl!)).ok()).toBe(true);
  await pageB.goto("/account/media-review");
  await pageB.getByRole("combobox", { name: "Collection", exact: true }).selectOption(batchId);
  await pageB.getByRole("combobox", { name: "Status", exact: true }).selectOption("approved");
  const approvedCard = pageB.locator("section").filter({ has: pageB.locator(`img[src="${privateFile}"]`) });
  await expect(approvedCard.getByRole("img")).toHaveCount(1);
  await pageB.goto(`/${profile.slug}`);
  await expect(pageB.locator(`img[src="${published.avatarImageUrl}"]`).first()).toBeVisible();
  stages.push("independent approval publishes into kit with unchanged primary picture");
  const kitDetail = await call<PublishedContributionDetail>(request, authA.access_token, "vrdex_media_contribution_get", { submissionId: submitted.submission.submissionId });
  expect(kitDetail.canProposePlacement).toBe(true);
  await pageA.goto("/account/media-contributions");
  const kitFile = `/api/v0/profiles/${profile.slug}/assets/${kitDetail.assetId}/file`;
  const kitCard = pageA.locator("section").filter({ has: pageA.locator(`img[src="${kitFile}"]`) });
  await expect(kitCard.getByRole("button", { name: "Select picture" })).toHaveCount(0);
  await kitCard.getByRole("button", { name: "Request replacement" }).click();
  await expect(kitCard.getByText("Submitted", { exact: true })).toBeVisible();
  expect((await request.post("/api/e2e/media", { headers, data: { op: "grant-publication-actors", runId, profileId } })).status()).toBe(200);
  const queue = await call<{ page: { submissionId: string; requestKind?: string }[] }>(request, authB.access_token, "vrdex_media_review_list", { batchId, status: "submitted" });
  const proposal = queue.page.find(row => row.requestKind === "identity_placement");
  expect(proposal).toBeTruthy();
  await pageB.goto("/account/media-review");
  await pageB.getByRole("combobox", { name: "Collection", exact: true }).selectOption(batchId);
  const replacementFile = `/api/account/media-review/submissions/${proposal!.submissionId}/file`;
  const replacementCard = pageB.locator("section").filter({ has: pageB.locator(`img[src="${replacementFile}"]`) });
  await expect(replacementCard.locator(`img[src="${published.avatarImageUrl}"]`)).toBeVisible();
  await replacementCard.getByLabel("Private review reason", { exact: true }).fill("Synthetic reviewed replacement.");
  await replacementCard.getByRole("button", { name: "Approve", exact: true }).click();
  await expect.poll(async () => (await call<PublishedContributionDetail>(request, authA.access_token, "vrdex_media_contribution_get", { submissionId: submitted.submission.submissionId })).canRemove).toBe(false);
  const replaced = await call<{ avatarImageUrl?: string }>(request, undefined, "vrdex_get_profile", { slug: profile.slug });
  expect(replaced.avatarImageUrl).toContain(kitDetail.assetId);
  await pageA.goto("/account/media-contributions");
  await expect(kitCard.getByRole("button", { name: "Remove", exact: true })).toHaveCount(0);
  await publishedCard.getByRole("button", { name: "Remove", exact: true }).click();
  await expect(pageA.getByText("Removed", { exact: true })).toBeVisible();
  expect((await request.get(publishedFile)).status()).toBe(404);
  stages.push("explicit replacement compares existing picture with published candidate, separate reviewer protects selection, logical removal of unused kit item");
  // A fourth unique candidate proves successful MCP writes independently of browser mutations.
  await new Promise(resolve => setTimeout(resolve, 31_000));
  const rpcImage = await sharp({ create: { width: 48, height: 64, channels: 3, background: "#412f65" } }).png().toBuffer();
  const rpcProfile = await call<{ updatedAt: number; avatarImageUrl?: string }>(request, undefined, "vrdex_get_profile", { slug: profile.slug });
  const rpcUploadKey = `${runId}-rpc-upload`;
  const rpcTarget = await call<UploadTarget>(request, authA.access_token, "vrdex_media_upload_begin", {
    mode: "contributor", profileId, expectedUpdatedAt: rpcProfile.updatedAt, placement: "gallery", contentType: "image/png", byteLength: rpcImage.length,
    sha256: createHash("sha256").update(rpcImage).digest("hex"), credit: "Synthetic MCP image", sourceDescription: "Synthetic RPC photograph", idempotencyKey: rpcUploadKey,
  });
  fixture.expiringTransfer = { ...rpcTarget.transfer, image: rpcImage };
  fixture.expectedReservations = 4;
  const rpcTransfer = await request.post(rpcTarget.transfer.url, { multipart: { ...rpcTarget.transfer.fields, [rpcTarget.transfer.fileField]: { name: "rpc.png", mimeType: "image/png", buffer: rpcImage } } });
  expect([201, 204]).toContain(rpcTransfer.status());
  const rpcCompleteInput = { intentId: rpcTarget.intentId, idempotencyKey: rpcUploadKey };
  const rpcCompleted = await call<UploadReceipt>(request, authA.access_token, "vrdex_media_upload_complete", rpcCompleteInput);
  expect(rpcCompleted.operationState).toBe("committed");
  expect(await call(request, authA.access_token, "vrdex_media_upload_complete", rpcCompleteInput)).toEqual(rpcCompleted);
  const rpcSubmissionId = rpcCompleted.resourceId!;
  const rpcInspection = await call<{ reviewVersion: string }>(request, authA.access_token, "vrdex_media_submission_get", { submissionId: rpcSubmissionId });
  const rpcPreview = await rpc(request, authA.access_token, "vrdex_media_submission_preview", { submissionId: rpcSubmissionId, expectedReviewVersion: rpcInspection.reviewVersion });
  expect(rpcPreview.result?.content?.some(item => item.type === "image")).toBe(true);
  expect((await request.post("/api/e2e/media", { headers, data: { op: "exercise-publication-guards", action: "edit_bio", runId, profileId } })).status()).toBe(200);
  const rpcPublishInput = { submissionId: rpcSubmissionId, expectedReviewVersion: rpcInspection.reviewVersion, idempotencyKey: `${runId}-rpc-publish` };
  // Discard the first response to model a client losing the committed result.
  await call<UploadReceipt>(request, authA.access_token, "vrdex_media_submission_publish", rpcPublishInput);
  const rpcPublication = await call<UploadReceipt>(request, authA.access_token, "vrdex_media_submission_publish", rpcPublishInput);
  expect(rpcPublication.operationState).toBe("committed");
  expect(await call(request, authA.access_token, "vrdex_media_submission_publish", rpcPublishInput)).toEqual(rpcPublication);
  let rpcDetail = await call<PublishedContributionDetail>(request, authA.access_token, "vrdex_media_contribution_get", { submissionId: rpcSubmissionId });
  expect(rpcDetail.canRemove).toBe(true);
  const rpcPublic = await call<{ avatarImageUrl?: string }>(request, undefined, "vrdex_get_profile", { slug: profile.slug });
  expect(rpcPublic.avatarImageUrl).toBe(rpcProfile.avatarImageUrl);
  const rpcFile = `/api/v0/profiles/${profile.slug}/assets/${rpcDetail.assetId}/file`;
  const rpcDownload = await request.get(`${rpcFile}?download=1`);
  expect(rpcDownload.ok()).toBe(true);
  expect((await sharp(await rpcDownload.body()).metadata()).width).toBe(48);
  await pageB.goto(`/${profile.slug}`);
  await expect(pageB.locator(`img[src="${rpcFile}"]`)).toBeVisible();
  expect(await pageB.locator(`img[src="${rpcFile}"]`).evaluate((image: HTMLImageElement) => image.complete && image.naturalWidth > 0)).toBe(true);
  const rpcManageInput = { submissionId: rpcSubmissionId, expectedContributionVersion: rpcDetail.contributionVersion, action: "update_metadata", metadata: { label: "Synthetic MCP title" }, idempotencyKey: `${runId}-rpc-title` };
  const rpcManaged = await call<UploadReceipt>(request, authA.access_token, "vrdex_media_contribution_manage", rpcManageInput);
  expect(rpcManaged.operationState).toBe("committed");
  expect(await call(request, authA.access_token, "vrdex_media_contribution_manage", rpcManageInput)).toEqual(rpcManaged);
  rpcDetail = await call<PublishedContributionDetail>(request, authA.access_token, "vrdex_media_contribution_get", { submissionId: rpcSubmissionId });
  const rpcProposeInput = { submissionId: rpcSubmissionId, expectedContributionVersion: rpcDetail.contributionVersion, idempotencyKey: `${runId}-rpc-propose` };
  const rpcProposed = await call<UploadReceipt>(request, authA.access_token, "vrdex_media_contribution_propose_placement", rpcProposeInput);
  expect(rpcProposed.operationState).toBe("committed");
  expect(await call(request, authA.access_token, "vrdex_media_contribution_propose_placement", rpcProposeInput)).toEqual(rpcProposed);
  expect((await request.post("/api/e2e/media", { headers, data: { op: "grant-publication-actors", runId, profileId } })).status()).toBe(200);
  const rpcReview = await call<{ reviewVersion: string }>(request, authB.access_token, "vrdex_media_review_get", { submissionId: rpcProposed.resourceId! });
  expect((await request.post("/api/e2e/media", { headers, data: { op: "exercise-publication-guards", action: "reselect_primary", runId, profileId } })).status()).toBe(200);
  const rpcDecision = { submissionId: rpcProposed.resourceId!, expectedReviewVersion: rpcReview.reviewVersion, decision: "approve", privateReason: "Synthetic independent RPC replacement", idempotencyKey: `${runId}-rpc-review` };
  const reselectedRefusal = await rpc<UploadReceipt>(request, authB.access_token, "vrdex_media_review_decide", rpcDecision);
  expect(reselectedRefusal.result?.structuredContent).toMatchObject({ operationState: "refused" });
  const changedReview = await call<{ reviewVersion: string }>(request, authB.access_token, "vrdex_media_review_get", { submissionId: rpcProposed.resourceId! });
  const rpcRebase = await call<UploadReceipt>(request, authB.access_token, "vrdex_media_review_rebase", { submissionId: rpcProposed.resourceId!, expectedReviewVersion: changedReview.reviewVersion, idempotencyKey: `${runId}-rpc-rebase` });
  expect(rpcRebase.operationState).toBe("committed");
  const freshReview = await call<{ reviewVersion: string }>(request, authB.access_token, "vrdex_media_review_get", { submissionId: rpcProposed.resourceId! });
  const freshDecisionInput = { ...rpcDecision, expectedReviewVersion: freshReview.reviewVersion, idempotencyKey: `${runId}-rpc-review-fresh` };
  const rpcApproved = await call<UploadReceipt>(request, authB.access_token, "vrdex_media_review_decide", freshDecisionInput);
  expect(rpcApproved.operationState).toBe("committed");
  expect(await call(request, authB.access_token, "vrdex_media_review_decide", freshDecisionInput)).toEqual(rpcApproved);
  const afterRpcReplacement = await call<{ avatarImageUrl?: string }>(request, undefined, "vrdex_get_profile", { slug: profile.slug });
  expect(afterRpcReplacement.avatarImageUrl).toContain(rpcDetail.assetId);
  expect((await call<PublishedContributionDetail>(request, authA.access_token, "vrdex_media_contribution_get", { submissionId: rpcSubmissionId })).canRemove).toBe(false);
  const oldKit = await call<PublishedContributionDetail>(request, authA.access_token, "vrdex_media_contribution_get", { submissionId: submitted.submission.submissionId });
  expect(oldKit.canRemove).toBe(true);
  const rpcRemoveInput = { submissionId: submitted.submission.submissionId, expectedContributionVersion: oldKit.contributionVersion, action: "remove", idempotencyKey: `${runId}-rpc-remove` };
  const rpcRemoved = await call<UploadReceipt>(request, authA.access_token, "vrdex_media_contribution_manage", rpcRemoveInput);
  expect(rpcRemoved.operationState).toBe("committed");
  expect(await call(request, authA.access_token, "vrdex_media_contribution_manage", rpcRemoveInput)).toEqual(rpcRemoved);
  expect((await request.get(kitFile)).status()).toBe(404);
  const rpcFinalState = await request.post("/api/e2e/media", { headers, data: { op: "inspect", runId, profileId } });
  expect((await rpcFinalState.json()).counts.reservations).toBe(4);
  expect((await request.post("/api/e2e/media", { headers, data: { op: "exercise-publication-guards", action: "revoke_actors", runId, profileId } })).status()).toBe(200);
  expect((await rpc<UploadReceipt>(request, authA.access_token, "vrdex_media_submission_publish", rpcPublishInput)).result?.structuredContent).toMatchObject({ operationState: "refused", code: "MEDIA_PUBLISH_ACCESS_REQUIRED" });
  expect((await rpc<UploadReceipt>(request, authA.access_token, "vrdex_media_contribution_place", { submissionId: rpcSubmissionId, expectedContributionVersion: rpcDetail.contributionVersion, action: "clear_primary", idempotencyKey: `${runId}-revoked-primary` })).result?.structuredContent).toMatchObject({ operationState: "refused", code: "publisher_required" });
  const revokedReviewer = await rpc<UploadReceipt>(request, authB.access_token, "vrdex_media_review_decide", freshDecisionInput);
  expect(revokedReviewer.result?.isError).toBe(true);
  expect(revokedReviewer.result?.structuredContent).toMatchObject({ operationState: "refused", code: "MEDIA_REVIEW_ACCESS_REQUIRED" });
  stages.push("actual authenticated MCP publish/get/render/download, own correction/removal, distinct assigned reviewer replacement, unchanged picture through bio edit, same-asset stale selection and feature-revoked replay denial");

  const assign = await request.post("/api/e2e/media", { headers, data: { op: "assign-review-owner", runId, profileId, reviewerEmail: b.email } });
  expect(assign.status(), "Assign only this synthetic profile to B").toBe(200);
  const claimedProfile = await call<{ updatedAt: number }>(request, undefined, "vrdex_get_profile", { slug: profile.slug });
  const claimed = await rpc(request, authA.access_token, "vrdex_profile_media_submit", {
    ...input, expectedUpdatedAt: claimedProfile.updatedAt, idempotencyKey: `${runId}-claimed`,
  });
  expectRefusal(claimed, "The public profile is claimed, so its owner manages profile media.");


  const audit = await request.post("/api/e2e/media", { headers, data: { op: "inspect-audit", runId, profileId } });
  expect(audit.status()).toBe(200);
  const auditEvidence = await audit.json() as { auditRows: number; toolRows: number; deniedToolRows: number; redacted: boolean };
  expect(auditEvidence.auditRows).toBe(1);
  expect(auditEvidence.toolRows).toBeGreaterThanOrEqual(6);
  expect(auditEvidence.deniedToolRows).toBeGreaterThanOrEqual(4);
  expect(auditEvidence.redacted).toBe(true);
  stages.push("bounded contributor write-audit and tool-event redaction checks");

  const revoke = await request.post("/oauth/revoke", { form: { client_id: authA.clientId, token: authA.refresh_token, token_type_hint: "refresh_token" } });
  expect(revoke.status()).toBe(200);
  const refused = await rpc(request, authA.access_token, "vrdex_list_my_media_submissions", {});
  expect(refused.status).toBe(401);
  await call(request, undefined, "vrdex_get_profile", { slug: profile.slug });
  stages.push("revoked grant refusal with anonymous reads preserved");

});
