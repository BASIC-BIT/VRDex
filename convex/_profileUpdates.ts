import type { Doc } from "./_generated/dataModel";
import type { DatabaseWriter } from "./_generated/server";
import { getProfileFieldVisibility } from "./_profileFieldVisibility";
import {
  canEditProfileField,
  canReadProfile,
  type ProfileEditableField,
  type ProfilePermissionSubject,
} from "./_profilePermissions";
import { sanitizeProfileLinks, type ProfileLinkSource } from "./_profileLinks";
import { assertIdentityNotSuppressed } from "./_suppressions";
import {
  createProfileSortName,
  normalizeProfileInlineText,
  PROFILE_ALIAS_MAX_COUNT,
  PROFILE_ALIAS_MAX_LENGTH,
  PROFILE_DISPLAY_NAME_MAX_LENGTH,
  PROFILE_DISPLAY_NAME_MIN_LENGTH,
  PROFILE_SUBTYPE_MAX_LENGTH,
  PROFILE_TAG_MAX_COUNT,
  PROFILE_TAG_MAX_LENGTH,
  sanitizeProfileTextList,
} from "./_profileSubmissions";
import { reindexProfileSearchDocument } from "./_searchDocuments";

export const PROFILE_HEADLINE_MAX_LENGTH = 160;
export const PROFILE_BIO_MAX_LENGTH = 600;
export const PROFILE_REGION_MAX_LENGTH = 80;
export const PROFILE_TIMEZONE_MAX_LENGTH = 80;
export const PROFILE_PERSON_PRONOUNS_MAX_LENGTH = 80;

type NullableString = string | null | undefined;

export type ApiProfileUpdateInput = {
  displayName?: string;
  aliases?: string[];
  tags?: string[];
  headline?: NullableString;
  bio?: NullableString;
  region?: NullableString;
  timezone?: NullableString;
  person?: {
    pronouns?: NullableString;
    roleTags?: string[];
  };
  community?: {
    subtype?: NullableString;
    categoryTags?: string[];
  };
  outboundLinks?: unknown;
};

export type SanitizedApiProfileUpdate = {
  changedFields: ProfileEditableField[];
  patch: Record<string, unknown>;
};

function hasOwn<T extends object>(input: T, key: PropertyKey): boolean {
  return Object.prototype.hasOwnProperty.call(input, key);
}

function requireBoundedText(input: string, fieldName: string, minLength: number, maxLength: number): string {
  const value = normalizeProfileInlineText(input);

  if (value.length < minLength) {
    throw new Error(`${fieldName} must be at least ${minLength} characters.`);
  }

  if (value.length > maxLength) {
    throw new Error(`${fieldName} must be ${maxLength} characters or fewer.`);
  }

  return value;
}

function optionalBoundedText(input: NullableString, fieldName: string, maxLength: number): string | undefined {
  if (input === null || input === undefined) {
    return undefined;
  }

  const value = normalizeProfileInlineText(input);

  if (value.length === 0) {
    return undefined;
  }

  if (value.length > maxLength) {
    throw new Error(`${fieldName} must be ${maxLength} characters or fewer.`);
  }

  return value;
}

/**
 * What makes two outbound links the same link.
 *
 * Type and destination, not label: renaming a link is editing it, and it keeps
 * the provenance it already had.
 */
function linkIdentity(link: { type: string; url: string }): string {
  return `${link.type}:${link.url.toLowerCase()}`;
}

function addChangedField(fields: ProfileEditableField[], field: ProfileEditableField) {
  if (!fields.includes(field)) {
    fields.push(field);
  }
}

function requireEditableFields(
  profile: Doc<"profiles">,
  changedFields: ProfileEditableField[],
  subject: ProfileEditSubject,
) {
  for (const field of changedFields) {
    if (!canEditProfileField(subject, profile, field)) {
      throw new Error(
        subject === "claimed_owner"
          ? `Only a claimed profile owner can update the ${field} field.`
          : `The ${field} field cannot be edited on a profile you do not own.`,
      );
    }
  }
}

/**
 * Who is writing. Everything else about the edit is identical, which is the
 * point: the owner path and the community path share one sanitizer and one
 * field policy, and differ only in which fields each subject may touch and what
 * provenance the links carry.
 */
export type ProfileEditSubject = Extract<
  ProfilePermissionSubject,
  "claimed_owner" | "community_submitter"
>;

const LINK_SOURCE_BY_SUBJECT: Record<ProfileEditSubject, ProfileLinkSource> = {
  // A signed-in person editing somebody else's profile did not author these
  // links, and the public page renders the distinction as a trust signal.
  claimed_owner: "owner_authored",
  community_submitter: "community_submitted",
};

