import { execFileSync } from "node:child_process";
import { it } from "node:test";

const setup = `
import assert from "node:assert/strict";
import { convexTest } from "convex-test";
import { internal } from "./convex/_generated/api.js";
import { getFunctionName } from "convex/server";
import { schema, modules as baseModules, seed, NOW } from "./tests/backend/_mediaReviewFixture.ts";
import { createMcpMediaUploadHandlers } from "./apps/web/src/lib/server/mcp-media-upload.ts";
import { completeMcpProfileMediaSubmissionImport } from "./apps/web/src/lib/server/profile-media-mcp-import.ts";
const modules = {
  ...baseModules,
  "../../convex/contributionUploads.ts": () => import("./convex/contributionUploads.ts"),
  "../../convex/contributionCapacity.ts": () => import("./convex/contributionCapacity.ts"),
};
const t = convexTest({schema, modules});
const s = await seed(t);
const tokenId = await t.run(ctx => ctx.db.insert("oauthAccessTokens", {
  tokenId: "token", clientId: "client", subjectType: "user", userId: s.contributorUserId,
  resource: "https://example.test/mcp", scopes: ["mcp:write", "assets:contribute"],
  status: "active", issuedAt: Date.now(), expiresAt: Date.now() + 3600000,
}));
const authority = {actorUserId: s.contributorUserId, oauthClientId: "client", oauthTokenId: "token",
  emailVerified: true, emailVerificationAttestedAt: Date.now()};
const input = {mode: "contributor", profileId: s.profileId, expectedUpdatedAt: NOW,
  placement: "profile_image", contentType: "image/png", byteLength: 512, sha256: "a".repeat(64),
  credit: "Artist", sourceDescription: "Artist supplied image", idempotencyKey: "begin"};
const admin = {mutation: (ref, args) => t.mutation(ref, args), query: (ref, args) => t.query(ref, args)};
const read = () => t.run(async ctx => ({
  reservation: await ctx.db.query("contributionUploadReservations").first(),
  intent: await ctx.db.query("profileAssetUploadIntents").first(),
  submission: await ctx.db.query("profileMediaSubmissions").first(),
  capacity: await ctx.db.query("contributionCapacity").collect(),
}));
`;

function probe(script: string) {
  execFileSync(process.execPath, ["--import", "tsx", "--input-type=module", "-e", setup + script], {
    cwd: process.cwd(), encoding: "utf8", stdio: "pipe",
    env: { ...process.env, TSX_TSCONFIG_PATH: "apps/web/tsconfig.json",
      VRDEX_CONTRIBUTION_UPLOADS_ENABLED: "true", VRDEX_MEDIA_UPLOAD_CLEANUP_READY: "true",
      VRDEX_MEDIA_CLEANUP_URL: "https://example.test/api/internal/media-cleanup", VRDEX_MEDIA_CLEANUP_TOKEN: "test-only",
      VRDEX_PROFILE_MEDIA_SUBMISSIONS_ENABLED: "true", VRDEX_PROFILE_MEDIA_KIT_ENABLED: "true" },
  });
}

it("failed presigning releases processing once and preserves its same-key refusal and byte charge", () => {
  probe(`
    const h = createMcpMediaUploadHandlers({authority: async () => authority, admin,
      target: async () => { throw Error("private signing credentials"); }});
    await assert.rejects(h.begin(input), {message: "UPLOAD_TARGET_UNAVAILABLE"});
    const failed = await read();
    assert.equal(failed.reservation.state, "failed");
    assert.ok(failed.capacity.every(row => row.processing === 0));
    assert.ok(failed.capacity.every(row => row.bytes > 0));
    const replay = await h.begin(input);
    assert.deepEqual(replay, failed.reservation.receipt);
    assert.deepEqual((await read()).capacity, failed.capacity);
    await assert.rejects(h.begin({...input, byteLength: 513}), /IDEMPOTENCY_CONFLICT/);
    await t.run(ctx => ctx.db.patch(tokenId, {status: "revoked"}));
    await assert.rejects(h.begin(input));
  `);
});

