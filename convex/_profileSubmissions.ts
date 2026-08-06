import { ConvexError } from "convex/values";
import {
  type NormalizedProfileLink,
  type ProfileLinkSource,
  sanitizeProfileLinks,
} from "./_profileLinks";

/**
 * A rejection the writer can act on, in a form that survives production.
 *
 * Convex redacts plain `Error` messages on production deployments, so "Display
 * name must be at least 2 characters" reached the form as the generic
 * backend-unreachable notice, for a problem entirely fixable in the form the
 * person was looking at. The structured payload survives, which is why
 * `sanitizeProfileLinks` already answers this way; these are the same kind of
 * message and now answer the same way.
 *
 * Only messages written for the writer come through here. Internal failures stay
 * plain, and stay redacted.
 */
export function profileInputError(message: string): ConvexError<{ code: string; message: string }> {
  return new ConvexError({ code: "PROFILE_INPUT_INVALID", message });
}

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
  outboundLinks?: unknown;
  person?: {
    roleTags?: string[];
  };
  community?: {
    subtype?: string;
    categoryTags?: string[];
  };
};

type SanitizedProfileLink = NormalizedProfileLink & { source: ProfileLinkSource };

export type SanitizedCommunitySubmissionProfileInput =
  | {
      profileType: "person";
      displayName: string;
      sortName: string;
      aliases: string[];
      tags: string[];
      outboundLinks: SanitizedProfileLink[];
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
      outboundLinks: SanitizedProfileLink[];
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
    throw profileInputError(`${fieldName} must be at least ${minLength} characters.`);
  }

  if (value.length > maxLength) {
    throw profileInputError(`${fieldName} must be ${maxLength} characters or fewer.`);
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
    throw profileInputError(`${fieldName} must be ${maxLength} characters or fewer.`);
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
      throw profileInputError(`${fieldName} items must be ${options.maxLength} characters or fewer.`);
    }

    const key = value.toLowerCase();
    if (seen.has(key)) {
      continue;
    }

    if (values.length >= options.maxItems) {
      throw profileInputError(`${fieldName} can include at most ${options.maxItems} entries.`);
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

/**
 * `linkSource` is explicit at every call site rather than defaulted: the same
 * sanitizer serves the community submit form, where the writer is adding
 * somebody else's profile, and Discord claim creation, where the writer ends up
 * owning the profile. Those are different provenance claims and the value is
 * rendered as a trust signal, so a default here would quietly mislabel one.
 */
export function sanitizeCommunitySubmissionProfileInput(
  input: CommunitySubmissionProfileInput,
  options: { linkSource: ProfileLinkSource },
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
    outboundLinks: sanitizeProfileLinks(input.outboundLinks ?? [], options.linkSource),
  };

  if (input.profileType === "person") {
    if (hasCommunitySubmissionFields(input.community)) {
      throw profileInputError("Community fields cannot be submitted for a person profile.");
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
    throw profileInputError("Person fields cannot be submitted for a community profile.");
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
