import type { Doc } from "./_generated/dataModel";
import type { DatabaseWriter } from "./_generated/server";
import { canEditProfileField, type ProfileEditableField } from "./_profilePermissions";
import { sanitizeProfileLinks } from "./_profileLinks";
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
import {
  createProfileSearchDocument,
  upsertSearchDocument,
  vocabularyForProfile,
} from "./_searchDocuments";
import { recordVocabularyTerms } from "./_vocabulary";

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

function addChangedField(fields: ProfileEditableField[], field: ProfileEditableField) {
  if (!fields.includes(field)) {
    fields.push(field);
  }
}

function requireEditableFields(profile: Doc<"profiles">, changedFields: ProfileEditableField[]) {
  for (const field of changedFields) {
    if (!canEditProfileField("claimed_owner", profile, field)) {
      throw new Error(`Only a claimed profile owner can update the ${field} field.`);
    }
  }
}

export function sanitizeApiProfileUpdateInput(
  profile: Doc<"profiles">,
  input: ApiProfileUpdateInput,
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
    // `requireEditableFields` below restricts this to a claimed owner, which is
    // what makes the owner-authored stamp true.
    patch.outboundLinks = sanitizeProfileLinks(input.outboundLinks ?? [], "owner_authored");
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

  requireEditableFields(profile, changedFields);

  return { changedFields, patch };
}

export async function applyApiProfileUpdate(
  db: DatabaseWriter,
  options: {
    profile: Doc<"profiles">;
    input: ApiProfileUpdateInput;
    now: number;
  },
) {
  const sanitized = sanitizeApiProfileUpdateInput(options.profile, options.input);

  await db.patch(options.profile._id, {
    ...sanitized.patch,
    updatedAt: options.now,
  } as Partial<Doc<"profiles">>);

  const updatedProfile = await db.get(options.profile._id);
  if (updatedProfile !== null) {
    await Promise.all([
      upsertSearchDocument(db, createProfileSearchDocument(updatedProfile)),
      recordVocabularyTerms(db, vocabularyForProfile(updatedProfile), options.now),
    ]);
  }

  return {
    changedFields: sanitized.changedFields,
    profile: updatedProfile ?? options.profile,
  };
}
