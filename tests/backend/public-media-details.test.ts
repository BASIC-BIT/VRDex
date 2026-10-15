import assert from "node:assert/strict";
import { it } from "node:test";
import { convexTest } from "convex-test";
import { api } from "../../convex/_generated/api";
import schemaModule from "../../convex/schema";
import { resolvePublicMediaActor } from "../../convex/_publicMediaDetails";
const schema =
  (schemaModule as unknown as { default?: typeof schemaModule }).default ??
  schemaModule;
const modules = {
  "../../convex/_generated/api.ts": () => import("../../convex/_generated/api"),
  "../../convex/profileAssets.ts": () => import("../../convex/profileAssets"),
};
process.env.VRDEX_PROFILE_MEDIA_KIT_ENABLED = "true";
async function seed() {
  const t = convexTest({ schema, modules });
  const ids = await t.run(async ({ db }) => {
    const a = await db.insert("users", {
      clerkUserId: "user_a",
      name: "PRIVATE A",
      email: "private@example.test",
    });
    const b = await db.insert("users", {
      clerkUserId: "user_b",
      name: "PRIVATE B",
    });
    const profile = (slug: string) => ({
      profileType: "person" as const,
      slug,
      displayName: slug,
      sortName: slug,
      aliases: [],
      tags: [],
      claimState: "claimed_verified" as const,
      publicationState: "published" as const,
      publicSurfacingState: "public" as const,
      creationSource: "self" as const,
      person: { roleTags: [] },
      updatedAt: 999,
    });
    const target = await db.insert("profiles", profile("target"));
    const pa = await db.insert("profiles", profile("public-a"));
    const pb = await db.insert("profiles", profile("public-b"));
    const owner = await db.insert("profileOwners", {
      profileId: pa,
      userId: a,
      roleKey: "owner",
      state: "active",
      grantedAt: 1,
      updatedAt: 1,
    });
    await db.insert("profileOwners", {
      profileId: pb,
      userId: b,
      roleKey: "owner",
      state: "active",
      grantedAt: 1,
      updatedAt: 1,
    });
    const asset = await db.insert("profileAssets", {
      profileId: target,
      storageKey: "private/key",
      sourceUrl: "https://private.test/?signature=secret",
      sourceDescription: "PRIVATE NOTES",
      mimeType: "image/png",
      byteSize: 128,
      label: "Image",
      visibility: "public",
      source: "owner_authored",
      uploadedBy: {
        issuer: "vrdex:api",
        subject: a,
        tokenIdentifier: `api:${a}`,
      },
      uploadedAt: 10,
      updatedAt: 999,
      state: "active",
      credit: "Artist credit",
      creditUrl: "https://example.test/reference",
    });
    const submission = await db.insert("profileMediaSubmissions", {
      profileId: target,
      targetProfileSlug: "target",
      targetProfileDisplayName: "target",
      submitterUserId: a,
      submitter: {
        issuer: "vrdex:api",
        subject: a,
        tokenIdentifier: `api:${a}`,
      },
      requestedPlacement: "gallery",
      credit: "Artist credit",
      contributorNote: "PRIVATE",
      privateReason: "PRIVATE",
      status: "approved",
      targetProfileUpdatedAt: 1,
      approvedAssetId: asset,
      publicationMethod: "independent_review",
      publicationActorUserId: b,
      publicationOperationId: "exact",
      reviewer: {
        issuer: "vrdex:api",
        subject: b,
        tokenIdentifier: `api:${b}`,
      },
      reviewedAt: 20,
      expiresAt: 99999,
      createdAt: 5,
      updatedAt: 999,
    });
    await db.patch(asset, { sourceSubmissionId: submission });
    const receipt = await db.insert("mediaReviewReceipts", {
      actorUserId: b,
      idempotencyKey: "key",
      inputHash: "hash",
      submissionId: submission,
      receipt: { operationId: "exact", operationState: "committed" },
      createdAt: 30,
    });
    return { a, b, target, pa, pb, asset, submission, receipt, owner };
  });
  return {
    t,
    ...ids,
    read: () =>
      t.query(api.profileAssets.getPublicAssetDetails, {
        slug: "target",
        assetId: ids.asset,
      }),
  };
}
it("keeps uploader and publisher distinct, with immutable dates and public reference only", async () => {
  const s = await seed();
  const d = await s.read();
  assert.ok(d);
  assert.deepEqual(
    d.history.map((e) => [e.kind, e.at, e.actor?.profileSlug]),
    [
      ["uploaded", 10, "public-a"],
      ["approved", 20, "public-b"],
      ["published", 30, "public-b"],
    ],
  );
  assert.equal(d.uploadedBy?.profileSlug, "public-a");
  assert.equal(d.referenceUrl, "https://example.test/reference");
  assert.equal(d.asset.detailsUrl, `/target#media-${s.asset}`);
  assert.doesNotMatch(
    JSON.stringify(d),
    /PRIVATE|private\.test|signature|privateReason|tokenIdentifier|storageKey/,
  );
  await s.t.run(({ db }) =>
    db.patch(s.asset, { updatedAt: 99999, credit: "Edited" }),
  );
  assert.deepEqual((await s.read())?.history, d.history);
});
it("trusted publication omits approval and missing receipt never guesses updatedAt", async () => {
  const s = await seed();
  await s.t.run(({ db }) =>
    db.patch(s.submission, { publicationMethod: "trusted_publisher" }),
  );
  assert.deepEqual(
    (await s.read())?.history.map((e) => e.kind),
    ["uploaded", "published"],
  );
  await s.t.run(({ db }) => db.delete(s.receipt));
  assert.equal((await s.read())?.history.at(-1)?.at, null);
});
it("owner media and invalid source linkage have upload only", async () => {
  const s = await seed();
  await s.t.run(({ db }) =>
    db.patch(s.asset, { sourceSubmissionId: undefined }),
  );
  assert.deepEqual(
    (await s.read())?.history.map((e) => e.kind),
    ["uploaded"],
  );
  await s.t.run(async ({ db }) => {
    await db.patch(s.asset, { sourceSubmissionId: s.submission });
    await db.patch(s.submission, { requestKind: "identity_placement" });
  });
  assert.deepEqual(
    (await s.read())?.history.map((e) => e.kind),
    ["uploaded"],
  );
  assert.equal((await s.read())?.uploadedBy, null);
});
it("ambiguous receipts and actor mismatch cannot provide a publication date", async () => {
  const s = await seed();
  await s.t.run(({ db }) => db.patch(s.receipt, { actorUserId: s.a }));
  assert.equal((await s.read())?.history.at(-1)?.at, null);
  await s.t.run(async ({ db }) => {
    await db.patch(s.receipt, { actorUserId: s.b });
    const r = await db.get(s.receipt);
    assert.ok(r);
    const { _id, _creationTime, ...data } = r;
    await db.insert("mediaReviewReceipts", {
      ...data,
      idempotencyKey: "duplicate",
    });
  });
  assert.equal((await s.read())?.history.at(-1)?.at, null);
});
it("hidden and transferred actors disclose no name or link", async () => {
  const s = await seed();
  await s.t.run(({ db }) =>
    db.patch(s.pa, { publicSurfacingState: "opted_out" }),
  );
  assert.equal((await s.read())?.uploadedBy, null);
  await s.t.run(async ({ db }) => {
    await db.patch(s.pa, { publicSurfacingState: "public" });
    await db.patch(s.owner, { state: "revoked" });
  });
  assert.equal((await s.read())?.uploadedBy, null);
});
it("zero, multiple and overflowing ownerships return no actor", async () => {
  const s = await seed();
  await s.t.run(async ({ db }) => {
    await db.patch(s.owner, { state: "revoked" });
    assert.equal(await resolvePublicMediaActor(db, s.a), null);
    await db.patch(s.owner, { state: "active" });
    await db.insert("profileOwners", {
      profileId: s.pb,
      userId: s.a,
      roleKey: "owner",
      state: "active",
      grantedAt: 1,
      updatedAt: 1,
    });
    assert.equal(await resolvePublicMediaActor(db, s.a), null);
    for (let i = 0; i < 10; i++)
      await db.insert("profileOwners", {
        profileId: s.target,
        userId: s.a,
        roleKey: "owner",
        state: "active",
        grantedAt: 1,
        updatedAt: 1,
      });
    assert.equal(await resolvePublicMediaActor(db, s.a), null);
  });
});
it("canonical visibility refuses hidden kit, suppressed, removed, foreign, draft and opted-out assets", async () => {
  const s = await seed();
  for (const patch of [
    { fieldVisibility: { mediaKit: "private" as const } },
    { publicationState: "draft_private" as const },
    { publicSurfacingState: "opted_out" as const },
  ]) {
    await s.t.run(({ db }) => db.patch(s.target, patch));
    assert.equal(await s.read(), null);
    await s.t.run(({ db }) =>
      db.patch(s.target, {
        fieldVisibility: undefined,
        publicationState: "published",
        publicSurfacingState: "public",
      }),
    );
  }
  for (const patch of [
    { moderatorSuppressedAt: 100 },
    { state: "deleted" as const },
    { profileId: s.pa },
    { visibility: "private" as const },
  ]) {
    await s.t.run(({ db }) => db.patch(s.asset, patch));
    assert.equal(await s.read(), null);
    await s.t.run(({ db }) =>
      db.patch(s.asset, {
        moderatorSuppressedAt: undefined,
        state: "active",
        profileId: s.target,
        visibility: "public",
      }),
    );
  }
  await s.t.run(async ({ db }) => {
    await db.insert("profileAssetPlacements", {
      profileId: s.target,
      assetId: s.asset,
      placement: "profile_image",
      position: 0,
      state: "active",
      updatedAt: 1,
    });
    await db.patch(s.target, {
      fieldVisibility: { mediaKit: "private", avatarImageUrl: "private" },
    });
  });
  assert.equal(await s.read(), null);
  process.env.VRDEX_PROFILE_MEDIA_KIT_ENABLED = "false";
  try {
    assert.equal(await s.read(), null);
  } finally {
    process.env.VRDEX_PROFILE_MEDIA_KIT_ENABLED = "true";
  }
});

