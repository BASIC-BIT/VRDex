import { v } from "convex/values";
import type { Doc } from "./_generated/dataModel";
import {
  PROVIDER_AUTHORITY_MAX_AGE_MS,
  type ClubIntegrationFeature,
} from "./_clubOperationPolicy";
export const integrationFeature = v.union(
  v.literal("analytics"),
  v.literal("membership_management"),
  v.literal("posts"),
  v.literal("instances"),
);
export const ownMemberAuthority = v.object({
  groupId: v.string(),
  userId: v.string(),
  ownerUserId: v.optional(v.string()),
  membershipStatus: v.string(),
  permissions: v.array(v.string()),
  observedAt: v.number(),
});
export const storedAuthority = v.object({
  authority: ownMemberAuthority,
  collectorAccountId: v.id("collectorAccounts"),
  credentialGeneration: v.number(),
  epochStartedAt: v.number(),
  receivedAt: v.number(),
});
export const FEATURES: ClubIntegrationFeature[] = [
  "analytics",
  "membership_management",
  "posts",
  "instances",
];
export function enabledClubFeatures(
  integration: Pick<Doc<"communityVrchatIntegrations">, "enabledFeatures">,
): ClubIntegrationFeature[] {
  return integration.enabledFeatures ?? ["analytics"];
}
export function currentClubAuthority(
  integration: Doc<"communityVrchatIntegrations">,
  account: Doc<"collectorAccounts"> | null,
  now: number,
) {
  const snapshot = integration.providerAuthority;
  if (
    !snapshot ||
    !account ||
    snapshot.collectorAccountId !== integration.assignedCollectorAccountId ||
    snapshot.collectorAccountId !== account._id ||
    snapshot.credentialGeneration !== account.credentialGeneration ||
    snapshot.epochStartedAt !==
      (integration.telemetryEpochStartedAt ?? integration.createdAt) ||
    snapshot.authority.groupId !== integration.vrchatGroupId ||
    snapshot.authority.userId !== account.vrchatUserId ||
    snapshot.authority.observedAt > now ||
    now - snapshot.authority.observedAt > PROVIDER_AUTHORITY_MAX_AGE_MS
  )
    return null;
  return snapshot.authority;
}
// Readiness describes the enabled feature's baseline. Individual writes still need
// operation-specific grants, target checks and fresh dispatch-time authorization.
export const FEATURE_BASELINE: Record<ClubIntegrationFeature, string[]> = {
  analytics: [],
  membership_management: ["group-members-manage"],
  posts: ["group-announcement-manage"],
  instances: ["group-instance-open-create"],
};
