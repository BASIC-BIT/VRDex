import type { Id } from "./_generated/dataModel";
import type { DatabaseReader, MutationCtx, QueryCtx } from "./_generated/server";
import { requireCurrentUser } from "./accounts";

export const ACCOUNT_FEATURES = [
  "super_admin",
  "view_private_seed_lookup",
] as const;

export type AccountFeature = (typeof ACCOUNT_FEATURES)[number];

type AccountFeatureGrantLike = {
  feature: AccountFeature;
  state: "active" | "revoked";
  expiresAt?: number;
};

export type AccountFeatureAccess = {
  superAdmin: boolean;
  canViewPrivateSeedLookup: boolean;
};

export function isAccountFeatureGrantActive(
  grant: AccountFeatureGrantLike,
  now: number,
): boolean {
  return grant.state === "active" &&
    (grant.expiresAt === undefined || grant.expiresAt > now);
}

export function accountFeatureAccessFromGrants(
  grants: AccountFeatureGrantLike[],
  now: number,
): AccountFeatureAccess {
  const activeFeatures = new Set(
    grants
      .filter((grant) => isAccountFeatureGrantActive(grant, now))
      .map((grant) => grant.feature),
  );
  const superAdmin = activeFeatures.has("super_admin");

  return {
    superAdmin,
    canViewPrivateSeedLookup:
      superAdmin || activeFeatures.has("view_private_seed_lookup"),
  };
}

export async function getAccountFeatureAccess(
  db: DatabaseReader,
  userId: Id<"users">,
  now = Date.now(),
): Promise<AccountFeatureAccess> {
  const [superAdminGrants, seedLookupGrants] = await Promise.all(
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

  return accountFeatureAccessFromGrants(
    [...superAdminGrants, ...seedLookupGrants],
    now,
  );
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
