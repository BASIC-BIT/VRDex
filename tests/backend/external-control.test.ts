import assert from "node:assert/strict";
import { describe, it } from "node:test";

import { convexTest } from "convex-test";

import { api, internal } from "../../convex/_generated/api";
import schemaModule from "../../convex/schema";
import { discordControlLevel } from "../../convex/discordVerification";
import {
  getActiveControlProof,
  getActiveProfileLinks,
  getProfilesLinkedToAsset,
  linkProfileToAsset,
  meetsControlLevel,
  recordExternalControlProof,
  removeProfileLink,
  requireControlProof,
} from "../../convex/_externalControl";
import { vrclinkingSecretRef } from "../../convex/_vrclinkingSecretRef";

import { newClerkUserId } from "./_clerkTestIdentity";

const modules = {
  "../../convex/_generated/api.ts": () => import("../../convex/_generated/api"),
  "../../convex/profileConnections.ts": () => import("../../convex/profileConnections"),
  "../../convex/claimAnalytics.ts": () => import("../../convex/claimAnalytics"),
  "../../convex/claimAnalyticsDelivery.ts": () => import("../../convex/claimAnalyticsDelivery"),
  "../../convex/discordVerification.ts": () => import("../../convex/discordVerification"),
  "../../convex/vrclinkingCredentials.ts": () => import("../../convex/vrclinkingCredentials"),
};
const schema = (
  schemaModule as unknown as { default?: typeof schemaModule }
).default ?? schemaModule;

/**
 * Reserve a generation and apply a reconciliation with it, as the OAuth action
 * does. Ordering tests call the two mutations directly instead, so they can
 * choose which generation arrives when.
 */
async function recordGuilds(
  asUser: { mutation: (fn: never, args: never) => Promise<unknown> },
  discordUserId: string,
  guilds: { id: string; name?: string; controlLevel: "manager" | "administrator" | "owner" }[],
) {
  const { generation } = (await asUser.mutation(
    internal.discordVerification.reserveGuildVerificationGeneration as never,
    { discordUserId } as never,
  )) as { generation: number };

  return (await asUser.mutation(internal.discordVerification.recordGuildControlProofs as never, {
    discordUserId,
    generation,
    guilds,
  } as never)) as { recorded: number; revoked: number; superseded: boolean };
}

const ADMINISTRATOR = String(1 << 3);
const MANAGE_GUILD = String(1 << 5);
const SEND_MESSAGES = String(1 << 11);

async function seedCommunity(ctx: never, slug: string, now: number) {
  const db = (ctx as unknown as { db: { insert: (t: string, v: unknown) => Promise<string> } }).db;

  return await db.insert("profiles", {
    profileType: "community",
    slug,
    displayName: slug,
    sortName: slug,
    aliases: [],
    tags: [],
    claimState: "unclaimed",
    publicationState: "published",
    publicSurfacingState: "public",
    creationSource: "concierge",
    community: { categoryTags: [] },
    updatedAt: now,
  });
}

async function webSessionIdentity(ctx: never, userId: string) {
  const db = (ctx as unknown as {
    db: { get: (id: string) => Promise<{ clerkUserId: string } | null> };
  }).db;
  // Clerk owns sessions, so the subject is the user's Clerk id and there is no
  // session row to fabricate. Read it back rather than guessing, so the
  // identity always resolves to this exact `users` row.
  const user = await db.get(userId);

  if (user === null) {
    throw new Error("Seeded user was not found.");
  }

  return {
    subject: user.clerkUserId,
    emailVerified: true,
    issuer: "test",
    tokenIdentifier: `test|${user.clerkUserId}`,
  };
}

describe("Discord control level mapping", () => {
  it("ranks ownership above Administrator above Manage Server", () => {
    assert.equal(discordControlLevel({ id: "1", owner: true, permissions: "0" }), "owner");
    assert.equal(discordControlLevel({ id: "2", permissions: ADMINISTRATOR }), "administrator");
    assert.equal(discordControlLevel({ id: "3", permissions: MANAGE_GUILD }), "manager");
  });

  it("rejects members without a management permission", () => {
    assert.equal(discordControlLevel({ id: "4", permissions: SEND_MESSAGES }), null);
  });

  // "We could not read this" is not "you do not manage this". Reconciliation
  // reads absence from the manageable list as evidence that control was lost,
  // so a malformed entry would revoke a working proof.
  it("refuses to guess at a guild whose permissions are unreadable", () => {
    assert.throws(() => discordControlLevel({ id: "5" }), /ADAPTER_UNAVAILABLE|permissions/);
    assert.throws(
      () => discordControlLevel({ id: "6", permissions: "not-a-number" }),
      /ADAPTER_UNAVAILABLE|permissions/,
    );
  });

  it("treats all three Discord management tiers as clearing the community bar", () => {
    for (const level of ["owner", "administrator", "manager"] as const) {
      assert.equal(meetsControlLevel(level, "manager"), true);
    }
    assert.equal(meetsControlLevel("manager", "owner"), false);
  });
});

describe("profile external links", () => {
  it("makes the first link primary and demotes the incumbent on promotion", async () => {
    const t = convexTest({ schema, modules });
    const now = Date.now();

    await t.run(async (ctx) => {
      const clerkUserId = newClerkUserId();
      const userId = await ctx.db.insert("users", {
        clerkUserId: clerkUserId,
        email: "links@example.test",
        emailVerificationTime: now,
      });
      const profileId = await seedCommunity(ctx as never, "link-order", now);

      await linkProfileToAsset(ctx.db, {
        profileId,
        assetType: "discord_guild",
        assetExternalId: "111",
        linkedByUserId: userId,
        now,
      });
      await linkProfileToAsset(ctx.db, {
        profileId,
        assetType: "discord_guild",
        assetExternalId: "222",
        linkedByUserId: userId,
        now,
      });

      const afterAdd = await getActiveProfileLinks(ctx.db, profileId, "discord_guild");
      assert.equal(afterAdd.find((l) => l.assetExternalId === "111")?.linkRole, "primary");
      assert.equal(afterAdd.find((l) => l.assetExternalId === "222")?.linkRole, "secondary");

      await linkProfileToAsset(ctx.db, {
        profileId,
        assetType: "discord_guild",
        assetExternalId: "222",
        linkRole: "primary",
        linkedByUserId: userId,
        now: now + 1,
      });

      const afterPromote = await getActiveProfileLinks(ctx.db, profileId, "discord_guild");
      assert.equal(afterPromote.filter((l) => l.linkRole === "primary").length, 1);
      assert.equal(afterPromote.find((l) => l.assetExternalId === "222")?.linkRole, "primary");
    });
  });

  // Re-verifying or re-claiming calls linkProfileToAsset again without a
  // linkRole. Defaulting on sibling count alone demoted the incumbent primary
  // and left the profile with none, silently changing public ordering.
  it("keeps an incumbent primary primary when the same asset is re-linked", async () => {
    const t = convexTest({ schema, modules });
    const now = Date.now();

    await t.run(async (ctx) => {
      const clerkUserId2 = newClerkUserId();
      const userId = await ctx.db.insert("users", {
        clerkUserId: clerkUserId2,
        email: "relink@example.test",
        emailVerificationTime: now,
      });
      const profileId = await seedCommunity(ctx as never, "link-relink", now);

      for (const guildId of ["111", "222"]) {
        await linkProfileToAsset(ctx.db, {
          profileId,
          assetType: "discord_guild",
          assetExternalId: guildId,
          linkedByUserId: userId,
          now,
        });
      }

      // Same asset, no explicit role — as every claim and proof path calls it.
      await linkProfileToAsset(ctx.db, {
        profileId,
        assetType: "discord_guild",
        assetExternalId: "111",
        linkedByUserId: userId,
        now: now + 1,
      });

      const links = await getActiveProfileLinks(ctx.db, profileId, "discord_guild");
      assert.equal(links.find((l) => l.assetExternalId === "111")?.linkRole, "primary");
      assert.equal(links.find((l) => l.assetExternalId === "222")?.linkRole, "secondary");
      assert.equal(links.filter((l) => l.linkRole === "primary").length, 1);
    });
  });

  it("keeps a re-linked secondary secondary", async () => {
    const t = convexTest({ schema, modules });
    const now = Date.now();

    await t.run(async (ctx) => {
      const clerkUserId3 = newClerkUserId();
      const userId = await ctx.db.insert("users", {
        clerkUserId: clerkUserId3,
        email: "relink-secondary@example.test",
        emailVerificationTime: now,
      });
      const profileId = await seedCommunity(ctx as never, "link-relink-secondary", now);

      for (const guildId of ["111", "222"]) {
        await linkProfileToAsset(ctx.db, {
          profileId,
          assetType: "discord_guild",
          assetExternalId: guildId,
          linkedByUserId: userId,
          now,
        });
      }

      await linkProfileToAsset(ctx.db, {
        profileId,
        assetType: "discord_guild",
        assetExternalId: "222",
        linkedByUserId: userId,
        now: now + 1,
      });

      const links = await getActiveProfileLinks(ctx.db, profileId, "discord_guild");
      assert.equal(links.find((l) => l.assetExternalId === "111")?.linkRole, "primary");
      assert.equal(links.find((l) => l.assetExternalId === "222")?.linkRole, "secondary");
    });
  });

  // Re-attaching reuses the removed row so an operator-recorded association
  // survives a remove/re-add, but the row must not bring its stale role or its
  // stale attribution back with it.
  it("reuses a removed link without restoring its role or its linker", async () => {
    const t = convexTest({ schema, modules });
    const now = Date.now();

    await t.run(async (ctx) => {
      const clerkUserId4 = newClerkUserId();
      const owner = await ctx.db.insert("users", {
        clerkUserId: clerkUserId4,
        email: "resurrect-owner@example.test",
        emailVerificationTime: now,
      });
      const clerkUserId5 = newClerkUserId();
      const other = await ctx.db.insert("users", {
        clerkUserId: clerkUserId5,
        email: "resurrect-other@example.test",
        emailVerificationTime: now,
      });
      const profileId = await seedCommunity(ctx as never, "link-resurrect", now);

      await linkProfileToAsset(ctx.db, {
        profileId,
        assetType: "discord_guild",
        assetExternalId: "111",
        linkedByUserId: owner,
        now,
      });
      await removeProfileLink(ctx.db, profileId, "discord_guild", "111", now + 1);
      await linkProfileToAsset(ctx.db, {
        profileId,
        assetType: "discord_guild",
        assetExternalId: "222",
        linkedByUserId: owner,
        now: now + 2,
      });

      // 111 comes back. It was primary before removal, but 222 holds that now.
      await linkProfileToAsset(ctx.db, {
        profileId,
        assetType: "discord_guild",
        assetExternalId: "111",
        linkedByUserId: other,
        now: now + 3,
      });

      const links = await getActiveProfileLinks(ctx.db, profileId, "discord_guild");
      assert.equal(links.length, 2);
      assert.equal(links.find((l) => l.assetExternalId === "222")?.linkRole, "primary");
      assert.equal(links.find((l) => l.assetExternalId === "111")?.linkRole, "secondary");
      // Re-attributed to whoever attached it, so resurrecting a row cannot hand
      // the new linker corroboration they did not earn.
      assert.equal(links.find((l) => l.assetExternalId === "111")?.linkedByUserId, other);
    });
  });

  // An operator record has no linker, and must survive a remove/re-add — that
  // is the whole reason re-attaching reuses the row.
  it("keeps an operator-recorded association through a remove and re-add", async () => {
    const t = convexTest({ schema, modules });
    const now = Date.now();

    await t.run(async (ctx) => {
      const clerkUserId6 = newClerkUserId();
      const owner = await ctx.db.insert("users", {
        clerkUserId: clerkUserId6,
        email: "operator-survives@example.test",
        emailVerificationTime: now,
      });
      const profileId = await seedCommunity(ctx as never, "link-operator-survives", now);

      await linkProfileToAsset(ctx.db, {
        profileId,
        assetType: "discord_guild",
        assetExternalId: "333",
        now,
      });
      await removeProfileLink(ctx.db, profileId, "discord_guild", "333", now + 1);
      await linkProfileToAsset(ctx.db, {
        profileId,
        assetType: "discord_guild",
        assetExternalId: "333",
        linkedByUserId: owner,
        now: now + 2,
      });

      const links = await getActiveProfileLinks(ctx.db, profileId, "discord_guild");
      assert.equal(links.length, 1);
      assert.equal(links[0]?.linkedByUserId, undefined);
    });
  });

  it("promotes a remaining link when the primary is removed", async () => {
    const t = convexTest({ schema, modules });
    const now = Date.now();

    await t.run(async (ctx) => {
      const clerkUserId7 = newClerkUserId();
      const userId = await ctx.db.insert("users", {
        clerkUserId: clerkUserId7,
        email: "remove@example.test",
        emailVerificationTime: now,
      });
      const profileId = await seedCommunity(ctx as never, "link-removal", now);

      for (const guildId of ["111", "222"]) {
        await linkProfileToAsset(ctx.db, {
          profileId,
          assetType: "discord_guild",
          assetExternalId: guildId,
          linkedByUserId: userId,
          now,
        });
      }

      await removeProfileLink(ctx.db, profileId, "discord_guild", "111", now + 1);

      const remaining = await getActiveProfileLinks(ctx.db, profileId, "discord_guild");
      assert.equal(remaining.length, 1);
      assert.equal(remaining[0]?.assetExternalId, "222");
      assert.equal(remaining[0]?.linkRole, "primary");
    });
  });

  it("lets one Discord guild back several community profiles", async () => {
    const t = convexTest({ schema, modules });
    const now = Date.now();

    await t.run(async (ctx) => {
      const clerkUserId8 = newClerkUserId();
      const userId = await ctx.db.insert("users", {
        clerkUserId: clerkUserId8,
        email: "shared@example.test",
        emailVerificationTime: now,
      });
      const first = await seedCommunity(ctx as never, "shared-one", now);
      const second = await seedCommunity(ctx as never, "shared-two", now);

      for (const profileId of [first, second]) {
        await linkProfileToAsset(ctx.db, {
          profileId,
          assetType: "discord_guild",
          assetExternalId: "999",
          linkedByUserId: userId,
          now,
        });
      }

      const sharing = await getProfilesLinkedToAsset(ctx.db, "discord_guild", "999");
      assert.equal(sharing.length, 2);
      // Each profile keeps its own primary; sharing an asset is not a conflict.
      assert.deepEqual(
        sharing.map((link) => link.linkRole),
        ["primary", "primary"],
      );
    });
  });
});

