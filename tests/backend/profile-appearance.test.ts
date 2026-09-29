import assert from "node:assert/strict";
import { it } from "node:test";
import { convexTest } from "convex-test";

import { api } from "../../convex/_generated/api";
import schemaModule from "../../convex/schema";
import { newClerkUserId } from "./_clerkTestIdentity";

const modules = {
  "../../convex/_generated/api.ts": () => import("../../convex/_generated/api"),
  "../../convex/profileAssets.ts": () => import("../../convex/profileAssets"),
  "../../convex/profiles.ts": () => import("../../convex/profiles"),
};
const schema = (schemaModule as unknown as { default?: typeof schemaModule }).default ?? schemaModule;

it("saves independent community membership switches for owner and public views only", async () => {
  const t = convexTest({ schema, modules });
  const now = Date.now();
  const ownerClerkId = newClerkUserId();
  const otherClerkId = newClerkUserId();
  const profileId = await t.run(async (ctx) => {
    const ownerId = await ctx.db.insert("users", { clerkUserId: ownerClerkId, emailVerificationTime: now });
    await ctx.db.insert("users", { clerkUserId: otherClerkId, emailVerificationTime: now });
    const profileId = await ctx.db.insert("profiles", {
      slug: "appearance-community", displayName: "Appearance Community", sortName: "appearance community",
      aliases: [], tags: [], claimState: "claimed_verified", publicationState: "published",
      publicSurfacingState: "public", creationSource: "self", updatedAt: now,
      profileType: "community", community: { categoryTags: [] },
    });
    await ctx.db.insert("profileOwners", {
      profileId, userId: ownerId, roleKey: "owner", state: "active", grantedAt: now, updatedAt: now,
    });
    return profileId;
  });
  const owner = t.withIdentity({ subject: ownerClerkId, issuer: "test", emailVerified: true });
  const other = t.withIdentity({ subject: otherClerkId, issuer: "test", emailVerified: true });
  const appearanceArgs = {
    profileId, borderEnabled: false, borderColor: "#abcdef", borderWidthPx: 1,
    borderSoftnessPx: 0, radiusPercent: 0,
    sectionOrder: ["about", "links", "events", "media_kit", "worlds", "details"] as const,
  };

  const initial = await t.query(api.profiles.getPublicBySlug, { slug: "appearance-community" });
  assert.equal(initial?.appearance.showMemberCount, true);
  assert.equal(initial?.appearance.showMemberHistory, true);
  for (const showMemberCount of [false, true]) {
    for (const showMemberHistory of [false, true]) {
      await owner.mutation(api.profileAssets.updateAppearance, {
        ...appearanceArgs, sectionOrder: [...appearanceArgs.sectionOrder], showMemberCount, showMemberHistory,
      });
      const preference = await t.run((ctx) => ctx.db.query("profileAssetDisplayPreferences")
        .withIndex("by_profileId", (q) => q.eq("profileId", profileId)).unique());
      const owned = await owner.query(api.profileAssets.listOwnedAppearanceProfiles, {});
      const publicProfile = await t.query(api.profiles.getPublicBySlug, { slug: "appearance-community" });
      assert.equal(preference?.showMemberCount, showMemberCount);
      assert.equal(preference?.showMemberHistory, showMemberHistory);
      assert.equal(owned?.[0]?.showMemberCount, showMemberCount);
      assert.equal(owned?.[0]?.showMemberHistory, showMemberHistory);
      assert.equal(publicProfile?.appearance.showMemberCount, showMemberCount);
      assert.equal(publicProfile?.appearance.showMemberHistory, showMemberHistory);
    }
  }
  await assert.rejects(other.mutation(api.profileAssets.updateAppearance, {
    ...appearanceArgs, sectionOrder: [...appearanceArgs.sectionOrder],
    showMemberCount: false, showMemberHistory: false,
  }), /Only the profile owner can update profile appearance/);
});
