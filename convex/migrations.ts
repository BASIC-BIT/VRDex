import type { Doc } from "./_generated/dataModel";
import { internalMutation } from "./_generated/server";

type LegacyProfile = Doc<"profiles"> & {
  publicSurfacingState?: Doc<"profiles">["publicSurfacingState"];
  publicSurfacingUpdatedAt?: number;
};

export const backfillProfilePublicSurfacingState = internalMutation({
  args: {},
  handler: async (ctx) => {
    const now = Date.now();
    const profiles = await ctx.db.query("profiles").collect();
    let updated = 0;

    for (const profile of profiles) {
      const legacyProfile = profile as LegacyProfile;

      if (
        legacyProfile.publicSurfacingState !== undefined &&
        legacyProfile.publicSurfacingUpdatedAt !== undefined
      ) {
        continue;
      }

      await ctx.db.patch(profile._id, {
        publicSurfacingState: legacyProfile.publicSurfacingState ?? "public",
        publicSurfacingUpdatedAt: legacyProfile.publicSurfacingUpdatedAt ?? now,
      });
      updated += 1;
    }

    return { scanned: profiles.length, updated };
  },
});
