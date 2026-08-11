import assert from "node:assert/strict";
import { describe, it } from "node:test";

import { convexTest } from "convex-test";

import { internal } from "../../convex/_generated/api";
import type { Id } from "../../convex/_generated/dataModel";
import schemaModule from "../../convex/schema";

import { newClerkUserId } from "./_clerkTestIdentity";

const modules = {
  "../../convex/_generated/api.ts": () => import("../../convex/_generated/api"),
  "../../convex/profiles.ts": () => import("../../convex/profiles"),
};
const schema = (schemaModule as unknown as { default?: typeof schemaModule }).default ?? schemaModule;
const NOW = Date.parse("2026-08-11T12:00:00.000Z");
const KEY_HASH = "c".repeat(64);
const FINGERPRINT = "d".repeat(64);

function errorCode(error: unknown) {
  return typeof error === "object"
    && error !== null
    && "data" in error
    && typeof error.data === "object"
    && error.data !== null
    && "code" in error.data
    ? error.data.code
    : null;
}

async function seedUser(t: ReturnType<typeof convexTest>, suffix: string) {
  return t.run(async (ctx) =>
    ctx.db.insert("users", {
      clerkUserId: newClerkUserId(),
      name: `Contributor ${suffix}`,
      email: `contributor-${suffix}@example.com`,
      emailVerificationTime: NOW,
    })
  );
}

async function seedProfile(
  t: ReturnType<typeof convexTest>,
  suffix: string,
  claimState: "unclaimed" | "claimed_verified",
) {
  return t.run(async (ctx) =>
    ctx.db.insert("profiles", {
      slug: `dj-${suffix}`,
      displayName: `DJ ${suffix}`,
      sortName: `dj ${suffix}`,
      aliases: [],
      tags: [],
      outboundLinks: [],
      claimState,
      publicationState: "published",
      publicSurfacingState: "public",
      publicSurfacingUpdatedAt: NOW,
      creationSource: "community",
      profileType: "person",
      person: { roleTags: ["DJ"] },
      publishedAt: NOW,
      updatedAt: NOW,
    })
  );
}

