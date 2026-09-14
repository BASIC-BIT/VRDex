import assert from "node:assert/strict";
import { it } from "node:test";
import { reservationBytes } from "../../convex/_contributionCapacity";
import { convexTest } from "convex-test";
import { api, internal } from "../../convex/_generated/api";
import {
  modules as reviewModules,
  schema,
  seed,
  NOW,
} from "./_mediaReviewFixture";

const modules = {
  ...reviewModules,
  "../../convex/contributionUploads.ts": () =>
    import("../../convex/contributionUploads"),
  "../../convex/contributionCleanup.ts": () =>
    import("../../convex/contributionCleanup"),
};
process.env.VRDEX_CONTRIBUTION_UPLOADS_ENABLED = "true";
process.env.VRDEX_MEDIA_UPLOAD_CLEANUP_READY = "true";
process.env.VRDEX_MEDIA_CLEANUP_URL =
  "https://example.test/api/internal/media-cleanup";
process.env.VRDEX_MEDIA_CLEANUP_TOKEN = "test-only";
process.env.VRDEX_PROFILE_MEDIA_SUBMISSIONS_ENABLED = "true";
process.env.VRDEX_PROFILE_MEDIA_KIT_ENABLED = "true";

async function fixture(mode: "owner" | "contributor" = "contributor") {
  const t = convexTest({ schema, modules });
  const s = await seed(t);
  if (mode === "owner")
    await t.run(async (ctx) => {
      await ctx.db.patch(s.profileId, { claimState: "claimed_verified" });
      await ctx.db.insert("profileOwners", {
        profileId: s.profileId,
        userId: s.contributorUserId,
        roleKey: "owner",
        state: "active",
        grantedAt: NOW,
        updatedAt: NOW,
      });
    });
  const tokenId = await t.run((ctx) =>
    ctx.db.insert("oauthAccessTokens", {
      tokenId: "token",
      clientId: "client",
      subjectType: "user",
      userId: s.contributorUserId,
      resource: "https://example.test/mcp",
      scopes: ["mcp:write", "assets:contribute", "assets:write"],
      status: "active",
      issuedAt: Date.now(),
      expiresAt: Date.now() + 3600000,
    }),
  );
  const authority = {
    actorUserId: s.contributorUserId,
    oauthClientId: "client",
    oauthTokenId: "token",
    emailVerified: true,
    emailVerificationAttestedAt: Date.now(),
  };
  const input = {
    ...authority,
    mode,
    profileId: s.profileId,
    expectedUpdatedAt: NOW,
    placement: "profile_image" as const,
    contentType: "image/png",
    byteLength: 512,
    sha256: "a".repeat(64),
    credit: "Artist",
    sourceDescription: "Artist supplied local image",
    idempotencyKey: "begin",
  };
  const begun = await t.mutation(internal.contributionUploads.begin, input);
  const claimInput = {
    ...authority,
    intentId: begun.intentId,
    idempotencyKey: "complete",
    processingToken: "worker",
  };
  const completeInput = {
    ...claimInput,
    mimeType: "image/webp",
    byteSize: 100,
    contentSha256: "b".repeat(64),
    width: 10,
    height: 10,
    sourceMimeType: "image/png",
    sourceByteSize: 512,
    sourceContentSha256: "a".repeat(64),
    downloadMimeType: "image/png",
    downloadByteSize: 200,
    downloadContentSha256: "b".repeat(64),
  };
  return { t, s, tokenId, authority, input, begun, claimInput, completeInput };
}

it("replays admission without another reservation and refuses conflicting declarations", async () => {
  const f = await fixture();
  assert.deepEqual(
    await f.t.mutation(internal.contributionUploads.begin, f.input),
    f.begun,
  );
  await assert.rejects(
    f.t.mutation(internal.contributionUploads.begin, {
      ...f.input,
      sha256: "b".repeat(64),
    }),
    /IDEMPOTENCY_CONFLICT/,
  );
  assert.equal(
    (
      await f.t.run((ctx) =>
        ctx.db.query("contributionUploadReservations").collect(),
      )
    ).length,
    1,
  );
  assert.equal("uploadToken" in f.begun, false);
});

