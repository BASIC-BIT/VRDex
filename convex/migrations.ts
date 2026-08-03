import { Migrations } from "@convex-dev/migrations";
import { v } from "convex/values";

import { components, internal } from "./_generated/api";
import type { DataModel, Doc, Id } from "./_generated/dataModel";
import { internalMutation } from "./_generated/server";
import {
  createProfileSearchDocument,
  upsertSearchDocument,
  vocabularyForProfile,
} from "./_searchDocuments";
import { isLiveHandoffInvitation } from "./_seedHandoffs";
import { hasAcceptedSuppression, surfacedProfileNames } from "./_suppressions";
import { recordVocabularyTerms } from "./_vocabulary";

type LegacyProfile = Doc<"profiles"> & {
  publicSurfacingState?: Doc<"profiles">["publicSurfacingState"];
  publicSurfacingUpdatedAt?: number;
};

export const migrations = new Migrations<DataModel>(components.migrations, {
  internalMutation,
  defaultBatchSize: 50,
  migrationsLocationPrefix: "migrations:",
});

export const backfillProfilePublicSurfacingState = migrations.define({
  table: "profiles",
  migrateOne: async (_ctx, profile) => {
    const legacyProfile = profile as LegacyProfile;

    if (
      legacyProfile.publicSurfacingState !== undefined &&
      legacyProfile.publicSurfacingUpdatedAt !== undefined
    ) {
      return;
    }

    return {
      publicSurfacingState: legacyProfile.publicSurfacingState ?? "public",
      publicSurfacingUpdatedAt: legacyProfile.publicSurfacingUpdatedAt ?? Date.now(),
    };
  },
});

/**
 * Give every active handoff invitation a `profileId`.
 *
 * An invitation created before its candidate was matched carries none, which makes
 * every profile-indexed liveness check blind to it. Backfilling from the
 * candidate's `matchedProfileId` lets all publication paths use one cheap
 * `by_profileId_state` lookup instead of walking sibling candidates.
 */
export const backfillHandoffInvitationProfileIds = migrations.define({
  table: "seedHandoffInvitations",
  migrateOne: async (ctx, invitation) => {
    if (invitation.profileId !== undefined || invitation.state !== "active") {
      return;
    }

    const candidate = await ctx.db.get(invitation.candidateId);

    if (candidate?.matchedProfileId === undefined) {
      return;
    }

    return { profileId: candidate.matchedProfileId };
  },
});

export const runBackfillHandoffInvitationProfileIds = migrations.runner(
  internal.migrations.backfillHandoffInvitationProfileIds,
);

export const runBackfillProfilePublicSurfacingState = migrations.runner(
  internal.migrations.backfillProfilePublicSurfacingState,
);

/**
 * Take previously gated profiles live.
 *
 * Flips default-private profiles to published and reindexes them for search and
 * vocabulary (a flipped profile that is not reindexed stays invisible to
 * discovery).
 *
 * Only `draft_private` + `public` profiles are touched: that combination is the
 * default-private state with no explicit surfacing decision attached.
 *
 * Deliberately preserved:
 * - `opted_out` profiles. This is the canonical "keep off ordinary public
 *   surfaces" signal, and it is what `seedHandoffs` writes on a prepared
 *   concierge profile, including *unclaimed* ones that have been prepared for
 *   outreach but never accepted. Those were offered on the explicit promise that
 *   nothing is published, so claim state cannot be used to discard the opt-out.
 * - `suppressed` profiles, which are a moderation state.
 * - Any profile with an accepted `profileSuppressionRequests` row, which is the
 *   record of someone asking not to be listed.
 * - Claimed profiles, since publication of an owned profile is the owner's call.
 * - Profiles with a live concierge handoff invitation, whose recipient is holding
 *   a private review link.
 */
