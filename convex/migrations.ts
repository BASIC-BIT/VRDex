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

export const runAll = migrations.runner([
  internal.migrations.backfillProfilePublicSurfacingState,
]);
