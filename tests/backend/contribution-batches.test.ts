import assert from "node:assert/strict";
import { it } from "node:test";
import { convexTest } from "convex-test";
import { internal } from "../../convex/_generated/api";
import { createAndUpload } from "./_mediaReviewFixture";
import {
  schema,
  modules as baseModules,
  seed,
  NOW,
} from "./_mediaReviewFixture";
const modules = {
  ...baseModules,
  "../../convex/contributionOperations.ts": () =>
    import("../../convex/contributionOperations"),
  "../../convex/contributionUploads.ts": () =>
    import("../../convex/contributionUploads"),
  "../../convex/contributionBatches.ts": () =>
    import("../../convex/contributionBatches"),
};
process.env.VRDEX_CONTRIBUTION_BATCHES_ENABLED = "true";
it("replays committed and refused receipts after actual archived payload expiry", async () => {
  for (const refused of [false, true]) {
    const f = await fixture();
    await f.t.mutation(internal.contributionBatches.append, {
      ...f.authority,
      batchId: f.batch.batchId,
      items: [
        {
          ...f.item,
          ...(refused
            ? { source: { ...f.item.source, publication: "private_only" } }
            : {}),
        },
      ],
    });
    const args = {
      ...f.authority,
      batchId: f.batch.batchId,
      itemKey: "links",
      expectedRevision: 1,
    };
    const receipt = await f.t.mutation(
      internal.contributionBatches.submit,
      args,
    );
    await f.t.mutation(internal.contributionBatches.archive, {
      ...f.authority,
      batchId: f.batch.batchId,
    });
    await f.t.run((ctx) =>
      ctx.db.patch(f.batch.batchId, { payloadCleanupAfter: Date.now() - 1 }),
    );
    assert.equal(
      (await f.t.mutation(internal.contributionOperations.expirePayloads, {}))
        .expired,
      1,
    );
    assert.deepEqual(
      await f.t.mutation(internal.contributionBatches.submit, args),
      receipt,
    );
    await f.t.run((ctx) =>
      ctx.db.insert("oauthAccessTokens", {
        tokenId: "replacement",
        clientId: "replacement",
        subjectType: "user",
        userId: f.s.contributorUserId,
        resource: "https://example.test/mcp",
        scopes: ["mcp:read", "mcp:write", "profile:contribute"],
        status: "active",
        issuedAt: Date.now(),
        expiresAt: Date.now() + 600000,
      }),
    );
    assert.deepEqual(
      await f.t.mutation(internal.contributionBatches.submit, {
        ...args,
        oauthClientId: "replacement",
        oauthTokenId: "replacement",
      }),
      receipt,
    );
    assert.equal(
      (
        await f.t.run((ctx) =>
          ctx.db.query("contributionItemAttempts").collect(),
        )
      ).length,
      1,
    );
    await f.t.run((ctx) => ctx.db.patch(f.tokenId, { status: "revoked" }));
    await assert.rejects(
      f.t.mutation(internal.contributionBatches.submit, args),
      /DELEGATION/,
    );
  }
});
it("allows correction after actual submission expiry while active attempts stay blocked", async () => {
  const f = await fixture();
  process.env.VRDEX_PROFILE_MEDIA_SUBMISSIONS_ENABLED = "true";
  process.env.VRDEX_PROFILE_MEDIA_DIRECT_UPLOAD_ENABLED = "true";
  process.env.VRDEX_PROFILE_MEDIA_KIT_ENABLED = "true";
  const { intent } = await createAndUpload(f.t, f.s);
  await f.t.mutation(internal.contributionBatches.append, {
    ...f.authority,
    batchId: f.batch.batchId,
    items: [f.item],
  });
  await f.t.run(async (ctx) => {
    const rev = (await ctx.db.query("contributionItemRevisions").first())!;
    await ctx.db.insert("contributionItemAttempts", {
      actorUserId: f.s.contributorUserId,
      revisionId: rev._id,
      oauthClientId: "client",
      submissionId: intent.submissionId,
      receipt: { operationId: "test", operationState: "committed" },
      createdAt: Date.now(),
    });
  });
  const args = {
    ...f.authority,
    batchId: f.batch.batchId,
    itemKey: "links",
    expectedRevision: 1,
    item: f.item,
  };
  await assert.rejects(
    f.t.mutation(internal.contributionBatches.revise, args),
    /NOT_TERMINAL/,
  );
  await f.t.run(async (ctx) => {
    await ctx.db.patch(intent.submissionId, { expiresAt: Date.now() - 1 });
    const { prepareDueBlobCleanupCore } =
      await import("../../convex/profileMediaSubmissions");
    await prepareDueBlobCleanupCore(ctx, {
      issuer: "test",
      subject: "operator",
      tokenIdentifier: "test:operator",
    });
  });
  assert.equal(
    (await f.t.run((ctx) => ctx.db.get(intent.submissionId)))?.status,
    "superseded",
  );
  assert.equal(
    (await f.t.mutation(internal.contributionBatches.revise, args)).revision,
    2,
  );
});
async function fixture() {
  const t = convexTest({ schema, modules });
  const s = await seed(t);
  const authority = {
    actorUserId: s.contributorUserId,
    oauthClientId: "client",
    oauthTokenId: "batch-token",
    emailVerified: true,
    emailVerificationAttestedAt: Date.now(),
  };
  const tokenId = await t.run((ctx) =>
    ctx.db.insert("oauthAccessTokens", {
      tokenId: authority.oauthTokenId,
      clientId: "client",
      subjectType: "user",
      userId: s.contributorUserId,
      resource: "https://example.test/mcp",
      scopes: [
        "mcp:write",
        "mcp:read",
        "profile:contribute",
        "assets:contribute",
      ],
      status: "active",
      issuedAt: Date.now(),
      expiresAt: Date.now() + 3600000,
    }),
  );
  const batch = await t.mutation(internal.contributionBatches.create, {
    ...authority,
    input: { idempotencyKey: "batch", label: "Collection" },
  });
  const item = {
    kind: "profile_links" as const,
    itemKey: "links",
    source: {
      description: "Public artist website",
      publication: "public_allowed" as const,
    },
    profileId: s.profileId,
    expectedUpdatedAt: NOW,
    links: [{ type: "website", url: "https://example.test/new" }],
  };
  return { t, s, authority, batch, item, tokenId };
}
it("stages and replays actor-owned items across clients, refusing changed payloads", async () => {
  const f = await fixture();
  const input = { ...f.authority, batchId: f.batch.batchId, items: [f.item] };
  const first = await f.t.mutation(internal.contributionBatches.append, input);
  await f.t.run((ctx) =>
    ctx.db.insert("oauthAccessTokens", {
      tokenId: "other-token",
      clientId: "other",
      subjectType: "user",
      userId: f.s.contributorUserId,
      resource: "https://example.test/mcp",
      scopes: ["mcp:write", "mcp:read", "profile:contribute"],
      status: "active",
      issuedAt: Date.now(),
      expiresAt: Date.now() + 3600000,
    }),
  );
  assert.deepEqual(
    await f.t.mutation(internal.contributionBatches.append, {
      ...input,
      oauthClientId: "other",
      oauthTokenId: "other-token",
    }),
    first,
  );
  await assert.rejects(
    f.t.mutation(internal.contributionBatches.append, {
      ...input,
      items: [{ ...f.item, links: [] }],
    }),
    /CONFLICT/,
  );
  await assert.rejects(
    f.t.mutation(internal.contributionBatches.append, {
      ...input,
      items: Array.from({ length: 51 }, (_, i) => ({
        ...f.item,
        itemKey: String(i),
      })),
    }),
  );
  await f.t.run((ctx) => ctx.db.patch(f.tokenId, { status: "revoked" }));
  await assert.rejects(
    f.t.mutation(internal.contributionBatches.append, input),
    /DELEGATION/,
  );
});
it("merges destinations, preserves provenance, replays durable receipts and rejects stale snapshots", async () => {
  const f = await fixture();
  await f.t.run((ctx) =>
    ctx.db.patch(f.s.profileId, {
      outboundLinks: [
        {
          type: "website",
          url: "https://example.test/original",
          label: "Original",
          source: "owner_authored",
        },
        {
          type: "website",
          url: "https://example.test/original",
          label: "Community copy",
          source: "community_submitted",
          handle: "untouched",
        },
      ],
    }),
  );
  const storedLinks = (await f.t.run((ctx) => ctx.db.get(f.s.profileId)))!
    .outboundLinks!;
  await f.t.mutation(internal.contributionBatches.append, {
    ...f.authority,
    batchId: f.batch.batchId,
    items: [f.item],
  });
  const input = {
    ...f.authority,
    batchId: f.batch.batchId,
    itemKey: "links",
    expectedRevision: 1,
  };
  const result = await f.t.mutation(internal.contributionBatches.submit, input);
  assert.equal(result.operationState, "committed");
  assert.deepEqual(
    await f.t.mutation(internal.contributionBatches.submit, input),
    result,
  );
  const profile = await f.t.run((ctx) => ctx.db.get(f.s.profileId));
  assert.equal(profile?.outboundLinks?.length, 3);
  assert.deepEqual(profile?.outboundLinks?.slice(0, 2), storedLinks);
  await f.t.mutation(internal.contributionBatches.append, {
    ...f.authority,
    batchId: f.batch.batchId,
    items: [{ ...f.item, itemKey: "stale" }],
  });
  const staleInput = { ...input, itemKey: "stale" };
  const stale = await f.t.mutation(internal.contributionBatches.submit, staleInput);
  assert.equal(stale.operationState, "refused");
  assert.equal(stale.code, "PROFILE_CHANGED");
  assert.deepEqual(await f.t.mutation(internal.contributionBatches.submit, staleInput), stale);
});
it("does not publish private evidence or ambiguous identities and archives without losing receipts", async () => {
  const f = await fixture();
  await f.t.mutation(internal.contributionBatches.append, {
    ...f.authority,
    batchId: f.batch.batchId,
    items: [
      { ...f.item, source: { ...f.item.source, publication: "private_only" } },
      {
        kind: "profile_create",
        itemKey: "new",
        source: f.item.source,
        identity: { resolution: "ambiguous" },
        profile: { profileType: "person", displayName: "Another DJ" },
      },
    ],
  });
  const input = {
    ...f.authority,
    batchId: f.batch.batchId,
    expectedRevision: 1,
  };
  assert.equal(
    (
      await f.t.mutation(internal.contributionBatches.submit, {
        ...input,
        itemKey: "links",
      })
    ).code,
    "SOURCE_PRIVATE",
  );
  assert.equal(
    (
      await f.t.mutation(internal.contributionBatches.submit, {
        ...input,
        itemKey: "new",
      })
    ).code,
    "NEEDS_REVIEW",
  );
  await f.t.mutation(internal.contributionBatches.archive, {
    ...f.authority,
    batchId: f.batch.batchId,
  });
  const batch = await f.t.query(internal.contributionBatches.get, {
    ...f.authority,
    batchId: f.batch.batchId,
  });
  assert.equal(batch.archived, true);
});