export const publishGatedProfiles = migrations.define({
  table: "profiles",
  // ponytail: smaller than the 50-row default because migrateOne has no page hook
  // to preload the accepted-suppression set, so each row re-reads it. Raise this
  // once suppression requests carry a canonical name/type index that allows a
  // targeted lookup instead of a full scan.
  batchSize: 10,
  migrateOne: async (ctx, profile) => {
    if (profile.claimState !== "unclaimed") {
      return;
    }

    if (profile.publicationState !== "draft_private" || profile.publicSurfacingState !== "public") {
      return;
    }

    // The migration bypasses both publication gates, so it repeats their live
    // handoff check: an invitation can reuse a legacy draft_private profile whose
    // surfacing state is still public, and publishing it would expose the profile
    // while its private review link is live.
    const activeInvitations = await ctx.db
      .query("seedHandoffInvitations")
      .withIndex("by_profileId_state", (query) =>
        query.eq("profileId", profile._id).eq("state", "active"),
      )
      .collect();

    if (activeInvitations.some((invitation) => isLiveHandoffInvitation(invitation, Date.now()))) {
      // Recorded as an explicit opt-out rather than skipped. A bare return advances
      // the migration cursor, so a profile whose invitation later expires would stay
      // draft_private forever with no record of why. opted_out is the same state
      // seedHandoffs writes on a prepared concierge profile, and the ordinary
      // publication and suppression paths govern it from there.
      const now = Date.now();

      await ctx.db.patch(profile._id, {
        publicSurfacingState: "opted_out",
        publicSurfacingUpdatedAt: now,
        publicSurfacingReason: "Concierge handoff invitation pending.",
        updatedAt: now,
      });

      return;
    }

    const suppressed = await hasAcceptedSuppression(ctx.db, {
      profileId: profile._id,
      slugs: [profile.slug],
      // Every name this profile would surface, respecting alias field visibility.
      displayNames: surfacedProfileNames(profile),
      profileType: profile.profileType,
    });

    if (suppressed) {
      return;
    }

    const now = Date.now();

    await ctx.db.patch(profile._id, {
      publicationState: "published",
      publicSurfacingUpdatedAt: now,
      publishedAt: profile.publishedAt ?? now,
      updatedAt: now,
    });

    const published = await ctx.db.get(profile._id);

    if (published !== null) {
      // Search and vocabulary are updated together everywhere else profiles
      // publish. Indexing search alone would surface the profile while leaving
      // its tags and genres missing from discovery vocabulary and usage counts.
      await Promise.all([
        upsertSearchDocument(ctx.db, createProfileSearchDocument(published)),
        recordVocabularyTerms(ctx.db, vocabularyForProfile(published), now),
      ]);

    }
  },
});

// Runs the surfacing backfill first: a legacy profile with no publicSurfacingState
// would be skipped by publishGatedProfiles while its cursor advanced, and running
// the backfill afterwards cannot make a completed migration revisit it.
//
// This deliberately does not reindex worlds per row. Scheduling one reindex per
// migrated profile would mean a full worlds scan each; run
// `search:rebuildWorldSearchDocuments` once afterwards instead, which covers every
// newly visible attribution and records world vocabulary with it.
export const runPublishGatedProfiles = migrations.runner([
  internal.migrations.backfillProfilePublicSurfacingState,
  internal.migrations.backfillHandoffInvitationProfileIds,
  internal.migrations.publishGatedProfiles,
]);

/**
 * Stamp `appliedAt` on Discord watermarks written before that field existed.
 *
 * A positive `appliedGeneration` is proof reconciliation completed, but those
 * rows carry no success timestamp, and `updatedAt` is not a substitute:
 * `reserveGuildVerificationGeneration` bumps it before reading guilds, so a
 * later failed attempt on an older account would make it outrank a newer
 * successful one and hand claiming the wrong Discord identity.
 *
 * `updatedAt` is the best evidence available for rows already written, and it is
 * correct unless a reservation failed after the last success — freezing it into
 * the immutable field at least stops future failures from moving it.
 */
export const backfillDiscordWatermarkAppliedAt = migrations.define({
  table: "discordVerificationWatermarks",
  migrateOne: async (_ctx, watermark) => {
    if (watermark.appliedAt !== undefined || watermark.appliedGeneration <= 0) {
      return;
    }

    return { appliedAt: watermark.updatedAt };
  },
});

export const runBackfillDiscordWatermarkAppliedAt = migrations.runner(
  internal.migrations.backfillDiscordWatermarkAppliedAt,
);

// Deliberately not in runAll: publishGatedProfiles publishes profiles publicly,
// which is outward-facing and not cleanly reversible. An operator triggers it when
// they mean to, rather than it firing as a side effect of a function deploy.
export const runAll = migrations.runner([
  internal.migrations.backfillProfilePublicSurfacingState,
  internal.migrations.backfillHandoffInvitationProfileIds,
  internal.migrations.backfillDiscordWatermarkAppliedAt,
]);

