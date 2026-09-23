import { execFileSync } from "node:child_process";
import { it } from "node:test";

const setup = `
import assert from "node:assert/strict";
import { convexTest } from "convex-test";
import { internal } from "./convex/_generated/api.js";
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
      VRDEX_MEDIA_CLEANUP_URL: "https://example.test/cleanup", VRDEX_MEDIA_CLEANUP_TOKEN: "test-only",
      VRDEX_PROFILE_MEDIA_SUBMISSIONS_ENABLED: "true", VRDEX_PROFILE_MEDIA_KIT_ENABLED: "true" },
  });
}

it("failed presigning releases processing once and preserves its same-key refusal and byte charge", () => {
  probe(`
    const h = createMcpMediaUploadHandlers({authority: async () => authority, admin,
      target: async () => { throw Error("private signing credentials"); }});
    await assert.rejects(h.begin(input));
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
    await assert.rejects(failing.begin(input));
    const row = await read();
    assert.equal(row.reservation.state, "pending");
    assert.equal(row.reservation.receipt, undefined);
    assert.ok(row.capacity.every(row => row.processing === 1));
    const claim = await t.mutation(internal.contributionUploads.claim, {...authority,
      intentId: success.intentId, idempotencyKey: "complete", processingToken: "worker"});
    assert.equal(claim.intentId, success.intentId);
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


