import assert from "node:assert/strict";
import { it } from "node:test";
import { convexTest } from "convex-test";
import { api } from "../../convex/_generated/api";
import schemaModule from "../../convex/schema";
import { execFileSync } from "node:child_process";
import { getPublicProfileMediaKit, type ProfileAssetPlacement } from "../../convex/_profileAssets";
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
  assert.equal(d.asset.detailsUrl, undefined);
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

for (const mismatch of ["profile", "approved asset"] as const) {
  it(`rejects a source submission with a mismatched ${mismatch}`, async () => {
    const s = await seed();
    await s.t.run(async ({ db }) => {
      if (mismatch === "profile") await db.patch(s.submission, { profileId: s.pa });
      else {
        const original = await db.get(s.asset);
        assert.ok(original);
        const { _id, _creationTime, ...data } = original;
        const otherAsset = await db.insert("profileAssets", data);
        await db.patch(s.submission, { approvedAssetId: otherAsset });
      }
    });
    const details = await s.read();
    assert.ok(details);
    assert.equal(details.uploadedBy, null);
    assert.deepEqual(details.history, [{ kind: "uploaded", at: 10, actor: null }]);
  });
}

it("advertises only destinations rendered by the real public profile page", async () => {
  const cases: Array<{
    name: string; placements: ProfileAssetPlacement[]; link: boolean;
    suppressed?: boolean; card?: boolean; galleryEnabled?: boolean; hiddenKit?: boolean; untitled?: boolean; privateAsset?: boolean; unlistedKit?: boolean;
  }> = [
    { name: "avatar only", placements: ["profile_image"], link: false },
    { name: "banner only", placements: ["banner"], link: false },
    { name: "unplaced", placements: [], link: false },
    { name: "private gallery asset", placements: ["gallery"], privateAsset: true, link: false },
    { name: "unlisted kit with avatar", placements: ["profile_image", "gallery"], unlistedKit: true, link: true },
    { name: "suppressed gallery", placements: ["gallery"], suppressed: true, card: true, link: false },
    { name: "suppressed primary logo", placements: ["primary_logo"], suppressed: true, card: true, galleryEnabled: false, link: false },
    { name: "suppressed additional logo", placements: ["additional_logo"], suppressed: true, card: true, galleryEnabled: false, link: false },
    { name: "gallery", placements: ["gallery"], link: true },
    { name: "featured gallery", placements: ["gallery", "featured"], link: true },
    { name: "primary logo", placements: ["primary_logo"], link: true },
    { name: "additional logo", placements: ["additional_logo"], link: true },
    { name: "avatar and gallery", placements: ["profile_image", "gallery"], link: true },
    { name: "hidden kit with avatar", placements: ["profile_image", "gallery"], hiddenKit: true, link: false },
    { name: "untitled gallery with avatar", placements: ["profile_image", "gallery"], untitled: true, link: false },
    { name: "gallery disabled", placements: ["gallery"], galleryEnabled: false, link: false },
    { name: "primary logo with gallery disabled", placements: ["primary_logo"], galleryEnabled: false, link: true },
    { name: "additional logo with gallery disabled", placements: ["additional_logo"], galleryEnabled: false, link: true },
    { name: "logo and gallery with gallery disabled", placements: ["primary_logo", "gallery"], galleryEnabled: false, link: true },
    { name: "avatar with gallery disabled", placements: ["profile_image"], galleryEnabled: false, link: false },
    { name: "unplaced with gallery disabled", placements: [], galleryEnabled: false, link: false },
    { name: "hidden logo with gallery disabled", placements: ["primary_logo"], hiddenKit: true, galleryEnabled: false, link: false },
    { name: "private logo with gallery disabled", placements: ["additional_logo"], privateAsset: true, galleryEnabled: false, link: false },
  ];
  const renders = [];
  for (const scenario of cases) {
    const s = await seed();
    const galleryEnabled = scenario.galleryEnabled ?? true;
    process.env.VRDEX_PROFILE_MEDIA_KIT_ENABLED = String(galleryEnabled);
    try {
      const kit = await s.t.run(async ({ db }) => {
        for (const placement of scenario.placements) await db.insert("profileAssetPlacements", {
          profileId: s.target, assetId: s.asset, placement, position: 0, state: "active", updatedAt: 1,
        });
        if (scenario.suppressed) await db.patch(s.asset, { moderatorSuppressedAt: 100 });
        if (scenario.hiddenKit) await db.patch(s.target, { fieldVisibility: { mediaKit: "private" } });
        if (scenario.privateAsset) await db.patch(s.asset, { visibility: "private" });
        if (scenario.unlistedKit) await db.patch(s.target, { fieldVisibility: { mediaKit: "unlisted" } });
        if (scenario.untitled) await db.patch(s.asset, { label: undefined });
        const profile = await db.get(s.target);
        assert.ok(profile);
        if (scenario.unlistedKit) {
          const discovery = await getPublicProfileMediaKit(db, profile, { surface: "discovery" });
          assert.equal(discovery.galleryAssets.length, 0);
          assert.equal(discovery.profileImage?.detailsUrl, `/target#media-${s.asset}`);
        }
        return getPublicProfileMediaKit(db, profile);
      });
      const projected = [...kit.assets, ...kit.logos, ...kit.galleryAssets, kit.profileImage, kit.banner, kit.featuredAsset].filter(a => a?.assetId === s.asset);
      assert.equal(projected.length > 0, !scenario.privateAsset && !(scenario.hiddenKit && !scenario.placements.includes("profile_image")), scenario.name);
      for (const asset of projected) assert.equal(asset?.detailsUrl, scenario.link ? `/target#media-${s.asset}` : undefined, scenario.name);
      {
        const details = await s.read();
        if (scenario.suppressed || scenario.privateAsset || (!galleryEnabled && !scenario.link)) assert.equal(details, null, scenario.name);
        else {
          assert.ok(details, `${scenario.name} remains publicly readable`);
          assert.equal(details.asset.detailsUrl, scenario.link ? `/target#media-${s.asset}` : undefined, scenario.name);
        }
      }
      renders.push({ name: scenario.name, kit, galleryEnabled, assetId: s.asset, link: scenario.link, card: scenario.card ?? scenario.link });
    } finally {
      process.env.VRDEX_PROFILE_MEDIA_KIT_ENABLED = "true";
    }
  }
  execFileSync(process.execPath, ["--import", "tsx", "--input-type=module", "-e", `
    import assert from "node:assert/strict";
    import { readFileSync } from "node:fs";
    import React from "./apps/web/node_modules/react/index.js";
    import { renderToStaticMarkup } from "./apps/web/node_modules/react-dom/server.node.js";
    import { ProfilePublicPage } from "./apps/web/src/app/_components/profile-public-page.tsx";
    for (const scenario of JSON.parse(readFileSync(0, "utf8"))) {
      const profile = { profileType: "person", slug: "target", displayName: "Target", person: { roleTags: [] },
        aliases: [], tags: [], genres: [], outboundLinks: [], worldCredits: [], upcomingEvents: [], hostedEvents: [],
        trustLabel: "Unclaimed", mediaKit: scenario.kit };
      const html = renderToStaticMarkup(React.createElement(ProfilePublicPage, { profile, embedded: true, mediaKitGalleryEnabled: scenario.galleryEnabled }));
      assert.equal(html.includes('id="media-' + scenario.assetId + '"'), scenario.card, scenario.name);
      assert.equal(html.includes('Details &amp; history'), scenario.link, scenario.name);
    }
  `], { cwd: process.cwd(), input: JSON.stringify(renders), env: { ...process.env, TSX_TSCONFIG_PATH: "apps/web/tsconfig.json" }, stdio: ["pipe", "pipe", "pipe"] });
});

