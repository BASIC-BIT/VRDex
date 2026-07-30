import { Migrations } from "@convex-dev/migrations";

import { components, internal } from "./_generated/api";
import type { DataModel, Doc } from "./_generated/dataModel";
import { internalMutation } from "./_generated/server";
import {
  createProfileSearchDocument,
  upsertSearchDocument,
  vocabularyForProfile,
} from "./_searchDocuments";
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
 */
export const publishGatedProfiles = migrations.define({
  table: "profiles",
  migrateOne: async (ctx, profile) => {
    if (profile.claimState !== "unclaimed") {
      return;
    }

    if (profile.publicationState !== "draft_private" || profile.publicSurfacingState !== "public") {
      return;
    }

    const suppressed = await hasAcceptedSuppression(ctx.db, {
      profileId: profile._id,
      slug: profile.slug,
      displayNames: [profile.displayName],
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

export const runPublishGatedProfiles = migrations.runner(internal.migrations.publishGatedProfiles);

// Deliberately not in runAll: this publishes profiles publicly, which is
// outward-facing and not cleanly reversible. An operator triggers it when they
// mean to, rather than it firing as a side effect of a function deploy.
export const runAll = migrations.runner([
  internal.migrations.backfillProfilePublicSurfacingState,
]);
