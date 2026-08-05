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
 * An allowlist made the default for a new field "not editable", which is how
 * `outboundLinks` -- a DJ's stream links, the single highest-value field on the
 * record -- ended up excluded by omission rather than by decision.
 *
 * `timezone` was briefly in here on the grounds that no public surface renders
 * it. That was wrong: the public lookup projects it at `public` visibility and
 * `LookupIdentity` renders it beside the region. It is the *profile page* that
 * never shows it, which is a narrower claim and the one `PAGE_INVISIBLE_FIELDS`
 * below carries.
 */
export const COMMUNITY_UNEDITABLE_FIELDS = [
  "slug",
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
 * Visibility keys the page shows only while no headline takes their row.
 *
 * `ProfilePublicPage` builds one metadata line from pronouns or subtype, region,
 * and then the "focus items" -- role tags, category tags and free tags -- and
 * drops the focus items when the profile has a headline, because the headline is
 * already carrying that row. There is no second place they render.
 *
 * Keys rather than fields, because `person` and `community` each group one focus
 * key with one that is not: pronouns and subtype keep their place in that row
 * whatever the headline does.
 */
const HEADER_ONLY_KEYS = new Set<ProfileFieldVisibilityKey>([
  "tags",
  "personRoleTags",
  "communityCategoryTags",
]);

/**
 * Visibility keys the profile page never renders, whatever else is on it.
 *
 * `timezone` reaches the record and no part of the page shows it. The public
 * lookup does, so it is readable while it is `public` -- and unreadable the
 * moment it is `unlisted`, because that is precisely the state discovery
 * excludes and the page was never going to cover.
 */
const PAGE_INVISIBLE_KEYS = new Set<ProfileFieldVisibilityKey>(["timezone"]);

/**
 * Whether a field is held back from the contributor on this profile.
 *
 * `private` is an explicit instruction that a value is not for public surfaces,
 * and a community contributor is a member of that public. Editing a field means
 * being shown its current value first, so the community may not edit what it may
 * not read -- otherwise the editor becomes a way to read withheld values by
 * opening a form, and a blind save would overwrite one.
 *
 * `unlisted` is normally not private: it renders on the profile page, so a
 * contributor looking at that page has already seen it. That reasoning is the
 * whole justification, and it fails wherever the page does not in fact render the
 * field -- for a focus item on a profile with a headline, because the headline
 * takes that row, and for `timezone` always. `unlisted` is exactly the state
 * discovery excludes, so with the page not covering it either the value is
 * nowhere a contributor can reach.
 *
 * `public` is unaffected in both cases: the lookup carries it whatever the page
 * does. That is why this turns on `unlisted` rather than on the headline, or on
 * the field, alone.
 */
function isFieldWithheldFromCommunity(
  profile: Pick<Doc<"profiles">, "fieldVisibility"> & Partial<Pick<Doc<"profiles">, "headline">>,
  field: ProfileEditableField,
): boolean {
  const headlineTakesFocusRow = (profile.headline ?? "").trim().length > 0;

  return VISIBILITY_KEYS_BY_FIELD[field].some((key) => {
    const visibility = getProfileFieldVisibility(profile, key);

    // Per key, not per field. `person` covers pronouns *and* role tags, and only
    // the role tags are focus content -- the page keeps rendering pronouns in the
    // metadata row when a headline is there. Asking the question of the whole
    // group withheld the entire form group over an unlisted pronoun that is on
    // the page, which is the opposite of what this rule is for.
    const pageShowsKey =
      !PAGE_INVISIBLE_KEYS.has(key) && !(headlineTakesFocusRow && HEADER_ONLY_KEYS.has(key));

    return visibility === "private" || (!pageShowsKey && visibility === "unlisted");
  });
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
    // `headline` decides whether the header renders focus items at all, which is
    // the only place they render. Optional so a caller that does not load it
    // reads as "no headline", the case where those fields *are* on the page.
    Partial<Pick<Doc<"profiles">, "fieldVisibility" | "headline">>,
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
      !isFieldWithheldFromCommunity(profile, field)
    );
  }

  return false;
}