for (const patch of [
  { moderatorSuppressedAt: 100 },
  { state: "deleted" as const },
]) {
  it(`refuses unavailable selected logos with gallery disabled: ${JSON.stringify(patch)}`, async () => {
    const s = await seed();
    await s.t.run(async ({ db }) => {
      await db.insert("profileAssetPlacements", {
        profileId: s.target, assetId: s.asset, placement: "primary_logo", position: 0, state: "active", updatedAt: 1,
      });
      await db.patch(s.asset, patch);
    });
    process.env.VRDEX_PROFILE_MEDIA_KIT_ENABLED = "false";
    try { assert.equal(await s.read(), null); }
    finally { process.env.VRDEX_PROFILE_MEDIA_KIT_ENABLED = "true"; }
  });
}

it("refuses foreign and hidden-profile logo reads with gallery disabled", async () => {
  const s = await seed();
  await s.t.run(({ db }) => db.insert("profileAssetPlacements", {
    profileId: s.target, assetId: s.asset, placement: "additional_logo", position: 0, state: "active", updatedAt: 1,
  }));
  process.env.VRDEX_PROFILE_MEDIA_KIT_ENABLED = "false";
  try {
    await s.t.run(({ db }) => db.patch(s.asset, { profileId: s.pa }));
    assert.equal(await s.read(), null);
    await s.t.run(({ db }) => db.patch(s.asset, { profileId: s.target }));
    for (const patch of [
      { publicationState: "draft_private" as const },
      { publicSurfacingState: "opted_out" as const },
    ]) {
      await s.t.run(({ db }) => db.patch(s.target, patch));
      assert.equal(await s.read(), null);
      await s.t.run(({ db }) => db.patch(s.target, {
        publicationState: "published", publicSurfacingState: "public",
      }));
    }
  } finally { process.env.VRDEX_PROFILE_MEDIA_KIT_ENABLED = "true"; }
});
