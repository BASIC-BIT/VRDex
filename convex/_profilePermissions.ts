import type { Doc } from "./_generated/dataModel";

export type ProfilePermissionSubject =
  | "public"
  | "community_submitter"
  | "claimed_owner"
  | "moderator";

export type ProfileEditableField =
  | "displayName"
  | "aliases"
  | "tags"
  | "headline"
  | "bio"
  | "region"
  | "timezone"
  | "slug"
  | "person"
  | "community";

export const COMMUNITY_SUBMISSION_EDITABLE_FIELDS = [
  "displayName",
  "aliases",
  "tags",
  "person",
  "community",
] as const satisfies readonly ProfileEditableField[];

function isFieldCompatibleWithProfileType(
  profileType: Doc<"profiles">["profileType"],
  field: ProfileEditableField,
): boolean {
  if (field === "person") {
    return profileType === "person";
  }

  if (field === "community") {
    return profileType === "community";
  }

  return true;
}

export function canReadProfile(
  subject: ProfilePermissionSubject,
  profile: Pick<Doc<"profiles">, "publicationState">,
): boolean {
  if (subject === "claimed_owner" || subject === "moderator") {
    return true;
  }

  return profile.publicationState === "published";
}

export function canEditProfileField(
  subject: ProfilePermissionSubject,
  profile: Pick<Doc<"profiles">, "claimState" | "profileType" | "publicationState">,
  field: ProfileEditableField,
): boolean {
  if (!isFieldCompatibleWithProfileType(profile.profileType, field)) {
    return false;
  }

  if (!canReadProfile(subject, profile)) {
    return false;
  }

  if (subject === "moderator") {
    return true;
  }

  if (subject === "claimed_owner") {
    return profile.claimState !== "unclaimed";
  }

  if (subject === "community_submitter") {
    return (
      profile.claimState === "unclaimed" &&
      (COMMUNITY_SUBMISSION_EDITABLE_FIELDS as readonly ProfileEditableField[]).includes(field)
    );
  }

  return false;
}
