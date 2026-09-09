import assert from "node:assert/strict";
import { it } from "node:test";
import { convexTest } from "convex-test";
import schemaModule from "../../convex/schema";
import { getPublicProfileMediaKit } from "../../convex/_profileAssets";
import { toPublicProfileShareCard } from "../../convex/_profileShareCard";
import { projectPublicSearchResult } from "../../convex/_publicSearch";
import { createProfileSearchDocument } from "../../convex/_searchDocuments";

const schema = (schemaModule as unknown as { default?: typeof schemaModule }).default ?? schemaModule;
const modules = { "../../convex/_generated/api.ts": () => import("../../convex/_generated/api") };

it("search and share cards use custom portraits before banners and drop stale indexed images", async () => {
  const t = convexTest({ schema, modules });
  await t.run(async ctx => {
    const userId = "usr_7023d326-083f-41fe-a3e9-27ea303b50c5";
    const id = await ctx.db.insert("profiles", {
      slug: "portrait-projection", displayName: "Portrait", sortName: "portrait",
      aliases: [], tags: [], profileType: "person", person: { roleTags: [] },
      claimState: "unclaimed", publicationState: "published", publicSurfacingState: "public",
      creationSource: "community", updatedAt: 1, bannerImageUrl: "https://example.com/banner.png",
      outboundLinks: [{ type: "vrchat_profile", label: "VRChat", url: `https://vrchat.com/home/user/${userId}`, source: "community_submitted" }],
    });
    await ctx.db.insert("profileLinkDestinations", {
      key: `vrchat_user:${userId}`, kind: "vrchat_user", locator: userId, provider: "vrchat",
      status: "resolved", artworkSourceUrl: "https://example.com/portrait.png",
      artworkType: "user_icon", observedAt: 1,
    });
    const profile = (await ctx.db.get(id))!;
    const documentId = await ctx.db.insert("searchDocuments", {
      ...createProfileSearchDocument(profile), imageUrl: "https://example.com/stale-private.png",
    });
    const document = (await ctx.db.get(documentId))!;
    const mediaKit = await getPublicProfileMediaKit(ctx.db, profile, { surface: "discovery" });
    assert.match(mediaKit.automaticAvatarImageUrl ?? "", /size=512/);
    assert.equal((await projectPublicSearchResult(ctx, document, "portrait"))?.imageUrl, mediaKit.automaticAvatarImageUrl);
    assert.equal(toPublicProfileShareCard(profile, mediaKit).avatarImageUrl, mediaKit.automaticAvatarImageUrl);
    await ctx.db.patch(id, { fieldVisibility: { avatarImageUrl: "private", bannerImageUrl: "private" } });
    const hiddenProfile = (await ctx.db.get(id))!;
    assert.equal((await projectPublicSearchResult(ctx, document, "portrait"))?.imageUrl, undefined);
    assert.equal(toPublicProfileShareCard(hiddenProfile,
      await getPublicProfileMediaKit(ctx.db, hiddenProfile, { surface: "discovery" })).avatarImageUrl, undefined);
  });
});