describe("external control proofs", () => {
  it("refreshes an existing proof instead of accumulating duplicates", async () => {
    const t = convexTest({ schema, modules });
    const now = Date.now();

    await t.run(async (ctx) => {
      const clerkUserId9 = newClerkUserId();
      const userId = await ctx.db.insert("users", {
        clerkUserId: clerkUserId9,
        email: "proof@example.test",
        emailVerificationTime: now,
      });

      const first = await recordExternalControlProof(ctx.db, {
        userId,
        assetType: "discord_guild",
        assetExternalId: "555",
        controlLevel: "manager",
        evidenceSource: "discord_oauth",
        now,
      });
      const second = await recordExternalControlProof(ctx.db, {
        userId,
        assetType: "discord_guild",
        assetExternalId: "555",
        controlLevel: "owner",
        evidenceSource: "discord_oauth",
        now: now + 5,
      });

      assert.equal(first, second);

      const proofs = await ctx.db
        .query("externalControlProofs")
        .withIndex("by_userId_state", (q) => q.eq("userId", userId).eq("state", "active"))
        .collect();
      assert.equal(proofs.length, 1);
      assert.equal(proofs[0]?.controlLevel, "owner");
    });
  });

  // The sweeper marks overdue proofs stale in batches, so a proof can sit
  // `active` past its window until its batch runs. Consumption must not trust
  // the state field alone.
  it("refuses a proof whose revalidation window has passed even while active", async () => {
    const t = convexTest({ schema, modules });
    const now = Date.now();

    await t.run(async (ctx) => {
      const clerkUserId10 = newClerkUserId();
      const userId = await ctx.db.insert("users", {
        clerkUserId: clerkUserId10,
        email: "overdue@example.test",
        emailVerificationTime: now,
      });

      await recordExternalControlProof(ctx.db, {
        userId,
        assetType: "discord_guild",
        assetExternalId: "overdue-guild",
        controlLevel: "owner",
        evidenceSource: "discord_oauth",
        now,
        revalidateAfterMs: 1_000,
      });

      // Still active — the sweeper has not reached it yet.
      const proof = await getActiveControlProof(ctx.db, userId, "discord_guild", "overdue-guild");
      assert.equal(proof?.state, "active");

      await assert.rejects(
        () =>
          requireControlProof(
            ctx.db,
            userId,
            "discord_guild",
            "overdue-guild",
            "manager",
            now + 2_000,
          ),
        /CONTROL_NOT_VERIFIED/,
      );

      // Inside the window it still grants.
      const fresh = await requireControlProof(
        ctx.db,
        userId,
        "discord_guild",
        "overdue-guild",
        "manager",
        now + 500,
      );
      assert.equal(fresh.controlLevel, "owner");
    });
  });

  it("refuses to grant when control was never proved or is too weak", async () => {
    const t = convexTest({ schema, modules });
    const now = Date.now();

    await t.run(async (ctx) => {
      const clerkUserId11 = newClerkUserId();
      const userId = await ctx.db.insert("users", {
        clerkUserId: clerkUserId11,
        email: "weak@example.test",
        emailVerificationTime: now,
      });

      await assert.rejects(
        () => requireControlProof(ctx.db, userId, "discord_guild", "404", "manager"),
        /CONTROL_NOT_VERIFIED/,
      );

      await recordExternalControlProof(ctx.db, {
        userId,
        assetType: "vrchat_group",
        assetExternalId: "grp_weak",
        controlLevel: "manager",
        evidenceSource: "vrchat_api",
        now,
      });

      await assert.rejects(
        () => requireControlProof(ctx.db, userId, "vrchat_group", "grp_weak", "owner"),
        /CONTROL_LEVEL_TOO_LOW/,
      );
    });
  });
});

describe("control proof revalidation", () => {
  it("marks overdue proofs stale so they can no longer grant anything", async () => {
    const t = convexTest({ schema, modules });
    const now = Date.now();
    const userId = await t.run(async (ctx) => {
      const clerkUserId12 = newClerkUserId();
      const id = await ctx.db.insert("users", {
        clerkUserId: clerkUserId12,
        email: "overdue@example.test",
        emailVerificationTime: now,
      });
      await recordExternalControlProof(ctx.db, {
        userId: id,
        assetType: "discord_guild",
        assetExternalId: "expiring",
        controlLevel: "owner",
        evidenceSource: "discord_oauth",
        now,
        revalidateAfterMs: -1_000,
      });
      await recordExternalControlProof(ctx.db, {
        userId: id,
        assetType: "discord_guild",
        assetExternalId: "current",
        controlLevel: "owner",
        evidenceSource: "discord_oauth",
        now,
      });

      return id;
    });

    const result = await t.mutation(
      internal.profileConnections.markOverdueControlProofsStale,
      {},
    );
    assert.equal(result.stale, 1);

    await t.run(async (ctx) => {
      // The overdue proof no longer satisfies a control requirement...
      await assert.rejects(
        () => requireControlProof(ctx.db, userId, "discord_guild", "expiring", "manager"),
        /CONTROL_NOT_VERIFIED/,
      );
      // ...while one still inside its window is untouched.
      const live = await requireControlProof(
        ctx.db,
        userId,
        "discord_guild",
        "current",
        "manager",
      );
      assert.equal(live.state, "active");
    });
  });
});