it("pages all 1001 rows with bounded reads and isolates other actors", async () => {
  const f = await fixture();
  await f.t.run(async (ctx) => {
    for (let i = 0; i < 1001; i++) {
      const payload = JSON.stringify({
        ...f.item,
        itemKey: `row-${String(i).padStart(4, "0")}`,
      });
      const revisionId = await ctx.db.insert("contributionItemRevisions", {
        actorUserId: f.s.contributorUserId,
        batchId: f.batch.batchId,
        itemKey: `row-${String(i).padStart(4, "0")}`,
        revision: 1,
        payload,
        bytes: payload.length,
        createdAt: NOW,
      });
      await ctx.db.insert("contributionItems", {
        actorUserId: f.s.contributorUserId,
        batchId: f.batch.batchId,
        itemKey: `row-${String(i).padStart(4, "0")}`,
        revision: 1,
        revisionId,
        createdAt: NOW,
      });
    }
  });
  const seen = new Set<string>();
  let cursor: string | null = null;
  do {
    const page = await f.t.query(internal.contributionBatches.items, {
      ...f.authority,
      batchId: f.batch.batchId,
      limit: 40,
      cursor,
    });
    assert.ok(page.page.length <= 40);
    for (const row of page.page) seen.add(row.itemKey);
    cursor = page.isDone ? null : page.cursor;
  } while (cursor);
  assert.equal(seen.size, 1001);
  await assert.rejects(
    f.t.query(internal.contributionBatches.get, {
      ...f.authority,
      actorUserId: f.s.moderatorUserId,
      batchId: f.batch.batchId,
    }),
    /DELEGATION/,
  );
});
it("enforces concurrent capacity, counts terminal rows until archive, retains revision charges", async () => {
  const f = await fixture();
  await f.t.run((ctx) =>
    ctx.db.insert("contributionManifestUsage", {
      actorUserId: f.s.contributorUserId,
      activeRows: 999,
      retainedRevisions: 999,
      retainedBytes: 999,
    }),
  );
  const outcomes = await Promise.allSettled(
    ["a", "b"].map((itemKey) =>
      f.t.mutation(internal.contributionBatches.append, {
        ...f.authority,
        batchId: f.batch.batchId,
        items: [{ ...f.item, itemKey }],
      }),
    ),
  );
  assert.equal(outcomes.filter((x) => x.status === "fulfilled").length, 1);
  await f.t.mutation(internal.contributionBatches.archive, {
    ...f.authority,
    batchId: f.batch.batchId,
  });
  const usage = await f.t.run((ctx) =>
    ctx.db.query("contributionManifestUsage").unique(),
  );
  assert.equal(usage?.activeRows, 999);
  assert.equal(usage?.retainedRevisions, 1000);
});
it("requires terminal attempts before revision and caps retained revisions and payload bytes", async () => {
  const f = await fixture();
  const privateItem = {
    ...f.item,
    source: { ...f.item.source, publication: "private_only" as const },
  };
  await f.t.mutation(internal.contributionBatches.append, {
    ...f.authority,
    batchId: f.batch.batchId,
    items: [privateItem],
  });
  const input = {
    ...f.authority,
    batchId: f.batch.batchId,
    itemKey: f.item.itemKey,
  };
  assert.equal(
    (
      await f.t.mutation(internal.contributionBatches.revise, {
        ...input,
        expectedRevision: 1,
        item: privateItem,
      })
    ).revision,
    2,
  );
  for (let revision = 2; revision <= 5; revision++) {
    await f.t.mutation(internal.contributionBatches.submit, {
      ...input,
      expectedRevision: revision,
    });
    if (revision < 5)
      await f.t.mutation(internal.contributionBatches.revise, {
        ...input,
        expectedRevision: revision,
        item: {
          ...privateItem,
          source: {
            ...privateItem.source,
            description: `revision ${revision + 1}`,
          },
        },
      });
  }
  await assert.rejects(
    f.t.mutation(internal.contributionBatches.revise, {
      ...input,
      expectedRevision: 5,
      item: f.item,
    }),
    /REVISION_LIMIT/,
  );
  await f.t.run(async (ctx) => {
    const u = await ctx.db.query("contributionManifestUsage").unique();
    await ctx.db.patch(u!._id, { retainedRevisions: 10000 });
  });
  await assert.rejects(
    f.t.mutation(internal.contributionBatches.append, {
      ...f.authority,
      batchId: f.batch.batchId,
      items: [{ ...f.item, itemKey: "extra" }],
    }),
    /CAPACITY/,
  );
  await assert.rejects(
    f.t.mutation(internal.contributionBatches.append, {
      ...f.authority,
      batchId: f.batch.batchId,
      items: [
        {
          ...f.item,
          itemKey: "bytes",
          links: Array.from({ length: 10 }, (_, i) => ({
            type: "website",
            url: `https://example.test/${i}/${"a".repeat(1000)}`,
          })),
        },
      ],
    }),
    /METADATA_LIMIT/,
  );
});