async function communityFixture() {
  const t = convexTest({ schema, modules });
  const profileId = await t.run(async ctx => {
    const id = await ctx.db.insert("profiles", {
      slug: "community-artwork", displayName: "Community", sortName: "community",
      aliases: [], tags: [], profileType: "community", community: { categoryTags: [] },
      claimState: "unclaimed", publicationState: "published", publicSurfacingState: "public",
      creationSource: "community", updatedAt: 1,
      outboundLinks: [
        { type: "discord", label: "Discord", url: "https://discord.gg/first-server", source: "reviewed" },
        { type: "website", label: "First group", url: "https://vrc.group/FIRST.0001", source: "reviewed" },
        { type: "website", label: "Second group", url: "https://vrc.group/SECOND.0002", source: "reviewed" },
        { type: "discord", label: "Other Discord", url: "https://discord.gg/second-server", source: "reviewed" },
      ],
    });
    for (const locator of ["FIRST.0001", "SECOND.0002"]) {
      await ctx.db.insert("profileLinkDestinations", {
        key: `vrchat_group:${locator}`, kind: "vrchat_group", locator, provider: "vrchat",
        status: "resolved", artworkSourceUrl: `https://example.com/${locator}.png`, artworkType: "group_icon", observedAt: 1,
      });
    }
    for (const locator of ["first-server", "second-server"]) {
      await ctx.db.insert("profileLinkDestinations", {
        key: `discord_guild:${locator}`, kind: "discord_guild", locator, provider: "discord",
        status: "resolved", artworkSourceUrl: `https://example.com/${locator}.png`, artworkType: "server_icon", observedAt: 1,
      });
    }
    return id;
  });
  const read = (surface: "discovery" | "profile_page" = "discovery") => t.run(async ctx => {
    const profile = (await ctx.db.get(profileId))!;
    return getPublicProfileMediaKit(ctx.db, profile, { surface });
  });
  return { t, profileId, read };
}

it("unclaimed communities prefer the first saved group over Discord, with owner source overrides", async () => {
  const { t, profileId, read } = await communityFixture();
  assert.match((await read()).automaticAvatarImageUrl ?? "", /vrchat_group%3AFIRST.0001/);
  await t.run(ctx => ctx.db.patch(profileId, {
    imageFallback: { disabled: false, vrchatGroupKey: "vrchat_group:SECOND.0002", discordGuildKey: "discord_guild:second-server" },
  }));
  assert.match((await read()).automaticAvatarImageUrl ?? "", /vrchat_group%3ASECOND.0002/);
  await t.run(async ctx => {
    const selected = await ctx.db.query("profileLinkDestinations").withIndex("by_key", q => q.eq("key", "vrchat_group:SECOND.0002")).unique();
    await ctx.db.patch(selected!._id, { artworkSourceUrl: undefined });
  });
  assert.match((await read()).automaticAvatarImageUrl ?? "", /discord_guild%3Asecond-server/);
  await t.run(ctx => ctx.db.patch(profileId, { imageFallback: { disabled: true } }));
  assert.equal((await read()).automaticAvatarImageUrl, undefined);
});

it("community artwork follows source visibility on direct profiles and discovery", async () => {
  const { t, profileId, read } = await communityFixture();
  await t.run(ctx => ctx.db.patch(profileId, { fieldVisibility: { outboundLinks: "unlisted" } }));
  assert.match((await read("profile_page")).automaticAvatarImageUrl ?? "", /vrchat_group%3AFIRST.0001/);
  assert.equal((await read("discovery")).automaticAvatarImageUrl, undefined);
  await t.run(ctx => ctx.db.patch(profileId, { fieldVisibility: { outboundLinks: "private" } }));
  assert.equal((await read("profile_page")).automaticAvatarImageUrl, undefined);
  assert.equal((await read("discovery")).automaticAvatarImageUrl, undefined);
});

it("a private authored community logo suppresses automatic artwork", async () => {
  const { t, profileId, read } = await communityFixture();
  assert.ok((await read()).automaticAvatarImageUrl);
  await t.run(async ctx => {
    const assetId = await ctx.db.insert("profileAssets", {
      profileId, storageKey: "profile-assets/test/private.png", mimeType: "image/png", byteSize: 128,
      contentSha256: "private-logo", visibility: "private", source: "owner_authored",
      uploadedBy: { tokenIdentifier: "test:owner", issuer: "test", subject: "owner" },
      uploadedAt: 1, state: "active", updatedAt: 1,
    });
    await ctx.db.insert("profileAssetPlacements", {
      profileId, assetId, placement: "primary_logo", position: 0, state: "active", updatedAt: 1,
    });
  });
  for (const surface of ["profile_page", "discovery"] as const) {
    const mediaKit = await read(surface);
    assert.equal(mediaKit.primaryLogo, undefined);
    assert.equal(mediaKit.automaticAvatarImageUrl, undefined);
  }
});
