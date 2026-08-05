import type { Doc } from "./_generated/dataModel";

export type ProfilePermissionSubject =
  | "public"
  | "community_submitter"
  | "claimed_owner"
  | "moderator";

export const PROFILE_EDITABLE_FIELDS = [
  "displayName",
  "aliases",
  "tags",
  "headline",
  "bio",
  "region",
  "timezone",
  "slug",
  "outboundLinks",
  "person",
  "community",
] as const;

export type ProfileEditableField = (typeof PROFILE_EDITABLE_FIELDS)[number];

/**
 * Fields the community may never write on someone else's profile.
 *
 * Stated as an exclusion rather than an allowlist because the rule that
 * actually separates the two cases is not per-field:
 *
 * - **Information about the person** is community-editable. Display name,
 *   aliases, links, genres, tags, role tags, pronouns, region. Facts a third
 *   party can know and correct, and the reason an unclaimed profile is worth
 *   visiting at all.
 * - **The record itself** is not. `slug` is the profile's address, so changing
 *   it on someone else's behalf breaks every link anyone has shared. Appearance
 *   -- border radius, colours, section order -- is a presentation choice
 *   belonging to whoever owns the profile, and it is governed by
 *   `profileAppearance` rather than reaching this union at all.
 *
 * An allowlist made the default for a new field "not editable", which is how
 * `outboundLinks` -- a DJ's stream links, the single highest-value field on the
 * record -- ended up excluded by omission rather than by decision.
 */
export const COMMUNITY_UNEDITABLE_FIELDS = [
  "slug",
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
  profile: Pick<Doc<"profiles">, "publicationState" | "publicSurfacingState">,
): boolean {
  if (subject === "claimed_owner" || subject === "moderator") {
    return true;
  }

  return profile.publicationState === "published" && profile.publicSurfacingState === "public";
}

export function canEditProfileField(
  subject: ProfilePermissionSubject,
  profile: Pick<
    Doc<"profiles">,
    "claimState" | "profileType" | "publicationState" | "publicSurfacingState"
  >,
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
      // Only while nobody has claimed it. A claimed profile has someone
      // answerable for it, and their edits are not the community's to make.
      profile.claimState === "unclaimed" &&
      !(COMMUNITY_UNEDITABLE_FIELDS as readonly ProfileEditableField[]).includes(field)
    );
  }

  return false;
}