it("resumes a partially submitted mixed collection without creating a second profile", async () => {
  const f = await fixture();
  const create = {
    kind: "profile_create",
    itemKey: "new",
    source: f.item.source,
    identity: {
      resolution: "new_identity",
      evidence: "Distinct public performer identity reviewed",
    },
    profile: { profileType: "person", displayName: "Another DJ" },
  };
  await f.t.mutation(internal.contributionBatches.append, {
    ...f.authority,
    batchId: f.batch.batchId,
    items: [create, { ...f.item, expectedUpdatedAt: 1 }],
  });
  const input = {
    ...f.authority,
    batchId: f.batch.batchId,
    expectedRevision: 1,
  };
  const receipt = await f.t.mutation(internal.contributionBatches.submit, {
    ...input,
    itemKey: "new",
  });
  const refusal = await f.t.mutation(internal.contributionBatches.submit, { ...input, itemKey: "links" });
  assert.equal(refusal.operationState, "refused");
  assert.equal(refusal.code, "PROFILE_CHANGED");
  assert.deepEqual(await f.t.mutation(internal.contributionBatches.submit, { ...input, itemKey: "links" }), refusal);
  assert.deepEqual(
    await f.t.mutation(internal.contributionBatches.submit, {
      ...input,
      itemKey: "new",
    }),
    receipt,
  );
  const profiles = await f.t.run((ctx) => ctx.db.query("profiles").collect());
  assert.equal(profiles.length, 2);
  const rows = await f.t.query(internal.contributionBatches.reconcilePage, {
    ...f.authority,
    cursor: null,
    kind: "batches",
  });
  assert.equal(rows.activeRows, 2);
  const revs = await f.t.query(internal.contributionBatches.reconcilePage, {
    ...f.authority,
    cursor: null,
    kind: "revisions",
  });
  assert.equal(revs.retainedRevisions, 2);
  assert.ok(revs.retainedBytes > 0);
});