it("rejects both legacy token-only upload paths even with the stored token", async () => {
  const f = await fixture();
  const intent = (await f.t.run((ctx) => ctx.db.get(f.begun.intentId)))!;
  const args = { intentId: intent._id, uploadToken: intent.uploadToken };
  assert.equal(
    await f.t.query(
      internal.profileAssets.getUploadIntentForDirectStorage,
      args,
    ),
    null,
  );
  assert.deepEqual(
    await f.t.mutation(internal.profileAssets.claimUploadIntentForStorage, {
      ...args,
      processingToken: "legacy",
    }),
    { status: "not_found" },
  );
  await assert.rejects(
    f.t.mutation(internal.profileAssets.markUploadIntentUploaded, {
      ...args,
      processingToken: "worker",
      mimeType: "image/png",
      byteSize: 512,
    }),
  );
});

it("seals one private proposal with concurrent completions and reconciles retained bytes", async () => {
  const f = await fixture();
  const claims = await Promise.all([
    f.t.mutation(internal.contributionUploads.claim, f.claimInput),
    f.t.mutation(internal.contributionUploads.claim, {
      ...f.claimInput,
      processingToken: "second",
    }),
  ]);
  assert.equal(claims.filter((c) => "receipt" in c).length, 1);
  const results = await Promise.all([
    f.t.mutation(internal.contributionUploads.complete, f.completeInput),
    f.t.mutation(internal.contributionUploads.complete, f.completeInput),
  ]);
  assert.deepEqual(results[0], results[1]);
  assert.equal(results[0].operationState, "committed");
  const state = await f.t.run(async (ctx) => ({
    assets: await ctx.db.query("profileAssets").collect(),
    submissions: await ctx.db.query("profileMediaSubmissions").collect(),
    reservation: await ctx.db.query("contributionUploadReservations").first(),
  }));
  assert.equal(state.assets.length, 0);
  assert.equal(state.submissions[0].status, "submitted");
  assert.equal(state.submissions[0].sourceKind, "local");
  assert.equal(state.reservation?.chargedBytes, 1324);
  assert.equal(state.reservation?.processing, false);
});

for (const mismatch of [
  { sourceByteSize: 513 },
  { sourceMimeType: "image/jpeg" },
  { sourceContentSha256: "c".repeat(64) },
]) {
  it(`refuses a sealed source mismatch ${JSON.stringify(mismatch)}`, async () => {
    const f = await fixture();
    await f.t.mutation(internal.contributionUploads.claim, f.claimInput);
    await assert.rejects(
      f.t.mutation(internal.contributionUploads.complete, {
        ...f.completeInput,
        ...mismatch,
      }),
      /SOURCE_MISMATCH/,
    );
    assert.equal(
      (await f.t.run((ctx) => ctx.db.query("profileAssets").collect())).length,
      0,
    );
  });
}

it("rechecks revoked delegation and lost target eligibility at commit", async () => {
  const f = await fixture();
  await f.t.mutation(internal.contributionUploads.claim, f.claimInput);
  await f.t.run((ctx) => ctx.db.patch(f.tokenId, { status: "revoked" }));
  await assert.rejects(
    f.t.mutation(internal.contributionUploads.complete, f.completeInput),
    /DELEGATION_DENIED/,
  );
  await f.t.run(async (ctx) => {
    await ctx.db.patch(f.tokenId, { status: "active" });
    await ctx.db.patch(f.s.profileId, { publicSurfacingState: "suppressed" });
  });
  await assert.rejects(
    f.t.mutation(internal.contributionUploads.complete, f.completeInput),
  );
});

it("expires processing without releasing retained byte charges before deletion", async () => {
  const f = await fixture();
  await f.t.mutation(internal.contributionUploads.claim, f.claimInput);
  await f.t.run(async (ctx) => {
    const row = (await ctx.db.query("contributionUploadReservations").first())!;
    await ctx.db.patch(row._id, { expiresAt: Date.now() - 1 });
  });
  assert.equal(
    (await f.t.mutation(internal.contributionUploads.complete, f.completeInput))
      .code,
    "UPLOAD_EXPIRED",
  );
  const row = (await f.t.run((ctx) =>
    ctx.db.query("contributionUploadReservations").first(),
  ))!;
  assert.equal(row.processing, false);
  assert.equal(row.chargedBytes, reservationBytes(512));
});