// ---------------------------------------------------------------------------
// Convex Auth purge, phase two.
//
// Clerk owns authentication. What is left behind is the Convex Auth component's
// six tables, VRDex's own `recentAuthChallenges` and `e2eAuthCodes`, and the
// `users` rows created before the cutover — inert, because a row without a
// `clerkUserId` matches the index for nobody, but still blocking the schema
// change that drops those declarations. Convex rejects a push that leaves a
// populated table undeclared.
//
// Deliberately not in `runAll`. This deletes rows and cannot be undone, so it
// runs when an operator means it, not as a side effect of a function deploy.
// `dryRun` defaults to true for the same reason: the first run reports, the
// second acts.

export const CONVEX_AUTH_TABLES = [
  "authRefreshTokens",
  "authVerificationCodes",
  "authVerifiers",
  "authSessions",
  "authAccounts",
  "authRateLimits",
  "recentAuthChallenges",
  "e2eAuthCodes",
] as const;

// Every `v.id("users")` field outside the tables above, derived from
// `convex/schema.ts`. A legacy row referenced by any of them is NOT deleted:
// Convex does not enforce referential integrity, so removing it would leave a
// dangling id that reads as a valid reference and resolves to nothing.
//
// Kept as data rather than 38 hand-written queries because the whole point is
// that the list is exhaustive — a missed entry is silent corruption, and a
// table is far easier to check against the schema than a wall of lookups.
export const USER_REFERENCES = [
  ["accountFeatureGrants", "userId"],
  ["apiTokenEvents", "ownerUserId"],
  ["apiTokens", "ownerUserId"],
  ["apiTokens", "revokedByUserId"],
  ["apiWriteAuditEvents", "ownerUserId"],
  ["billingCustomerMappings", "userId"],
  ["billingEntitlementSnapshots", "userId"],
  ["billingSubscriptionSnapshots", "userId"],
  ["communityVrclinkingCredentials", "delegatedByUserId"],
  ["discordVerificationStates", "userId"],
  ["discordVerificationWatermarks", "userId"],
  ["externalControlProofs", "userId"],
  ["mcpEventWriteReceipts", "ownerUserId"],
  ["mcpToolEvents", "ownerUserId"],
  ["oauthAccessTokens", "userId"],
  ["oauthApplicationSecrets", "revokedByUserId"],
  ["oauthApplications", "ownerUserId"],
  ["oauthApplications", "revokedByUserId"],
  ["oauthAuthorizationCodes", "userId"],
  ["oauthClientEvents", "ownerUserId"],
  ["oauthConsentTransactions", "userId"],
  ["oauthRefreshTokens", "userId"],
  ["profileAssetAccessibilityGenerationEvents", "userId"],
  ["profileClaimRequests", "userId"],
  ["profileExternalLinks", "linkedByUserId"],
  ["profileOwners", "userId"],
  ["profileVerificationAttempts", "userId"],
  ["seedHandoffInvitations", "acceptedByUserId"],
  ["temporalParseJobs", "ownerUserId"],
  ["temporalParsingPreferences", "userId"],
  ["temporalPrewarmLeases", "ownerUserId"],
] as const;

