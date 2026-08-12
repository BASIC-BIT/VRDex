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
      contributeGranted: true,
      currentSlug: "dj-unclaimed",
      expectedUpdatedAt: NOW,
      outboundLinks: [{ type: "soundcloud", url: "https://soundcloud.com/dj-unclaimed" }],
    });

    assert.equal(result.slug, "dj-unclaimed");

    const stored = await t.run(async (ctx) => ctx.db.get(profileId as Id<"profiles">));

    assert.equal(stored?.outboundLinks?.length, 1);
    // Not owner_authored: the writer does not own this profile, and the public
    // page renders that distinction as a trust signal.
    assert.equal(stored?.outboundLinks?.[0]?.source, "community_submitted");
  });

  it("refuses a community correction from a credential without profile:contribute", async () => {
    const t = convexTest(schema, modules);
    const ownerUserId = await seedUser(t, "no-contribute");
    await seedProfile(t, "no-contribute", "unclaimed");

    // The consent screen for `profile:write` reads "Edit your profiles". A token
    // issued against that promise must not reach somebody else's profile just
    // because this path learned how to.
    await assert.rejects(
      () =>
        t.mutation(internal.profiles.updateProfileForApiOwner, {
          actorKind: "personal_api_token",
          ownerUserId,
          currentSlug: "dj-no-contribute",
          expectedUpdatedAt: NOW,
          contributeGranted: false,
          outboundLinks: [{ type: "soundcloud", url: "https://soundcloud.com/nope" }],
        }),
      (error: unknown) => errorCode(error) === "PROFILE_CONTRIBUTE_SCOPE_REQUIRED",
    );
  });

  it("answers not-found before naming the missing scope on a hidden profile", async () => {
    const t = convexTest(schema, modules);
    const ownerUserId = await seedUser(t, "hidden-leak");
    const profileId = await seedProfile(t, "hidden-leak", "unclaimed");

    await t.run(async (ctx) => {
      await ctx.db.patch(profileId as Id<"profiles">, { publicSurfacingState: "opted_out" });
    });

    // A credential without the contribution grant that guesses a hidden slug
    // must not learn the profile exists from getting a scope error where an
    // unknown slug gets not-found.
    await assert.rejects(
      () =>
        t.mutation(internal.profiles.updateProfileForApiOwner, {
          actorKind: "personal_api_token",
          ownerUserId,
          currentSlug: "dj-hidden-leak",
          expectedUpdatedAt: NOW,
          contributeGranted: false,
          headline: "probe",
        }),
      (error: unknown) => errorCode(error) === "PROFILE_NOT_FOUND",
    );
  });

  it("answers a structured not-found the route can still read in production", async () => {
    const t = convexTest(schema, modules);
    const ownerUserId = await seedUser(t, "missing");

    // The code, not the sentence. Convex redacts plain error messages on a
    // production deployment, so the route's old `message.includes("not found")`
    // branch never fired there and a missing profile answered 500.
    await assert.rejects(
      () =>
        t.mutation(internal.profiles.updateProfileForApiOwner, {
          actorKind: "personal_api_token",
          ownerUserId,
          currentSlug: "dj-nobody-has-this",
          expectedUpdatedAt: NOW,
          contributeGranted: true,
          headline: "probe",
        }),
      (error: unknown) => errorCode(error) === "PROFILE_NOT_FOUND",
    );

    // A slug no profile could hold answers the same way, rather than complaining
    // about the slug and telling a caller which addresses are even well-formed.
    await assert.rejects(
      () =>
        t.mutation(internal.profiles.updateProfileForApiOwner, {
          actorKind: "personal_api_token",
          ownerUserId,
          currentSlug: "Not A Slug",
          expectedUpdatedAt: NOW,
          contributeGranted: true,
          headline: "probe",
        }),
      (error: unknown) => errorCode(error) === "PROFILE_NOT_FOUND",
    );
  });

  it("refuses a second contributor whose links were written against an older revision", async () => {
    const t = convexTest(schema, modules);
    const firstUserId = await seedUser(t, "race-first");
    const secondUserId = await seedUser(t, "race-second");
    const profileId = await seedProfile(t, "race", "unclaimed");

    // Both read the same revision. `outboundLinks` replaces the whole list, so
    // without the pin the second write silently drops the first one's link.
    const readAt = NOW;

    await t.mutation(internal.profiles.updateProfileForApiOwner, {
      actorKind: "personal_api_token",
      ownerUserId: firstUserId,
      currentSlug: "dj-race",
      contributeGranted: true,
      expectedUpdatedAt: readAt,
      outboundLinks: [{ type: "soundcloud", url: "https://soundcloud.com/first-set" }],
    });

    await assert.rejects(
      () =>
        t.mutation(internal.profiles.updateProfileForApiOwner, {
          actorKind: "personal_api_token",
          ownerUserId: secondUserId,
          currentSlug: "dj-race",
          contributeGranted: true,
          expectedUpdatedAt: readAt,
          outboundLinks: [{ type: "soundcloud", url: "https://soundcloud.com/second-set" }],
        }),
      (error: unknown) => errorCode(error) === "PROFILE_CHANGED",
    );

    const stored = await t.run(async (ctx) => ctx.db.get(profileId as Id<"profiles">));

    assert.equal(stored?.outboundLinks?.length, 1);
    assert.equal(stored?.outboundLinks?.[0]?.url, "https://soundcloud.com/first-set");

    // Re-reading and re-sending is the documented recovery, so it has to work.
    await t.mutation(internal.profiles.updateProfileForApiOwner, {
      actorKind: "personal_api_token",
      ownerUserId: secondUserId,
      currentSlug: "dj-race",
      contributeGranted: true,
      expectedUpdatedAt: stored?.updatedAt,
      outboundLinks: [
        { type: "soundcloud", url: "https://soundcloud.com/first-set" },
        { type: "soundcloud", url: "https://soundcloud.com/second-set" },
      ],
    });

    const merged = await t.run(async (ctx) => ctx.db.get(profileId as Id<"profiles">));

    assert.equal(merged?.outboundLinks?.length, 2);
  });

  it("refuses an owner's stale replacement, because owning is not writing alone", async () => {
    const t = convexTest(schema, modules);
    const ownerUserId = await seedUser(t, "self-race");
    const profileId = await seedProfile(t, "self-race", "claimed_verified");

    await t.run(async (ctx) => {
      await ctx.db.insert("profileOwners", {
        profileId: profileId as Id<"profiles">,
        userId: ownerUserId,
        roleKey: "owner",
        state: "active",
        grantedAt: NOW,
        updatedAt: NOW,
      });
    });

    // One person, two clients. Something else adds a link, then the agent posts
    // the list it read before that -- the owner deleting their own edit rather
    // than a stranger's, which the ownership exemption would have allowed.
    await t.mutation(internal.profiles.updateProfileForApiOwner, {
      actorKind: "personal_api_token",
      ownerUserId,
      currentSlug: "dj-self-race",
      contributeGranted: false,
      expectedUpdatedAt: NOW,
      outboundLinks: [{ type: "soundcloud", url: "https://soundcloud.com/added-elsewhere" }],
    });

    await assert.rejects(
      () =>
        t.mutation(internal.profiles.updateProfileForApiOwner, {
          actorKind: "personal_api_token",
          ownerUserId,
          currentSlug: "dj-self-race",
          contributeGranted: false,
          expectedUpdatedAt: NOW,
          outboundLinks: [],
        }),
      (error: unknown) => errorCode(error) === "PROFILE_CHANGED",
    );

    const stored = await t.run(async (ctx) => ctx.db.get(profileId as Id<"profiles">));

    assert.equal(stored?.outboundLinks?.length, 1);
  });

  it("refuses any update that pins no revision at all", async () => {
    const t = convexTest(schema, modules);
    const ownerUserId = await seedUser(t, "unpinned");
    const profileId = await seedProfile(t, "unpinned", "unclaimed");

    // The validators require the argument, so this is refused before any
    // permission or field check runs. A guard a caller can decline by leaving
    // the field out is not a guard, which is why it is not an optional one.
    await assert.rejects(() =>
      t.mutation(internal.profiles.updateProfileForApiOwner, {
        actorKind: "personal_api_token",
        ownerUserId,
        currentSlug: "dj-unpinned",
        contributeGranted: true,
        outboundLinks: [{ type: "soundcloud", url: "https://soundcloud.com/replacement" }],
      } as never)
    );

    const stored = await t.run(async (ctx) => ctx.db.get(profileId as Id<"profiles">));

    assert.equal(stored?.outboundLinks?.length, 0);
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
          contributeGranted: true,
          currentSlug: "dj-claimed",
          expectedUpdatedAt: NOW,
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
      contributeGranted: true,
      currentSlug: "dj-replay",
      expectedUpdatedAt: NOW,
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
      contributeGranted: true,
      currentSlug: "dj-hidden",
      expectedUpdatedAt: NOW,
      headline: "Back soon",
    });

    // The owner is entitled to edit a profile they have taken off public
    // surfaces, and the write landed. The tool reads this flag rather than
    // demanding a public readback that would answer a success with an error.
    assert.equal(result.publiclyViewable, false);
  });

  it("reports an ordinary update as publicly viewable, so a 404 stays a warning", async () => {
    const t = convexTest(schema, modules);
    const ownerUserId = await seedUser(t, "visible");
    await seedProfile(t, "visible", "unclaimed");

    const result = await t.mutation(internal.profiles.updateProfileForApiOwner, {
      actorKind: "personal_api_token",
      ownerUserId,
      contributeGranted: true,
      currentSlug: "dj-visible",
      expectedUpdatedAt: NOW,
      headline: "Playing Friday",
    });

    // The counterpart to the hidden-profile case. Exempting every update from
    // readback would hide a genuine anomaly: this profile does have a public
    // page, so a 404 reading it back means something went wrong.
    assert.equal(result.publiclyViewable, true);
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

  it("replays a receipt through the profile's current slug after a rename", async () => {
    const t = convexTest(schema, modules);
    const ownerUserId = await seedUser(t, "renamed");
    const profileId = await seedProfile(t, "renamed", "unclaimed");
    const args = {
      ownerUserId,
      oauthClientId: "vrdx_app_0123456789abcdef01234567",
      oauthTokenId: "token-5",
      requestId: "request-5",
      idempotencyKeyHash: KEY_HASH,
      requestFingerprint: FINGERPRINT,
      contributeGranted: true,
      currentSlug: "dj-renamed",
      expectedUpdatedAt: NOW,
      headline: "Touring",
    };

    const first = await t.mutation(internal.profiles.updateProfileForMcpActor, args);
    assert.equal(first.profilePath, "/dj-renamed");

    await t.run(async (ctx) => {
      await ctx.db.patch(profileId as Id<"profiles">, { slug: "dj-new-name" });
    });

    const replay = await t.mutation(internal.profiles.updateProfileForMcpActor, args);

    // The receipt still holds the old slug, and a link to it stops resolving
    // once the profile moves. The id is stable, so the replay reports where the
    // profile actually lives now.
    assert.equal(replay.slug, "dj-new-name");
    assert.equal(replay.profilePath, "/dj-new-name");
  });

  it("keeps a renamed but no-longer-public profile's new slug out of a replay", async () => {
    const t = convexTest(schema, modules);
    const ownerUserId = await seedUser(t, "gone-private");
    const profileId = await seedProfile(t, "gone-private", "unclaimed");
    const args = {
      ownerUserId,
      oauthClientId: "vrdx_app_0123456789abcdef01234567",
      oauthTokenId: "token-6",
      requestId: "request-6",
      idempotencyKeyHash: KEY_HASH,
      requestFingerprint: FINGERPRINT,
      contributeGranted: true,
      currentSlug: "dj-gone-private",
      expectedUpdatedAt: NOW,
      headline: "Quiet season",
    };

    await t.mutation(internal.profiles.updateProfileForMcpActor, args);

    await t.run(async (ctx) => {
      await ctx.db.patch(profileId as Id<"profiles">, {
        slug: "dj-moved-and-hidden",
        publicSurfacingState: "opted_out",
      });
    });

    const replay = await t.mutation(internal.profiles.updateProfileForMcpActor, args);

    // Resolving through the record would hand a prior submitter the profile's
    // new address, which renaming and opting out is precisely what takes away.
    assert.notEqual(replay.slug, "dj-moved-and-hidden");
    assert.equal(replay.profilePath, "/dj-gone-private");
    assert.equal(replay.publiclyViewable, false);
  });

  it("keeps one user's two OAuth apps in separate receipt namespaces", async () => {
    const t = convexTest(schema, modules);
    const ownerUserId = await seedUser(t, "two-apps");
    const base = {
      actorKind: "user_delegated_oauth" as const,
      ownerUserId,
      idempotencyKeyHash: KEY_HASH,
      requestFingerprint: FINGERPRINT,
      profileType: "person" as const,
      displayName: "DJ Shared Key",
    };

    const first = await t.mutation(internal.profiles.submitCommunityProfileForApiUser, {
      ...base,
      oauthClientId: "vrdx_app_1111111111111111aaaaaaaa",
    });
    const second = await t.mutation(internal.profiles.submitCommunityProfileForApiUser, {
      ...base,
      oauthClientId: "vrdx_app_2222222222222222bbbbbbbb",
    });

    // Two applications one user authorized are two callers. Sharing a namespace
    // handed the second app the first app's profile.
    assert.notEqual(first.profileId, second.profileId);
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
          contributeGranted: true,
          currentSlug: "dj-fixable",
          expectedUpdatedAt: NOW,
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
