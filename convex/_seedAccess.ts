import type { Doc } from "./_generated/dataModel";
import {
  getProfileFieldVisibility,
  PROFILE_FIELD_VISIBILITY_KEYS,
  type ProfileFieldVisibilityKey,
  type ProfileFieldVisibilityState,
} from "./_profileFieldVisibility";
import { normalizeSafePrivateSeedFieldValue } from "./_seedImports";

export function projectSafePrivateSeedField(
  field: Doc<"seedImportCandidateFields">,
) {
  try {
    return {
      id: field._id,
      fieldKey: field.fieldKey,
      value: normalizeSafePrivateSeedFieldValue(field.fieldKey, field.value),
      sourceLabel: field.sourceLabel,
      confidence: field.confidence,
      reviewState: field.reviewState,
      visibility: field.visibility,
      sourceObservedAt: field.sourceObservedAt,
      lastCheckedAt: field.lastCheckedAt,
      reviewedAt: field.reviewedAt,
    };
  } catch {
    return null;
  }
}

/**
 * Publication states a `view_private_seed_lookup` holder may look up.
 *
 * `rejected` and `suppressed` are deliberately absent: both record a decision to
 * stop handling this person, and the narrower grant has no reason to pull them
 * back up. Super-admins still see them, because "why is this person not here?"
 * is exactly the question an operator needs answered.
 */
const OPERATOR_LOOKUP_PUBLICATION_STATES = new Set([
  "draft_private",
  "review_pending",
  "published_unclaimed",
]);

export function canIncludePrivateSeedCandidate(
  candidate: Pick<
    Doc<"seedImportCandidateProfiles">,
    "claimState" | "profileType" | "publicationState" | "reviewState"
  >,
  publicationPolicy: Doc<"seedImportBatches">["publicationPolicy"] | undefined,
  batchReviewState: Doc<"seedImportBatches">["reviewState"] | undefined,
  superAdmin: boolean,
): boolean {
  if (candidate.profileType !== "person") {
    return false;
  }

  if (superAdmin) {
    return true;
  }

  if (!OPERATOR_LOOKUP_PUBLICATION_STATES.has(candidate.publicationState)) {
    return false;
  }

  return (
    // `private_only` is the promise this grant is scoped to. A published
    // candidate necessarily came from a batch relaxed to
    // reviewed_publication_allowed, so requiring private_only there would hide
    // exactly the records whose data is already public -- which is how
    // publishing dropped 405 people out of this lookup the moment they went
    // live, leaving it covering only what had not shipped yet.
    (publicationPolicy === "private_only" ||
      candidate.publicationState === "published_unclaimed") &&
    batchReviewState !== "rejected" &&
    batchReviewState !== "superseded" &&
    candidate.claimState === "unclaimed" &&
    candidate.reviewState === "accepted"
  );
}

export type OperatorProfileField = {
  key: ProfileFieldVisibilityKey;
  visibility: ProfileFieldVisibilityState;
  values: string[];
};

function compact(values: Array<string | undefined>): string[] {
  return values.flatMap((value) => {
    const trimmed = value?.trim();

    return trimmed ? [trimmed] : [];
  });
}

/**
 * Read one visibility-governed field as display strings.
 *
 * Flattened deliberately: the operator panel exists to answer "what is on this
 * record that I cannot see?", and a discriminated union per field type would
 * make every reader re-implement rendering for a debugging surface.
 *
 * The switch is exhaustive over `ProfileFieldVisibilityKey`, so a field added to
 * the visibility map fails to compile here rather than quietly reading as empty
 * and reporting a hidden field as having no value.
 */
function profileFieldValues(
  profile: Doc<"profiles">,
  key: ProfileFieldVisibilityKey,
): string[] {
  switch (key) {
    case "aliases":
      return compact(profile.aliases ?? []);
    case "tags":
      return compact(profile.tags ?? []);
    case "genres":
      return compact((profile.genres ?? []).map((genre) => genre.displayLabel ?? genre.displayName));
    case "headline":
      return compact([profile.headline]);
    case "bio":
      return compact([profile.bio]);
    case "about":
      return compact([profile.about]);
    case "avatarImageUrl":
      return compact([profile.avatarImageUrl]);
    case "bannerImageUrl":
      return compact([profile.bannerImageUrl]);
    case "outboundLinks":
      return compact((profile.outboundLinks ?? []).map((link) => `${link.label}: ${link.url}`));
    case "region":
      return compact([profile.region]);
    case "timezone":
      return compact([profile.timezone]);
    case "personPronouns":
      return profile.profileType === "person" ? compact([profile.person.pronouns]) : [];
    case "personRoleTags":
      return profile.profileType === "person" ? compact(profile.person.roleTags) : [];
    case "communitySubtype":
      return profile.profileType === "community" ? compact([profile.community.subtype]) : [];
    case "communityCategoryTags":
      return profile.profileType === "community" ? compact(profile.community.categoryTags) : [];
  }
}

/**
 * The fields a profile holds that the public page does not render.
 *
 * Only fields that both carry a value and are held back, so the result is the
 * gap itself rather than the whole record with the visible parts repeated.
 * `unlisted` is included: it renders on the profile page but not in discovery,
 * and an operator asking why someone is unsearchable needs to see that.
 */
export function withheldProfileFields(profile: Doc<"profiles">): OperatorProfileField[] {
  return PROFILE_FIELD_VISIBILITY_KEYS.flatMap((key) => {
    const visibility = getProfileFieldVisibility(profile, key);

    if (visibility === "public") {
      return [];
    }

    const values = profileFieldValues(profile, key);

    return values.length === 0 ? [] : [{ key, visibility, values }];
  });
}
