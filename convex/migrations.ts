import { Migrations } from "@convex-dev/migrations";

import { components, internal } from "./_generated/api";
import type { DataModel, Doc } from "./_generated/dataModel";
import { internalMutation } from "./_generated/server";

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

export const runAll = migrations.runner([
  internal.migrations.backfillProfilePublicSurfacingState,
  internal.migrations.backfillDiscordWatermarkAppliedAt,
]);
