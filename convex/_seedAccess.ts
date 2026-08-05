import type { Doc } from "./_generated/dataModel";
import {
  getProfileFieldVisibility,
  PROFILE_FIELD_VISIBILITY_KEYS,
  type ProfileFieldVisibilityKey,
  type ProfileFieldVisibilityState,
} from "./_profileFieldVisibility";
import { canReadProfile } from "./_profilePermissions";
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
export const OPERATOR_LOOKUP_PUBLICATION_STATES = [
  "draft_private",
  "review_pending",
  "published_unclaimed",
] as const;

const OPERATOR_LOOKUP_PUBLICATION_STATE_SET = new Set<string>(
  OPERATOR_LOOKUP_PUBLICATION_STATES,
);

type SeedProfileEligibility = Pick<
  Doc<"profiles">,
  "claimState" | "publicationState" | "publicSurfacingState"
>;

/**
 * Whether a published seed record is still the directory's to show.
 *
 * One rule, used by both operator surfaces, because narrowing it in one place
 * and not the other is how this kept coming apart: unclaimed, and still
 * publicly readable. Claimed means its subject took ownership and their
 * imported fields stopped being ours to hand out; not publicly readable means
 * somebody withdrew the listing on purpose.
 *
 * `null` -- a profile that could not be loaded -- fails. Failing to load is not
 * evidence that nobody owns it.
 */
export function isOperatorVisiblePublishedProfile(
  profile: SeedProfileEligibility | null | undefined,
): boolean {
  return (
    profile !== null &&
    profile !== undefined &&
    profile.claimState === "unclaimed" &&
    canReadProfile("public", profile)
  );
}

export function canIncludePrivateSeedCandidate(
  candidate: Pick<
    Doc<"seedImportCandidateProfiles">,
    "claimState" | "profileType" | "publicationState" | "reviewState"
  >,
  publicationPolicy: Doc<"seedImportBatches">["publicationPolicy"] | undefined,
  batchReviewState: Doc<"seedImportBatches">["reviewState"] | undefined,
  superAdmin: boolean,
  /**
   * The live profile this candidate published to, when it published to one.
   *
   * The candidate row goes stale in both directions: claim flows patch
   * `profiles.claimState` and suppression patches `publicSurfacingState`, and
   * neither revisits the candidate. Reading the candidate alone kept handing a
   * person's imported private fields to a beta grant after they claimed their
   * profile, or after it was withdrawn from public view.
   */
  publishedProfile?: SeedProfileEligibility | null,
): boolean {
  if (candidate.profileType !== "person") {
    return false;
  }

  if (superAdmin) {
    return true;
  }

  if (!OPERATOR_LOOKUP_PUBLICATION_STATE_SET.has(candidate.publicationState)) {
    return false;
  }

  if (
    candidate.publicationState === "published_unclaimed" &&
    !isOperatorVisiblePublishedProfile(publishedProfile)
  ) {
    return false;
  }

  // Each publication state answers to the policy that permits it, rather than to
  // one condition covering both.
  //
  // `private_only` is the promise this grant is scoped to for a record that has
  // not shipped. A published candidate cannot be held to it -- publishing
  // required the batch to be relaxed past `private_only` in the first place, so
  // demanding it there hid exactly the records whose data is already public,
  // which is how publishing dropped 405 people out of this lookup the moment
  // they went live.
  //
  // But "was relaxed once" is not "is still permitted". Written as a single
  // disjunction, a published row satisfied the policy clause on its state alone,
  // so a batch revoked back to `private_only` after publishing went on serving
  // its accepted private fields to the narrower grant -- a withdrawal of source
  // permission that changed nothing. A published row now requires the batch to
  // still allow publication; revocation withdraws it here the same way it
  // withdraws the right to publish more. Super-admins still see it, because
  // "why is this person gone?" is exactly what they are there to answer.
  // Both sides default a missing policy to `private_only`, matching the publish
  // gates and the runbook. Reading the unpublished side as a literal comparison
  // hid every accepted row of a legacy batch whose policy was never backfilled:
  // gone for the narrower grant, still there for a super-admin, with nothing
  // saying why.
  const policy = publicationPolicy ?? "private_only";
  const policyAllows =
    candidate.publicationState === "published_unclaimed"
      ? policy === "reviewed_publication_allowed"
      : policy === "private_only";

  return (
    policyAllows &&
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
 * Field keys the record holds and no public surface renders, whatever their
 * visibility says.
 *
 * The same three the publication gate refuses to count as visible content, for
 * the same reason: they reach the profile row and nothing on the page shows
 * them. `public` is a permission, not a rendering — reading it as one made these
 * invisible from both directions at once, withheld from the panel for being
 * public and absent from the page for never having been rendered.
 */
const UNRENDERED_PROFILE_FIELD_KEYS = new Set<ProfileFieldVisibilityKey>([
  "about",
  "genres",
  "timezone",
]);

/**
 * The fields a profile holds that the public page does not render.
 *
 * Only fields that both carry a value and are held back, so the result is the
 * gap itself rather than the whole record with the visible parts repeated.
 * `unlisted` is included: it renders on the profile page but not in discovery,
 * and an operator asking why someone is unsearchable needs to see that.
 *
 * "Does not render" is the question, not "is not public". A field can be public
 * and still be shown nowhere, and those are exactly the values an owner or
 * operator had no way to read short of a deploy key -- which is the thing this
 * panel exists to replace.
 */
export function withheldProfileFields(profile: Doc<"profiles">): OperatorProfileField[] {
  return PROFILE_FIELD_VISIBILITY_KEYS.flatMap((key) => {
    const visibility = getProfileFieldVisibility(profile, key);

    if (visibility === "public" && !UNRENDERED_PROFILE_FIELD_KEYS.has(key)) {
      return [];
    }

    const values = profileFieldValues(profile, key);

    return values.length === 0 ? [] : [{ key, visibility, values }];
  });
}