describe("Discord guild proof reconciliation", () => {
  // A fresh OAuth result is the complete manageable list, so a guild missing
  // from it is evidence control was lost. Leaving the old proof active would
  // let someone claim with a server they just demonstrated they no longer run.
  it("revokes proofs for guilds absent from a later verification", async () => {
    const t = convexTest({ schema, modules });
    const now = Date.now();
    const seeded = await t.run(async (ctx) => {
      const clerkUserId13 = newClerkUserId();
      const userId = await ctx.db.insert("users", {
        clerkUserId: clerkUserId13,
        email: "reconcile@example.test",
        emailVerificationTime: now,
      });

      return {
        userId,
        identity: await webSessionIdentity(ctx as never, userId),
      };
    });

    await t.run(async (ctx) => {
      for (const guildId of ["111", "222"]) {
        await recordExternalControlProof(ctx.db, {
          userId: seeded.userId,
          assetType: "discord_guild",
          assetExternalId: guildId,
          controlLevel: "administrator",
          evidenceSource: "discord_oauth",
          now,
        });
      }
      // An unrelated asset type must survive reconciliation untouched.
      await recordExternalControlProof(ctx.db, {
        userId: seeded.userId,
        assetType: "vrchat_user",
        assetExternalId: "usr_keep",
        controlLevel: "self",
        evidenceSource: "vrclinking",
        now,
      });
    });

    await recordGuilds(t.withIdentity(seeded.identity), "discord-subject-a", [{ id: "111", name: "Still Managed", controlLevel: "owner" }]);

    await t.run(async (ctx) => {
      assert.notEqual(
        await getActiveControlProof(ctx.db, seeded.userId, "discord_guild", "111"),
        null,
      );
      assert.equal(
        await getActiveControlProof(ctx.db, seeded.userId, "discord_guild", "222"),
        null,
      );
      assert.notEqual(
        await getActiveControlProof(ctx.db, seeded.userId, "vrchat_user", "usr_keep"),
        null,
      );
    });
  });

  // Proofs are keyed by evidence subject, not just by user and asset. Sharing a
  // row across two Discord logins meant the second overwrote the first, and then
  // the second's reconciliation revoked the only row even though the first login
  // still controlled the guild.
  it("keeps a separate proof per Discord identity for the same guild", async () => {
    const t = convexTest({ schema, modules });
    const now = Date.now();
    const seeded = await t.run(async (ctx) => {
      const clerkUserId14 = newClerkUserId();
      const userId = await ctx.db.insert("users", {
        clerkUserId: clerkUserId14,
        email: "shared-guild@example.test",
        emailVerificationTime: now,
      });

      return {
        userId,
        identity: await webSessionIdentity(ctx as never, userId),
      };
    });
    const asUser = t.withIdentity(seeded.identity);

    for (const discordUserId of ["discord-subject-a", "discord-subject-b"]) {
      await recordGuilds(asUser, discordUserId, [
        { id: "999", name: "Shared Server", controlLevel: "administrator" },
      ]);
    }

    // B loses access. A still runs the server, so the guild must stay proved.
    await recordGuilds(asUser, "discord-subject-b", []);

    await t.run(async (ctx) => {
      const rows = await ctx.db
        .query("externalControlProofs")
        .withIndex("by_userId_assetType_assetExternalId", (q) =>
          q.eq("userId", seeded.userId).eq("assetType", "discord_guild").eq("assetExternalId", "999"),
        )
        .collect();
      assert.equal(rows.length, 2);
      assert.deepEqual(
        rows.filter((row) => row.state === "active").map((row) => row.evidenceSubjectId),
        ["discord-subject-a"],
      );
      assert.notEqual(
        await getActiveControlProof(ctx.db, seeded.userId, "discord_guild", "999"),
        null,
      );
    });

    // The picker shows servers, not evidence, so one guild is one entry.
    const guilds = await asUser.query(api.discordVerification.getManageableGuilds, {});
    assert.deepEqual(
      guilds.map((guild) => guild.guildId),
      ["999"],
    );
  });

  // Two callbacks for the same identity can overlap, and Discord's answer can
  // change between their reads. Without an ordering check the last one to
  // arrive wins, so an older response could reactivate a guild a newer one just
  // revoked — with a fresh 30-day window on access Discord no longer reports.
  it("ignores a verification result the newer one already superseded", async () => {
    const t = convexTest({ schema, modules });
    const now = Date.now();
    const seeded = await t.run(async (ctx) => {
      const clerkUserId15 = newClerkUserId();
      const userId = await ctx.db.insert("users", {
        clerkUserId: clerkUserId15,
        email: "overlapping-callbacks@example.test",
        emailVerificationTime: now,
      });

      return { userId, identity: await webSessionIdentity(ctx as never, userId) };
    });
    const asUser = t.withIdentity(seeded.identity);
    const guild = [
      { id: "555", name: "Losing Access", controlLevel: "administrator" as const },
    ];
    // Both callbacks reserve before reading, so the order they were issued in is
    // fixed here rather than by whichever finishes first. Driven directly
    // instead of through the helper so the older one can arrive last.
    const first = (await asUser.mutation(
      internal.discordVerification.reserveGuildVerificationGeneration,
      { discordUserId: "discord-subject-a" },
    )) as { generation: number };
    const second = (await asUser.mutation(
      internal.discordVerification.reserveGuildVerificationGeneration,
      { discordUserId: "discord-subject-a" },
    )) as { generation: number };

    // The newer read saw the access gone and lands first.
    await asUser.mutation(internal.discordVerification.recordGuildControlProofs, {
      discordUserId: "discord-subject-a",
      generation: second.generation,
      guilds: [],
    });

    // The slow callback finally arrives carrying the older read.
    const superseded = (await asUser.mutation(
      internal.discordVerification.recordGuildControlProofs,
      { discordUserId: "discord-subject-a", generation: first.generation, guilds: guild },
    )) as { superseded: boolean };

    assert.equal(superseded.superseded, true);
    await t.run(async (ctx) => {
      assert.equal(
        await getActiveControlProof(ctx.db, seeded.userId, "discord_guild", "555"),
        null,
      );
    });

    // Nothing to order against in the rows themselves: a first verification
    // finding no manageable guilds writes nothing and revokes nothing. The
    // older read arriving afterwards must still lose, or it creates the access
    // the newer one said was gone.
    const emptyFirst = (await asUser.mutation(
      internal.discordVerification.reserveGuildVerificationGeneration,
      { discordUserId: "discord-subject-empty" },
    )) as { generation: number };
    const emptySecond = (await asUser.mutation(
      internal.discordVerification.reserveGuildVerificationGeneration,
      { discordUserId: "discord-subject-empty" },
    )) as { generation: number };

    await asUser.mutation(internal.discordVerification.recordGuildControlProofs, {
      discordUserId: "discord-subject-empty",
      generation: emptySecond.generation,
      guilds: [],
    });

    const afterEmpty = (await asUser.mutation(
      internal.discordVerification.recordGuildControlProofs,
      {
        discordUserId: "discord-subject-empty",
        generation: emptyFirst.generation,
        guilds: [{ id: "777", name: "Already Gone", controlLevel: "owner" }],
      },
    )) as { superseded: boolean };

    assert.equal(afterEmpty.superseded, true);
    await t.run(async (ctx) => {
      assert.equal(
        await getActiveControlProof(ctx.db, seeded.userId, "discord_guild", "777"),
        null,
      );
    });

    // A superseded result still revokes. Dropping it whole lost the revocation
    // it had observed when the newer callback then died, leaving the proof
    // usable until its own revalidation deadline; revoking on an older read can
    // only take away access that read saw as gone, and a newer result restores
    // anything still held.
    const revokeSubject = "discord-subject-revoke";
    await recordGuilds(asUser, revokeSubject, [
      { id: "888", name: "Losing It", controlLevel: "owner" },
    ]);

    const stale = (await asUser.mutation(
      internal.discordVerification.reserveGuildVerificationGeneration,
      { discordUserId: revokeSubject },
    )) as { generation: number };
    await asUser.mutation(internal.discordVerification.reserveGuildVerificationGeneration, {
      discordUserId: revokeSubject,
    });

    // The older callback lands while the newer reservation is still
    // outstanding, carrying a read that no longer lists the guild.
    const suppressed = (await asUser.mutation(
      internal.discordVerification.recordGuildControlProofs,
      { discordUserId: revokeSubject, generation: stale.generation, guilds: [] },
    )) as { superseded: boolean; revoked: number };

    assert.equal(suppressed.superseded, true);
    assert.equal(suppressed.revoked, 1);
    await t.run(async (ctx) => {
      assert.equal(
        await getActiveControlProof(ctx.db, seeded.userId, "discord_guild", "888"),
        null,
      );
    });
  });

  // One VRDex account may manage servers through more than one Discord login.
  // A result from the second login is only complete about the second login's
  // guilds, so it must not revoke what the first one proved.
  it("leaves proofs from a different Discord identity alone", async () => {
    const t = convexTest({ schema, modules });
    const now = Date.now();
    const seeded = await t.run(async (ctx) => {
      const clerkUserId16 = newClerkUserId();
      const userId = await ctx.db.insert("users", {
        clerkUserId: clerkUserId16,
        email: "two-logins@example.test",
        emailVerificationTime: now,
      });

      return {
        userId,
        identity: await webSessionIdentity(ctx as never, userId),
      };
    });

    await recordGuilds(t.withIdentity(seeded.identity), "discord-subject-a", [{ id: "111", name: "From Login A", controlLevel: "owner" }]);

    await recordGuilds(t.withIdentity(seeded.identity), "discord-subject-b", [{ id: "222", name: "From Login B", controlLevel: "owner" }]);

    await t.run(async (ctx) => {
      assert.notEqual(
        await getActiveControlProof(ctx.db, seeded.userId, "discord_guild", "111"),
        null,
      );
      assert.notEqual(
        await getActiveControlProof(ctx.db, seeded.userId, "discord_guild", "222"),
        null,
      );
    });

    // The same identity re-verifying without guild 111 is still authoritative
    // about its own guilds, so that one does get revoked.
    await recordGuilds(t.withIdentity(seeded.identity), "discord-subject-a", []);

    await t.run(async (ctx) => {
      assert.equal(
        await getActiveControlProof(ctx.db, seeded.userId, "discord_guild", "111"),
        null,
      );
      assert.notEqual(
        await getActiveControlProof(ctx.db, seeded.userId, "discord_guild", "222"),
        null,
      );
    });
  });
});