export const purgeConvexAuthLeftovers = internalMutation({
  args: {
    // Both ends of the grant transfer, named explicitly. Neither is inferred.
    //
    // Not by email: a rule that moves privileges to whoever holds a matching
    // address is a privilege-escalation primitive. Not "every grant on every
    // legacy row" either, which was the first version of this and was worse —
    // `view_private_seed_lookup` and `use_temporal_parsing_beta` are issued to
    // individual beta users, so a deployment holding grants for several of them
    // would have had all of those collapse onto one account.
    //
    // Only `from`'s active grants move. Grants on any other legacy row are left
    // alone and block that row's deletion, which is the outcome worth having:
    // someone else's privileges are a reason to stop, not to reassign.
    regrantGrantsFrom: v.optional(v.id("users")),
    regrantGrantsToClerkUserId: v.optional(v.string()),
    dryRun: v.optional(v.boolean()),
  },
  handler: async (ctx, args) => {
    const dryRun = args.dryRun ?? true;

    if ((args.regrantGrantsFrom === undefined) !== (args.regrantGrantsToClerkUserId === undefined)) {
      throw new Error(
        "regrantGrantsFrom and regrantGrantsToClerkUserId go together. Pass both to move grants, or neither to leave every grant alone.",
      );
    }

    const users = await ctx.db.query("users").collect();
    const legacy = users.filter((user) => user.clerkUserId === undefined);
    const legacyIds = new Set<string>(legacy.map((user) => user._id));

    let regrantTarget: Id<"users"> | undefined;

    if (args.regrantGrantsToClerkUserId !== undefined) {
      const target = await ctx.db
        .query("users")
        .withIndex("clerkUserId", (q) => q.eq("clerkUserId", args.regrantGrantsToClerkUserId))
        .unique();

      if (target === null) {
        throw new Error(
          `No users row carries clerkUserId ${args.regrantGrantsToClerkUserId}. Sign in through Clerk first so ensureUser provisions one.`,
        );
      }

      // A Clerk row is the only valid destination. Naming a legacy row would
      // move the grants onto something this same run then deletes.
      if (!legacyIds.has(args.regrantGrantsFrom as string)) {
        throw new Error(
          `regrantGrantsFrom ${args.regrantGrantsFrom} is not a legacy users row. Only rows without a clerkUserId are purged, so only their grants need moving.`,
        );
      }

      regrantTarget = target._id;
    }

    // Re-point before scanning, so a grant that moved off a legacy row stops
    // counting as a reason to keep it.
    const regranted: string[] = [];

    if (regrantTarget !== undefined) {
      const grants = await ctx.db
        .query("accountFeatureGrants")
        .withIndex("by_userId_feature_state", (q) => q.eq("userId", args.regrantGrantsFrom as Id<"users">))
        .collect();

      for (const grant of grants) {
        // Revoked grants stay put and block. Moving one would write a history
        // in which the Clerk account held and lost a feature it never had, and
        // deleting one would discard the record of a revocation.
        if (grant.state !== "active") {
          continue;
        }

        regranted.push(`${grant.feature}:${grant._id}`);

        if (!dryRun) {
          await ctx.db.patch(grant._id, { userId: regrantTarget, updatedAt: Date.now() });
        }
      }
    }

    // A dry run reports what a real run would refuse to delete. Because the
    // patches above have not been applied yet, grants still sit on legacy rows,
    // so exclude the ones already accounted for rather than reporting them twice.
    const regrantedGrantIds = new Set(regranted.map((entry) => entry.split(":")[1]));
    const blocked = new Map<string, string[]>();

    for (const [table, field] of USER_REFERENCES) {
      for (const row of await ctx.db.query(table).collect()) {
        const value = (row as Record<string, unknown>)[field];

        if (typeof value !== "string" || !legacyIds.has(value)) {
          continue;
        }

        if (table === "accountFeatureGrants" && regrantedGrantIds.has(row._id)) {
          continue;
        }

        blocked.set(value, [...(blocked.get(value) ?? []), `${table}.${field}`]);
      }
    }

    const deletableUsers = legacy.filter((user) => !blocked.has(user._id));
    const clearedTables: Record<string, number> = {};

    for (const table of CONVEX_AUTH_TABLES) {
      const rows = await ctx.db.query(table).collect();
      clearedTables[table] = rows.length;

      if (!dryRun) {
        await Promise.all(rows.map((row) => ctx.db.delete(row._id)));
      }
    }

    if (!dryRun) {
      await Promise.all(deletableUsers.map((user) => ctx.db.delete(user._id)));
    }

    return {
      dryRun,
      clearedTables,
      legacyUsers: legacy.length,
      deletedUsers: deletableUsers.map((user) => user.email ?? user._id),
      regrantedGrants: regranted,
      // Non-empty means those rows survive on purpose. Resolve each reference
      // before rerunning; the schema drop stays blocked until this is empty.
      //
      // Keys are full `users._id` values, which is where `regrantGrantsFrom`
      // comes from: run once with no regrant arguments, read the blocked row out
      // of this, run again naming it. That is deliberately the only supported
      // way to find it — an operator who has not seen what a row is referenced by
      // should not be reassigning its privileges.
      blockedUsers: Object.fromEntries(blocked),
      // The other half of that round trip. Reported so the two ids the real run
      // needs both come out of the dry run, rather than sending someone to read
      // truncated cells in the dashboard and retype them.
      clerkUsers: users
        .filter((user) => user.clerkUserId !== undefined)
        .map((user) => ({ clerkUserId: user.clerkUserId, email: user.email })),
      // Keyed by token identifier, not by `users._id`, so these do not block the
      // purge — but the issuer change already stopped them matching their owners
      // and they have to be re-granted by hand. Reported so that is not a
      // surprise later.
      staleCommunityAuthorities: (await ctx.db.query("communityAuthorities").collect()).length,
    };
  },
});