export function sanitizeApiProfileUpdateInput(
  profile: Doc<"profiles">,
  input: ApiProfileUpdateInput,
  subject: ProfileEditSubject = "claimed_owner",
): SanitizedApiProfileUpdate {
  const patch: Record<string, unknown> = {};
  const changedFields: ProfileEditableField[] = [];

  if (hasOwn(input, "displayName")) {
    const displayName = requireBoundedText(
      input.displayName ?? "",
      "Display name",
      PROFILE_DISPLAY_NAME_MIN_LENGTH,
      PROFILE_DISPLAY_NAME_MAX_LENGTH,
    );

    patch.displayName = displayName;
    patch.sortName = createProfileSortName(displayName);
    addChangedField(changedFields, "displayName");
  }

  if (hasOwn(input, "aliases")) {
    patch.aliases = sanitizeProfileTextList(input.aliases, "Aliases", {
      maxItems: PROFILE_ALIAS_MAX_COUNT,
      maxLength: PROFILE_ALIAS_MAX_LENGTH,
    });
    addChangedField(changedFields, "aliases");
  }

  if (hasOwn(input, "tags")) {
    patch.tags = sanitizeProfileTextList(input.tags, "Tags", {
      maxItems: PROFILE_TAG_MAX_COUNT,
      maxLength: PROFILE_TAG_MAX_LENGTH,
    });
    addChangedField(changedFields, "tags");
  }

  if (hasOwn(input, "headline")) {
    patch.headline = optionalBoundedText(input.headline, "Headline", PROFILE_HEADLINE_MAX_LENGTH);
    addChangedField(changedFields, "headline");
  }

  if (hasOwn(input, "bio")) {
    patch.bio = optionalBoundedText(input.bio, "Bio", PROFILE_BIO_MAX_LENGTH);
    addChangedField(changedFields, "bio");
  }

  if (hasOwn(input, "region")) {
    patch.region = optionalBoundedText(input.region, "Region", PROFILE_REGION_MAX_LENGTH);
    addChangedField(changedFields, "region");
  }

  if (hasOwn(input, "timezone")) {
    patch.timezone = optionalBoundedText(input.timezone, "Timezone", PROFILE_TIMEZONE_MAX_LENGTH);
    addChangedField(changedFields, "timezone");
  }

  if (hasOwn(input, "outboundLinks")) {
    // Stamped from the subject rather than assumed: `requireEditableFields`
    // below decides whether this writer may touch the field at all, and calling
    // a community contributor's links owner-authored would be a plain lie on a
    // surface that renders provenance.
    //
    // A link that was already on the profile keeps the provenance it had. The
    // form posts the whole array back, so without this, saving an unrelated
    // field would restamp every owner-authored link as community-submitted --
    // downgrading a trust signal nobody touched. Only genuinely new links carry
    // the writer's own stamp.
    // Each stored link's provenance is claimed once. A map keyed on identity
    // alone hands the same owner-authored source to every submitted link that
    // matches it, so a contributor adding a second row for the same destination
    // would have it recorded as owner-authored. One existing link, one
    // inherited source; the surplus is the writer's own.
    const existingSources = new Map<string, ProfileLinkSource[]>();

    for (const link of profile.outboundLinks ?? []) {
      const identity = linkIdentity(link);

      existingSources.set(identity, [...(existingSources.get(identity) ?? []), link.source]);
    }

    patch.outboundLinks = sanitizeProfileLinks(
      input.outboundLinks ?? [],
      LINK_SOURCE_BY_SUBJECT[subject],
    ).map((link) => ({ ...link, source: existingSources.get(linkIdentity(link))?.shift() ?? link.source }));
    addChangedField(changedFields, "outboundLinks");
  }

  if (input.person !== undefined) {
    if (profile.profileType !== "person") {
      throw new Error("Person fields cannot be updated for a community profile.");
    }

    const person = { ...profile.person };
    let changed = false;

    if (hasOwn(input.person, "pronouns")) {
      const pronouns = optionalBoundedText(
        input.person.pronouns,
        "Pronouns",
        PROFILE_PERSON_PRONOUNS_MAX_LENGTH,
      );

      if (pronouns === undefined) {
        delete person.pronouns;
      } else {
        person.pronouns = pronouns;
      }

      changed = true;
    }

    if (hasOwn(input.person, "roleTags")) {
      person.roleTags = sanitizeProfileTextList(input.person.roleTags, "Role tags", {
        maxItems: PROFILE_TAG_MAX_COUNT,
        maxLength: PROFILE_TAG_MAX_LENGTH,
      });
      changed = true;
    }

    if (changed) {
      patch.person = person;
      addChangedField(changedFields, "person");
    }
  }

  if (input.community !== undefined) {
    if (profile.profileType !== "community") {
      throw new Error("Community fields cannot be updated for a person profile.");
    }

    const community = { ...profile.community };
    let changed = false;

    if (hasOwn(input.community, "subtype")) {
      const subtype = optionalBoundedText(
        input.community.subtype,
        "Community subtype",
        PROFILE_SUBTYPE_MAX_LENGTH,
      );

      if (subtype === undefined) {
        delete community.subtype;
      } else {
        community.subtype = subtype;
      }

      changed = true;
    }

    if (hasOwn(input.community, "categoryTags")) {
      community.categoryTags = sanitizeProfileTextList(input.community.categoryTags, "Category tags", {
        maxItems: PROFILE_TAG_MAX_COUNT,
        maxLength: PROFILE_TAG_MAX_LENGTH,
      });
      changed = true;
    }

    if (changed) {
      patch.community = community;
      addChangedField(changedFields, "community");
    }
  }

  if (changedFields.length === 0) {
    throw new Error("At least one editable profile field is required.");
  }

  // Permission is checked on everything submitted, before the diff. A writer
  // sending a field they may not touch is refused whether or not the value
  // happens to match.
  requireEditableFields(profile, changedFields, subject);

  return { changedFields: changedFields.filter((field) => fieldChanged(profile, field, patch)), patch };
}