it("links media admission and completion to one exact revision and follows a created profile", async () => {
  const f = await fixture();
  process.env.VRDEX_CONTRIBUTION_UPLOADS_ENABLED = "true";
  process.env.VRDEX_MEDIA_UPLOAD_CLEANUP_READY = "true";
  process.env.VRDEX_MEDIA_CLEANUP_URL = "https://example.test/cleanup";
  process.env.VRDEX_MEDIA_CLEANUP_TOKEN = "test";
  process.env.VRDEX_PROFILE_MEDIA_SUBMISSIONS_ENABLED = "true";
  const create = {
    kind: "profile_create",
    itemKey: "new",
    source: f.item.source,
    identity: {
      resolution: "new_identity",
      evidence: "Public identity inspected",
    },
    profile: { profileType: "community", displayName: "New Club" },
  };
  const media = {
    kind: "media",
    itemKey: "logo",
    source: f.item.source,
    dependsOnItemKey: "new",
    placement: "primary_logo",
    transport: "local",
    credit: "Artist",
    contentType: "image/png",
    byteLength: 512,
    sha256: "a".repeat(64),
  };
  await f.t.mutation(internal.contributionBatches.append, {
    ...f.authority,
    batchId: f.batch.batchId,
    items: [create, media],
  });
  const input = {
    ...f.authority,
    batchId: f.batch.batchId,
    itemKey: "logo",
    expectedRevision: 1,
  };
  await assert.rejects(
    f.t.mutation(internal.contributionBatches.mediaRequest, input),
    /DEPENDENCY/,
  );
  const created = await f.t.mutation(internal.contributionBatches.submit, {
    ...input,
    itemKey: "new",
  });
  const request = await f.t.mutation(
    internal.contributionBatches.mediaRequest,
    input,
  );
  assert.equal(request.profileId, created.resourceId);
  assert.equal(request.placement, "primary_logo");
  const { transport, ...upload } = request;
  const begun = await f.t.mutation(internal.contributionUploads.begin, {
    ...f.authority,
    ...upload,
  });
  await assert.rejects(
    f.t.mutation(internal.contributionUploads.begin, {
      ...f.authority,
      ...upload,
      sha256: "b".repeat(64),
    }),
    /CONFLICT/,
  );
  await assert.rejects(
    f.t.mutation(internal.contributionBatches.revise, {
      ...input,
      item: media,
    }),
    /NOT_TERMINAL/,
  );
  const page = await f.t.query(internal.contributionBatches.items, {
    ...f.authority,
    batchId: f.batch.batchId,
    limit: 40,
    cursor: null,
  });
  assert.equal(
    page.page.find((r) => r.itemKey === "logo")?.mediaStatus,
    "upload_pending",
  );
  const claim = {
    ...f.authority,
    intentId: begun.intentId,
    processingToken: "worker",
    idempotencyKey: "seal",
  };
  await f.t.mutation(internal.contributionUploads.claim, claim);
  await f.t.mutation(internal.contributionBatches.archive, {
    ...f.authority,
    batchId: f.batch.batchId,
  });
  const receipt = await f.t.mutation(internal.contributionUploads.complete, {
    ...claim,
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
  });
  assert.equal(receipt.operationState, "committed");
  const attempts = await f.t.run((ctx) =>
    ctx.db.query("contributionItemAttempts").collect(),
  );
  assert.equal(attempts.length, 2);
});
it("refuses suppressed identities without a profile or command receipt", async () => {
  const f = await fixture();
  await f.t.run((ctx) =>
    ctx.db.insert("profileSuppressionRequests", {
      profileType: "person",
      displayName: "Suppressed DJ",
      requestType: "pre_claim_safety",
      state: "accepted",
      createdAt: NOW,
      updatedAt: NOW,
    }),
  );
  await f.t.mutation(internal.contributionBatches.append, {
    ...f.authority,
    batchId: f.batch.batchId,
    items: [
      {
        kind: "profile_create",
        itemKey: "blocked",
        source: f.item.source,
        identity: { resolution: "new_identity", evidence: "Public evidence" },
        profile: { profileType: "person", displayName: "Suppressed DJ" },
      },
    ],
  });
  await assert.rejects(
    f.t.mutation(internal.contributionBatches.submit, {
      ...f.authority,
      batchId: f.batch.batchId,
      itemKey: "blocked",
      expectedRevision: 1,
    }),
  );
  assert.equal(
    (await f.t.run((ctx) => ctx.db.query("profiles").collect())).length,
    1,
  );
  assert.equal(
    (await f.t.run((ctx) => ctx.db.query("contributionItemAttempts").collect()))
      .length,
    0,
  );
});

