import assert from "node:assert/strict";
import { it } from "node:test";
import { convexTest } from "convex-test";
import { api, internal } from "../../convex/_generated/api";
import {
  modules,
  schema,
  seed,
  createAndUpload,
  NOW,
} from "./_mediaReviewFixture";
process.env.VRDEX_CONTRIBUTION_BATCHES_ENABLED = "true";
process.env.VRDEX_PROFILE_MEDIA_SUBMISSIONS_ENABLED = "true";
process.env.VRDEX_PROFILE_MEDIA_DIRECT_UPLOAD_ENABLED = "true";
process.env.VRDEX_PROFILE_MEDIA_KIT_ENABLED = "true";
it("compares the effective alternate managed slot for person and community without changing decision placement", async () => {
  for (const type of ["person", "community"] as const) {
    const t = convexTest({ schema, modules });
    const s = await seed(t, type);
    const { intent } = await createAndUpload(t, s);
    const alt = type === "person" ? "primary_logo" : "profile_image";
    const assetId = await t.run(async (ctx) => {
      await ctx.db.patch(intent.submissionId, {
        requestedPlacement:
          type === "person" ? "profile_image" : "primary_logo",
      });
      const assetId = await ctx.db.insert("profileAssets", {
        profileId: s.profileId,
        storageKey: "alternate.webp",
        downloadStorageKey: "alternate.png",
        mimeType: "image/webp",
        downloadMimeType: "image/png",
        downloadContentSha256: "c".repeat(64),
        contentSha256: "c".repeat(64),
        byteSize: 100,
        visibility: "public",
        source: "owner_authored",
        uploadedBy: {
          issuer: "test",
          subject: "owner",
          tokenIdentifier: "test:owner",
        },
        uploadedAt: Date.now(),
        state: "active",
        updatedAt: Date.now(),
      });
      await ctx.db.insert("profileAssetPlacements", {
        profileId: s.profileId,
        assetId,
        placement: alt,
        position: 0,
        state: "active",
        updatedAt: Date.now(),
      });
      return assetId;
    });
    const args = {
      actorUserId: s.moderatorUserId,
      emailVerified: true,
      emailVerificationAttestedAt: Date.now(),
      submissionId: intent.submissionId,
    };
    const d = await t.query(
      internal.profileMediaSubmissions.reviewDetailForMcpActor,
      args,
    );
    assert.equal(d?.currentPlacement, null);
    assert.equal(d?.currentImage?.kind, "managed");
    if (d?.currentImage?.kind === "managed")
      assert.equal(d.currentImage.assetId, assetId);
    assert.equal(
      (await t.query(internal.profileMediaSubmissions.currentForMcpActor, args))
        ?.storageKey,
      "alternate.png",
    );
  }
});
it("keeps assignment revoke and regrant actor reason history", async () => {
  const f = await fixture();
  await f.t.run((ctx) => ctx.db.patch(f.grantId, { feature: "super_admin" }));
  for (const active of [false, true])
    await f.actor.mutation(api.profileMediaSubmissions.setBatchReviewer, {
      batchId: f.batchId,
      reviewerUserId: f.s.moderatorUserId,
      active,
      expiresAt: Date.now() + 600000,
      reason: active ? "Reassigned collection" : "Coverage ended",
    });
  const history = await f.t.run((ctx) =>
    ctx.db.query("contributionReviewerAuditEvents").collect(),
  );
  assert.deepEqual(
    history.map((e) => [e.active, e.reason]),
    [
      [false, "Coverage ended"],
      [true, "Reassigned collection"],
    ],
  );
  assert.ok(history.every((e) => e.actorUserId === f.s.moderatorUserId));
});
it("withdraws with exact version and durable receipt, refusing the opposite decision and foreign replay", async () => {
  const f = await fixture();
  const actor = f.t.withIdentity(f.s.contributorIdentity);
  const own = await actor.query(api.profileMediaSubmissions.getMine, {
    submissionId: f.intent.submissionId,
  });
  assert.ok(own);
  const args = {
    submissionId: f.intent.submissionId,
    expectedReviewVersion: own.reviewVersion,
    idempotencyKey: "withdraw-once",
  };
  const result = await actor.mutation(
    api.profileMediaSubmissions.withdrawWithReceipt,
    args,
  );
  assert.equal(result.operationState, "committed");
  assert.deepEqual(
    await actor.mutation(api.profileMediaSubmissions.withdrawWithReceipt, args),
    result,
  );
  await assert.rejects(
    f.actor.mutation(api.profileMediaSubmissions.withdrawWithReceipt, args),
    /UNAVAILABLE/,
  );
  const review = await f.actor.mutation(
    api.profileMediaSubmissions.decideWithReceipt,
    {
      ...args,
      decision: "approve",
      privateReason: "Reviewed",
      idempotencyKey: "opposite",
    },
  );
  assert.equal(review.operationState, "refused");
});
it("pages own lifecycle beyond forty, isolates cursors and provides an ordinary contributor exact lookup", async () => {
  const f = await fixture();
  await f.t.run(async (ctx) => {
    const row = (await ctx.db.get(f.intent.submissionId))!;
    const { _id, _creationTime, ...value } = row;
    for (let i = 0; i < 45; i++)
      await ctx.db.insert("profileMediaSubmissions", {
        ...value,
        status: i % 2 ? "rejected" : "approved",
        createdAt: Date.now() + i,
        publicDisposition: `result-${i}`,
        uploadIntentId: undefined,
      });
  });
  const actor = f.t.withIdentity(f.s.contributorIdentity);
  const first = await actor.query(api.profileMediaSubmissions.listMinePage, {
    paginationOpts: { cursor: null, numItems: 40 },
  });
  assert.equal(first.page.length, 40);
  assert.equal(first.isDone, false);
  const next = await actor.query(api.profileMediaSubmissions.listMinePage, {
    paginationOpts: { cursor: first.continueCursor, numItems: 40 },
  });
  assert.equal(next.page.length, 6);
  await assert.rejects(
    f.actor.query(api.profileMediaSubmissions.listMinePage, {
      paginationOpts: { cursor: first.continueCursor, numItems: 40 },
    }),
    /CURSOR/,
  );
  const filtered = await actor.query(api.profileMediaSubmissions.listMinePage, {
    status: "rejected",
    paginationOpts: { cursor: null, numItems: 40 },
  });
  assert.equal(filtered.page.length, 22);
  const exact = await actor.query(api.profileMediaSubmissions.getMine, {
    submissionId: f.intent.submissionId,
  });
  assert.ok(exact?.reviewVersion);
  assert.equal(exact?.batchId, f.batchId);
  assert.equal(
    await f.actor.query(api.profileMediaSubmissions.getMine, {
      submissionId: f.intent.submissionId,
    }),
    null,
  );
  const batch = await actor.query(api.profileMediaSubmissions.listMinePage, {
    batchId: f.batchId,
    paginationOpts: { cursor: null, numItems: 40 },
  });
  assert.ok(batch.page.every((row) => row.batchId === f.batchId));
});
it("discovers only live assigned batches through MCP without a known batch id", async () => {
  const f = await fixture();
  const args = {
    actorUserId: f.s.moderatorUserId,
    emailVerified: true,
    emailVerificationAttestedAt: Date.now(),
    paginationOpts: { cursor: null, numItems: 1 },
  };
  const page = await f.t.query(
    internal.profileMediaSubmissions.assignedReviewBatchesForMcpActor,
    args,
  );
  assert.equal(page.page[0]?.batchId, f.batchId);
  await f.t.run((ctx) => ctx.db.patch(f.assignmentId, { active: false }));
  assert.equal(
    (
      await f.t.query(
        internal.profileMediaSubmissions.assignedReviewBatchesForMcpActor,
        args,
      )
    ).page.length,
    0,
  );
});
it("revalidates OAuth token, client and scopes before each command and receipt replay", async () => {
  const f = await fixture();
  const tokenId = await f.t.run((ctx) =>
    ctx.db.insert("oauthAccessTokens", {
      tokenId: "review-token",
      clientId: "review-client",
      subjectType: "user",
      userId: f.s.moderatorUserId,
      resource: "https://example.test/mcp",
      scopes: [
        "mcp:read",
        "mcp:write",
        "assets:review:read",
        "assets:review:write",
      ],
      status: "active",
      issuedAt: Date.now(),
      expiresAt: Date.now() + 600000,
    }),
  );
  const authority = {
    actorUserId: f.s.moderatorUserId,
    emailVerified: true,
    emailVerificationAttestedAt: Date.now(),
    oauthTokenId: "review-token",
    oauthClientId: "review-client",
    oauthResource: "https://example.test/mcp",
  };
  const detail = await f.t.query(
    internal.profileMediaSubmissions.reviewDetailForMcpActor,
    { ...authority, submissionId: f.intent.submissionId },
  );
  assert.ok(detail);
  const args = {
    ...authority,
    submissionId: f.intent.submissionId,
    expectedReviewVersion: detail.reviewVersion,
    decision: "reject" as const,
    privateReason: "Examined",
    publicReason: "Declined",
    idempotencyKey: "oauth-review",
  };
  const receipt = await f.t.mutation(
    internal.profileMediaSubmissions.decideForMcpActor,
    args,
  );
  assert.equal(receipt.operationState, "committed");
  await f.t.run((ctx) => ctx.db.patch(tokenId, { status: "revoked" }));
  await assert.rejects(
    f.t.mutation(internal.profileMediaSubmissions.decideForMcpActor, args),
    /DELEGATION/,
  );
  await assert.rejects(
    f.t.query(internal.profileMediaSubmissions.reviewDetailForMcpActor, {
      ...authority,
      submissionId: f.intent.submissionId,
    }),
    /DELEGATION/,
  );
  await f.t.run((ctx) =>
    ctx.db.patch(tokenId, {
      status: "active",
      scopes: ["mcp:read", "assets:review:read"],
    }),
  );
  await assert.rejects(
    f.t.mutation(internal.profileMediaSubmissions.decideForMcpActor, args),
    /DELEGATION/,
  );
  await f.t.run(async (ctx) => {
    const client = await ctx.db.insert("oauthDynamicClients", {
      clientId: "review-client",
      clientName: "Review",
      redirectUris: ["https://example.test/callback"],
      primaryRedirectHost: "example.test",
      grantTypes: ["authorization_code"],
      responseTypes: ["code"],
      tokenEndpointAuthMethod: "none",
      contacts: [],
      allowedScopes: ["mcp:read", "assets:review:read"],
      resource: "https://example.test/mcp",
      status: "revoked",
      createdAt: Date.now(),
      updatedAt: Date.now(),
    });
    await ctx.db.patch(tokenId, {
      dynamicClientId: client,
      scopes: [
        "mcp:read",
        "mcp:write",
        "assets:review:read",
        "assets:review:write",
      ],
    });
  });
  await assert.rejects(
    f.t.mutation(internal.profileMediaSubmissions.decideForMcpActor, args),
    /DELEGATION/,
  );
  await assert.rejects(
    f.t.query(internal.profileMediaSubmissions.reviewDetailForMcpActor, {
      ...authority,
      submissionId: f.intent.submissionId,
    }),
    /DELEGATION/,
  );
});
it("selects the content-addressed download rendition for existing review and publisher candidates", async () => {
  const t = convexTest({ schema, modules });
  const s = await seed(t);
  const { intent } = await createAndUpload(t, s);
  await t.run((ctx) =>
    ctx.db.patch(intent.intentId, {
      storageKey: "display.webp",
      mimeType: "image/webp",
      downloadStorageKey: "download.png",
      downloadMimeType: "image/png",
      downloadContentSha256: "proposal-hash",
    }),
  );
  const candidate = await t
    .withIdentity(s.moderatorIdentity)
    .query(api.profileMediaSubmissions.getCandidateForStorage, {
      submissionId: intent.submissionId,
    });
  assert.equal(candidate?.storageKey, "download.png");
  assert.equal(candidate?.mimeType, "image/png");
  await t.run((ctx) =>
    ctx.db.insert("accountFeatureGrants", {
      userId: s.contributorUserId,
      feature: "trusted_publisher",
      state: "active",
      grantedBy: {
        issuer: "test",
        subject: "operator",
        tokenIdentifier: "test:operator",
      },
      grantedAt: Date.now(),
      updatedAt: Date.now(),
    }),
  );
  const own = await t
    .withIdentity(s.contributorIdentity)
    .query(api.profileMediaSubmissions.publisherCandidateForStorage, {
      submissionId: intent.submissionId,
    });
  assert.equal(own?.storageKey, "download.png");
});
it("preserves existing assignment authority and discovery while batch intake is disabled", async () => {
  const f = await fixture();
  process.env.VRDEX_CONTRIBUTION_BATCHES_ENABLED = "false";
  process.env.VRDEX_CONTRIBUTION_INTAKE_PAUSED = "true";
  try {
    const args = { submissionId: f.intent.submissionId };
    let d = await f.actor.query(api.profileMediaSubmissions.reviewDetail, args);
    assert.ok(d);
    assert.equal(
      (
        await f.actor.mutation(api.profileMediaSubmissions.rebase, {
          ...args,
          expectedReviewVersion: d.reviewVersion,
          idempotencyKey: "paused-rebase",
        })
      ).operationState,
      "committed",
    );
    d = await f.actor.query(api.profileMediaSubmissions.reviewDetail, args);
    assert.ok(d);
    assert.ok(
      await f.actor.query(
        api.profileMediaSubmissions.getCandidateForStorage,
        args,
      ),
    );
    const page = await f.actor.query(
      api.profileMediaSubmissions.assignedReviewBatches,
      { paginationOpts: { numItems: 40, cursor: null } },
    );
    assert.equal(page.page.length, 1);
    const command = {
      ...args,
      expectedReviewVersion: d.reviewVersion,
      decision: "reject" as const,
      privateReason: "Reviewed",
      publicReason: "Declined",
      idempotencyKey: "paused-decision",
    };
    const receipt = await f.actor.mutation(
      api.profileMediaSubmissions.decideWithReceipt,
      command,
    );
    assert.equal(receipt.operationState, "committed");
    assert.deepEqual(
      await f.actor.mutation(
        api.profileMediaSubmissions.decideWithReceipt,
        command,
      ),
      receipt,
    );
  } finally {
    process.env.VRDEX_CONTRIBUTION_BATCHES_ENABLED = "true";
    delete process.env.VRDEX_CONTRIBUTION_INTAKE_PAUSED;
  }
});
async function fixture() {
  const t = convexTest({ schema, modules });
  const s = await seed(t);
  const { intent } = await createAndUpload(t, s);
  const ids = await t.run(async (ctx) => {
    const grant = (await ctx.db.query("accountFeatureGrants").first())!;
    await ctx.db.patch(grant._id, { feature: "media_reviewer" });
    const batchId = await ctx.db.insert("contributionBatches", {
      actorUserId: s.contributorUserId,
      idempotencyKey: "collection",
      label: "Collection",
      archived: false,
      rowCount: 1,
      createdAt: NOW,
    });
    const revisionId = await ctx.db.insert("contributionItemRevisions", {
      actorUserId: s.contributorUserId,
      batchId,
      itemKey: "one",
      revision: 1,
      payload: JSON.stringify({ kind: "media" }),
      bytes: 10,
      createdAt: NOW,
    });
    await ctx.db.insert("contributionItemAttempts", {
      actorUserId: s.contributorUserId,
      revisionId,
      oauthClientId: "fixture",
      submissionId: intent.submissionId,
      intentId: intent.intentId,
      receipt: { operationId: "one", operationState: "committed" },
      createdAt: NOW,
    });
    const assignmentId = await ctx.db.insert("contributionBatchReviewers", {
      batchId,
      reviewerUserId: s.moderatorUserId,
      active: true,
      expiresAt: Date.now() + 600000,
    });
    return { batchId, assignmentId, grantId: grant._id };
  });
  return { t, s, intent, ...ids, actor: t.withIdentity(s.moderatorIdentity) };
}
it("requires fresh separate grant and exact assignment on detail, candidate and receipt replay", async () => {
  const f = await fixture();
  const args = { submissionId: f.intent.submissionId };
  const d = await f.actor.query(api.profileMediaSubmissions.reviewDetail, args);
  assert.ok(d);
  assert.equal("submitterEmail" in d, false);
  const command = {
    ...args,
    expectedReviewVersion: d.reviewVersion,
    decision: "reject" as const,
    privateReason: "Reviewed",
    publicReason: "Declined",
    idempotencyKey: "decision",
  };
  assert.equal(
    (
      await f.actor.mutation(
        api.profileMediaSubmissions.decideWithReceipt,
        command,
      )
    ).operationState,
    "committed",
  );
  for (const change of [
    "grant",
    "assignment",
    "expired",
    "claimed",
    "private",
  ]) {
    await f.t.run(async (ctx) => {
      await ctx.db.patch(f.grantId, {
        state: change === "grant" ? "revoked" : "active",
      });
      await ctx.db.patch(f.assignmentId, {
        active: change !== "assignment",
        expiresAt: change === "expired" ? 0 : Date.now() + 600000,
      });
      await ctx.db.patch(f.s.profileId, {
        claimState: change === "claimed" ? "claimed_verified" : "unclaimed",
        publicSurfacingState: change === "private" ? "opted_out" : "public",
      });
    });
    await assert.rejects(
      f.actor.query(api.profileMediaSubmissions.reviewDetail, args),
    );
    await assert.rejects(
      f.actor.query(api.profileMediaSubmissions.getCandidateForStorage, args),
    );
    await assert.rejects(
      f.actor.mutation(api.profileMediaSubmissions.decideWithReceipt, command),
    );
  }
});
it("rebases target changes explicitly, increments version and refuses donor or claimed target", async () => {
  const f = await fixture();
  const args = { submissionId: f.intent.submissionId };
  await f.t.run((ctx) => ctx.db.patch(f.s.profileId, { updatedAt: NOW + 1 }));
  const before = await f.actor.query(
    api.profileMediaSubmissions.reviewDetail,
    args,
  );
  assert.ok(before);
  const r = await f.actor.mutation(api.profileMediaSubmissions.rebase, {
    ...args,
    expectedReviewVersion: before.reviewVersion,
    idempotencyKey: "rebase",
  });
  assert.equal(r.operationState, "committed");
  const after = await f.actor.query(
    api.profileMediaSubmissions.reviewDetail,
    args,
  );
  assert.ok(after);
  assert.notEqual(after.reviewVersion, before.reviewVersion);
  assert.equal(after.targetProfileUpdatedAt, NOW + 1);
  assert.equal(
    (await f.t.run((ctx) => ctx.db.get(f.intent.submissionId)))?.status,
    "submitted",
  );
  await assert.rejects(
    f.t
      .withIdentity(f.s.contributorIdentity)
      .mutation(api.profileMediaSubmissions.rebase, {
        ...args,
        expectedReviewVersion: after.reviewVersion,
        idempotencyKey: "donor",
      }),
  );
  await f.t.run((ctx) =>
    ctx.db.patch(f.s.profileId, { claimState: "claimed_verified" }),
  );
  await assert.rejects(
    f.actor.mutation(api.profileMediaSubmissions.rebase, {
      ...args,
      expectedReviewVersion: after.reviewVersion,
      idempotencyKey: "claimed",
    }),
  );
});
it("binds review cursors to authenticated actors, batches and status filters", async () => {
  const f = await fixture();
  const second = await f.t.run(async (ctx) => {
    const id = await ctx.db.insert("contributionBatches", {
      actorUserId: f.s.contributorUserId,
      idempotencyKey: "second",
      label: "Second",
      archived: false,
      rowCount: 0,
      createdAt: NOW,
    });
    await ctx.db.insert("contributionBatchReviewers", {
      batchId: id,
      reviewerUserId: f.s.moderatorUserId,
      active: true,
      expiresAt: Date.now() + 60000,
    });
    return id;
  });
  const page = await f.actor.query(api.profileMediaSubmissions.listForReview, {
    batchId: f.batchId,
    paginationOpts: { cursor: null, numItems: 1 },
  });
  assert.equal(page.page.length, 1);
  await assert.rejects(
    f.actor.query(api.profileMediaSubmissions.listForReview, {
      batchId: second,
      paginationOpts: { cursor: page.continueCursor, numItems: 1 },
    }),
    /CURSOR/,
  );
  await assert.rejects(
    f.actor.query(api.profileMediaSubmissions.listForReview, {
      batchId: f.batchId,
      status: "rejected",
      paginationOpts: { cursor: page.continueCursor, numItems: 1 },
    }),
    /CURSOR/,
  );
  await assert.rejects(
    f.t
      .withIdentity(f.s.contributorIdentity)
      .query(api.profileMediaSubmissions.listForReview, {
        batchId: f.batchId,
        paginationOpts: { cursor: null, numItems: 1 },
      }),
    /BATCH_UNAVAILABLE/,
  );
  await f.t.run((ctx) => ctx.db.patch(f.assignmentId, { active: false }));
  await assert.rejects(
    f.actor.query(api.profileMediaSubmissions.listForReview, {
      batchId: f.batchId,
      paginationOpts: { cursor: page.continueCursor, numItems: 1 },
    }),
    /BATCH_UNAVAILABLE/,
  );
});
it("traverses past nonmatching indexed revisions instead of truncating the filtered queue", async () => {
  const f = await fixture();
  await f.t.run(async (ctx) => {
    await ctx.db.insert("contributionItemRevisions", {
      actorUserId: f.s.contributorUserId,
      batchId: f.batchId,
      itemKey: "aaa",
      revision: 1,
      payload: "{}",
      bytes: 2,
      createdAt: NOW,
    });
  });
  const first = await f.actor.query(api.profileMediaSubmissions.listForReview, {
    batchId: f.batchId,
    paginationOpts: { cursor: null, numItems: 1 },
  });
  assert.equal(first.page.length, 0);
  assert.equal(first.isDone, false);
  const second = await f.actor.query(
    api.profileMediaSubmissions.listForReview,
    {
      batchId: f.batchId,
      paginationOpts: { cursor: first.continueCursor, numItems: 1 },
    },
  );
  assert.equal(second.page.length, 1);
});
it("manages assignments only as a verified super admin and refuses donor assignments", async () => {
  const f = await fixture();
  const input = {
    batchId: f.batchId,
    reviewerUserId: f.s.moderatorUserId,
    active: true,
    expiresAt: Date.now() + 60000,
  };
  await assert.rejects(
    f.actor.mutation(api.profileMediaSubmissions.setBatchReviewer, input),
    /Super admin/,
  );
  await f.t.run((ctx) => ctx.db.patch(f.grantId, { feature: "super_admin" }));
  await assert.rejects(
    f.actor.mutation(api.profileMediaSubmissions.setBatchReviewer, {
      ...input,
      reviewerUserId: f.s.contributorUserId,
    }),
    /ASSIGNMENT_INVALID/,
  );
  assert.equal(
    await f.actor.mutation(api.profileMediaSubmissions.setBatchReviewer, {
      ...input,
      active: false,
    }),
    null,
  );
  assert.equal(
    (await f.t.run((ctx) => ctx.db.get(f.assignmentId)))?.active,
    false,
  );
});
it("placement changes require a new explicit rebase and previously viewed versions fail", async () => {
  const f = await fixture();
  const args = { submissionId: f.intent.submissionId };
  const before = await f.actor.query(
    api.profileMediaSubmissions.reviewDetail,
    args,
  );
  assert.ok(before);
  await f.t.run(async (ctx) => {
    const assetId = await ctx.db.insert("profileAssets", {
      profileId: f.s.profileId,
      state: "active",
      visibility: "public",
      source: "owner_authored",
      storageKey: "current.png",
      mimeType: "image/png",
      byteSize: 100,
      uploadedBy: {
        tokenIdentifier: "test:reviewer",
        subject: "reviewer",
        issuer: "test",
      },
      uploadedAt: NOW,
      updatedAt: NOW,
    });
    await ctx.db.insert("profileAssetPlacements", {
      profileId: f.s.profileId,
      assetId,
      placement: "profile_image",
      state: "active",
      position: 0,
      updatedAt: NOW,
    });
  });
  const stale = await f.actor.mutation(api.profileMediaSubmissions.rebase, {
    ...args,
    expectedReviewVersion: before.reviewVersion,
    idempotencyKey: "stale",
  });
  assert.equal(stale.code, "review_changed");
  const current = await f.actor.query(
    api.profileMediaSubmissions.reviewDetail,
    args,
  );
  assert.ok(current);
  const r = await f.actor.mutation(api.profileMediaSubmissions.rebase, {
    ...args,
    expectedReviewVersion: current.reviewVersion,
    idempotencyKey: "placement",
  });
  assert.equal(r.operationState, "committed");
  const audit = await f.t.run((ctx) =>
    ctx.db.query("mediaReviewRebases").first(),
  );
  assert.ok(audit?.currentPlacementAssetId);
  assert.equal(audit.priorPlacementAssetId, undefined);
});
import { decideSelectedReviews } from "../../packages/api-contracts/src/media-review";
it("commits each selected item independently across a transaction rollback", async () => {
  const f = await fixture();
  await f.t.run((ctx) => ctx.db.patch(f.grantId, { feature: "super_admin" }));
  const second = await createAndUpload(f.t, await seed(f.t), "second-hash");
  const firstDetail = await f.actor.query(
    api.profileMediaSubmissions.reviewDetail,
    { submissionId: f.intent.submissionId },
  );
  const secondDetail = await f.actor.query(
    api.profileMediaSubmissions.reviewDetail,
    { submissionId: second.intent.submissionId },
  );
  assert.ok(firstDetail && secondDetail);
  const decisions = [
    {
      submissionId: f.intent.submissionId,
      expectedReviewVersion: firstDetail.reviewVersion,
      decision: "reject" as const,
      privateReason: "Examined one",
      publicReason: "Declined",
      idempotencyKey: "one",
    },
    {
      submissionId: second.intent.submissionId,
      expectedReviewVersion: secondDetail.reviewVersion,
      decision: "reject" as const,
      privateReason: "Examined two",
      publicReason: "Declined",
      idempotencyKey: "two",
    },
  ];
  const result = await decideSelectedReviews({ decisions }, async (input) => {
    if (input.idempotencyKey === "one") {
      return await f.t.run(async (ctx) => {
        const { decideReviewCommand } =
          await import("../../convex/_mediaReview");
        const { trustedReviewActor } =
          await import("../../convex/_mediaReview");
        await decideReviewCommand(
          ctx,
          input,
          await trustedReviewActor(ctx, f.s.moderatorUserId, {
            emailVerified: true,
            emailVerificationAttestedAt: Date.now(),
          }),
        );
        throw new Error("Injected transaction failure");
      });
    }
    return await f.actor.mutation(
      api.profileMediaSubmissions.decideWithReceipt,
      { ...input, submissionId: second.intent.submissionId },
    );
  });
  assert.deepEqual(
    result.receipts.map((r) => r.operationState),
    ["in_progress", "committed"],
  );
  assert.equal(
    (await f.t.run((ctx) => ctx.db.get(f.intent.submissionId)))?.status,
    "submitted",
  );
  assert.equal(
    (await f.t.run((ctx) => ctx.db.get(second.intent.submissionId)))?.status,
    "rejected",
  );
  assert.equal(
    (await f.t.run((ctx) => ctx.db.query("mediaReviewReceipts").collect()))
      .length,
    1,
  );
});
it("round-trips both reactive split children for global and assigned review pages", async () => {
  const f = await fixture();
  await f.t.run(async (ctx) => {
    const original = (await ctx.db.get(f.intent.submissionId))!;
    const { _id, _creationTime, ...submission } = original;
    void _id;
    void _creationTime;
    for (let n = 0; n < 6; n++) {
      const submissionId = await ctx.db.insert("profileMediaSubmissions", {
        ...submission,
        createdAt: NOW + n,
      });
      const revisionId = await ctx.db.insert("contributionItemRevisions", {
        actorUserId: f.s.contributorUserId,
        batchId: f.batchId,
        itemKey: `split-${n}`,
        revision: 1,
        payload: '{"kind":"media"}',
        bytes: 16,
        createdAt: NOW,
      });
      await ctx.db.insert("contributionItemAttempts", {
        actorUserId: f.s.contributorUserId,
        revisionId,
        oauthClientId: "fixture",
        submissionId,
        receipt: { operationId: `split-${n}`, operationState: "committed" },
        createdAt: NOW,
      });
    }
  });
  for (const batchId of [f.batchId, undefined]) {
    if (!batchId)
      await f.t.run((ctx) =>
        ctx.db.patch(f.grantId, { feature: "super_admin" }),
      );
    const args = {
      ...(batchId ? { batchId } : {}),
      paginationOpts: { cursor: null, numItems: 40, maximumRowsRead: 4 },
    };
    const parent = await f.actor.query(
      api.profileMediaSubmissions.listForReview,
      args,
    );
    assert.ok(parent.splitCursor);
    assert.ok(parent.pageStatus);
    const first = await f.actor.query(
      api.profileMediaSubmissions.listForReview,
      {
        ...args,
        paginationOpts: {
          ...args.paginationOpts,
          endCursor: parent.splitCursor,
        },
      },
    );
    const second = await f.actor.query(
      api.profileMediaSubmissions.listForReview,
      {
        ...args,
        paginationOpts: {
          ...args.paginationOpts,
          cursor: parent.splitCursor,
          endCursor: parent.continueCursor,
        },
      },
    );
    assert.deepEqual(
      [...first.page, ...second.page].map((r) => r.submissionId),
      parent.page.map((r) => r.submissionId),
    );
    await assert.rejects(
      f.actor.query(api.profileMediaSubmissions.listForReview, {
        ...args,
        status: "rejected",
        paginationOpts: {
          ...args.paginationOpts,
          endCursor: parent.splitCursor,
        },
      }),
      /CURSOR/,
    );
  }
});
it("round-trips assignment split children and scopes the ending cursor", async () => {
  const f = await fixture();
  await f.t.run(async (ctx) => {
    for (let n = 0; n < 6; n++) {
      const batchId = await ctx.db.insert("contributionBatches", {
        actorUserId: f.s.contributorUserId,
        idempotencyKey: `split-${n}`,
        label: `Split ${n}`,
        archived: false,
        rowCount: 0,
        createdAt: NOW,
      });
      await ctx.db.insert("contributionBatchReviewers", {
        batchId,
        reviewerUserId: f.s.moderatorUserId,
        active: true,
        expiresAt: Date.now() + 60000,
      });
    }
  });
  const opts = { cursor: null, numItems: 40, maximumRowsRead: 4 };
  const parent = await f.actor.query(
    api.profileMediaSubmissions.assignedReviewBatches,
    { paginationOpts: opts },
  );
  assert.ok(parent.splitCursor);
  const first = await f.actor.query(
    api.profileMediaSubmissions.assignedReviewBatches,
    { paginationOpts: { ...opts, endCursor: parent.splitCursor } },
  );
  const second = await f.actor.query(
    api.profileMediaSubmissions.assignedReviewBatches,
    {
      paginationOpts: {
        ...opts,
        cursor: parent.splitCursor,
        endCursor: parent.continueCursor,
      },
    },
  );
  assert.deepEqual(
    [...first.page, ...second.page].map((r) => r.batchId),
    parent.page.map((r) => r.batchId),
  );
  await assert.rejects(
    f.actor.query(api.profileMediaSubmissions.listForReview, {
      batchId: f.batchId,
      paginationOpts: { ...opts, endCursor: parent.splitCursor },
    }),
    /CURSOR/,
  );
  const noEnd = await f.actor.query(
    api.profileMediaSubmissions.assignedReviewBatches,
    { paginationOpts: { cursor: null, numItems: 40 } },
  );
  const nullEnd = await f.actor.query(
    api.profileMediaSubmissions.assignedReviewBatches,
    { paginationOpts: { cursor: null, numItems: 40, endCursor: null } },
  );
  assert.deepEqual(noEnd, nullEnd);
});
import {
  readScopedPagination,
  writeScopedPagination,
} from "../../convex/_reviewCursor";
it("preserves omitted and null split/end cursors in the pagination protocol", () => {
  const omitted = writeScopedPagination({ continueCursor: "end" }, "scope");
  assert.equal(Object.hasOwn(omitted, "splitCursor"), false);
  const explicitNull = writeScopedPagination(
    { continueCursor: "end", splitCursor: null },
    "scope",
  );
  assert.equal(explicitNull.splitCursor, null);
  const start = { cursor: null, numItems: 40 };
  assert.equal(
    Object.hasOwn(readScopedPagination(start, "scope"), "endCursor"),
    false,
  );
  assert.equal(
    readScopedPagination({ ...start, endCursor: null }, "scope").endCursor,
    null,
  );
  const split = writeScopedPagination(
    { continueCursor: "end", splitCursor: "middle" },
    "scope",
  );
  assert.deepEqual(
    readScopedPagination(
      { ...start, cursor: split.splitCursor, endCursor: split.continueCursor },
      "scope",
    ),
    { ...start, cursor: "middle", endCursor: "end" },
  );
});
