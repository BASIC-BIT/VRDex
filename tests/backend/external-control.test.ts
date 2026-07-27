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

const modules = {
  "../../convex/_generated/api.ts": () => import("../../convex/_generated/api"),
  "../../convex/profileConnections.ts": () => import("../../convex/profileConnections"),
  "../../convex/discordVerification.ts": () => import("../../convex/discordVerification"),
  "../../convex/vrclinkingCredentials.ts": () => import("../../convex/vrclinkingCredentials"),
};
const schema = (
  schemaModule as unknown as { default?: typeof schemaModule }
).default ?? schemaModule;

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

describe("Discord control level mapping", () => {
  it("ranks ownership above Administrator above Manage Server", () => {
    assert.equal(discordControlLevel({ id: "1", owner: true, permissions: "0" }), "owner");
    assert.equal(discordControlLevel({ id: "2", permissions: ADMINISTRATOR }), "administrator");
    assert.equal(discordControlLevel({ id: "3", permissions: MANAGE_GUILD }), "manager");
  });

  it("rejects members without a management permission", () => {
    assert.equal(discordControlLevel({ id: "4", permissions: SEND_MESSAGES }), null);
    assert.equal(discordControlLevel({ id: "5" }), null);
    assert.equal(discordControlLevel({ id: "6", permissions: "not-a-number" }), null);
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
      const userId = await ctx.db.insert("users", {
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
      const userId = await ctx.db.insert("users", {
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
      const userId = await ctx.db.insert("users", {
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

  it("promotes a remaining link when the primary is removed", async () => {
    const t = convexTest({ schema, modules });
    const now = Date.now();

    await t.run(async (ctx) => {
      const userId = await ctx.db.insert("users", {
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
      const userId = await ctx.db.insert("users", {
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
      const userId = await ctx.db.insert("users", {
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
      const userId = await ctx.db.insert("users", {
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
      const userId = await ctx.db.insert("users", {
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
      const id = await ctx.db.insert("users", {
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
      const userId = await ctx.db.insert("users", {
        email: "reconcile@example.test",
        emailVerificationTime: now,
      });

      return {
        userId,
        identity: {
          subject: `${userId}|web-session`,
          issuer: "test",
          tokenIdentifier: `test|${userId}`,
        },
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

    await t
      .withIdentity(seeded.identity)
      .mutation(internal.discordVerification.recordGuildControlProofs, {
        discordUserId: "discord-subject-a",
        guilds: [{ id: "111", name: "Still Managed", controlLevel: "owner" }],
      });

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
      const userId = await ctx.db.insert("users", {
        email: "shared-guild@example.test",
        emailVerificationTime: now,
      });

      return {
        userId,
        identity: {
          subject: `${userId}|web-session`,
          issuer: "test",
          tokenIdentifier: `test|${userId}`,
        },
      };
    });
    const asUser = t.withIdentity(seeded.identity);

    for (const discordUserId of ["discord-subject-a", "discord-subject-b"]) {
      await asUser.mutation(internal.discordVerification.recordGuildControlProofs, {
        discordUserId,
        guilds: [{ id: "999", name: "Shared Server", controlLevel: "administrator" }],
      });
    }

    // B loses access. A still runs the server, so the guild must stay proved.
    await asUser.mutation(internal.discordVerification.recordGuildControlProofs, {
      discordUserId: "discord-subject-b",
      guilds: [],
    });

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

  // One VRDex account may manage servers through more than one Discord login.
  // A result from the second login is only complete about the second login's
  // guilds, so it must not revoke what the first one proved.
  it("leaves proofs from a different Discord identity alone", async () => {
    const t = convexTest({ schema, modules });
    const now = Date.now();
    const seeded = await t.run(async (ctx) => {
      const userId = await ctx.db.insert("users", {
        email: "two-logins@example.test",
        emailVerificationTime: now,
      });

      return {
        userId,
        identity: {
          subject: `${userId}|web-session`,
          issuer: "test",
          tokenIdentifier: `test|${userId}`,
        },
      };
    });

    await t
      .withIdentity(seeded.identity)
      .mutation(internal.discordVerification.recordGuildControlProofs, {
        discordUserId: "discord-subject-a",
        guilds: [{ id: "111", name: "From Login A", controlLevel: "owner" }],
      });

    await t
      .withIdentity(seeded.identity)
      .mutation(internal.discordVerification.recordGuildControlProofs, {
        discordUserId: "discord-subject-b",
        guilds: [{ id: "222", name: "From Login B", controlLevel: "owner" }],
      });

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
    await t
      .withIdentity(seeded.identity)
      .mutation(internal.discordVerification.recordGuildControlProofs, {
        discordUserId: "discord-subject-a",
        guilds: [],
      });

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
  // Expiry sweeping alone bounds nothing: a caller who starts the flow and never
  // finishes it accumulates unexpired rows faster than the sweep reclaims them.
  it("keeps only the caller's most recent outstanding states", async () => {
    const t = convexTest({ schema, modules });
    const now = Date.now();
    const seeded = await t.run(async (ctx) => {
      const userId = await ctx.db.insert("users", {
        email: "state-spam@example.test",
        emailVerificationTime: now,
      });

      return {
        userId,
        identity: {
          subject: `${userId}|web-session`,
          issuer: "test",
          tokenIdentifier: `test|${userId}`,
        },
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
      const userId = await ctx.db.insert("users", {
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
        identity: {
          subject: `${userId}|web-session`,
          issuer: "test",
          tokenIdentifier: `test|${userId}`,
        },
      };
    });
  }

  it("refuses a delegation for a guild the owner has not proved they manage", async () => {
    const t = convexTest({ schema, modules });
    const now = Date.now();
    const seeded = await seedOwnedCommunity(t, "delegation-unproved", now);

    await assert.rejects(
      () =>
        t.withIdentity(seeded.identity).mutation(api.vrclinkingCredentials.registerCredential, {
          profileSlug: "delegation-unproved",
          guildId: "12345678901234567",
          secretRef: "secret://vrdex/vrclinking/12345678901234567",
        }),
      /CONTROL_NOT_VERIFIED/,
    );
  });

  // Every one of these would register cleanly and then fail resolution forever,
  // with no operator-visible signal beyond a permanently unavailable claim: the
  // adapter classifies references with case-sensitive startsWith, allows only
  // [A-Za-z0-9._/-] after `secret://`, and receives whatever is stored verbatim.
  it("refuses references the adapter could never resolve", async () => {
    const t = convexTest({ schema, modules });
    const now = Date.now();
    const seeded = await seedOwnedCommunity(t, "delegation-casing", now);
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

    for (const secretRef of [
      // Reference syntax is not authorization. The adapter resolves whatever it
      // is handed through its own IAM role, so a name that is well-formed but
      // belongs to another guild would have VRDex spend another tenant's key.
      "secret://vrdex/vrclinking/99999999999999999",
      "arn:aws:secretsmanager:us-east-1:123456789012:secret:vrdex/vrclinking/99999999999999999",
      "secret://vrdex/group-telemetry/oak",
      // An overlong ARN used to pass validation and then be truncated on write,
      // so the adapter resolved a different reference and every verification
      // through the delegation was permanently unavailable.
      `arn:aws:secretsmanager:us-east-1:123456789012:secret:vrdex/vrclinking/${guildId}${"o".repeat(600)}`,
      "SECRET://vrdex/group-telemetry/oak",
      "ARN:aws:secretsmanager:us-east-1:1234:secret:oak",
      // The adapter's local-name grammar allows only [A-Za-z0-9._/-] and
      // rejects traversal; anything looser registers then never resolves.
      "secret://team:key",
      "secret://../../etc/passwd",
      "secret://name with spaces",
    ]) {
      await assert.rejects(
        () =>
          t.withIdentity(seeded.identity).mutation(api.vrclinkingCredentials.registerCredential, {
            profileSlug: "delegation-casing",
            guildId,
            secretRef,
          }),
        /ADAPTER_NOT_CONFIGURED/,
        secretRef,
      );
    }
  });

  it("refuses a raw token and requires a secret store reference", async () => {
    const t = convexTest({ schema, modules });
    const now = Date.now();
    const seeded = await seedOwnedCommunity(t, "delegation-rawtoken", now);
    await t.run(async (ctx) => {
      await recordExternalControlProof(ctx.db, {
        userId: seeded.userId,
        assetType: "discord_guild",
        assetExternalId: "12345678901234567",
        controlLevel: "owner",
        evidenceSource: "discord_oauth",
        now,
      });
    });

    await assert.rejects(
      () =>
        t.withIdentity(seeded.identity).mutation(api.vrclinkingCredentials.registerCredential, {
          profileSlug: "delegation-rawtoken",
          guildId: "12345678901234567",
          // A pasted VRCLinking token must never be accepted into the database.
          secretRef: "eyJhbGciOiJIUzI1NiJ9.fake.token",
        }),
      /ADAPTER_NOT_CONFIGURED/,
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

    await asOwner.mutation(api.vrclinkingCredentials.registerCredential, {
      profileSlug: "delegation-ok",
      guildId,
      secretRef:
        "arn:aws:secretsmanager:us-east-1:123456789012:secret:vrdex/vrclinking/12345678901234567-AbC123",
    });

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

    await t.withIdentity(lapsed.identity).mutation(api.vrclinkingCredentials.registerCredential, {
      profileSlug: "delegation-lapsed",
      guildId: lapsedGuild,
      secretRef: "secret://vrdex/vrclinking/12345678901234567",
    });
    await t.withIdentity(live.identity).mutation(api.vrclinkingCredentials.registerCredential, {
      profileSlug: "delegation-live",
      guildId: liveGuild,
      secretRef: "secret://vrdex/vrclinking/22345678901234567",
    });

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

      const userId = await ctx.db.insert("users", {
        email: "rotation-claimant@example.test",
        emailVerificationTime: now,
      });
      await ctx.db.insert("authAccounts", {
        userId,
        provider: "discord",
        providerAccountId: "discord-claimant",
      });

      return userId;
    });

    const context = await t.query(internal.vrclinkingCredentials.getAdapterContext, {
      userId: claimantId,
    });

    assert.deepEqual(
      context?.delegations.map((delegation) => delegation.guildId),
      [liveGuild],
    );
    assert.equal(context?.skippedCredentialIds.length, 1);
  });
});

describe("claiming a community with a verified guild", () => {
  it("requires a proof, then grants verified ownership and records the link", async () => {
    const t = convexTest({ schema, modules });
    const now = Date.now();
    const seeded = await t.run(async (ctx) => {
      const userId = await ctx.db.insert("users", {
        email: "claimer@example.test",
        emailVerificationTime: now,
      });
      await seedCommunity(ctx as never, "guild-claim", now);

      return {
        userId,
        identity: {
          subject: `${userId}|web-session`,
          issuer: "test",
          tokenIdentifier: `test|${userId}`,
        },
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
    });
  });

  // The link deliberately outlives its proof, so losing control of a server does
  // not silently detach it. The "Verified" label must not outlive it too.
  it("stops reporting a connection as verified once its proof lapses", async () => {
    const t = convexTest({ schema, modules });
    const now = Date.now();
    const seeded = await t.run(async (ctx) => {
      const userId = await ctx.db.insert("users", {
        email: "lapsing@example.test",
        emailVerificationTime: now,
      });
      await seedCommunity(ctx as never, "lapsing-connection", now);

      return {
        userId,
        identity: {
          subject: `${userId}|web-session`,
          issuer: "test",
          tokenIdentifier: `test|${userId}`,
        },
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
    await t.withIdentity(seeded.identity).mutation(
      internal.discordVerification.recordGuildControlProofs,
      { discordUserId: "discord-subject-a", guilds: [{ id: "888", controlLevel: "administrator" }] },
    );

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
      const staffId = await ctx.db.insert("users", {
        email: "staff@example.test",
        emailVerificationTime: now,
      });
      const userId = await ctx.db.insert("users", {
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
        identity: {
          subject: `${userId}|web-session`,
          issuer: "test",
          tokenIdentifier: `test|${userId}`,
        },
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

  it("refuses a second claimant even with their own verified guild", async () => {
    const t = convexTest({ schema, modules });
    const now = Date.now();
    const seeded = await t.run(async (ctx) => {
      const ownerId = await ctx.db.insert("users", {
        email: "first@example.test",
        emailVerificationTime: now,
      });
      const intruderId = await ctx.db.insert("users", {
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
        identity: {
          subject: `${intruderId}|web-session`,
          issuer: "test",
          tokenIdentifier: `test|${intruderId}`,
        },
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
