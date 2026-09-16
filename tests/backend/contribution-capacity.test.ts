import assert from "node:assert/strict";
import { it } from "node:test";
import { convexTest } from "convex-test";
import { internal } from "../../convex/_generated/api";
import { modules as base, schema, seed } from "./_mediaReviewFixture";
const modules = {
  ...base,
  "../../convex/contributionCapacity.ts": () =>
    import("../../convex/contributionCapacity"),
  "../../convex/contributionUploads.ts": () =>
    import("../../convex/contributionUploads"),
  "../../convex/contributionOperations.ts": () =>
    import("../../convex/contributionOperations"),
};
it("bounds simultaneous actors at shared deployment and source-host admission", async () => {
  const t = convexTest({ schema, modules }),
    s = await seed(t);
  Object.assign(process.env, {
    VRDEX_CONTRIBUTION_UPLOADS_ENABLED: "true",
    VRDEX_MEDIA_UPLOAD_CLEANUP_READY: "true",
    VRDEX_MEDIA_CLEANUP_URL: "https://example.test/api/internal/media-cleanup",
    VRDEX_MEDIA_CLEANUP_TOKEN: "test",
    VRDEX_PROFILE_MEDIA_SUBMISSIONS_ENABLED: "true",
    VRDEX_CONTRIBUTION_DEPLOYMENT_CONCURRENCY: "2",
    VRDEX_CONTRIBUTION_HOST_FETCHES_PER_MINUTE: "1",
  });
  try {
    const actors = await t.run(async (ctx) => {
      const { _id, _creationTime, ...profile } = (await ctx.db.get(
        s.profileId,
      ))!;
      const actors = [];
      for (let i = 0; i < 3; i++) {
        const actorUserId = await ctx.db.insert("users", {
          clerkUserId: `synthetic-${i}`,
          email: `actor-${i}@example.test`,
        });
        const profileId = await ctx.db.insert("profiles", {
          ...profile,
          slug: `synthetic-${i}`,
        });
        await ctx.db.insert("oauthAccessTokens", {
          tokenId: `token-${i}`,
          clientId: "client",
          subjectType: "user",
          userId: actorUserId,
          resource: "https://example.test/mcp",
          scopes: ["mcp:read", "mcp:write", "assets:contribute"],
          status: "active",
          issuedAt: Date.now(),
          expiresAt: Date.now() + 3600000,
        });
        actors.push({
          actorUserId,
          profileId,
          oauthClientId: "client",
          oauthTokenId: `token-${i}`,
          emailVerified: true,
          emailVerificationAttestedAt: Date.now(),
        });
      }
      return actors;
    });
    const admissions = await Promise.all(
      actors.map((actor) =>
        t.mutation(internal.contributionUploads.begin, {
          ...actor,
          mode: "contributor",
          expectedUpdatedAt: Date.parse("2026-08-26T12:00:00Z"),
          placement: "profile_image",
          contentType: "image/png",
          byteLength: 512,
          sha256: "a".repeat(64),
          credit: "Artist",
          sourceUrl: "https://example.test/image.png",
          idempotencyKey: "admit",
        }),
      ),
    );
    const admitted = admissions.filter((row) => "intentId" in row);
    assert.equal(admitted.length, 2);
    assert.equal(
      admissions.find((row) => "receipt" in row)?.receipt.code,
      "CONTRIBUTION_DEPLOYMENT_CONCURRENCY",
    );
    assert.deepEqual(
      await t.mutation(internal.contributionCapacity.claimSourceFetch, {
        intentId: admitted[0].intentId,
      }),
      { allowed: true },
    );
    const refused = await t.mutation(
      internal.contributionCapacity.claimSourceFetch,
      { intentId: admitted[1].intentId },
    );
    assert.equal(refused.allowed, false);
    assert.ok(refused.retryAt! > Date.now());
  } finally {
    delete process.env.VRDEX_CONTRIBUTION_DEPLOYMENT_CONCURRENCY;
    delete process.env.VRDEX_CONTRIBUTION_HOST_FETCHES_PER_MINUTE;
  }
});
it("discovers effective baseline limits without intake and keeps capacity separate from publication", async () => {
  const t = convexTest({ schema, modules });
  const s = await seed(t);
  await t.run((ctx) =>
    ctx.db.insert("oauthAccessTokens", {
      tokenId: "capacity",
      clientId: "client",
      subjectType: "user",
      userId: s.contributorUserId,
      resource: "https://example.test/mcp",
      scopes: ["mcp:read", "mcp:write", "assets:contribute"],
      status: "active",
      issuedAt: Date.now(),
      expiresAt: Date.now() + 3600000,
    }),
  );
  const authority = {
    actorUserId: s.contributorUserId,
    oauthClientId: "client",
    oauthTokenId: "capacity",
    emailVerified: true,
    emailVerificationAttestedAt: Date.now(),
  };
  const before = await t.query(internal.contributionCapacity.get, authority);
  assert.equal(before.limits.openActor, 3);
  assert.equal(before.reservation, false);
  await t.run((ctx) =>
    ctx.db.insert("contributionCapacity", {
      scope: `actor:${s.contributorUserId}`,
      bytes: 0,
      processing: 0,
      byteLimit: 64,
      processingLimit: 0,
    }),
  );
  const lowered = await t.query(internal.contributionCapacity.get, authority);
  assert.equal(lowered.limits.actorBytes, 64);
  assert.equal(lowered.remaining.bytes, 64);
  assert.equal(lowered.remaining.concurrency, 0);
  const request = await t.mutation(internal.contributionCapacity.request, {
    ...authority,
    key: "ask",
    kind: "trusted_contributor",
    evidence: "https://example.test/collection",
    reason: "collection",
  });
  assert.equal(request.state, "pending");
  assert.equal(
    (await t.query(internal.contributionCapacity.get, authority)).tier,
    "ordinary",
  );
});
it("replays terminal quota refusal, authorizes before replay, and reports status through pause", async () => {
  const t = convexTest({ schema, modules }),
    s = await seed(t);
  Object.assign(process.env, {
    VRDEX_CONTRIBUTION_UPLOADS_ENABLED: "true",
    VRDEX_MEDIA_UPLOAD_CLEANUP_READY: "true",
    VRDEX_MEDIA_CLEANUP_URL: "https://example.test/api/internal/media-cleanup",
    VRDEX_MEDIA_CLEANUP_TOKEN: "test",
    VRDEX_PROFILE_MEDIA_SUBMISSIONS_ENABLED: "true",
  });
  const token = await t.run((ctx) =>
    ctx.db.insert("oauthAccessTokens", {
      tokenId: "a",
      clientId: "c",
      subjectType: "user",
      userId: s.contributorUserId,
      resource: "https://example.test/mcp",
      scopes: ["mcp:read", "mcp:write", "assets:contribute"],
      status: "active",
      issuedAt: Date.now(),
      expiresAt: Date.now() + 3600000,
    }),
  );
  const authority = {
    actorUserId: s.contributorUserId,
    oauthClientId: "c",
    oauthTokenId: "a",
    emailVerified: true,
    emailVerificationAttestedAt: Date.now(),
  };
  const request = {
    ...authority,
    mode: "contributor" as const,
    profileId: s.profileId,
    expectedUpdatedAt: Date.parse("2026-08-26T12:00:00Z"),
    placement: "profile_image" as const,
    contentType: "image/png",
    byteLength: 512,
    sha256: "a".repeat(64),
    credit: "Artist",
    sourceDescription: "Artist supplied image",
    idempotencyKey: "one",
  };
  const first = await t.mutation(internal.contributionUploads.begin, request);
  assert.ok("intentId" in first);
  const refused = await t.mutation(internal.contributionUploads.begin, {
    ...request,
    idempotencyKey: "two",
  });
  assert.equal(refused.receipt?.operationState, "refused");
  assert.deepEqual(
    await t.mutation(internal.contributionUploads.begin, {
      ...request,
      idempotencyKey: "two",
    }),
    refused,
  );
  process.env.VRDEX_CONTRIBUTION_INTAKE_PAUSED = "true";
  try {
    const status = await t.query(internal.contributionCapacity.status, {
      ...authority,
      cursor: null,
      limit: 20,
    });
    assert.equal(status.page[0].receipt.operationState, "in_progress");
  } finally {
    delete process.env.VRDEX_CONTRIBUTION_INTAKE_PAUSED;
  }
  await t.run((ctx) => ctx.db.patch(token, { status: "revoked" }));
  await assert.rejects(
    t.mutation(internal.contributionUploads.begin, {
      ...request,
      idempotencyKey: "two",
    }),
    /DELEGATION_DENIED/,
  );
});
it("expires archived metadata in bounded pages while holding unresolved payloads charged", async () => {
  const t = convexTest({ schema, modules }),
    s = await seed(t);
  const batch = await t.run(async (ctx) => {
    const batch = await ctx.db.insert("contributionBatches", {
      actorUserId: s.contributorUserId,
      idempotencyKey: "archive",
      label: "Synthetic",
      archived: true,
      rowCount: 41,
      createdAt: 1,
      archivedAt: 1,
      payloadCleanupAfter: 2,
    });
    await ctx.db.insert("contributionManifestUsage", {
      actorUserId: s.contributorUserId,
      activeRows: 0,
      retainedRevisions: 41,
      retainedBytes: 410,
    });
    for (let i = 0; i < 41; i++)
      await ctx.db.insert("contributionItemRevisions", {
        actorUserId: s.contributorUserId,
        batchId: batch,
        itemKey: String(i).padStart(2, "0"),
        revision: 1,
        payload: "1234567890",
        bytes: 10,
        createdAt: 1,
        ...(i === 0 ? { legalHoldAt: 1 } : {}),
      });
    return batch;
  });
  const first = await t.mutation(
    internal.contributionOperations.expirePayloads,
    {},
  );
  assert.deepEqual(first, { scanned: 40, expired: 39, held: 1 });
  const second = await t.mutation(
    internal.contributionOperations.expirePayloads,
    {},
  );
  assert.equal(second.expired, 1);
  const usage = await t.run((ctx) =>
    ctx.db.query("contributionManifestUsage").unique(),
  );
  assert.equal(usage?.retainedRevisions, 1);
  assert.equal(usage?.retainedBytes, 10);
  assert.ok(
    (await t.run((ctx) => ctx.db.get(batch)))!.payloadCleanupAfter! >
      Date.now(),
  );
});
for (const revoked of [false, true])
  it(`capacity grant ${revoked ? "revocation blocks" : "expiry permits"} admitted finalization`, async () => {
    const t = convexTest({ schema, modules }),
      s = await seed(t);
    Object.assign(process.env, {
      VRDEX_CONTRIBUTION_UPLOADS_ENABLED: "true",
      VRDEX_MEDIA_UPLOAD_CLEANUP_READY: "true",
      VRDEX_MEDIA_CLEANUP_URL:
        "https://example.test/api/internal/media-cleanup",
      VRDEX_MEDIA_CLEANUP_TOKEN: "test",
      VRDEX_PROFILE_MEDIA_SUBMISSIONS_ENABLED: "true",
    });
    const grant = await t.run(async (ctx) => {
      await ctx.db.insert("oauthAccessTokens", {
        tokenId: "a",
        clientId: "c",
        subjectType: "user",
        userId: s.contributorUserId,
        resource: "https://example.test/mcp",
        scopes: ["mcp:read", "mcp:write", "assets:contribute"],
        status: "active",
        issuedAt: Date.now(),
        expiresAt: Date.now() + 3600000,
      });
      return ctx.db.insert("accountFeatureGrants", {
        userId: s.contributorUserId,
        feature: "trusted_contributor",
        state: "active",
        grantedBy: {
          issuer: "test",
          subject: "operator",
          tokenIdentifier: "test:operator",
        },
        grantedAt: Date.now(),
        updatedAt: Date.now(),
      });
    });
    const authority = {
      actorUserId: s.contributorUserId,
      oauthClientId: "c",
      oauthTokenId: "a",
      emailVerified: true,
      emailVerificationAttestedAt: Date.now(),
    };
    const admission = await t.mutation(internal.contributionUploads.begin, {
      ...authority,
      mode: "contributor",
      profileId: s.profileId,
      expectedUpdatedAt: Date.parse("2026-08-26T12:00:00Z"),
      placement: "profile_image",
      contentType: "image/png",
      byteLength: 512,
      sha256: "a".repeat(64),
      credit: "Artist",
      sourceDescription: "Artist supplied image",
      idempotencyKey: "one",
    });
    assert.ok("intentId" in admission);
    await t.run((ctx) =>
      ctx.db.patch(
        grant,
        revoked
          ? { state: "revoked", revokedAt: Date.now() }
          : { expiresAt: Date.now() - 1 },
      ),
    );
    const claim = t.mutation(internal.contributionUploads.claim, {
      ...authority,
      intentId: admission.intentId,
      idempotencyKey: "finish",
      processingToken: "worker",
    });
    if (revoked) await assert.rejects(claim, /CAPACITY_REVOKED/);
    else assert.ok("storageKey" in (await claim));
  });