describe("Discord verification state backlog", () => {
  it("does not record a verification start when OAuth configuration is invalid", async () => {
    const previousClientId = process.env.AUTH_DISCORD_ID;
    const previousSiteUrl = process.env.SITE_URL;
    const previousAuthorizeUrl = process.env.DISCORD_OAUTH_AUTHORIZE_URL;
    process.env.AUTH_DISCORD_ID = "discord-client-test";
    process.env.SITE_URL = "https://vrdex.example.test";
    process.env.DISCORD_OAUTH_AUTHORIZE_URL = "http://discord.invalid/authorize";

    try {
      const t = convexTest({ schema, modules });
      const now = Date.now();
      const identity = await t.run(async (ctx) => {
        const userId = await ctx.db.insert("users", {
          clerkUserId: newClerkUserId(),
          email: "invalid-oauth-config@example.test",
          emailVerificationTime: now,
        });
        return await webSessionIdentity(ctx as never, userId);
      });

      await assert.rejects(
        t.withIdentity(identity).action(api.discordVerification.startGuildVerification, {
          returnTo: "/claim/oauth-config",
          analyticsJourneyId: "4d36e96e-34d9-4f7e-9fe1-72a98aa13077",
          analyticsEntrySource: "profile",
          analyticsProfileType: "community",
        }),
      );

      await t.run(async (ctx) => {
        assert.equal((await ctx.db.query("discordVerificationStates").collect()).length, 0);
        assert.equal((await ctx.db.query("claimAnalyticsOutbox").collect()).length, 0);
      });
    } finally {
      if (previousClientId === undefined) delete process.env.AUTH_DISCORD_ID;
      else process.env.AUTH_DISCORD_ID = previousClientId;
      if (previousSiteUrl === undefined) delete process.env.SITE_URL;
      else process.env.SITE_URL = previousSiteUrl;
      if (previousAuthorizeUrl === undefined) delete process.env.DISCORD_OAUTH_AUTHORIZE_URL;
      else process.env.DISCORD_OAUTH_AUTHORIZE_URL = previousAuthorizeUrl;
    }
  });

  it("records the backend verification-started milestone when claim OAuth opens", async () => {
    const t = convexTest({ schema, modules });
    const now = Date.now();
    const identity = await t.run(async (ctx) => {
      const userId = await ctx.db.insert("users", {
        clerkUserId: newClerkUserId(),
        email: "oauth-claim-analytics@example.test",
        emailVerificationTime: now,
      });
      return await webSessionIdentity(ctx as never, userId);
    });

    await t.withIdentity(identity).mutation(
      internal.discordVerification.createVerificationState,
      {
        returnTo: "/claim/oauth-analytics",
        analyticsJourneyId: "4d36e96e-34d9-4f7e-9fe1-72a98aa13077",
        analyticsEntrySource: "search",
        analyticsProfileType: "community",
      },
    );

    await t.run(async (ctx) => {
      const event = await ctx.db
        .query("claimAnalyticsOutbox")
        .withIndex("by_eventKey", (q) =>
          q.eq(
            "eventKey",
            "4d36e96e-34d9-4f7e-9fe1-72a98aa13077:claim_verification_started",
          ),
        )
        .unique();
      assert.equal(event?.event, "claim_verification_started");
      assert.equal(event?.method, "discord");
      assert.equal(event?.profileType, "community");
      assert.equal(event?.entrySource, "search");
    });
  });

  // Expiry sweeping alone bounds nothing: a caller who starts the flow and never
  // finishes it accumulates unexpired rows faster than the sweep reclaims them.
  it("keeps only the caller's most recent outstanding states", async () => {
    const t = convexTest({ schema, modules });
    const now = Date.now();
    const seeded = await t.run(async (ctx) => {
      const clerkUserId17 = newClerkUserId();
      const userId = await ctx.db.insert("users", {
        clerkUserId: clerkUserId17,
        email: "state-spam@example.test",
        emailVerificationTime: now,
      });

      return {
        userId,
        identity: await webSessionIdentity(ctx as never, userId),
      };
    });
    const asCaller = t.withIdentity(seeded.identity);
    const states: string[] = [];

    for (let index = 0; index < 20; index += 1) {
      const { state } = await asCaller.mutation(
        internal.discordVerification.createVerificationState,
        { returnTo: `/claim/target-${index}` },
      );
      states.push(state);
    }

    const remaining = await t.run(async (ctx) =>
      await ctx.db
        .query("discordVerificationStates")
        .withIndex("by_userId_createdAt", (q) => q.eq("userId", seeded.userId))
        .collect(),
    );

    assert.equal(remaining.length, 5);
    // The newest survive, so the round-trip a caller is actually in the middle
    // of still completes.
    assert.deepEqual(
      remaining.map((row) => row.state).sort(),
      states.slice(-5).sort(),
    );
  });
});

