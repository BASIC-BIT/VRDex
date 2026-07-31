import type { Doc, Id } from "./_generated/dataModel";
import type { DatabaseReader, DatabaseWriter } from "./_generated/server";
import {
  materializeProfileFieldVisibility,
  normalizeProfileFieldVisibility,
} from "./_profileFieldVisibility";
import { canReadProfile } from "./_profilePermissions";
import { userOwnsProfile } from "./_profileOwnership";

type ProfilePrivacyUpdateInput = {
  profile: Doc<"profiles">;
  userId: Id<"users">;
  fieldVisibility: Record<string, unknown>;
  now: number;
};

export function toOwnedProfilePrivacyResult(profile: Doc<"profiles">) {
  return {
    profileId: profile._id,
    profileType: profile.profileType,
    slug: profile.slug,
    displayName: profile.displayName,
    claimState: profile.claimState,
    hasPublicProfile: canReadProfile("public", profile),
    fieldVisibility: materializeProfileFieldVisibility(profile.fieldVisibility),
  };
}

export async function listOwnedPrivacyProfiles(db: DatabaseReader, userId: Id<"users">) {
  const owners = await db
    .query("profileOwners")
    .withIndex("by_userId_state", (query) => query.eq("userId", userId).eq("state", "active"))
    .collect();
  const profiles = await Promise.all(owners.map((owner) => db.get(owner.profileId)));

  return profiles
    .filter((profile): profile is Doc<"profiles"> => profile !== null && profile.claimState !== "unclaimed")
    .map((profile) => toOwnedProfilePrivacyResult(profile))
    .sort((first, second) => first.displayName.localeCompare(second.displayName));
}

export async function assertProfilePrivacyOwner(
  db: DatabaseReader,
  profile: Doc<"profiles">,
  userId: Id<"users">,
) {
  if (profile.claimState === "unclaimed" || !(await userOwnsProfile(db, profile._id, userId))) {
    throw new Error("Only a claimed profile owner can update profile privacy.");
  }
}

export async function applyProfileFieldVisibilityUpdate(
  db: DatabaseWriter,
  input: ProfilePrivacyUpdateInput,
) {
  await assertProfilePrivacyOwner(db, input.profile, input.userId);

  const fieldVisibility = normalizeProfileFieldVisibility(input.fieldVisibility);

  await db.patch(input.profile._id, {
    fieldVisibility,
    updatedAt: input.now,
  });

  return {
    profileId: input.profile._id,
    fieldVisibility: materializeProfileFieldVisibility(fieldVisibility),
  };
}