describe("profile write authority", () => {
  it("lets an API credential correct an unclaimed profile it does not own", async () => {
    const t = convexTest(schema, modules);
    const ownerUserId = await seedUser(t, "unclaimed");
    const profileId = await seedProfile(t, "unclaimed", "unclaimed");

    const result = await t.mutation(internal.profiles.updateProfileForApiOwner, {
      actorKind: "personal_api_token",
      ownerUserId,
      currentSlug: "dj-unclaimed",
      outboundLinks: [{ type: "soundcloud", url: "https://soundcloud.com/dj-unclaimed" }],
    });

    assert.equal(result.slug, "dj-unclaimed");

    const stored = await t.run(async (ctx) => ctx.db.get(profileId as Id<"profiles">));

    assert.equal(stored?.outboundLinks?.length, 1);
    // Not owner_authored: the writer does not own this profile, and the public
    // page renders that distinction as a trust signal.
    assert.equal(stored?.outboundLinks?.[0]?.source, "community_submitted");
  });

  it("refuses an API credential on a profile somebody else claimed", async () => {
    const t = convexTest(schema, modules);
    const ownerUserId = await seedUser(t, "claimed");
    await seedProfile(t, "claimed", "claimed_verified");

    await assert.rejects(
      () =>
        t.mutation(internal.profiles.updateProfileForApiOwner, {
          actorKind: "personal_api_token",
          ownerUserId,
          currentSlug: "dj-claimed",
          outboundLinks: [{ type: "soundcloud", url: "https://soundcloud.com/hijack" }],
        }),
      (error: unknown) => errorCode(error) === "PROFILE_CLAIMED",
    );
  });

  it("replays a hosted MCP profile update instead of applying it twice", async () => {
    const t = convexTest(schema, modules);
    const ownerUserId = await seedUser(t, "replay");
    const profileId = await seedProfile(t, "replay", "unclaimed");
    const args = {
      ownerUserId,
      oauthClientId: "vrdx_app_0123456789abcdef01234567",
      oauthTokenId: "token-1",
      requestId: "request-1",
      idempotencyKeyHash: KEY_HASH,
      requestFingerprint: FINGERPRINT,
      currentSlug: "dj-replay",
      outboundLinks: [{ type: "mixcloud" as const, url: "https://mixcloud.com/dj-replay" }],
    };

    const first = await t.mutation(internal.profiles.updateProfileForMcpActor, args);
    const second = await t.mutation(internal.profiles.updateProfileForMcpActor, args);

    assert.deepEqual(first, second);

    const stored = await t.run(async (ctx) => ctx.db.get(profileId as Id<"profiles">));

    // One link, not two: the replay returned the stored receipt rather than
    // appending the same link a second time.
    assert.equal(stored?.outboundLinks?.length, 1);

    const audits = await t.run(async (ctx) => ctx.db.query("apiWriteAuditEvents").collect());

    assert.equal(audits.length, 1);
  });

  it("reports a profile with no public surface as written but unviewable", async () => {
    const t = convexTest(schema, modules);
    const ownerUserId = await seedUser(t, "hidden");
    const profileId = await seedProfile(t, "hidden", "unclaimed");

    await t.run(async (ctx) => {
      await ctx.db.patch(profileId as Id<"profiles">, { publicSurfacingState: "opted_out" });
      await ctx.db.insert("profileOwners", {
        profileId: profileId as Id<"profiles">,
        userId: ownerUserId,
        roleKey: "owner",
        state: "active",
        grantedAt: NOW,
        updatedAt: NOW,
      });
      await ctx.db.patch(profileId as Id<"profiles">, { claimState: "claimed_verified" });
    });

    const result = await t.mutation(internal.profiles.updateProfileForMcpActor, {
      ownerUserId,
      oauthClientId: "vrdx_app_0123456789abcdef01234567",
      oauthTokenId: "token-4",
      requestId: "request-4",
      idempotencyKeyHash: KEY_HASH,
      requestFingerprint: FINGERPRINT,
      currentSlug: "dj-hidden",
      headline: "Back soon",
    });

    // The owner is entitled to edit a profile they have taken off public
    // surfaces, and the write landed. The tool reads this flag rather than
    // demanding a public readback that would answer a success with an error.
    assert.equal(result.publiclyViewable, false);
  });

  it("replays an API submission carrying the same idempotency key", async () => {
    const t = convexTest(schema, modules);
    const ownerUserId = await seedUser(t, "api-replay");
    const args = {
      actorKind: "personal_api_token" as const,
      ownerUserId,
      idempotencyKeyHash: KEY_HASH,
      requestFingerprint: FINGERPRINT,
      profileType: "person" as const,
      displayName: "DJ Api Replay",
    };

    const first = await t.mutation(internal.profiles.submitCommunityProfileForApiUser, args);
    const second = await t.mutation(internal.profiles.submitCommunityProfileForApiUser, args);

    assert.equal(first.profileId, second.profileId);

    const profiles = await t.run(async (ctx) =>
      ctx.db
        .query("profiles")
        .filter((query) => query.eq(query.field("displayName"), "DJ Api Replay"))
        .collect()
    );

    // One profile, not two under suffixed slugs. This is the whole point: a
    // create has no natural replay guard, so a retry after a lost response
    // would otherwise publish a second profile for the same person.
    assert.equal(profiles.length, 1);
  });

  it("refuses an idempotency key reused for a different submission", async () => {
    const t = convexTest(schema, modules);
    const ownerUserId = await seedUser(t, "api-reuse");
    const base = {
      actorKind: "personal_api_token" as const,
      ownerUserId,
      idempotencyKeyHash: KEY_HASH,
      profileType: "person" as const,
    };

    await t.mutation(internal.profiles.submitCommunityProfileForApiUser, {
      ...base,
      requestFingerprint: FINGERPRINT,
      displayName: "DJ First",
    });

    await assert.rejects(
      () =>
        t.mutation(internal.profiles.submitCommunityProfileForApiUser, {
          ...base,
          requestFingerprint: "e".repeat(64),
          displayName: "DJ Second",
        }),
      (error: unknown) => errorCode(error) === "IDEMPOTENCY_KEY_REUSED",
    );
  });

  it("relays a fixable refusal instead of flattening it into a denial", async () => {
    const t = convexTest(schema, modules);
    const ownerUserId = await seedUser(t, "fixable");
    await seedProfile(t, "fixable", "unclaimed");

    // A branded link pointing at the wrong host. The agent can correct this, so
    // the code has to survive the tool boundary -- a generic denial would read
    // as "you may not write here" and start a retry loop.
    await assert.rejects(
      () =>
        t.mutation(internal.profiles.updateProfileForMcpActor, {
          ownerUserId,
          oauthClientId: "vrdx_app_0123456789abcdef01234567",
          oauthTokenId: "token-3",
          requestId: "request-3",
          idempotencyKeyHash: KEY_HASH,
          requestFingerprint: FINGERPRINT,
          currentSlug: "dj-fixable",
          outboundLinks: [{ type: "discord", url: "https://not-discord.example/invite" }],
        }),
      (error: unknown) => errorCode(error) === "INVALID_PROFILE_LINK",
    );
  });

  it("replays a hosted MCP submission instead of creating a duplicate profile", async () => {
    const t = convexTest(schema, modules);
    const ownerUserId = await seedUser(t, "submit");
    const args = {
      ownerUserId,
      oauthClientId: "vrdx_app_0123456789abcdef01234567",
      oauthTokenId: "token-2",
      requestId: "request-2",
      idempotencyKeyHash: KEY_HASH,
      requestFingerprint: FINGERPRINT,
      profileType: "person" as const,
      displayName: "DJ Submitted",
      outboundLinks: [{ type: "soundcloud" as const, url: "https://soundcloud.com/dj-submitted" }],
    };

    const first = await t.mutation(internal.profiles.submitCommunityProfileForMcpActor, args);
    const second = await t.mutation(internal.profiles.submitCommunityProfileForMcpActor, args);

    assert.equal(first.profileId, second.profileId);

    const profiles = await t.run(async (ctx) =>
      ctx.db
        .query("profiles")
        .filter((query) => query.eq(query.field("displayName"), "DJ Submitted"))
        .collect()
    );

    assert.equal(profiles.length, 1);
    assert.equal(profiles[0]?.claimState, "unclaimed");
    assert.equal(profiles[0]?.outboundLinks?.[0]?.source, "community_submitted");
  });
});