it("concurrent and replay signing failures cannot cancel a successful transfer", () => {
  probe(`
    let release;
    let entered;
    const started = new Promise(resolve => { entered = resolve; });
    const blocked = new Promise(resolve => { release = resolve; });
    const transfer = {url: "https://storage.example.test", fields: {key: "private"}};
    const h = createMcpMediaUploadHandlers({authority: async () => authority, admin,
      target: async () => { entered(); await blocked; return transfer; }});
    const first = h.begin(input);
    await started;
    const failing = createMcpMediaUploadHandlers({authority: async () => authority, admin,
      target: async () => { throw Error("private credentials"); }});
    const concurrent = await failing.begin(input);
    assert.equal(concurrent.operationState, "in_progress");
    release();
    const success = await first;
    assert.equal(success.transfer.url, transfer.url);
    await assert.rejects(failing.begin(input), {message: "UPLOAD_ACQUISITION_RETRY"});
    const row = await read();
    assert.equal(row.reservation.state, "pending");
    assert.equal(row.reservation.receipt, undefined);
    assert.ok(row.capacity.every(row => row.processing === 1));
    assert.deepEqual(await h.begin(input), success);
    assert.deepEqual((await read()).capacity, row.capacity);
    const claim = await t.mutation(internal.contributionUploads.claim, {...authority,
      intentId: success.intentId, idempotencyKey: "complete", processingToken: "worker"});
    assert.equal(claim.intentId, success.intentId);
  `);
});

for (const settledBeforeLoss of [false, true]) {
  it(`unacknowledged failure settlement stays retryable, committed=${settledBeforeLoss}`, () => {
    probe(`
      const unreliableAdmin = {mutation: async (ref, args) => {
        if (getFunctionName(ref) === "contributionUploads:settleSigning") {
          if (${settledBeforeLoss}) await t.mutation(ref, args);
          throw Error("private settlement transport details");
        }
        return t.mutation(ref, args);
      }};
      const h = createMcpMediaUploadHandlers({authority: async () => authority, admin: unreliableAdmin,
        target: async () => {throw Error("private credentials");}});
      await assert.rejects(h.begin(input), {message: "UPLOAD_ACQUISITION_RETRY"});
      const state = await read();
      assert.equal(state.reservation.state, ${settledBeforeLoss} ? "failed" : "pending");
      assert.ok(state.capacity.every(row => row.processing === (${settledBeforeLoss} ? 0 : 1)));
      assert.ok(state.capacity.every(row => row.bytes > 0));
      const reliable = createMcpMediaUploadHandlers({authority: async () => authority, admin,
        target: async () => {throw Error("must not sign before the stored outcome is replayed");}});
      const replay = await reliable.begin(input);
      assert.equal(replay.operationState, ${settledBeforeLoss} ? "refused" : "in_progress");
      assert.deepEqual((await read()).capacity, state.capacity);
    `);
  });
}

it("lost success acknowledgement cannot terminally reject a live target and same-key retry recovers", () => {
  probe(`
    const unreliableAdmin = {mutation: async (ref, args) => {
      const result = await t.mutation(ref, args);
      if (getFunctionName(ref) === "contributionUploads:settleSigning" && args.succeeded)
        throw Error("private acknowledgement details");
      return result;
    }};
    const transfer = {url: "https://storage.example.test", fields: {key: "private"}};
    const h = createMcpMediaUploadHandlers({authority: async () => authority, admin: unreliableAdmin,
      target: async () => transfer});
    await assert.rejects(h.begin(input), {message: "UPLOAD_ACQUISITION_RETRY"});
    const before = await read();
    assert.equal(before.reservation.state, "pending");
    assert.equal(before.reservation.signingToken, undefined);
    assert.ok(before.capacity.every(row => row.processing === 1));
    const retry = createMcpMediaUploadHandlers({authority: async () => authority, admin, target: async () => transfer});
    const target = await retry.begin(input);
    assert.equal(target.intentId, before.intent._id);
    assert.equal(target.transfer.url, transfer.url);
    assert.deepEqual((await read()).capacity, before.capacity);
  `);
});