describe("VRCLinking credential delegation", () => {
  async function seedOwnedCommunity(t: ReturnType<typeof convexTest>, slug: string, now: number) {
    return await t.run(async (ctx) => {
      const clerkUserId18 = newClerkUserId();
      const userId = await ctx.db.insert("users", {
        clerkUserId: clerkUserId18,
        email: `${slug}@example.test`,
        emailVerificationTime: now,
      });
      const profileId = await seedCommunity(ctx as never, slug, now);
      await ctx.db.insert("profileOwners", {
        profileId,
        userId,
        roleKey: "owner",
        state: "active",
        grantedAt: now,
        updatedAt: now,
      });

      return {
        userId,
        identity: await webSessionIdentity(ctx as never, userId),
      };
    });
  }


  /**
   * The route's sequence, as the backend sees it: reserve a row, then activate
   * it once the key is in the store. Tests that only need a live delegation use
   * this rather than repeating both calls.
   */
  async function delegateCredential(
    t: ReturnType<typeof convexTest>,
    identity: Parameters<ReturnType<typeof convexTest>["withIdentity"]>[0],
    profileSlug: string,
    guildId: string,
  ) {
    const reserved = await t
      .withIdentity(identity)
      .mutation(api.vrclinkingCredentials.reserveCredential, { profileSlug, guildId });

    await t
      .withIdentity(identity)
      .mutation(api.vrclinkingCredentials.activateCredential, {
        profileSlug,
        credentialId: reserved.credentialId,
      });

    return reserved;
  }

  // Every reservation creates a Secrets Manager object, so the bound has to hold
  // against a burst — and a burst is entirely `pending`, because no request in
  // it has reached activation. Counting only settled rows let every concurrent
  // reservation through, each creating its own secret.
  // A request still in flight past the TTL could otherwise activate the very row
  // a later request has just scheduled for deletion — and with the file backend
  // that deletion is immediate, so the winning activation would come up backed
  // by nothing. The sweep takes the row out of `pending` first, which is the
  // only state `activateCredential` accepts.
  // A replacement that has reserved a row and is still writing its key would
  // otherwise activate afterwards, find no active predecessor, and promote
  // itself — resurrecting the delegation the owner had just revoked from another
  // tab, another session, or a co-owner.
  // A guild-scoped name is shared by every pre-naming row for that guild, across
  // profiles — so retiring one profile's legacy delegation must not hand back a
  // name another profile is still resolving through. Three separate rounds each
  // retired that name from a different path, which is why the check now lives in
  // one helper every path goes through.
  it("withholds a legacy name another profile still resolves through", async () => {
    const t = convexTest({ schema, modules });
    const now = Date.now();
    const guildId = "92345678901234567";
    const first = await seedOwnedCommunity(t, "legacy-shared-a", now);
    const second = await seedOwnedCommunity(t, "legacy-shared-b", now);

    for (const seeded of [first, second]) {
      await t.run(async (ctx) => {
        await recordExternalControlProof(ctx.db, {
          userId: seeded.userId,
          assetType: "discord_guild",
          assetExternalId: guildId,
          controlLevel: "owner",
          evidenceSource: "discord_oauth",
          now,
        });
      });
    }

    await delegateCredential(t, first.identity, "legacy-shared-a", guildId);
    await delegateCredential(t, second.identity, "legacy-shared-b", guildId);

    // Both predate per-credential naming, so both resolve to the shared name.
    await t.run(async (ctx) => {
      const rows = await ctx.db.query("communityVrclinkingCredentials").collect();

      await Promise.all(
        rows.map((row) =>
          ctx.db.patch(row._id, { secretRef: `secret://vrdex/vrclinking/${guildId}` }),
        ),
      );
    });

    const revoked = await t
      .withIdentity(first.identity)
      .mutation(api.vrclinkingCredentials.revokeCredential, {
        profileSlug: "legacy-shared-a",
        guildId,
      });

    assert.equal(revoked.revoked, true);
    // Revoked, but nothing to retire: the key is not this profile's alone to
    // delete while the other profile still resolves through the same name.
    assert.deepEqual(revoked.retired, []);
  });

  // Deleting a key that does not exist yet succeeds, so a revoke racing a
  // reservation can retire a name moments before the POST creates it. Stamping
  // there would suppress the only durable handle to a key that then comes into
  // existence, so a cancelled reservation stays unretired until its writer is
  // presumed gone.
  it("holds retirement of a cancelled reservation while its writer may run", async () => {
    const t = convexTest({ schema, modules });
    const now = Date.now();
    const seeded = await seedOwnedCommunity(t, "delegation-late-write", now);
    const guildId = "13345678901234567";
    await t.run(async (ctx) => {
      await recordExternalControlProof(ctx.db, {
        userId: seeded.userId,
        assetType: "discord_guild",
        assetExternalId: guildId,
        controlLevel: "owner",
        evidenceSource: "discord_oauth",
        now,
      });
    });

    const asOwner = t.withIdentity(seeded.identity);
    const reserved = await asOwner.mutation(api.vrclinkingCredentials.reserveCredential, {
      profileSlug: "delegation-late-write",
      guildId,
    });

    // The revoke path cancels it, and the route confirms the deletion of a key
    // that has not been written yet.
    await asOwner.mutation(api.vrclinkingCredentials.abandonCredential, {
      profileSlug: "delegation-late-write",
      credentialId: reserved.credentialId,
    });
    await asOwner.mutation(api.vrclinkingCredentials.confirmSecretsRetired, {
      profileSlug: "delegation-late-write",
      credentialIds: [reserved.credentialId],
    });

    const fresh = await t.run(async (ctx) => ctx.db.get(reserved.credentialId));

    // Not retired: a late write would otherwise leave a live key with nothing
    // able to find it.
    assert.equal(fresh?.secretRetiredAt, undefined);

    // Once the writer is presumed gone, the same confirmation settles it.
    await t.run(async (ctx) => {
      await ctx.db.patch(reserved.credentialId, { createdAt: now - 60 * 60 * 1000 });
    });
    await asOwner.mutation(api.vrclinkingCredentials.confirmSecretsRetired, {
      profileSlug: "delegation-late-write",
      credentialIds: [reserved.credentialId],
    });

    // Gone, not stamped: an aborted write is not audit history — nobody
    // delegated anything — and keeping every one of them would eventually put
    // the profile's revoked-row query past Convex's read limits.
    const settled = await t.run(async (ctx) => ctx.db.get(reserved.credentialId));

    assert.equal(settled, null);
  });

  it("cancels reservations for a guild the owner revokes", async () => {
    const t = convexTest({ schema, modules });
    const now = Date.now();
    const seeded = await seedOwnedCommunity(t, "delegation-revoke-race", now);
    const guildId = "82345678901234567";
    await t.run(async (ctx) => {
      await recordExternalControlProof(ctx.db, {
        userId: seeded.userId,
        assetType: "discord_guild",
        assetExternalId: guildId,
        controlLevel: "owner",
        evidenceSource: "discord_oauth",
        now,
      });
    });

    const asOwner = t.withIdentity(seeded.identity);
    await delegateCredential(t, seeded.identity, "delegation-revoke-race", guildId);

    // A replacement in flight: reserved, key not yet written.
    const inFlight = await asOwner.mutation(api.vrclinkingCredentials.reserveCredential, {
      profileSlug: "delegation-revoke-race",
      guildId,
    });

    await asOwner.mutation(api.vrclinkingCredentials.revokeCredential, {
      profileSlug: "delegation-revoke-race",
      guildId,
    });

    await assert.rejects(
      () =>
        asOwner.mutation(api.vrclinkingCredentials.activateCredential, {
          profileSlug: "delegation-revoke-race",
          credentialId: inFlight.credentialId,
        }),
      /LINK_NOT_FOUND/,
    );

    const stillActive = await asOwner.query(api.vrclinkingCredentials.listCredentials, {
      profileSlug: "delegation-revoke-race",
    });

    assert.deepEqual(stillActive, []);
  });

  it("claims a stale reservation before its key can be deleted", async () => {
    const t = convexTest({ schema, modules });
    const now = Date.now();
    const seeded = await seedOwnedCommunity(t, "delegation-stale", now);
    const guildId = "72345678901234567";
    await t.run(async (ctx) => {
      await recordExternalControlProof(ctx.db, {
        userId: seeded.userId,
        assetType: "discord_guild",
        assetExternalId: guildId,
        controlLevel: "owner",
        evidenceSource: "discord_oauth",
        now,
      });
    });

    const asOwner = t.withIdentity(seeded.identity);
    const stranded = await asOwner.mutation(api.vrclinkingCredentials.reserveCredential, {
      profileSlug: "delegation-stale",
      guildId,
    });

    // Age it past the reservation TTL without activating.
    await t.run(async (ctx) => {
      await ctx.db.patch(stranded.credentialId, { createdAt: now - 60 * 60 * 1000 });
    });

    const next = await asOwner.mutation(api.vrclinkingCredentials.reserveCredential, {
      profileSlug: "delegation-stale",
      guildId,
    });

    assert.deepEqual(
      next.abandoned.map((row: { credentialId: string }) => row.credentialId),
      [stranded.credentialId],
    );

    // The original request losing the race must not be able to bring it back.
    await assert.rejects(
      () =>
        asOwner.mutation(api.vrclinkingCredentials.activateCredential, {
          profileSlug: "delegation-stale",
          credentialId: stranded.credentialId,
        }),
      /LINK_NOT_FOUND/,
    );
  });

  it("counts reservations still in flight toward the write bound", async () => {
    const t = convexTest({ schema, modules });
    const now = Date.now();
    const seeded = await seedOwnedCommunity(t, "delegation-burst", now);
    const guildId = "62345678901234567";
    await t.run(async (ctx) => {
      await recordExternalControlProof(ctx.db, {
        userId: seeded.userId,
        assetType: "discord_guild",
        assetExternalId: guildId,
        controlLevel: "owner",
        evidenceSource: "discord_oauth",
        now,
      });
    });

    const reserve = () =>
      t.withIdentity(seeded.identity).mutation(api.vrclinkingCredentials.reserveCredential, {
        profileSlug: "delegation-burst",
        guildId,
      });

    // None of these activate, so every row stays `pending`.
    for (let attempt = 0; attempt < 10; attempt += 1) {
      await reserve();
    }

    await assert.rejects(reserve, /TOO_MANY_OPEN_PROOFS/);
  });

  it("refuses a delegation for a guild the owner has not proved they manage", async () => {
    const t = convexTest({ schema, modules });
    const now = Date.now();
    const seeded = await seedOwnedCommunity(t, "delegation-unproved", now);

    await assert.rejects(
      () =>
        t.withIdentity(seeded.identity).mutation(api.vrclinkingCredentials.reserveCredential, {
          profileSlug: "delegation-unproved",
          guildId: "12345678901234567",
        }),
      /CONTROL_NOT_VERIFIED/,
    );
  });

  // The reference is derived from the guild now, so the whole class of
  // unresolvable references these used to enumerate is unreachable: there is no
  // argument to carry one. What is worth pinning is that the derived value is
  // the one the adapter resolves, and that a caller cannot smuggle its own.
  it("derives the guild-scoped reference and accepts no other", async () => {
    const t = convexTest({ schema, modules });
    const now = Date.now();
    const seeded = await seedOwnedCommunity(t, "delegation-derived", now);
    const guildId = "12345678901234567";
    await t.run(async (ctx) => {
      await recordExternalControlProof(ctx.db, {
        userId: seeded.userId,
        assetType: "discord_guild",
        assetExternalId: guildId,
        controlLevel: "owner",
        evidenceSource: "discord_oauth",
        now,
      });
    });

    const reserved = await t
      .withIdentity(seeded.identity)
      .mutation(api.vrclinkingCredentials.reserveCredential, {
        profileSlug: "delegation-derived",
        guildId,
      });

    // Reserved, not delegated: the name exists so the key has somewhere to go,
    // and nothing selects the row until the write has landed.
    const pending = await t.run(async (ctx) => ctx.db.get(reserved.credentialId));

    assert.equal(pending?.state, "pending");
    assert.equal(reserved.secretName, `vrdex/vrclinking/${guildId}/${reserved.credentialId}`);

    await t
      .withIdentity(seeded.identity)
      .mutation(api.vrclinkingCredentials.activateCredential, {
        profileSlug: "delegation-derived",
        credentialId: reserved.credentialId,
      });

    const stored = await t.run(async (ctx) => ctx.db.get(reserved.credentialId));

    assert.equal(stored?.state, "active");
    assert.equal(
      stored?.secretRef,
      `secret://vrdex/vrclinking/${guildId}/${reserved.credentialId}`,
    );

    // A pasted VRCLinking token must never reach the database, and now it
    // cannot: there is no argument that would carry one, so Convex's validator
    // refuses the call before the handler runs.
    await assert.rejects(
      () =>
        t.withIdentity(seeded.identity).mutation(
          api.vrclinkingCredentials.reserveCredential,
          {
            profileSlug: "delegation-derived",
            guildId,
            secretRef: "eyJhbGciOiJIUzI1NiJ9.fake.token",
          } as never,
        ),
      /secretRef/,
    );
  });

  it("stores a reference the owner can see without exposing it, and revokes", async () => {
    const t = convexTest({ schema, modules });
    const now = Date.now();
    const seeded = await seedOwnedCommunity(t, "delegation-ok", now);
    const guildId = "12345678901234567";
    await t.run(async (ctx) => {
      await recordExternalControlProof(ctx.db, {
        userId: seeded.userId,
        assetType: "discord_guild",
        assetExternalId: guildId,
        controlLevel: "administrator",
        evidenceSource: "discord_oauth",
        now,
      });
    });
    const asOwner = t.withIdentity(seeded.identity);

    await delegateCredential(t, seeded.identity, "delegation-ok", guildId);

    const listed = await asOwner.query(api.vrclinkingCredentials.listCredentials, {
      profileSlug: "delegation-ok",
    });
    assert.equal(listed.length, 1);
    assert.equal(listed[0]?.guildId, guildId);
    // The reference must not travel to a client-facing surface.
    assert.equal("secretRef" in (listed[0] ?? {}), false);

    const revoked = await asOwner.mutation(api.vrclinkingCredentials.revokeCredential, {
      profileSlug: "delegation-ok",
      guildId,
    });
    assert.equal(revoked.revoked, true);
    assert.deepEqual(
      await asOwner.query(api.vrclinkingCredentials.listCredentials, {
        profileSlug: "delegation-ok",
      }),
      [],
    );
  });

  // Every surface that compares a reference against a credential derives it
  // from the row rather than reading the stored string, so a row written before
  // the ARN form was retired still works end to end — now including the choice
  // between the per-credential name and the guild-only one an upgraded
  // installation's existing rows still use. Four sites had to
  // learn this one at a time; the audit path was the last and the quietest —
  // it reported "Not used yet" for a key being queried on every claim, which is
  // the opposite of what an operator needs to tell a dead delegation from a
  // live one.
  it("selects, stamps, and accepts a delegation stored in the retired ARN form", async () => {
    const t = convexTest({ schema, modules });
    const now = Date.now();
    const seeded = await seedOwnedCommunity(t, "delegation-legacy", now);
    const guildId = "32345678901234567";
    const legacyRef = `arn:aws:secretsmanager:us-east-1:123456789012:secret:vrdex/vrclinking/${guildId}-AbC123`;

    await t.run(async (ctx) => {
      await recordExternalControlProof(ctx.db, {
        userId: seeded.userId,
        assetType: "discord_guild",
        assetExternalId: guildId,
        controlLevel: "owner",
        evidenceSource: "discord_oauth",
        now,
      });
    });

    await delegateCredential(t, seeded.identity, "delegation-legacy", guildId);

    // Registered through the mutation, then rewritten to the retired form:
    // registration rejects that form now, and the row an upgraded deployment
    // already holds is exactly what this is about.
    const credentialId = await t.run(async (ctx) => {
      const row = await ctx.db
        .query("communityVrclinkingCredentials")
        .filter((q) => q.eq(q.field("guildId"), guildId))
        .first();

      await ctx.db.patch(row!._id, { secretRef: legacyRef });

      return row!._id;
    });

    // Selection resolves the claimant's Discord identity, so the reservation
    // needs a user with one — not the community owner who delegated the key.
    const claimantId = await t.run(async (ctx) => {
      const userId = await ctx.db.insert("users", {
        clerkUserId: `user_test_${globalThis.crypto.randomUUID()}`,
        email: "legacy-claimant@example.test",
        emailVerificationTime: now,
      });
      await ctx.db.insert("discordVerificationWatermarks", {
        userId,
        discordUserId: "discord-legacy-claimant",
        issuedGeneration: 1,
        appliedGeneration: 1,
        appliedAt: now,
        issuedAt: now,
        updatedAt: now,
      });

      return userId;
    });

    const reserved = await t.mutation(internal.vrclinkingCredentials.reserveAdapterDelegations, {
      userId: claimantId,
    });
    const delegation = reserved?.delegations.find(
      (row: { guildId: string }) => row.guildId === guildId,
    );

    assert.notEqual(delegation, undefined);
    // The guild-only name, because that is where this row's key actually is.
    // Its secret was written before per-credential naming and nothing copies it,
    // so emitting the per-credential reference would point every adapter at an
    // object that does not exist and take a working delegation offline.
    assert.equal(delegation?.secretRef, `secret://vrdex/vrclinking/${guildId}`);

    await t.run(async (ctx) =>
      ctx.runMutation(internal.vrclinkingCredentials.recordCredentialConsultations, {
        consulted: [{ credentialId, secretRef: delegation!.secretRef }],
      }),
    );
    assert.notEqual(
      (await t.run(async (ctx) => await ctx.db.get(credentialId)))?.lastConsultedAt,
      undefined,
    );

    const use = await t.run(async (ctx) =>
      ctx.runMutation(internal.vrclinkingCredentials.recordCredentialUse, {
        credentialId,
        secretRef: delegation!.secretRef,
        resultSummary: "Confirmed a VRC Linking identity attestation.",
      }),
    );
    assert.equal(use.accepted, true);
  });

  // Replacement takes a new row rather than patching in place. Every version of
  // a delegation derives the same guild-scoped reference, so with a stable id
  // the grant's recheck could not tell a response obtained with the superseded
  // key from one obtained with its replacement — and the resolver caches a
  // token for five minutes, which is long enough for a claim in flight across a
  // replacement to be granted on the old key and stamped against the new row.
  it("issues a new credential id when a community replaces its key", async () => {
    const t = convexTest({ schema, modules });
    const now = Date.now();
    const seeded = await seedOwnedCommunity(t, "delegation-replace", now);
    const guildId = "52345678901234567";

    await t.run(async (ctx) => {
      await recordExternalControlProof(ctx.db, {
        userId: seeded.userId,
        assetType: "discord_guild",
        assetExternalId: guildId,
        controlLevel: "owner",
        evidenceSource: "discord_oauth",
        now,
      });
    });

    const asOwner = t.withIdentity(seeded.identity);
    const register = async () => {
      const reserved = await asOwner.mutation(api.vrclinkingCredentials.reserveCredential, {
        profileSlug: "delegation-replace",
        guildId,
      });

      return await asOwner.mutation(api.vrclinkingCredentials.activateCredential, {
        profileSlug: "delegation-replace",
        credentialId: reserved.credentialId,
      });
    };

    const first = await register();
    const second = await register();

    assert.equal(second.replaced, true);

    // The replaced key is unreachable the moment its row is revoked — names are
    // per credential and never reused — so activation has to hand the caller
    // the names to retire, or a community's live provider credential stays in
    // the store forever.
    assert.deepEqual(second.supersededSecretNames, [
      `vrdex/vrclinking/${guildId}/${first.credentialId}`,
    ]);

    // Idempotent: a retry after a lost response must report success rather than
    // looking like a failure. The route decides whether to delete the stored key
    // from this answer, so an activation reported as failed after it committed
    // would destroy the key it had just installed.
    const replay = await asOwner.mutation(api.vrclinkingCredentials.activateCredential, {
      profileSlug: "delegation-replace",
      credentialId: second.credentialId,
    });

    assert.equal(replay.credentialId, second.credentialId);
    // The same cleanup obligation, not an empty one: a lost response must not
    // also lose the names of the keys the first call retired.
    assert.deepEqual(replay.supersededSecretNames, second.supersededSecretNames);
    assert.notEqual(second.credentialId, first.credentialId);

    // The superseded row is revoked rather than deleted, so a response carrying
    // its id fails the grant recheck instead of matching the live delegation.
    assert.equal(
      (await t.run(async (ctx) => await ctx.db.get(first.credentialId)))?.state,
      "revoked",
    );
    assert.deepEqual(
      (
        await asOwner.query(api.vrclinkingCredentials.listCredentials, {
          profileSlug: "delegation-replace",
        })
      ).length,
      1,
    );
  });

  // Every row for a guild derives the same guild-scoped reference, so sending
  // one per row made the adapter repeat an identical lookup — spending that
  // community's quota once per row and, at five rows, filling the entire
  // fan-out with a single server while a guild that could actually attest the
  // claimant waited for a cooldown-limited retry.
  it("tries a second distinct key for a guild several profiles delegate", async () => {
    const t = convexTest({ schema, modules });
    const now = Date.now();
    const guildId = "42345678901234567";
    const first = await seedOwnedCommunity(t, "delegation-dup-a", now);
    const second = await seedOwnedCommunity(t, "delegation-dup-b", now);

    for (const [seeded, slug] of [
      [first, "delegation-dup-a"],
      [second, "delegation-dup-b"],
    ] as const) {
      await t.run(async (ctx) => {
        await recordExternalControlProof(ctx.db, {
          userId: seeded.userId,
          assetType: "discord_guild",
          assetExternalId: guildId,
          controlLevel: "owner",
          evidenceSource: "discord_oauth",
          now,
        });
      });

      await delegateCredential(t, seeded.identity, slug, guildId);
    }

    const claimantId = await t.run(async (ctx) => {
      const userId = await ctx.db.insert("users", {
        clerkUserId: `user_test_${globalThis.crypto.randomUUID()}`,
        email: "dup-claimant@example.test",
        emailVerificationTime: now,
      });
      await ctx.db.insert("discordVerificationWatermarks", {
        userId,
        discordUserId: "discord-dup-claimant",
        issuedGeneration: 1,
        appliedGeneration: 1,
        appliedAt: now,
        issuedAt: now,
        updatedAt: now,
      });

      return userId;
    });

    const reserved = await t.mutation(internal.vrclinkingCredentials.reserveAdapterDelegations, {
      userId: claimantId,
    });

    // Two, not one. These rows used to derive a single shared reference, so
    // sending both was a duplicate lookup; per-credential names made them
    // different keys, and dropping all but the first let a stale key
    // deterministically suppress a working one. Capped so one guild still
    // cannot crowd out every other community in the fan-out.
    const delegations = reserved?.delegations ?? [];

    assert.deepEqual(
      delegations.map((delegation: { guildId: string }) => delegation.guildId),
      [guildId, guildId],
    );
    assert.equal(
      new Set(delegations.map((delegation: { secretRef: string }) => delegation.secretRef)).size,
      2,
    );
  });

  // Selection sorts by `lastConsultedAt`, so a delegation that is skipped but
  // never stamped stays at the head of the index forever. Once there are more
  // of those than the scan window, no usable delegation is reachable again.
  it("reports skipped delegations so their rotation position advances", async () => {
    const t = convexTest({ schema, modules });
    const now = Date.now();
    const lapsed = await seedOwnedCommunity(t, "delegation-lapsed", now);
    const live = await seedOwnedCommunity(t, "delegation-live", now);
    const lapsedGuild = "12345678901234567";
    const liveGuild = "22345678901234567";

    for (const [seeded, guildId] of [
      [lapsed, lapsedGuild],
      [live, liveGuild],
    ] as const) {
      await t.run(async (ctx) => {
        await recordExternalControlProof(ctx.db, {
          userId: seeded.userId,
          assetType: "discord_guild",
          assetExternalId: guildId,
          controlLevel: "owner",
          evidenceSource: "discord_oauth",
          now,
        });
      });
    }

    await delegateCredential(t, lapsed.identity, "delegation-lapsed", lapsedGuild);
    await delegateCredential(t, live.identity, "delegation-live", liveGuild);

    const claimantId = await t.run(async (ctx) => {
      // The lapsed delegator's proof is past its revalidation window, which is
      // what makes their still-active credential ineligible.
      const proof = await getActiveControlProof(
        ctx.db,
        lapsed.userId,
        "discord_guild",
        lapsedGuild,
      );
      await ctx.db.patch(proof!._id, { revalidateAfter: now - 1 });

      const clerkUserId19 = newClerkUserId();
      const userId = await ctx.db.insert("users", {
        clerkUserId: clerkUserId19,
        email: "rotation-claimant@example.test",
        emailVerificationTime: now,
      });
      // A linked Discord identity is now VRDex's own verification watermark
      // rather than a sign-in provider account.
      await ctx.db.insert("discordVerificationWatermarks", {
        userId,
        discordUserId: "discord-claimant",
        issuedGeneration: 1,
        appliedGeneration: 1,
        appliedAt: now,
        issuedAt: now,
        updatedAt: now,
      });

      return userId;
    });

    const context = await t.mutation(internal.vrclinkingCredentials.reserveAdapterDelegations, {
      userId: claimantId,
    });

    assert.deepEqual(
      context?.delegations.map((delegation) => delegation.guildId),
      [liveGuild],
    );

    // Selecting stamps the rotation cursor in the same transaction, for the
    // ineligible row too — left unstamped it pins the head of the index and no
    // usable delegation is ever reached again.
    const rotated = await t.run(async (ctx) =>
      (await ctx.db.query("communityVrclinkingCredentials").collect()).filter(
        (row) => row.lastRotatedAt !== undefined,
      ),
    );
    assert.equal(rotated.length, 2);
  });

  /**
   * A backlog whose rows all carry the same `createdAt` — a bulk import, or a
   * migration that stamped one timestamp across a batch — has to drain, not
   * stall.
   *
   * The sweep used to page with `.gt("createdAt", cursor)`, and that cursor is
   * not unique: advancing past the last row of a batch stepped over every row
   * sharing its millisecond. Nothing due was actually lost, because both filters
   * are functions of `createdAt` and so rows sharing one share their verdict —
   * but the safety of the skip rested on that coincidence rather than on
   * anything the loop said. This pins the outcome instead.
   */
  it("drains a backlog whose rows all share one timestamp", async () => {
    const t = convexTest({ schema, modules });
    const now = Date.now();
    const seeded = await seedOwnedCommunity(t, "delegation-backlog", now);
    const guildId = "82345678901234567";
    // One millisecond for all sixty, and old enough that every row is due.
    const createdAt = now - 60 * 60 * 1000;

    await t.run(async (ctx) => {
      const profile = await ctx.db
        .query("profiles")
        .withIndex("by_slug", (q) => q.eq("slug", "delegation-backlog"))
        .unique();

      for (let index = 0; index < 60; index += 1) {
        const credentialId = await ctx.db.insert("communityVrclinkingCredentials", {
          communityProfileId: profile!._id,
          guildId,
          secretRef: "",
          state: "revoked",
          delegatedByUserId: seeded.userId,
          revokedAt: createdAt,
          createdAt,
          updatedAt: createdAt,
        });

        // Per-credential, so the legacy-name liveness guard has no shared name
        // to withhold and every row is a genuine obligation.
        await ctx.db.patch(credentialId, {
          secretRef: vrclinkingSecretRef(guildId, credentialId),
        });
      }
    });

    const first = await t.mutation(internal.vrclinkingCredentials.claimOverdueSecretCleanups, {});

    assert.equal(first.length, 50);

    // Retired, as the sweep route confirms them, which is what takes them out of
    // the index and lets the next run reach what is behind them.
    await t.run(async (ctx) => {
      for (const obligation of first) {
        await ctx.db.patch(obligation.credentialId, { secretRetiredAt: Date.now() });
      }
    });

    const second = await t.mutation(internal.vrclinkingCredentials.claimOverdueSecretCleanups, {});

    // The remaining ten, not zero: sharing a timestamp with a full batch must not
    // put a row permanently out of the sweep's reach.
    assert.equal(second.length, 10);
    assert.equal(new Set(second.map((row) => row.credentialId)).size, 10);
  });

  /**
   * Withheld legacy rows must not pin the head of every sweep.
   *
   * A revoked row whose guild-scoped name another profile is still active on is
   * due forever: the liveness guard refuses to retire it, so nothing stamps it
   * and it leads the index again tomorrow. Counting those against the batch let
   * a batch's worth of them fill every sweep with rows that produce no work,
   * while a per-credential obligation behind them kept its key indefinitely.
   */
  it("reaches obligations behind a batch of permanently withheld rows", async () => {
    const t = convexTest({ schema, modules });
    const now = Date.now();
    const sharedGuild = "92345678901234500";
    const ownGuild = "92345678901234501";
    const seeded = await seedOwnedCommunity(t, "delegation-withheld", now);
    const createdAt = now - 60 * 60 * 1000;

    await t.run(async (ctx) => {
      const profile = await ctx.db
        .query("profiles")
        .withIndex("by_slug", (q) => q.eq("slug", "delegation-withheld"))
        .unique();

      // The live delegation whose shared name keeps every legacy row below
      // unretirable, for as long as it stays active.
      await ctx.db.insert("communityVrclinkingCredentials", {
        communityProfileId: profile!._id,
        guildId: sharedGuild,
        secretRef: `secret://vrdex/vrclinking/${sharedGuild}`,
        state: "active",
        delegatedByUserId: seeded.userId,
        createdAt,
        updatedAt: createdAt,
      });

      // A full batch of them, all older than the obligation behind them so they
      // lead the index.
      for (let index = 0; index < 50; index += 1) {
        await ctx.db.insert("communityVrclinkingCredentials", {
          communityProfileId: profile!._id,
          guildId: sharedGuild,
          secretRef: `secret://vrdex/vrclinking/${sharedGuild}`,
          state: "revoked",
          delegatedByUserId: seeded.userId,
          revokedAt: createdAt,
          createdAt,
          updatedAt: createdAt,
        });
      }

      // Behind them, and genuinely retirable: its own guild, its own name.
      const reachable = await ctx.db.insert("communityVrclinkingCredentials", {
        communityProfileId: profile!._id,
        guildId: ownGuild,
        secretRef: "",
        state: "revoked",
        delegatedByUserId: seeded.userId,
        revokedAt: createdAt + 1,
        createdAt: createdAt + 1,
        updatedAt: createdAt + 1,
      });

      await ctx.db.patch(reachable, {
        secretRef: vrclinkingSecretRef(ownGuild, reachable),
      });
    });

    const obligations = await t.mutation(
      internal.vrclinkingCredentials.claimOverdueSecretCleanups,
      {},
    );

    // Exactly the reachable one. The fifty ahead of it are due and selected, and
    // the guard drops all fifty — so they must cost the scan, not the batch.
    assert.equal(obligations.length, 1);
    assert.match(obligations[0]!.secretName, new RegExp(`^vrdex/vrclinking/${ownGuild}/`));

    // And they move. Withholding is permanent — no path stamps `secretRetiredAt`
    // on a name another profile still resolves through — so if the scan kept
    // returning to them by age, a wide enough head of them would outrun any read
    // cap and every later obligation would sit behind it forever. Stamped, they
    // sort behind everything the scan has not reached yet.
    const scanned = await t.run(async (ctx) =>
      (await ctx.db.query("communityVrclinkingCredentials").collect()).filter(
        (row) => row.state === "revoked" && row.guildId === sharedGuild,
      ),
    );

    assert.equal(scanned.length, 50);
    assert.ok(scanned.every((row) => row.lastCleanupScanAt !== undefined));

    // The one handed out is deliberately not stamped: it leaves the index when
    // its retirement is confirmed, and if that never lands it has to lead the
    // next scan, because that retry is the only one it gets.
    const handedOut = await t.run(async (ctx) => ctx.db.get(obligations[0]!.credentialId));

    assert.equal(handedOut?.lastCleanupScanAt, undefined);
  });
});

