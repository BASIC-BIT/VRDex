import { Migrations } from "@convex-dev/migrations";

import { components, internal } from "./_generated/api";
import type { DataModel, Doc } from "./_generated/dataModel";
import { internalMutation } from "./_generated/server";
import { createProfileSearchDocument, upsertSearchDocument } from "./_searchDocuments";

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
 * Flips `draft_private` / `opted_out` profiles to published and publicly
 * surfaced, and reindexes them for search (a flipped profile that is not
 * reindexed stays invisible to discovery).
 *
 * Deliberately preserved:
 * - `suppressed` profiles, which are a moderation state, not a default.
 * - Any profile with an accepted `profileSuppressionRequests` row, which is the
 *   record of someone asking not to be listed.
 * - Claimed profiles. Publication of an owned profile is the owner's call, and
 *   they already have a control for it in account privacy settings. This also
 *   covers concierge handoff acceptances, which were accepted on the explicit
 *   understanding that accepting publishes nothing.
 */
export const publishGatedProfiles = migrations.define({
  table: "profiles",
  migrateOne: async (ctx, profile) => {
    if (profile.publicSurfacingState === "suppressed" || profile.claimState !== "unclaimed") {
      return;
    }

    if (profile.publicationState === "published" && profile.publicSurfacingState === "public") {
      return;
    }

    const acceptedSuppressionRequests = await ctx.db
      .query("profileSuppressionRequests")
      .withIndex("by_profileSlug_state", (query) =>
        query.eq("profileSlug", profile.slug).eq("state", "accepted"),
      )
      .take(1);

    if (acceptedSuppressionRequests.length > 0) {
      return;
    }

    const now = Date.now();

    await ctx.db.patch(profile._id, {
      publicationState: "published",
      publicSurfacingState: "public",
      publicSurfacingUpdatedAt: now,
      publicSurfacingReason: undefined,
      publishedAt: profile.publishedAt ?? now,
      updatedAt: now,
    });

    const published = await ctx.db.get(profile._id);

    if (published !== null) {
      await upsertSearchDocument(ctx.db, createProfileSearchDocument(published));
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