it("keeps failed writes charged through cleanup failure and retries, then releases once", async () => {
  const f = await fixture();
  await f.t.mutation(internal.contributionUploads.claim, f.claimInput);
  await f.t.mutation(internal.contributionUploads.fail, {
    intentId: f.begun.intentId,
    processingToken: "worker",
  });
  await f.t.run(async (ctx) => {
    const row = (await ctx.db.query("contributionUploadReservations").first())!;
    await ctx.db.patch(row._id, { cleanupAfter: Date.now() - 1 });
  });
  const work = await f.t.mutation(internal.contributionCleanup.claim, {});
  assert.equal(work.uploads.length, 1);
  assert.equal(work.uploads[0].keys.length, 4);
  assert.equal(
    (
      await f.t.run((ctx) =>
        ctx.db.query("contributionUploadReservations").first(),
      )
    )?.chargedBytes,
    reservationBytes(512),
  );
  assert.equal(
    (await f.t.mutation(internal.contributionCleanup.claim, {})).uploads.length,
    0,
  );
  const confirm = {
    uploads: work.uploads.map(({ reservationId, token }) => ({
      reservationId,
      token,
    })),
    proposals: [],
  };
  await f.t.mutation(internal.contributionCleanup.confirm, confirm);
  await f.t.mutation(internal.contributionCleanup.confirm, confirm);
  assert.equal(
    (
      await f.t.run((ctx) =>
        ctx.db.query("contributionUploadReservations").first(),
      )
    )?.chargedBytes,
    0,
  );
});

it("allows admitted reservations to finish after their capacity ceiling drops", async () => {
  const f = await fixture();
  await f.t.run(async (ctx) => {
    const row = (await ctx.db
      .query("contributionCapacity")
      .withIndex("by_scope", (q) =>
        q.eq("scope", `actor:${f.s.contributorUserId}`),
      )
      .unique())!;
    await ctx.db.patch(row._id, { byteLimit: 1, processingLimit: 0 });
  });
  await f.t.mutation(internal.contributionUploads.claim, f.claimInput);
  assert.equal(
    (await f.t.mutation(internal.contributionUploads.complete, f.completeInput))
      .operationState,
    "committed",
  );
  await f.t.run(async (ctx) => {
    const row = (await ctx.db.query("profileMediaSubmissions").first())!;
    await ctx.db.patch(row._id, { createdAt: Date.now() - 86400000 });
  });
  await assert.rejects(
    f.t.mutation(internal.contributionUploads.begin, {
      ...f.input,
      idempotencyKey: "next",
    }),
    /CAPACITY_EXCEEDED/,
  );
});

it("reserves quarantine and source plus both bounded derivatives", () => {
  assert.equal(reservationBytes(512), 1024 + 24 * 1024 * 1024);
  for (const invalid of [0, -1, NaN, Infinity, 12 * 1024 * 1024 + 1, 1.5]) {
    assert.throws(() => reservationBytes(invalid));
  }
});

it("fails closed without cleanup readiness and refuses batch references before writes", async () => {
  const f = await fixture();
  const before = await f.t.run((ctx) =>
    ctx.db.query("contributionUploadReservations").collect(),
  );
  process.env.VRDEX_MEDIA_UPLOAD_CLEANUP_READY = "false";
  try {
    await assert.rejects(
      f.t.mutation(internal.contributionUploads.begin, {
        ...f.input,
        idempotencyKey: "disabled",
      }),
      /UPLOAD_DISABLED/,
    );
  } finally {
    process.env.VRDEX_MEDIA_UPLOAD_CLEANUP_READY = "true";
  }
  await assert.rejects(
    f.t.mutation(internal.contributionUploads.begin, {
      ...f.input,
      batchId: "invented",
      idempotencyKey: "batch",
    }),
    /BATCH_UNAVAILABLE/,
  );
  await assert.rejects(
    f.t.mutation(internal.contributionUploads.begin, {
      ...f.input,
      sourceDescription: undefined,
      idempotencyKey: "source",
    }),
    /PROVENANCE_REQUIRED/,
  );
  assert.deepEqual(
    await f.t.run((ctx) =>
      ctx.db.query("contributionUploadReservations").collect(),
    ),
    before,
  );
});

