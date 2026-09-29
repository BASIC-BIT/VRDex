import assert from "node:assert/strict";
import { it } from "node:test";
import { convexTest } from "convex-test";
import { internal } from "../../convex/_generated/api";
import { batchAllowance } from "../../convex/_contributionCapacity";
import { modules as base, schema, seed, NOW } from "./_mediaReviewFixture";

const modules = {
  ...base,
  "../../convex/contributionCapacity.ts": () => import("../../convex/contributionCapacity"),
  "../../convex/contributionUploads.ts": () => import("../../convex/contributionUploads"),
};

async function setup() {
  Object.assign(process.env, {
    VRDEX_CONTRIBUTION_UPLOADS_ENABLED: "true",
    VRDEX_MEDIA_UPLOAD_CLEANUP_READY: "true",
    VRDEX_MEDIA_CLEANUP_URL: "https://example.test/api/internal/media-cleanup",
    VRDEX_MEDIA_CLEANUP_TOKEN: "test",
    VRDEX_PROFILE_MEDIA_SUBMISSIONS_ENABLED: "true",
  });
  const t = convexTest({ schema, modules });
  const s = await seed(t);
  await t.run(async ctx => {
    for (const clientId of ["first", "second"])
      await ctx.db.insert("oauthAccessTokens", {
        tokenId: clientId, clientId, subjectType: "user", userId: s.contributorUserId,
        resource: "https://example.test/mcp", scopes: ["mcp:read", "mcp:write", "assets:contribute"],
        status: "active", issuedAt: Date.now(), expiresAt: Date.now() + 3600000,
      });
  });
  const authority = (clientId = "first") => ({ actorUserId: s.contributorUserId,
    oauthClientId: clientId, oauthTokenId: clientId, emailVerified: true,
    emailVerificationAttestedAt: Date.now() });
  return { t, s, authority };
}

it("keeps expired pending allowances out of the request cap while preserving replay", async () => {
  const { t, s, authority } = await setup();
  const batchId = await t.run(async ctx => {
    const id = await ctx.db.insert("contributionBatches", {
      actorUserId: s.contributorUserId, idempotencyKey: "batch", label: "Batch",
      archived: false, rowCount: 0, createdAt: Date.now(),
    });
    for (let i = 0; i < 20; i++) await ctx.db.insert("contributionCapacityRequests", {
      actorUserId: s.contributorUserId, key: `expired-${i}`, kind: "batch_allowance",
      batchId: id, evidence: "collection", reason: "temporary_batch", rows: 1, bytes: 100,
      expiresAt: Date.now() - 1, state: "pending", createdAt: 1, updatedAt: 1,
    });
    return id;
  });
  const input = { ...authority(), key: "new", kind: "batch_allowance" as const,
    evidence: "collection", reason: "temporary_batch" as const,
    batchId, rows: 1, bytes: 100, expiresAt: Date.now() + 3600000 };
  const first = await t.mutation(internal.contributionCapacity.request, input);
  assert.equal((await t.mutation(internal.contributionCapacity.request, input)).requestId, first.requestId);
  await t.run(async ctx => {
    for (let i = 0; i < 18; i++) await ctx.db.insert("contributionCapacityRequests", {
      actorUserId: s.contributorUserId, key: `live-${i}`, kind: "batch_allowance",
      batchId, evidence: "collection", reason: "temporary_batch", rows: 1, bytes: 100,
      expiresAt: Date.now() + 3600000, state: "pending", createdAt: 1, updatedAt: 1,
    });
  });
  await t.mutation(internal.contributionCapacity.request, { ...input, key: "twentieth" });
  await assert.rejects(t.mutation(internal.contributionCapacity.request, { ...input, key: "overflow" }), /CAPACITY_REQUEST_LIMIT/);
  assert.equal((await t.mutation(internal.contributionCapacity.request, input)).requestId, first.requestId);
});

it("allows only one active batch approval, ignores expired approvals, and rejects stale requests", async () => {
  const { t, s } = await setup();
  const { batchId, requests } = await t.run(async ctx => {
    const batchId = await ctx.db.insert("contributionBatches", {
      actorUserId: s.contributorUserId, idempotencyKey: "batch", label: "Batch",
      archived: false, rowCount: 0, createdAt: Date.now(),
    });
    const requests = [];
    for (let i = 0; i < 4; i++) requests.push(await ctx.db.insert("contributionCapacityRequests", {
      actorUserId: s.contributorUserId, key: `ask-${i}`, kind: "batch_allowance",
      batchId, evidence: "collection", reason: "temporary_batch", rows: 2, bytes: 1000,
      expiresAt: Date.now() + (i === 3 ? -1 : 3600000), state: "pending",
      createdAt: 1, updatedAt: 1,
    }));
    return { batchId, requests };
  });
  const approve = (requestId: typeof requests[number]) => t.mutation(internal.contributionCapacity.decideRequest,
    { adminUserId: s.moderatorUserId, requestId, decision: "approved", reason: "reviewed" });
  const outcomes = await Promise.allSettled([approve(requests[0]), approve(requests[1])]);
  assert.equal(outcomes.filter(x => x.status === "fulfilled").length, 1);
  assert.match(String((outcomes.find(x => x.status === "rejected") as PromiseRejectedResult).reason), /CAPACITY_ALLOWANCE_CONFLICT/);
  await assert.rejects(approve(requests[3]), /CAPACITY_REQUEST_UNAVAILABLE/);
  const winner = await t.run(ctx => ctx.db.query("contributionCapacityRequests")
    .withIndex("by_batch_state", q => q.eq("batchId", batchId).eq("state", "approved")).unique());
  await t.run(ctx => ctx.db.patch(winner!._id, { expiresAt: Date.now() - 1 }));
  await approve(requests[2]);
  process.env.VRDEX_CONTRIBUTION_POLICY = "synthetic-v1";
  process.env.CONVEX_DEPLOYMENT = "local:contributor-capacity-proof";
  try {
    assert.equal((await t.run(ctx => batchAllowance(ctx.db, batchId, s.contributorUserId)))?._id, requests[2]);
    await t.run(ctx => ctx.db.patch(winner!._id, { expiresAt: Date.now() + 3600000 }));
    await assert.rejects(t.run(ctx => batchAllowance(ctx.db, batchId, s.contributorUserId)), /CAPACITY_ALLOWANCE_CONFLICT/);
  } finally {
    delete process.env.VRDEX_CONTRIBUTION_POLICY;
    delete process.env.CONVEX_DEPLOYMENT;
  }
});