it("registered upload begin reports terminal signing failure only for its own settled admission", () => {
  probe(`
    import { createVrdexMcpHandler } from "./apps/web/src/lib/server/vrdex-mcp.ts";
    delete process.env.VRDEX_PROFILE_ASSET_BUCKET;
    delete process.env.VRDEX_ASSET_BUCKET;
    const h = createMcpMediaUploadHandlers({authority: async () => authority, admin,
      target: async () => ({url: "https://storage.example.test", fields: {key: "private"}})});
    await h.begin(input);
    const before = await read();
    const handler = createVrdexMcpHandler({adminConvex: admin, verifyContributorEmail: async () => true});
    const authInfo = {token: "private-token", clientId: "client", scopes: ["mcp:write", "assets:contribute"],
      resource: new URL("https://example.test/mcp"),
      extra: {subjectType: "user", userId: s.contributorUserId, tokenId: "token", requestId: "request"}};
    async function call(idempotencyKey) {
      const response = await handler.fetch(new Request("https://example.test/mcp", {
        method: "POST", headers: {accept: "application/json, text/event-stream", "content-type": "application/json"},
        body: JSON.stringify({jsonrpc: "2.0", id: 1, method: "tools/call", params: {
          name: "vrdex_media_upload_begin", arguments: {...input, idempotencyKey},
        }}),
      }), {authInfo});
      const text = await response.text();
      const result = JSON.parse(text.split(/\\r?\\n/).find(line => line.startsWith("data: "))?.slice(6) ?? text).result;
      assert.deepEqual(JSON.parse(result.content[0].text), result.structuredContent);
      assert.doesNotMatch(JSON.stringify(result), /private|bucket|credentials|signingToken/);
      return result.structuredContent;
    }
    const replay = await call(input.idempotencyKey);
    assert.equal(replay.code, "UPLOAD_ACQUISITION_RETRY");
    assert.equal(replay.operationState, "in_progress");
    assert.equal(replay.retryable, true);
    assert.equal(replay.nextAction, "retry_same_key");
    assert.deepEqual((await read()).capacity, before.capacity);
    // Admit the independent signing-failure case outside the actor burst window.
    await t.run(ctx => ctx.db.patch(before.submission._id, {createdAt: Date.now() - 86400000}));
    const firstFailure = await call("new-key");
    assert.equal(firstFailure.code, "UPLOAD_TARGET_UNAVAILABLE");
    assert.equal(firstFailure.operationState, "refused");
    assert.equal(firstFailure.retryable, false);
    const afterFailure = await read();
    assert.ok(afterFailure.capacity.every(row => row.processing === 1));
    assert.ok(afterFailure.capacity.every(row => row.bytes > before.capacity.find(old => old.scope === row.scope).bytes));
    const terminalReplay = await call("new-key");
    assert.equal(terminalReplay.code, "UPLOAD_TARGET_UNAVAILABLE");
    assert.equal(terminalReplay.operationState, "refused");
    assert.deepEqual((await read()).capacity, afterFailure.capacity);
    await handler.close();
  `);
});

it("source throttling keeps a legacy proposal retryable with the same key after the window", () => {
  probe(`
    const prepareInput = {...authority, requestId: "request", idempotencyKeyHash: "a".repeat(64),
      requestFingerprint: "b".repeat(64), slug: "community-dj", expectedUpdatedAt: NOW,
      sourceUrl: "https://images.example.test/photo.png?signature=private", credit: "Artist"};
    const begun = await t.mutation(internal.profileMediaSubmissions.prepareMcpMediaSubmission, prepareInput);
    const hostId = await t.run(ctx => ctx.db.insert("contributionHostFetches", {
      host: "images.example.test", window: Math.floor(Date.now()/60000), count: 100000,
    }));
    let fetches = 0;
    const deps = {adminConvex: admin, isStorageConfigured: () => true,
      fetchSource: async () => { fetches++; return {body: new Uint8Array([1]), mimeType: "image/png"}; },
      prepareAsset: async () => ({
        source: {body: new Uint8Array([1]), mimeType: "image/png", contentSha256: "a".repeat(64)},
        download: {body: new Uint8Array([1]), mimeType: "image/png", contentSha256: "b".repeat(64)},
        display: {body: new Uint8Array([1]), mimeType: "image/webp", width: 1, height: 1},
      }), putObject: async () => {}, deleteObjects: async () => { throw Error("must not delete on throttle"); }};
    const before = await read();
    for (let i = 0; i < 5; i++) {
      await assert.rejects(completeMcpProfileMediaSubmissionImport(begun.intentId, deps), error => {
        assert.equal(error.outcome, "indeterminate");
        assert.equal(error.code, "CONTRIBUTION_HOST_RATE");
        assert.equal(error.message, "CONTRIBUTION_HOST_RATE");
        return true;
      });
      assert.deepEqual(await t.mutation(internal.profileMediaSubmissions.prepareMcpMediaSubmission, prepareInput), begun);
    }
    assert.equal(fetches, 0);
    const retryable = await read();
    assert.equal(retryable.submission.status, "upload_pending");
    assert.equal(retryable.intent.processingToken, undefined);
    assert.equal(retryable.intent.processingAttempts, 0);
    assert.equal(retryable.intent.mcpFailureCode, undefined);
    assert.deepEqual(retryable.capacity, before.capacity);
    await t.run(ctx => ctx.db.patch(hostId, {window: Math.floor(Date.now()/60000)-1}));
    const completed = await completeMcpProfileMediaSubmissionImport(begun.intentId, deps);
    assert.equal(completed.submission.status, "submitted");
    assert.equal(fetches, 1);
    assert.equal((await read()).reservation.receipt.operationState, "committed");
    assert.ok((await read()).capacity.every(row => row.processing === 0));
    assert.equal((await t.mutation(internal.profileMediaSubmissions.prepareMcpMediaSubmission, prepareInput)).status, "completed");
  `);
});