it("resolves known Clerk subjects and rejects unknown issuer mappings", async () => {
  const s = await seed();
  process.env.CLERK_JWT_ISSUER_DOMAIN = "https://clerk.example.test";
  try {
    await s.t.run(({ db }) =>
      db.patch(s.asset, {
        sourceSubmissionId: undefined,
        uploadedBy: {
          issuer: "https://clerk.example.test",
          subject: "user_a",
          tokenIdentifier: "clerk|a",
        },
      }),
    );
    assert.equal((await s.read())?.uploadedBy?.profileSlug, "public-a");
    await s.t.run(({ db }) =>
      db.patch(s.asset, {
        uploadedBy: {
          issuer: "unknown",
          subject: "user_a",
          tokenIdentifier: "unknown|a",
          displayName: "PRIVATE",
        },
      }),
    );
    assert.equal((await s.read())?.uploadedBy, null);
  } finally {
    delete process.env.CLERK_JWT_ISSUER_DOMAIN;
  }
});
it("retains independent approval with unknown actor/date and ignores unrelated receipts", async () => {
  const s = await seed();
  await s.t.run(async ({ db }) => {
    await db.patch(s.submission, {
      reviewer: undefined,
      reviewedAt: undefined,
    });
    await db.patch(s.receipt, {
      receipt: { operationId: "unrelated", operationState: "committed" },
    });
  });
  const d = await s.read();
  assert.ok(d);
  assert.deepEqual(d.history[1], { kind: "approved", at: null, actor: null });
  assert.equal(d.history[2].at, null);
});
it("unsafe legacy credit links are omitted without consulting private sourceUrl", async () => {
  const s = await seed();
  await s.t.run(({ db }) =>
    db.patch(s.asset, { creditUrl: "javascript:alert(1)" }),
  );
  const d = await s.read();
  assert.ok(d);
  assert.equal(d.referenceUrl, null);
  assert.equal(d.asset.creditUrl, undefined);
});