it("replays pending URL admission and rejects cross-item upload keys", async () => {
  const f = await fixture();
  process.env.VRDEX_CONTRIBUTION_UPLOADS_ENABLED = "true";
  process.env.VRDEX_MEDIA_UPLOAD_CLEANUP_READY = "true";
  process.env.VRDEX_MEDIA_CLEANUP_URL = "https://example.test/cleanup";
  process.env.VRDEX_MEDIA_CLEANUP_TOKEN = "test";
  process.env.VRDEX_PROFILE_MEDIA_SUBMISSIONS_ENABLED = "true";
  const media = {
    kind: "media",
    itemKey: "image",
    source: f.item.source,
    profileId: f.s.profileId,
    expectedUpdatedAt: NOW,
    placement: "profile_image",
    transport: "url",
    sourceUrl: "https://example.test/image.png",
    credit: "Artist",
    contentType: "image/png",
    byteLength: 512,
    sha256: "a".repeat(64),
  };
  await f.t.mutation(internal.contributionBatches.append, {
    ...f.authority,
    batchId: f.batch.batchId,
    items: [media, { ...media, itemKey: "second" }],
  });
  const input = {
    ...f.authority,
    batchId: f.batch.batchId,
    itemKey: "image",
    expectedRevision: 1,
  };
  const { transport, ...request } = await f.t.mutation(
    internal.contributionBatches.mediaRequest,
    input,
  );
  await f.t.mutation(internal.contributionUploads.begin, {
    ...f.authority,
    ...request,
  });
  assert.equal(
    (await f.t.mutation(internal.contributionBatches.submit, input)).code,
    "URL_UPLOAD_REQUIRED",
  );
  const second = await f.t.mutation(internal.contributionBatches.mediaRequest, {
    ...input,
    itemKey: "second",
  });
  const { transport: ignored, ...secondRequest } = second;
  await assert.rejects(
    f.t.mutation(internal.contributionUploads.begin, {
      ...f.authority,
      ...secondRequest,
      idempotencyKey: request.idempotencyKey,
    }),
    /CONFLICT/,
  );
});

