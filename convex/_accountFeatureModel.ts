export const ACCOUNT_FEATURES = [
  "super_admin",
  "view_private_seed_lookup",
  "use_temporal_parsing_beta",
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
  canUseTemporalParsing: boolean;
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
    canUseTemporalParsing:
      superAdmin || activeFeatures.has("use_temporal_parsing_beta"),
  };
}
