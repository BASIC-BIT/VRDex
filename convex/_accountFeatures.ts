import type { Id } from "./_generated/dataModel";
import type { DatabaseReader, MutationCtx, QueryCtx } from "./_generated/server";
import {
  ACCOUNT_FEATURES,
  accountFeatureAccessFromGrants,
  type AccountFeatureAccess,
} from "./_accountFeatureModel";
import { requireCurrentUser } from "./accounts";

export * from "./_accountFeatureModel";

export async function getAccountFeatureAccess(
  db: DatabaseReader,
  userId: Id<"users">,
  now = Date.now(),
): Promise<AccountFeatureAccess> {
  const grantGroups = await Promise.all(
    ACCOUNT_FEATURES.map((feature) =>
      db
        .query("accountFeatureGrants")
        .withIndex("by_userId_feature_state", (query) =>
          query
            .eq("userId", userId)
            .eq("feature", feature)
            .eq("state", "active"),
        )
        .collect(),
    ),
  );

  return accountFeatureAccessFromGrants(grantGroups.flat(), now);
}

export async function requirePrivateSeedLookupAccess(
  ctx: QueryCtx | MutationCtx,
  now = Date.now(),
) {
  const user = await requireCurrentUser(ctx);
  const access = await getAccountFeatureAccess(ctx.db, user._id, now);

  if (!access.canViewPrivateSeedLookup) {
    throw new Error("Private seed lookup access is required.");
  }

  return { user, access };
}
