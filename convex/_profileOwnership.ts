import type { Doc, Id } from "./_generated/dataModel";
import type { DatabaseReader, DatabaseWriter } from "./_generated/server";
import type { AuthSubject } from "./_communityAuthority";
import { requireProfileClaimStateTransition } from "./_profileStates";

type GrantProfileOwnerOptions = {
  profileId: Id<"profiles">;
  userId: Id<"users">;
  grantedByClaimRequestId?: Id<"profileClaimRequests">;
  now: number;
};

type ApproveProfileClaimOptions = GrantProfileOwnerOptions & {
  profile: Doc<"profiles">;
  verified: boolean;
  actor?: AuthSubject;
  note?: string;
};

export async function getActiveProfileOwner(db: DatabaseReader, profileId: Id<"profiles">) {
  const owners = await db
    .query("profileOwners")
    .withIndex("by_profileId_roleKey_state", (query) =>
      query.eq("profileId", profileId).eq("roleKey", "owner").eq("state", "active"),
    )
    .take(1);

  return owners[0] ?? null;
}

export async function getActiveProfileOwnerForUser(
  db: DatabaseReader,
  profileId: Id<"profiles">,
  userId: Id<"users">,
) {
  const owners = await db
    .query("profileOwners")
    .withIndex("by_userId_state", (query) => query.eq("userId", userId).eq("state", "active"))
    .filter((query) => query.eq(query.field("profileId"), profileId))
    .take(1);

  return owners[0] ?? null;
}

export async function userOwnsProfile(
  db: DatabaseReader,
  profileId: Id<"profiles">,
  userId: Id<"users">,
): Promise<boolean> {
  return (await getActiveProfileOwnerForUser(db, profileId, userId)) !== null;
}

export async function grantProfileOwner(db: DatabaseWriter, options: GrantProfileOwnerOptions) {
  const existingOwner = await getActiveProfileOwner(db, options.profileId);

  if (existingOwner !== null) {
    if (existingOwner.userId === options.userId) {
      return existingOwner._id;
    }

    throw new Error("This profile already has an active owner.");
  }

  return await db.insert("profileOwners", {
    profileId: options.profileId,
    userId: options.userId,
    roleKey: "owner",
    state: "active",
    ...(options.grantedByClaimRequestId !== undefined
      ? { grantedByClaimRequestId: options.grantedByClaimRequestId }
      : {}),
    grantedAt: options.now,
    updatedAt: options.now,
  });
}

export async function approveProfileClaimForUser(
  db: DatabaseWriter,
  options: ApproveProfileClaimOptions,
) {
  const targetClaimState =
    options.profile.claimState === "claimed_verified"
      ? "claimed_verified"
      : options.verified
        ? "claimed_verified"
        : "claimed_unverified";

  await grantProfileOwner(db, options);

  if (options.profile.claimState !== targetClaimState) {
    requireProfileClaimStateTransition(options.profile.claimState, targetClaimState);

    await db.patch(options.profileId, {
      claimState: targetClaimState,
      claimedAt: options.profile.claimedAt ?? options.now,
      updatedAt: options.now,
    });
  }

  await db.insert("profileAuditEvents", {
    profileId: options.profileId,
    action: targetClaimState === "claimed_verified" ? "profile_claim_verified" : "profile_claim_approved_unverified",
    ...(options.actor !== undefined ? { actor: options.actor } : {}),
    sourceType: "owner",
    ...(options.note !== undefined ? { note: options.note } : {}),
    createdAt: options.now,
  });
}