it("rolls publication back when storing its receipt unexpectedly fails", async () => {
  const f = await fixture();
  await f.t.mutation(internal.contributionBatches.append, {
    ...f.authority,
    batchId: f.batch.batchId,
    items: [
      {
        kind: "profile_create",
        itemKey: "new",
        source: f.item.source,
        identity: { resolution: "new_identity", evidence: "Public evidence" },
        profile: { profileType: "person", displayName: "Transaction DJ" },
      },
    ],
  });
  const { submit } = await import("../../convex/contributionBatches");
  await assert.rejects(
    f.t.run(async (ctx) => {
      const insert = ctx.db.insert.bind(ctx.db);
      const db = new Proxy(ctx.db, {
        get(target, key) {
          if (key === "insert")
            return async (
              table: Parameters<typeof insert>[0],
              value: Parameters<typeof insert>[1],
            ) => {
              if (table === "contributionItemAttempts")
                throw Error("Receipt storage failed");
              return insert(table, value);
            };
          return Reflect.get(target, key);
        },
      });
      return submit._handler(
        { ...ctx, db },
        {
          ...f.authority,
          batchId: f.batch.batchId,
          itemKey: "new",
          expectedRevision: 1,
        },
      );
    }),
    /Receipt storage failed/,
  );
  assert.equal(
    (await f.t.run((ctx) => ctx.db.query("profiles").collect())).length,
    1,
  );
  assert.equal(
    (await f.t.run((ctx) => ctx.db.query("contributionItemAttempts").collect()))
      .length,
    0,
  );
});

