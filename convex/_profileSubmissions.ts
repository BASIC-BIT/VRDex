export const PROFILE_DISPLAY_NAME_MIN_LENGTH = 2;
export const PROFILE_DISPLAY_NAME_MAX_LENGTH = 80;
export const PROFILE_ALIAS_MAX_COUNT = 8;
export const PROFILE_ALIAS_MAX_LENGTH = 60;
export const PROFILE_TAG_MAX_COUNT = 12;
export const PROFILE_TAG_MAX_LENGTH = 32;
export const PROFILE_SUBTYPE_MAX_LENGTH = 40;

type ProfileSubmissionProfileType = "person" | "community";

export type CommunitySubmissionProfileInput = {
  profileType: ProfileSubmissionProfileType;
  displayName: string;
  aliases?: string[];
  tags?: string[];
  person?: {
    roleTags?: string[];
  };
  community?: {
    subtype?: string;
    categoryTags?: string[];
  };
};

export type SanitizedCommunitySubmissionProfileInput =
  | {
      profileType: "person";
      displayName: string;
      sortName: string;
      aliases: string[];
      tags: string[];
      person: {
        roleTags: string[];
      };
    }
  | {
      profileType: "community";
      displayName: string;
      sortName: string;
      aliases: string[];
      tags: string[];
      community: {
        subtype?: string;
        categoryTags: string[];
      };
    };

export function normalizeProfileInlineText(input: string): string {
  return input.trim().replace(/\s+/g, " ");
}

export function createProfileSortName(displayName: string): string {
  const asciiSortName = normalizeProfileInlineText(
    displayName
      .normalize("NFKD")
      .replace(/[\u0300-\u036f]/g, "")
      .toLowerCase()
      .replace(/[^a-z0-9]+/g, " "),
  );

  return asciiSortName || normalizeProfileInlineText(displayName).toLowerCase();
}

function requireBoundedText(
  input: string,
  fieldName: string,
  minLength: number,
  maxLength: number,
): string {
  const value = normalizeProfileInlineText(input);

  if (value.length < minLength) {
    throw new Error(`${fieldName} must be at least ${minLength} characters.`);
  }

  if (value.length > maxLength) {
    throw new Error(`${fieldName} must be ${maxLength} characters or fewer.`);
  }

  return value;
}

function optionalBoundedText(
  input: string | undefined,
  fieldName: string,
  maxLength: number,
): string | undefined {
  if (input === undefined) {
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

export function sanitizeProfileTextList(
  input: string[] | undefined,
  fieldName: string,
  options: { maxItems: number; maxLength: number },
): string[] {
  const values: string[] = [];
  const seen = new Set<string>();

  for (const item of input ?? []) {
    const value = normalizeProfileInlineText(item);

    if (value.length === 0) {
      continue;
    }

    if (value.length > options.maxLength) {
      throw new Error(`${fieldName} items must be ${options.maxLength} characters or fewer.`);
    }

    const key = value.toLowerCase();
    if (seen.has(key)) {
      continue;
    }

    if (values.length >= options.maxItems) {
      throw new Error(`${fieldName} can include at most ${options.maxItems} entries.`);
    }

    seen.add(key);
    values.push(value);
  }

  return values;
}

function hasPersonSubmissionFields(input: CommunitySubmissionProfileInput["person"]): boolean {
  return (input?.roleTags ?? []).some((value) => normalizeProfileInlineText(value).length > 0);
}

function hasCommunitySubmissionFields(
  input: CommunitySubmissionProfileInput["community"],
): boolean {
  const subtype = normalizeProfileInlineText(input?.subtype ?? "");

  return (
    subtype.length > 0 ||
    (input?.categoryTags ?? []).some((value) => normalizeProfileInlineText(value).length > 0)
  );
}

export function sanitizeCommunitySubmissionProfileInput(
  input: CommunitySubmissionProfileInput,
): SanitizedCommunitySubmissionProfileInput {
  const displayName = requireBoundedText(
    input.displayName,
    "Display name",
    PROFILE_DISPLAY_NAME_MIN_LENGTH,
    PROFILE_DISPLAY_NAME_MAX_LENGTH,
  );

  const shared = {
    displayName,
    sortName: createProfileSortName(displayName),
    aliases: sanitizeProfileTextList(input.aliases, "Aliases", {
      maxItems: PROFILE_ALIAS_MAX_COUNT,
      maxLength: PROFILE_ALIAS_MAX_LENGTH,
    }),
    tags: sanitizeProfileTextList(input.tags, "Tags", {
      maxItems: PROFILE_TAG_MAX_COUNT,
      maxLength: PROFILE_TAG_MAX_LENGTH,
    }),
  };

  if (input.profileType === "person") {
    if (hasCommunitySubmissionFields(input.community)) {
      throw new Error("Community fields cannot be submitted for a person profile.");
    }

    return {
      ...shared,
      profileType: "person",
      person: {
        roleTags: sanitizeProfileTextList(input.person?.roleTags, "Role tags", {
          maxItems: PROFILE_TAG_MAX_COUNT,
          maxLength: PROFILE_TAG_MAX_LENGTH,
        }),
      },
    };
  }

  if (hasPersonSubmissionFields(input.person)) {
    throw new Error("Person fields cannot be submitted for a community profile.");
  }

  const subtype = optionalBoundedText(
    input.community?.subtype,
    "Community subtype",
    PROFILE_SUBTYPE_MAX_LENGTH,
  );

  return {
    ...shared,
    profileType: "community",
    community: {
      ...(subtype ? { subtype } : {}),
      categoryTags: sanitizeProfileTextList(input.community?.categoryTags, "Category tags", {
        maxItems: PROFILE_TAG_MAX_COUNT,
        maxLength: PROFILE_TAG_MAX_LENGTH,
      }),
    },
  };
}