/**
 * Whether a submitted field differs from what the profile already holds.
 *
 * The editor posts every field group it rendered on every save, so without this
 * a display-name typo fix records "aliases, tags, links, headline, bio, roles
 * updated" -- and a save that changed nothing records a broad update anyway.
 * That history is the record a claiming owner inherits and the operator surface
 * reads back, so it has to say what actually happened.
 *
 * Structural comparison by serialization: these are arrays of strings and small
 * plain objects, and a deep-equality helper for that is more machinery than the
 * job needs.
 */
function fieldChanged(
  profile: Doc<"profiles">,
  field: ProfileEditableField,
  patch: Record<string, unknown>,
): boolean {
  if (!Object.prototype.hasOwnProperty.call(patch, field)) {
    return false;
  }

  return JSON.stringify(patch[field] ?? null) !== JSON.stringify(
    (profile as unknown as Record<string, unknown>)[field] ?? null,
  );
}

/**
 * Refuse an edit that would put a retracted identity back on public surfaces.
 *
 * Renaming is a second way in: an editor can leave the display name alone and
 * put the suppressed name in aliases, which the public projection exposes and
 * search indexes. Both count as names here.
 *
 * Only when the profile is actually publicly readable. An opted-out or
 * suppressed profile surfaces nothing through an edit, which never changes
 * `publicSurfacingState`, so guarding it would block editing a profile that is
 * already retracted. Republication re-checks the identity.
 */
export async function assertProfileEditNotSuppressed(
  db: DatabaseWriter,
  profile: Doc<"profiles">,
  input: Pick<ApiProfileUpdateInput, "aliases" | "displayName">,
): Promise<void> {
  const renamesProfile =
    input.displayName !== undefined &&
    createProfileSortName(input.displayName) !== createProfileSortName(profile.displayName);

  if ((!renamesProfile && input.aliases === undefined) || !canReadProfile("public", profile)) {
    return;
  }

  await assertIdentityNotSuppressed(db, {
    // No profileId: an accepted request against *this* profile would otherwise
    // match every proposed name, so an already-opted-out profile could never be
    // renamed even though renaming never restores public surfacing.
    // No slug either: this path patches displayName and sortName only, so it
    // never occupies a slug derived from the new name, and checking one would
    // reject an unrelated /p/bob owner renaming to a name whose base slug
    // happens to be suppressed.
    slugs: [],
    // Aliases only when they would actually be visible. A private alias is
    // absent from public pages and search, so submitting it here would reject an
    // edit that surfaces nothing.
    displayNames: [
      input.displayName ?? profile.displayName,
      ...(getProfileFieldVisibility(profile, "aliases") === "private"
        ? []
        : (input.aliases ?? profile.aliases)),
    ],
    profileType: profile.profileType,
    // Uses the approved default rather than an edit-specific sentence: only
    // "This profile cannot be submitted." and "This profile cannot be created."
    // carry BASIC's sign-off, and unapproved public copy must not ship.
  });
}

export async function applyApiProfileUpdate(
  db: DatabaseWriter,
  options: {
    profile: Doc<"profiles">;
    input: ApiProfileUpdateInput;
    subject?: ProfileEditSubject;
    now: number;
  },
) {
  const sanitized = sanitizeApiProfileUpdateInput(
    options.profile,
    options.input,
    options.subject ?? "claimed_owner",
  );

  // Nothing to write, so nothing to reindex either. A save that changed no
  // value should not bump `updatedAt` or touch the search document.
  if (sanitized.changedFields.length === 0) {
    return { changedFields: [], profile: options.profile };
  }

  await db.patch(options.profile._id, {
    ...sanitized.patch,
    updatedAt: options.now,
  } as Partial<Doc<"profiles">>);

  const updatedProfile = await db.get(options.profile._id);
  if (updatedProfile !== null) {
    // A delta, not a replay. This path used to record the whole vocabulary on
    // every write and never release anything, so removing a tag left discovery
    // correct and its `usageCount` permanently holding a reference that no
    // longer existed -- and every unchanged term was incremented again on each
    // save. Barely visible while only the API could reach it; the profile editor
    // makes this the ordinary way a tag changes.
    await reindexProfileSearchDocument(db, updatedProfile, options.now);
  }

  return {
    changedFields: sanitized.changedFields,
    profile: updatedProfile ?? options.profile,
  };
}