it("signing settlement cannot release another signer, a claimed worker, or a committed receipt", () => {
  probe(`
    const begun = await t.mutation(internal.contributionUploads.begin, {...input, ...authority, signingToken: "signer"});
    await t.mutation(internal.contributionUploads.settleSigning, {
      intentId: begun.intentId, signingToken: "other", succeeded: false,
    });
    assert.equal((await read()).reservation.state, "pending");
    const claim = {...authority, intentId: begun.intentId, idempotencyKey: "complete", processingToken: "worker"};
    await t.mutation(internal.contributionUploads.claim, claim);
    await t.mutation(internal.contributionUploads.settleSigning, {
      intentId: begun.intentId, signingToken: "signer", succeeded: false,
    });
    assert.equal((await read()).reservation.state, "processing");
    const result = await t.mutation(internal.contributionUploads.complete, {...claim,
      mimeType: "image/webp", byteSize: 100, contentSha256: "b".repeat(64), width: 10, height: 10,
      sourceMimeType: "image/png", sourceByteSize: 512, sourceContentSha256: "a".repeat(64),
      downloadMimeType: "image/png", downloadByteSize: 200, downloadContentSha256: "b".repeat(64),
    });
    const before = await read();
    await t.mutation(internal.contributionUploads.settleSigning, {
      intentId: begun.intentId, signingToken: "signer", succeeded: false,
    });
    assert.deepEqual((await read()).reservation.receipt, result);
    assert.deepEqual((await read()).capacity, before.capacity);
  `);
});

it("throttle reopening cannot clear a successor lease and retry still requires a live token", () => {
  probe(`
    const begun = await t.mutation(internal.profileMediaSubmissions.prepareMcpMediaSubmission, {
      ...authority, requestId: "request", idempotencyKeyHash: "a".repeat(64),
      requestFingerprint: "b".repeat(64), slug: "community-dj", expectedUpdatedAt: NOW,
      sourceUrl: "https://images.example.test/photo.png", credit: "Artist",
    });
    const lease = {intentId: begun.intentId, processingToken: "first"};
    await t.mutation(internal.profileMediaSubmissions.claimMcpMediaSubmissionImport, lease);
    assert.equal(await t.mutation(internal.profileMediaSubmissions.retryMcpMediaSubmissionImport,
      {...lease, processingToken: "other"}), false);
    assert.equal((await read()).intent.processingToken, "first");
    assert.equal(await t.mutation(internal.profileMediaSubmissions.retryMcpMediaSubmissionImport, lease), true);
    assert.equal(await t.mutation(internal.profileMediaSubmissions.retryMcpMediaSubmissionImport, lease), false);
    assert.equal((await read()).intent.processingAttempts, 0);
    await t.mutation(internal.profileMediaSubmissions.claimMcpMediaSubmissionImport, {...lease, processingToken: "second"});
    assert.equal(await t.mutation(internal.profileMediaSubmissions.retryMcpMediaSubmissionImport, lease), false);
    assert.equal(await t.mutation(internal.profileMediaSubmissions.failMcpMediaSubmissionImport,
      {...lease, errorCode: "MCP_MEDIA_IMPORT_REJECTED"}), false);
    assert.equal((await read()).intent.processingToken, "second");
    assert.equal((await read()).submission.status, "upload_pending");
    await t.mutation(internal.profileMediaSubmissions.retryMcpMediaSubmissionImport, {...lease, processingToken: "second"});
    await t.run(ctx => ctx.db.patch(tokenId, {status: "revoked"}));
    await assert.rejects(t.mutation(internal.profileMediaSubmissions.claimMcpMediaSubmissionImport, lease));
  `);
});