it("archives above a downgraded retained ceiling without releasing retained charges", async () => {
  const f = await fixture();
  await f.t.mutation(internal.contributionBatches.append, {
    ...f.authority,
    batchId: f.batch.batchId,
    items: [f.item],
  });
  await f.t.run(async (ctx) => {
    const usage = await ctx.db.query("contributionManifestUsage").unique();
    await ctx.db.patch(usage!._id, {
      activeRows: 1001,
      retainedRevisions: 10001,
      retainedBytes: 81920001,
    });
  });
  await f.t.mutation(internal.contributionBatches.archive, {
    ...f.authority,
    batchId: f.batch.batchId,
  });
  const usage = await f.t.run((ctx) =>
    ctx.db.query("contributionManifestUsage").unique(),
  );
  assert.equal(usage?.activeRows, 1000);
  assert.equal(usage?.retainedRevisions, 10001);
  assert.equal(usage?.retainedBytes, 81920001);
});
it("uses independently authenticated batch readers and binds their reconciliation cursors", async () => {
  const f = await fixture();
  const otherAuthority = {
    ...f.authority,
    actorUserId: f.s.moderatorUserId,
    oauthTokenId: "reviewer-token",
  };
  await f.t.run((ctx) =>
    ctx.db.insert("oauthAccessTokens", {
      tokenId: "reviewer-token",
      clientId: "client",
      subjectType: "user",
      userId: f.s.moderatorUserId,
      resource: "https://example.test/mcp",
      scopes: [
        "mcp:read",
        "mcp:write",
        "profile:contribute",
        "assets:review:read",
      ],
      status: "active",
      issuedAt: Date.now(),
      expiresAt: Date.now() + 600000,
    }),
  );
  const other = await f.t.mutation(internal.contributionBatches.create, {
    ...otherAuthority,
    input: { label: "Other", idempotencyKey: "other" },
  });
  await assert.rejects(
    f.t.query(internal.contributionBatches.get, {
      ...otherAuthority,
      batchId: f.batch.batchId,
    }),
    /BATCH_UNAVAILABLE/,
  );
  const original = await f.t.query(internal.contributionBatches.items, {
    ...f.authority,
    batchId: f.batch.batchId,
    cursor: null,
    limit: 1,
  });
  await assert.rejects(
    f.t.query(internal.contributionBatches.items, {
      ...otherAuthority,
      batchId: other.batchId,
      cursor: original.cursor,
      limit: 1,
    }),
    /CURSOR/,
  );
  const rec = await f.t.query(internal.contributionBatches.reconcilePage, {
    ...f.authority,
    kind: "batches",
    cursor: null,
  });
  await assert.rejects(
    f.t.query(internal.contributionBatches.reconcilePage, {
      ...otherAuthority,
      kind: "batches",
      cursor: rec.cursor,
    }),
    /CURSOR/,
  );
  const assignment = await f.t.run((ctx) =>
    ctx.db.insert("contributionBatchReviewers", {
      batchId: f.batch.batchId,
      reviewerUserId: f.s.moderatorUserId,
      active: true,
      expiresAt: Date.now() + 600000,
    }),
  );
  await assert.rejects(
    f.t.query(internal.contributionBatches.get, {
      ...otherAuthority,
      batchId: f.batch.batchId,
    }),
    /BATCH_UNAVAILABLE/,
  );
  const grant = await f.t.run(async (ctx) => {
    const g = (await ctx.db.query("accountFeatureGrants").first())!;
    await ctx.db.patch(g._id, { feature: "media_reviewer" });
    return g._id;
  });
  assert.equal(
    (
      await f.t.query(internal.contributionBatches.get, {
        ...otherAuthority,
        batchId: f.batch.batchId,
      })
    ).batchId,
    f.batch.batchId,
  );
  const second = await f.t.mutation(internal.contributionBatches.create, {
    ...f.authority,
    input: { label: "Second", idempotencyKey: "second" },
  });
  await f.t.run((ctx) =>
    ctx.db.insert("contributionBatchReviewers", {
      batchId: second.batchId,
      reviewerUserId: f.s.moderatorUserId,
      active: true,
      expiresAt: Date.now() + 600000,
    }),
  );
  const page = await f.t.query(internal.contributionBatches.items, {
    ...otherAuthority,
    batchId: f.batch.batchId,
    cursor: null,
    limit: 1,
  });
  await assert.rejects(
    f.t.query(internal.contributionBatches.items, {
      ...otherAuthority,
      batchId: second.batchId,
      cursor: page.cursor,
      limit: 1,
    }),
    /CURSOR/,
  );
  for (const change of ["expired", "revoked", "grant"]) {
    await f.t.run(async (ctx) => {
      await ctx.db.patch(assignment, {
        active: change !== "revoked",
        expiresAt: change === "expired" ? 0 : Date.now() + 600000,
      });
      await ctx.db.patch(grant, {
        state: change === "grant" ? "revoked" : "active",
      });
    });
    await assert.rejects(
      f.t.query(internal.contributionBatches.get, {
        ...otherAuthority,
        batchId: f.batch.batchId,
      }),
      /BATCH_UNAVAILABLE/,
    );
    await assert.rejects(
      f.t.query(internal.contributionBatches.items, {
        ...otherAuthority,
        batchId: f.batch.batchId,
        cursor: null,
        limit: 1,
      }),
      /BATCH_UNAVAILABLE/,
    );
  }
});