describe("claiming a community with a verified guild", () => {
  it("requires a proof, then grants verified ownership and records the link", async () => {
    const t = convexTest({ schema, modules });
    const now = Date.now();
    const seeded = await t.run(async (ctx) => {
      const clerkUserId20 = newClerkUserId();
      const userId = await ctx.db.insert("users", {
        clerkUserId: clerkUserId20,
        email: "claimer@example.test",
        emailVerificationTime: now,
      });
      await seedCommunity(ctx as never, "guild-claim", now);

      return {
        userId,
        identity: await webSessionIdentity(ctx as never, userId),
      };
    });
    const asUser = t.withIdentity(seeded.identity);

    // No proof yet: claiming must be refused rather than granting on assertion.
    await assert.rejects(
      () =>
        asUser.mutation(api.profileConnections.claimCommunityWithVerifiedGuild, {
          profileSlug: "guild-claim",
          guildId: "777",
        }),
      /CONTROL_NOT_VERIFIED/,
    );

    await t.run(async (ctx) => {
      await recordExternalControlProof(ctx.db, {
        userId: seeded.userId,
        assetType: "discord_guild",
        assetExternalId: "777",
        assetDisplayName: "Verified Server",
        controlLevel: "administrator",
        evidenceSource: "discord_oauth",
        now,
      });
    });

    const result = await asUser.mutation(api.profileConnections.claimCommunityWithVerifiedGuild, {
      profileSlug: "guild-claim",
      guildId: "777",
    });

    // Control of guild 777 is proved, but nothing says 777 is this listing's
    // server. Granting verified on the claimant's own choice of guild would let
    // a throwaway server take an unrelated community's listing and its badge.
    assert.equal(result.claimState, "claimed_unverified");

    await t.run(async (ctx) => {
      const links = await getActiveProfileLinks(ctx.db, result.profileId, "discord_guild");
      assert.equal(links.length, 1);
      assert.equal(links[0]?.assetExternalId, "777");
      assert.equal(links[0]?.linkRole, "primary");
      assert.notEqual(links[0]?.verifiedByProofId, undefined);
    });

    // A retry after a lost response, or a second call from the account UI, must
    // not pile up duplicate approved claim requests.
    const retry = await asUser.mutation(api.profileConnections.claimCommunityWithVerifiedGuild, {
      profileSlug: "guild-claim",
      guildId: "777",
      analyticsJourneyId: "1c64ccbd-6240-47ec-8a9a-e6d265f13736",
      analyticsEntrySource: "account",
    });

    // The link this claim wrote is the claimant's own assertion repeated back,
    // so it must not corroborate the retry into a verified state.
    assert.equal(retry.claimRequestId, null);
    assert.equal(retry.claimState, "claimed_unverified");

    await t.run(async (ctx) => {
      const requests = await ctx.db
        .query("profileClaimRequests")
        .withIndex("by_profileId_userId_state_updatedAt", (q) =>
          q.eq("profileId", result.profileId).eq("userId", seeded.userId).eq("state", "approved"),
        )
        .collect();
      assert.equal(requests.length, 1);
      assert.equal(
        (await getActiveProfileLinks(ctx.db, result.profileId, "discord_guild")).length,
        1,
      );
      const analytics = (await ctx.db.query("claimAnalyticsOutbox").collect()).filter(
        (row) => row.journeyId === "1c64ccbd-6240-47ec-8a9a-e6d265f13736",
      );
      assert.equal(analytics.length, 1);
      assert.equal(analytics[0]?.event, "claim_resolved");
      assert.equal(analytics[0]?.outcome, "claimed_unverified");
      assert.equal(analytics[0]?.connectionOnly, true);
      assert.equal(analytics[0]?.entrySource, "account");
    });
  });

  // Proofs are per verifying identity. A link references one row, and revoking
  // that row while the same user still holds a live proof for the same asset
  // through another Discord login must not report the connection as lost — the
  // asset is already attached, so there is no way to rebind it from the UI.
  it("stays verified while another live proof for the asset survives", async () => {
    const t = convexTest({ schema, modules });
    const now = Date.now();
    const seeded = await t.run(async (ctx) => {
      const clerkUserId21 = newClerkUserId();
      const userId = await ctx.db.insert("users", {
        clerkUserId: clerkUserId21,
        email: "two-proof-link@example.test",
        emailVerificationTime: now,
      });
      await seedCommunity(ctx as never, "two-proof-link", now);

      return { userId, identity: await webSessionIdentity(ctx as never, userId) };
    });
    const asUser = t.withIdentity(seeded.identity);

    for (const subject of ["discord-subject-a", "discord-subject-b"]) {
      await recordGuilds(asUser, subject, [{ id: "777", controlLevel: "administrator" }]);
    }
    await asUser.mutation(api.profileConnections.claimCommunityWithVerifiedGuild, {
      profileSlug: "two-proof-link",
      guildId: "777",
    });

    // Revoke whichever row the link happens to reference.
    await t.run(async (ctx) => {
      const links = await getActiveProfileLinks(ctx.db, (await ctx.db
        .query("profiles")
        .withIndex("by_slug", (q) => q.eq("slug", "two-proof-link"))
        .first())!._id, "discord_guild");
      await ctx.db.patch(links[0]!.verifiedByProofId!, { state: "revoked" });
    });

    const connections = await asUser.query(api.profileConnections.listProfileConnections, {
      profileSlug: "two-proof-link",
    });
    assert.equal(connections?.connections[0]?.verified, true);

    // With every proof for the asset gone, it does report unverified.
    await t.run(async (ctx) => {
      const proofs = await ctx.db
        .query("externalControlProofs")
        .withIndex("by_userId_state", (q) => q.eq("userId", seeded.userId).eq("state", "active"))
        .collect();
      await Promise.all(proofs.map((proof) => ctx.db.patch(proof._id, { state: "revoked" })));
    });

    const afterAll = await asUser.query(api.profileConnections.listProfileConnections, {
      profileSlug: "two-proof-link",
    });
    assert.equal(afterAll?.connections[0]?.verified, false);
  });

  // The link deliberately outlives its proof, so losing control of a server does
  // not silently detach it. The "Verified" label must not outlive it too.
  it("stops reporting a connection as verified once its proof lapses", async () => {
    const t = convexTest({ schema, modules });
    const now = Date.now();
    const seeded = await t.run(async (ctx) => {
      const clerkUserId22 = newClerkUserId();
      const userId = await ctx.db.insert("users", {
        clerkUserId: clerkUserId22,
        email: "lapsing@example.test",
        emailVerificationTime: now,
      });
      await seedCommunity(ctx as never, "lapsing-connection", now);

      return {
        userId,
        identity: await webSessionIdentity(ctx as never, userId),
      };
    });
    const asUser = t.withIdentity(seeded.identity);

    await t.run(async (ctx) => {
      await recordExternalControlProof(ctx.db, {
        userId: seeded.userId,
        assetType: "discord_guild",
        assetExternalId: "888",
        controlLevel: "administrator",
        evidenceSource: "discord_oauth",
        now,
      });
    });
    await asUser.mutation(api.profileConnections.claimCommunityWithVerifiedGuild, {
      profileSlug: "lapsing-connection",
      guildId: "888",
    });

    const verifiedBefore = await asUser.query(api.profileConnections.listProfileConnections, {
      profileSlug: "lapsing-connection",
    });
    assert.equal(verifiedBefore?.connections[0]?.verified, true);

    for (const lapse of [
      // Revoked by OAuth reconciliation...
      { state: "revoked" as const },
      // ...and overdue but not yet swept.
      { state: "active" as const, revalidateAfter: now - 1 },
    ]) {
      await t.run(async (ctx) => {
        const proofs = await ctx.db
          .query("externalControlProofs")
          .withIndex("by_userId_assetType_assetExternalId", (q) =>
            q
              .eq("userId", seeded.userId)
              .eq("assetType", "discord_guild")
              .eq("assetExternalId", "888"),
          )
          .collect();
        await ctx.db.patch(proofs[0]!._id, lapse);
      });

      const connections = await asUser.query(api.profileConnections.listProfileConnections, {
        profileSlug: "lapsing-connection",
      });
      // The link survives; only the label changes.
      assert.equal(connections?.connections.length, 1);
      assert.equal(connections?.connections[0]?.verified, false);
    }

    // Re-verifying must refresh the row the link already points at. Inserting a
    // replacement instead left every link referencing the dead row, so a
    // successfully re-verified connection read as unverified forever.
    await recordGuilds(t.withIdentity(seeded.identity), "discord-subject-a", [{ id: "888", controlLevel: "administrator" }]);

    const afterReverify = await asUser.query(api.profileConnections.listProfileConnections, {
      profileSlug: "lapsing-connection",
    });
    assert.equal(afterReverify?.connections.length, 1);
    assert.equal(afterReverify?.connections[0]?.verified, true);
  });

  // The no-match creation path grants ownership without verification. Proving
  // control of a server the listing already names is what upgrades that profile,
  // and an owner-present guard used to skip the upgrade entirely.
  it("upgrades an unverified owner when the listing already names their guild", async () => {
    const t = convexTest({ schema, modules });
    const now = Date.now();
    const seeded = await t.run(async (ctx) => {
      const clerkUserId23 = newClerkUserId();
      const staffId = await ctx.db.insert("users", {
        clerkUserId: clerkUserId23,
        email: "staff@example.test",
        emailVerificationTime: now,
      });
      const clerkUserId24 = newClerkUserId();
      const userId = await ctx.db.insert("users", {
        clerkUserId: clerkUserId24,
        email: "upgrade@example.test",
        emailVerificationTime: now,
      });
      const profileId = await seedCommunity(ctx as never, "upgrade-me", now);
      await ctx.db.patch(profileId, { claimState: "claimed_unverified", claimedAt: now });
      await ctx.db.insert("profileOwners", {
        profileId,
        userId,
        roleKey: "owner",
        state: "active",
        grantedAt: now,
        updatedAt: now,
      });
      await recordExternalControlProof(ctx.db, {
        userId,
        assetType: "discord_guild",
        assetExternalId: "999",
        controlLevel: "owner",
        evidenceSource: "discord_oauth",
        now,
      });
      // Somebody other than the claimant put guild 999 on record for this
      // listing. That is the association the claim is checked against.
      await linkProfileToAsset(ctx.db, {
        profileId,
        assetType: "discord_guild",
        assetExternalId: "999",
        linkedByUserId: staffId,
        now,
      });

      return {
        profileId,
        identity: await webSessionIdentity(ctx as never, userId),
      };
    });

    const result = await t
      .withIdentity(seeded.identity)
      .mutation(api.profileConnections.claimCommunityWithVerifiedGuild, {
        profileSlug: "upgrade-me",
        guildId: "999",
      });

    assert.equal(result.claimState, "claimed_verified");
  });

  // The verified branch is only reachable if some writer records an association
  // the claimant did not. `recordOperatorAssociation` is that writer; without it
  // `claimed_verified` would be dead code in production and only a test that
  // hand-inserts a link could reach it.
  it("reaches verified through an operator-recorded association", async () => {
    const t = convexTest({ schema, modules });
    const now = Date.now();
    const seeded = await t.run(async (ctx) => {
      const clerkUserId25 = newClerkUserId();
      const userId = await ctx.db.insert("users", {
        clerkUserId: clerkUserId25,
        email: "operator-seeded@example.test",
        emailVerificationTime: now,
      });
      await seedCommunity(ctx as never, "operator-seeded", now);
      await recordExternalControlProof(ctx.db, {
        userId,
        assetType: "discord_guild",
        assetExternalId: "424242424242424242",
        controlLevel: "owner",
        evidenceSource: "discord_oauth",
        now,
      });

      return {
        identity: await webSessionIdentity(ctx as never, userId),
      };
    });
    const asUser = t.withIdentity(seeded.identity);

    // Without the association, control of the guild is not evidence about this
    // listing, so ownership is granted unverified.
    assert.equal(
      (
        await asUser.mutation(api.profileConnections.claimCommunityWithVerifiedGuild, {
          profileSlug: "operator-seeded",
          guildId: "424242424242424242",
        })
      ).claimState,
      "claimed_unverified",
    );

    await t.mutation(internal.profileConnections.recordOperatorAssociation, {
      profileSlug: "operator-seeded",
      assetType: "discord_guild",
      assetExternalId: "424242424242424242",
      assetDisplayName: "Operator Seeded HQ",
    });

    assert.equal(
      (
        await asUser.mutation(api.profileConnections.claimCommunityWithVerifiedGuild, {
          profileSlug: "operator-seeded",
          guildId: "424242424242424242",
        })
      ).claimState,
      "claimed_verified",
    );
  });

  it("refuses a second claimant even with their own verified guild", async () => {
    const t = convexTest({ schema, modules });
    const now = Date.now();
    const seeded = await t.run(async (ctx) => {
      const clerkUserId26 = newClerkUserId();
      const ownerId = await ctx.db.insert("users", {
        clerkUserId: clerkUserId26,
        email: "first@example.test",
        emailVerificationTime: now,
      });
      const clerkUserId27 = newClerkUserId();
      const intruderId = await ctx.db.insert("users", {
        clerkUserId: clerkUserId27,
        email: "second@example.test",
        emailVerificationTime: now,
      });
      const profileId = await seedCommunity(ctx as never, "contested", now);
      await ctx.db.insert("profileOwners", {
        profileId,
        userId: ownerId,
        roleKey: "owner",
        state: "active",
        grantedAt: now,
        updatedAt: now,
      });
      await recordExternalControlProof(ctx.db, {
        userId: intruderId,
        assetType: "discord_guild",
        assetExternalId: "888",
        controlLevel: "owner",
        evidenceSource: "discord_oauth",
        now,
      });

      return {
        identity: await webSessionIdentity(ctx as never, intruderId, now),
      };
    });

    await assert.rejects(
      () =>
        t.withIdentity(seeded.identity).mutation(
          api.profileConnections.claimCommunityWithVerifiedGuild,
          { profileSlug: "contested", guildId: "888" },
        ),
      /PROFILE_ALREADY_OWNED/,
    );
  });
});
