import type { Doc } from "./_generated/dataModel";
import {
  getProfileFieldVisibility,
  type ProfileFieldVisibilityKey,
} from "./_profileFieldVisibility";

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
 * - **What the page does not show** is not either. `timezone` reaches the
 *   profile record and nothing on the public page renders it -- only the
 *   operator lookup does, behind `view_private_seed_lookup`. Editing a field
 *   means being shown its current value first, so a contributor offered this one
 *   would be reading a value the page withheld, and a blind save would overwrite
 *   it. That is the same rule `private` visibility enforces, and visibility
 *   alone does not catch it: the field can sit at `public` and still be invisible
 *   because no surface renders it. Rendering it is a product decision nobody has
 *   made; until somebody does, it is not the community's to edit. Owners keep it,
 *   since it is their own record.
 *
 * An allowlist made the default for a new field "not editable", which is how
 * `outboundLinks` -- a DJ's stream links, the single highest-value field on the
 * record -- ended up excluded by omission rather than by decision.
 */
export const COMMUNITY_UNEDITABLE_FIELDS = [
  "slug",
  "timezone",
] as const satisfies readonly ProfileEditableField[];

/**
 * The visibility keys an editable field writes.
 *
 * `displayName` has none -- a profile's name is what its page is titled with and
 * is always shown. `person` and `community` each cover two, so a private
 * pronoun or category holds the whole grouped field back rather than being
 * revealed by an edit to the part beside it.
 */
const VISIBILITY_KEYS_BY_FIELD: Record<ProfileEditableField, ProfileFieldVisibilityKey[]> = {
  displayName: [],
  slug: [],
  aliases: ["aliases"],
  tags: ["tags"],
  headline: ["headline"],
  bio: ["bio"],
  region: ["region"],
  timezone: ["timezone"],
  outboundLinks: ["outboundLinks"],
  person: ["personPronouns", "personRoleTags"],
  community: ["communitySubtype", "communityCategoryTags"],
};

/**
 * Whether a field is held back from the public on this profile.
 *
 * `private` is an explicit instruction that a value is not for public surfaces,
 * and a community contributor is a member of that public. Editing a field means
 * being shown its current value first, so the community may not edit what it may
 * not read -- otherwise the editor becomes a way to read private values by
 * opening a form, and a blind save would overwrite one.
 *
 * `unlisted` is not private: it renders on the profile page, so a contributor
 * looking at that page has already seen it.
 */
function isFieldPrivate(
  profile: Pick<Doc<"profiles">, "fieldVisibility">,
  field: ProfileEditableField,
): boolean {
  return VISIBILITY_KEYS_BY_FIELD[field].some(
    (key) => getProfileFieldVisibility(profile, key) === "private",
  );
}

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
  > &
    Partial<Pick<Doc<"profiles">, "fieldVisibility">>,
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
      !(COMMUNITY_UNEDITABLE_FIELDS as readonly ProfileEditableField[]).includes(field) &&
      !isFieldPrivate(profile, field)
    );
  }

  return false;
}