it("deletes expired source-host windows in bounded pages and leaves current counters", async () => {
  const { t } = await setup();
  const window = Math.floor(Date.now() / 60000);
  await t.run(async ctx => {
    for (let i = 0; i < 205; i++) await ctx.db.insert("contributionHostFetches", {
      host: `old-${i}.example.test`, window: window - 1, count: 1,
    });
    await ctx.db.insert("contributionHostFetches", { host: "current.example.test", window, count: 4 });
  });
  assert.equal(await t.mutation(internal.contributionCapacity.sweepExpiredHostFetches, {}), 100);
  assert.equal(await t.mutation(internal.contributionCapacity.sweepExpiredHostFetches, {}), 100);
  assert.equal(await t.mutation(internal.contributionCapacity.sweepExpiredHostFetches, {}), 5);
  const rows = await t.run(ctx => ctx.db.query("contributionHostFetches").collect());
  assert.deepEqual(rows.map(row => [row.host, row.window, row.count]), [["current.example.test", window, 4]]);
});

it("caps fresh refusal receipts across clients but preserves old replay and valid admission", async () => {
  const { t, s, authority } = await setup();
  const old = await t.run(async ctx => {
    for (let i = 0; i < 255; i++) await ctx.db.insert("contributionAdmissionRefusals", {
      actorUserId: s.contributorUserId, clientId: i % 2 ? "first" : "second",
      key: `old-${i}`, fingerprint: "historical", receipt: {
        operationId: `receipt-${i}`, operationState: "refused", code: "CONTRIBUTION_ACTOR_BYTES",
      }, createdAt: 1,
    });
    return ctx.db.insert("contributionCapacity", { scope: `actor:${s.contributorUserId}`,
      bytes: 0, processing: 0, byteLimit: 0 });
  });
  const request = (key: string, client = "first") => ({ ...authority(client), mode: "contributor" as const,
    profileId: s.profileId, expectedUpdatedAt: NOW, placement: "profile_image" as const,
    contentType: "image/png", byteLength: 512, sha256: "a".repeat(64),
    credit: "Artist", sourceDescription: "Artist supplied image", idempotencyKey: key });
  const admittedRefusal = await t.mutation(internal.contributionUploads.begin, request("boundary", "second"));
  assert.equal(admittedRefusal.receipt?.code, "CONTRIBUTION_ACTOR_BYTES");
  assert.deepEqual(await t.mutation(internal.contributionUploads.begin, request("boundary", "second")), admittedRefusal);
  await assert.rejects(t.mutation(internal.contributionUploads.begin, { ...request("boundary", "second"), credit: "Changed" }), /UPLOAD_IDEMPOTENCY_CONFLICT/);
  await assert.rejects(t.mutation(internal.contributionUploads.begin, request("overflow")), /UPLOAD_REFUSAL_RECEIPT_LIMIT/);
  assert.equal((await t.run(ctx => ctx.db.query("contributionAdmissionRefusals")
    .withIndex("by_actor_client_key", q => q.eq("actorUserId", s.contributorUserId)).collect())).length, 256);
  await t.run(ctx => ctx.db.patch(old, { byteLimit: undefined }));
  assert.ok("intentId" in await t.mutation(internal.contributionUploads.begin, request("success")));
});

it("fails closed when oversized historical refusals exhaust the bounded read", async () => {
  const { t, s, authority } = await setup();
  await t.run(async ctx => {
    for (let i = 0; i < 12; i++) await ctx.db.insert("contributionAdmissionRefusals", {
      actorUserId: s.contributorUserId, clientId: "first", key: `huge-${i}`,
      fingerprint: "x".repeat(900000), receipt: {
        operationId: `huge-${i}`, operationState: "refused", code: "CONTRIBUTION_ACTOR_BYTES",
      }, createdAt: 1,
    });
    await ctx.db.insert("contributionCapacity", { scope: `actor:${s.contributorUserId}`,
      bytes: 0, processing: 0, byteLimit: 0 });
  });
  await assert.rejects(t.mutation(internal.contributionUploads.begin, {
    ...authority(), mode: "contributor", profileId: s.profileId, expectedUpdatedAt: NOW,
    placement: "profile_image", contentType: "image/png", byteLength: 512,
    sha256: "a".repeat(64), credit: "Artist", sourceDescription: "Artist supplied image",
    idempotencyKey: "fresh",
  }), /UPLOAD_REFUSAL_RECEIPT_LIMIT/);
});