it("bounds every new row across append pages while replayed rows are free", async () => {
  const f = await fixture();
  process.env.VRDEX_CONTRIBUTION_POLICY = "synthetic-v1";
  process.env.CONVEX_DEPLOYMENT = "local:contributor-capacity-proof";
  try {
    await f.t.run((ctx) =>
      ctx.db.insert("contributionCapacityRequests", {
        actorUserId: f.s.contributorUserId,
        key: "allow",
        kind: "batch_allowance",
        batchId: f.batch.batchId,
        evidence: "fixture",
        reason: "fixture",
        rows: 3,
        bytes: 10000,
        expiresAt: Date.now() + 86400000,
        state: "approved",
        createdAt: Date.now(),
        updatedAt: Date.now(),
      }),
    );
    const append = (keys: string[]) =>
      f.t.mutation(internal.contributionBatches.append, {
        ...f.authority,
        batchId: f.batch.batchId,
        items: keys.map((itemKey) => ({ ...f.item, itemKey })),
      });
    await append(["a", "b"]);
    await assert.rejects(append(["a", "c", "d"]), /BATCH_ALLOWANCE_ROWS/);
    assert.equal(
      (await f.t.run((ctx) => ctx.db.get(f.batch.batchId)))?.rowCount,
      2,
    );
    await append(["a", "b", "c"]);
    await append(["a", "b", "c"]);
    assert.equal(
      (await f.t.run((ctx) => ctx.db.get(f.batch.batchId)))?.rowCount,
      3,
    );
  } finally {
    delete process.env.VRDEX_CONTRIBUTION_POLICY;
    delete process.env.CONVEX_DEPLOYMENT;
  }
});

it("migrates old archived payload deadlines in bounded pages, preserving holds and unknown dates", async () => {
  const f = await fixture();
  await f.t.mutation(internal.contributionBatches.append, {
    ...f.authority,
    batchId: f.batch.batchId,
    items: [f.item, { ...f.item, itemKey: "held" }],
  });
  const archivedAt = Date.now() - 31 * 86400000;
  await f.t.run(async (ctx) => {
    await ctx.db.patch(f.batch.batchId, { archived: true, archivedAt });
    const revisions = await ctx.db.query("contributionItemRevisions").collect();
    await ctx.db.patch(revisions.find((r) => r.itemKey === "held")!._id, {
      legalHoldAt: Date.now(),
    });
    for (let i = 0; i < 41; i++)
      await ctx.db.insert("contributionBatches", {
        actorUserId: f.s.contributorUserId,
        idempotencyKey: `old-${i}`,
        label: "old",
        archived: true,
        rowCount: 0,
        createdAt: 1,
        ...(i === 40 ? {} : { archivedAt }),
      });
  });
  let cursor: string | null = null,
    updated = 0,
    unresolved = 0,
    pages = 0;
  for (;;) {
    const page = await f.t.mutation(
      internal.contributionOperations.backfillArchivedPayloads,
      { cursor },
    );
    pages++;
    updated += page.updated;
    unresolved += page.unresolved;
    if (page.isDone) break;
    cursor = page.cursor;
  }
  assert.equal(pages, 2);
  assert.equal(updated, 41);
  assert.equal(unresolved, 1);
  assert.equal(
    (await f.t.run((ctx) => ctx.db.get(f.batch.batchId)))?.payloadCleanupAfter,
    archivedAt + 30 * 86400000,
  );
  const expired = await f.t.mutation(
    internal.contributionOperations.expirePayloads,
    {},
  );
  assert.equal(expired.expired, 1);
  assert.equal(expired.held, 1);
  const batch = (await f.t.run((ctx) => ctx.db.get(f.batch.batchId)))!;
  assert.ok(batch.payloadCleanupAfter! > Date.now());
  await f.t.mutation(internal.contributionOperations.backfillArchivedPayloads, {
    cursor: null,
  });
  assert.equal(
    (await f.t.run((ctx) => ctx.db.get(f.batch.batchId)))?.payloadCleanupAfter,
    batch.payloadCleanupAfter,
  );
});