it("holds block deletion and leased deletion blocks a new hold", async () => {
  const f = await fixture();
  await f.t.mutation(internal.contributionUploads.claim, f.claimInput);
  await f.t.mutation(internal.contributionUploads.complete, f.completeInput);
  const submission = (await f.t.run((ctx) =>
    ctx.db.query("profileMediaSubmissions").first(),
  ))!;
  const moderator = f.t.withIdentity(f.s.moderatorIdentity);
  await moderator.mutation(api.profileMediaSubmissions.setBlobLegalHold, {
    submissionId: submission._id,
    held: true,
    reason: "Preserve evidence",
  });
  await f.t.run(async (ctx) => {
    const row = (await ctx.db.query("contributionUploadReservations").first())!;
    await ctx.db.patch(row._id, { cleanupAfter: Date.now() - 1 });
  });
  assert.equal(
    (await f.t.mutation(internal.contributionCleanup.claim, {})).uploads.length,
    0,
  );
  await moderator.mutation(api.profileMediaSubmissions.setBlobLegalHold, {
    submissionId: submission._id,
    held: false,
    reason: "Release evidence",
  });
  await f.t.run(async (ctx) => {
    const row = (await ctx.db.query("contributionUploadReservations").first())!;
    await ctx.db.patch(row._id, { cleanupAfter: Date.now() - 1 });
  });
  assert.equal(
    (await f.t.mutation(internal.contributionCleanup.claim, {})).uploads.length,
    1,
  );
  await assert.rejects(
    moderator.mutation(api.profileMediaSubmissions.setBlobLegalHold, {
      submissionId: submission._id,
      held: true,
      reason: "Preserve evidence",
    }),
    /cleanup is already in progress/,
  );
});

it("owner mode publishes through existing finalization and rejects lost ownership", async () => {
  const f = await fixture("owner");
  await f.t.mutation(internal.contributionUploads.claim, f.claimInput);
  const owner = (await f.t.run((ctx) =>
    ctx.db.query("profileOwners").first(),
  ))!;
  await f.t.run((ctx) => ctx.db.delete(owner._id));
  await assert.rejects(
    f.t.mutation(internal.contributionUploads.complete, f.completeInput),
    /TARGET_DENIED/,
  );
  await f.t.run(async (ctx) => {
    const { _id: _id, _creationTime: _time, ...record } = owner;
    await ctx.db.insert("profileOwners", record);
  });
  assert.equal(
    (await f.t.mutation(internal.contributionUploads.complete, f.completeInput))
      .operationState,
    "committed",
  );
  const stored = await f.t.run(async (ctx) => ({
    assets: await ctx.db.query("profileAssets").collect(),
    proposals: await ctx.db.query("profileMediaSubmissions").collect(),
  }));
  assert.equal(stored.assets.length, 1);
  assert.equal(stored.assets[0].state, "active");
  assert.equal(stored.proposals.length, 0);
});

it("scheduled proposal cleanup advances past a failed batch before retrying it", async () => {
  const f = await fixture();
  await f.t.run(async (ctx) => {
    const source = (await ctx.db.query("profileMediaSubmissions").first())!;
    const {
      _id: _id,
      _creationTime: _time,
      uploadIntentId: _intent,
      ...record
    } = source;
    for (let i = 0; i < 25; i++)
      await ctx.db.insert("profileMediaSubmissions", {
        ...record,
        status: "withdrawn",
        blobDeleteAfter: Date.now() - 1000,
      });
  });
  const first = await f.t.mutation(internal.contributionCleanup.claim, {});
  const second = await f.t.mutation(internal.contributionCleanup.claim, {});
  assert.equal(first.proposals.length, 20);
  assert.equal(second.proposals.length, 5);
  assert.equal(
    second.proposals.some((row) =>
      first.proposals.some((old) => old.submissionId === row.submissionId),
    ),
    false,
  );
  await f.t.mutation(internal.contributionCleanup.confirm, {
    uploads: [],
    proposals: first.proposals.map(({ submissionId, cleanupToken }) => ({
      submissionId,
      cleanupToken,
    })),
  });
  assert.equal(
    (await f.t.run((ctx) => ctx.db.get(first.proposals[0].submissionId)))
      ?.blobDeletedAt !== undefined,
    true,
  );
});
