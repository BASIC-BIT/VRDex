import type { Doc } from "./_generated/dataModel";

export type ProfileClaimState = Doc<"profiles">["claimState"];
export type ProfileCreationSource = Doc<"profiles">["creationSource"];

export type ProfileTrustLabel =
  | "community_submitted"
  | "unclaimed"
  | "claimed_unverified"
  | "claimed_verified";

const ALLOWED_CLAIM_STATE_TRANSITIONS: Record<ProfileClaimState, ProfileClaimState[]> = {
  unclaimed: ["claimed_unverified", "claimed_verified"],
  claimed_unverified: ["claimed_verified"],
  claimed_verified: [],
};

export function getProfileTrustLabel(
  claimState: ProfileClaimState,
  creationSource: ProfileCreationSource,
): ProfileTrustLabel {
  if (claimState === "claimed_verified") {
    return "claimed_verified";
  }

  if (claimState === "claimed_unverified") {
    return "claimed_unverified";
  }

  if (creationSource === "community") {
    return "community_submitted";
  }

  return "unclaimed";
}

export function canTransitionProfileClaimState(
  from: ProfileClaimState,
  to: ProfileClaimState,
): boolean {
  return from === to || ALLOWED_CLAIM_STATE_TRANSITIONS[from].includes(to);
}

export function requireProfileClaimStateTransition(
  from: ProfileClaimState,
  to: ProfileClaimState,
): void {
  if (!canTransitionProfileClaimState(from, to)) {
    throw new Error(`Invalid profile claim state transition from "${from}" to "${to}".`);
  }
}
