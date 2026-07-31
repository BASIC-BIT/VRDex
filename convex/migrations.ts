import { Migrations } from "@convex-dev/migrations";

import { components, internal } from "./_generated/api";
import type { DataModel, Doc } from "./_generated/dataModel";
import { internalMutation } from "./_generated/server";
import {
  createProfileSearchDocument,
  upsertSearchDocument,
  vocabularyForProfile,
} from "./_searchDocuments";
import { isLiveHandoffInvitation } from "./_seedHandoffs";
import { hasAcceptedSuppression } from "./_suppressions";
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
      // Aliases too: they default to public, so publishing a legacy profile whose
      // aliases carry a suppressed identity would expose and index it.
      displayNames: [
        profile.displayName,
        ...profile.aliases,
        ...(profile.searchAliases ?? []),
      ],
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
