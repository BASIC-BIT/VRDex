import type { Doc } from "./_generated/dataModel";
import type { DatabaseWriter } from "./_generated/server";
import { getProfileFieldVisibility } from "./_profileFieldVisibility";
import {
  canEditProfileField,
  canReadProfile,
  PROFILE_EDITABLE_FIELDS,
  type ProfileEditableField,
  type ProfilePermissionSubject,
} from "./_profilePermissions";
import {
  profileLinkDestinationKey,
  sanitizeProfileLinks,
  sanitizeProfileLinksLeniently,
  type ProfileLinkSource,
} from "./_profileLinks";
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
  profileInputError,
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

/**
 * Whether a submitted list is exactly what the profile already holds.
 *
 * The editor posts every group it rendered, so a group nobody touched arrives on
 * every save and gets validated again. That is fine until the stored value is
 * outside a limit the writer cannot fix -- a profile published before a cap
 * existed, or seeded past one -- at which point the resubmitted array fails
 * validation and refuses an unrelated bio or display-name correction, naming a
 * field the writer never opened.
 *
 * An untouched group is left out of the patch entirely: nothing to validate,
 * nothing to write, nothing in the history. Changing it still has to satisfy the
 * limits, so this grandfathers what is there without letting anything new past.
 */
function matchesStoredList(submitted: unknown, stored: unknown): boolean {
  return JSON.stringify(submitted ?? null) === JSON.stringify(stored ?? null);
}

/**
 * The same question for outbound links, which carry rendering metadata.
 *
 * Every writable part of a link is compared, not just its destination. Comparing
 * type and URL alone called a row unchanged when an API owner had edited only its
 * label, handle or presentation, so the update returned success and wrote
 * nothing.
 *
 * `source` is deliberately excluded. It is not writable -- it is stripped before
 * normalization and honoured only against a stored link that already carries it
 * -- so a differing claim is not an edit, and counting it would let a caller
 * force the whole group through validation by asking for a provenance they were
 * never going to get.
 */
const COMPARED_LINK_KEYS = ["type", "url", "label", "handle", "presentation"] as const;

function matchesStoredLinks(submitted: unknown, stored: Doc<"profiles">["outboundLinks"]): boolean {
  if (!Array.isArray(submitted) || submitted.length !== (stored ?? []).length) {
    return false;
  }

  return submitted.every((entry, index) => {
    const link = (stored ?? [])[index] as Record<string, unknown> | undefined;
    const proposed = (entry ?? {}) as Record<string, unknown>;

    return (
      link !== undefined &&
      COMPARED_LINK_KEYS.every((key) => (proposed[key] ?? undefined) === (link[key] ?? undefined))
    );
  });
}

function requireBoundedText(input: string, fieldName: string, minLength: number, maxLength: number): string {
  const value = normalizeProfileInlineText(input);

  if (value.length < minLength) {
    throw profileInputError(`${fieldName} must be at least ${minLength} characters.`);
  }

  if (value.length > maxLength) {
    throw profileInputError(`${fieldName} must be ${maxLength} characters or fewer.`);
  }

  return value;
}

/**
 * Whether a submitted scalar is already what the profile holds.
 *
 * Normalized exactly as `optionalBoundedText` would, minus the length check --
 * which is the whole point. A profile seeded before the current limits can hold
 * a headline or a pronoun string longer than one of them, and the editor posts
 * every field it rendered on every save, so validating before comparing refused
 * a link or bio correction the writer did make over a value they never touched.
 * The same grandfathering the display name and the lists already get. A real
 * edit is still validated, so nothing new arrives this way.
 */
function matchesStoredText(submitted: NullableString, stored: string | undefined): boolean {
  if (submitted === null || submitted === undefined) {
    return stored === undefined;
  }

  const value = normalizeProfileInlineText(submitted);

  return (value.length === 0 ? undefined : value) === stored;
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
    throw profileInputError(`${fieldName} must be ${maxLength} characters or fewer.`);
  }

  return value;
}

/**
 * What makes two outbound links the same link, for provenance.
 *
 * Type and destination, not label: renaming a link is editing it, and it keeps
 * the provenance it already had. `profileLinkDestinationKey` decides what
 * "same destination" means, shared with the seed lane's deduplication so the two
 * cannot fold URLs differently -- which is how `/Mix` and `/mix` came to be one
 * link in both of them, letting a writer move an owner-authored link to another
 * page on a case-sensitive host and keep the stamp. The form drops the claim for
 * a case-only edit, but `updateProfileFromBrowser` accepts `source` from any
 * caller, so the form is not where this can be decided.
 */
const linkIdentity = profileLinkDestinationKey;

/**
 * The provenance each submitted row says it arrived with, by position.
 *
 * Read off the raw input rather than the sanitized links, because sanitizing
 * drops the key -- `source` is not a writer-supplied field, and it must not
 * become one. This is only a claim; `sanitizeApiProfileUpdateInput` honours it
 * against a stored link that genuinely has it.
 */
function requestedLinkSources(value: unknown): Array<ProfileLinkSource | undefined> {
  if (!Array.isArray(value)) {
    return [];
  }

  return value.map((entry) => {
    const source = (entry as { source?: unknown } | null)?.source;

    return LINK_SOURCES.has(source as string) ? (source as ProfileLinkSource) : undefined;
  });
}

const LINK_SOURCES = new Set<string>([
  "owner_authored",
  "reviewed",
  "partner_provided",
  "community_submitted",
]);

function addChangedField(fields: ProfileEditableField[], field: ProfileEditableField) {
  if (!fields.includes(field)) {
    fields.push(field);
  }
}

/**
 * Every editable field this request carries, whatever its value turns out to be.
 *
 * Exported so a caller can settle permission *before* doing anything else that
 * answers differently for a value the writer may not read. The suppression
 * lookup was the case: it ran first, so submitting a guessed alias at a profile
 * whose aliases are private returned `IDENTITY_SUPPRESSED` for a retracted name
 * and the cannot-edit refusal for anything else -- which discloses who has asked
 * to be suppressed, to anyone signed in.
 */
/**
 * What each nested group has to name before it counts as submitted.
 *
 * Defined once because two places ask it. The preflight below decides whether a
 * group is subject to the permission check, and the sanitizer decides whether it
 * belongs in `unchangedFields`; a group that counts for one and not the other is
 * the response oracle the preflight exists to close. `{ "person": {} }` asked for
 * nothing either way.
 */
const NESTED_GROUP_PROPERTIES = {
  person: ["pronouns", "roleTags"],
  community: ["subtype", "categoryTags"],
} as const;

export function namesNestedGroupField(
  input: ApiProfileUpdateInput,
  group: keyof typeof NESTED_GROUP_PROPERTIES,
): boolean {
  const value = (input as Record<string, unknown>)[group];

  if (typeof value !== "object" || value === null) {
    return false;
  }

  return NESTED_GROUP_PROPERTIES[group].some((property) =>
    hasOwn(value as Record<string, unknown>, property),
  );
}

export function submittedEditableFields(input: ApiProfileUpdateInput): ProfileEditableField[] {
  return PROFILE_EDITABLE_FIELDS.filter((field): field is ProfileEditableField => {
    if (field === "slug" || !hasOwn(input as Record<string, unknown>, field)) {
      return false;
    }

    // An empty nested group reached the permission check as a submitted field,
    // so the refusal it produced depended on whether that group happened to be
    // withheld -- a withheld one answered with the field-specific message and an
    // editable one fell through to the generic empty-request error. Both are
    // requests that asked for nothing, and they have to answer the same.
    return field === "person" || field === "community"
      ? namesNestedGroupField(input, field)
      : true;
  });
}

export function assertSubmittedFieldsEditable(
  profile: Doc<"profiles">,
  input: ApiProfileUpdateInput,
  subject: ProfileEditSubject,
): void {
  requireEditableFields(profile, submittedEditableFields(input), subject);
}

function requireEditableFields(
  profile: Doc<"profiles">,
  changedFields: ProfileEditableField[],
  subject: ProfileEditSubject,
) {
  for (const field of changedFields) {
    if (!canEditProfileField(subject, profile, field)) {
      throw profileInputError(
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
  // Groups the writer sent that turned out to match what is stored. Kept, not
  // just counted, because permission is a question about what was *submitted*.
  //
  // Skipping the permission check for a group that happened to match made this
  // an oracle: a signed-in non-owner could post a guessed alias array at an
  // unclaimed profile whose aliases are private, and read the answer off the
  // response -- an exact guess took the no-op path and succeeded, a wrong guess
  // was refused by name. Neither advances `updatedAt`, so the guesses could run
  // as long as they liked. Private tags and links had the same shape.
  const unchangedFields: ProfileEditableField[] = [];

  // Grandfathered like the lists. The editor submits the name on every save, and
  // a profile published before `display_name_outside_public_limits` existed can
  // hold one that is too short or too long -- so revalidating it refused a bio or
  // link correction the writer did make, over a name they did not touch. A rename
  // is still validated, so nothing new gets in this way.
  if (hasOwn(input, "displayName") && input.displayName === profile.displayName) {
    unchangedFields.push("displayName");
  } else if (hasOwn(input, "displayName")) {
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

  if (hasOwn(input, "aliases") && matchesStoredList(input.aliases, profile.aliases)) {
    unchangedFields.push("aliases");
  } else if (hasOwn(input, "aliases")) {
    patch.aliases = sanitizeProfileTextList(input.aliases, "Aliases", {
      maxItems: PROFILE_ALIAS_MAX_COUNT,
      maxLength: PROFILE_ALIAS_MAX_LENGTH,
    });
    addChangedField(changedFields, "aliases");
  }

  if (hasOwn(input, "tags") && matchesStoredList(input.tags, profile.tags)) {
    unchangedFields.push("tags");
  } else if (hasOwn(input, "tags")) {
    patch.tags = sanitizeProfileTextList(input.tags, "Tags", {
      maxItems: PROFILE_TAG_MAX_COUNT,
      maxLength: PROFILE_TAG_MAX_LENGTH,
    });
    addChangedField(changedFields, "tags");
  }

  if (hasOwn(input, "headline") && matchesStoredText(input.headline, profile.headline)) {
    unchangedFields.push("headline");
  } else if (hasOwn(input, "headline")) {
    patch.headline = optionalBoundedText(input.headline, "Headline", PROFILE_HEADLINE_MAX_LENGTH);
    addChangedField(changedFields, "headline");
  }

  if (hasOwn(input, "bio") && matchesStoredText(input.bio, profile.bio)) {
    unchangedFields.push("bio");
  } else if (hasOwn(input, "bio")) {
    patch.bio = optionalBoundedText(input.bio, "Bio", PROFILE_BIO_MAX_LENGTH);
    addChangedField(changedFields, "bio");
  }

  if (hasOwn(input, "region") && matchesStoredText(input.region, profile.region)) {
    unchangedFields.push("region");
  } else if (hasOwn(input, "region")) {
    patch.region = optionalBoundedText(input.region, "Region", PROFILE_REGION_MAX_LENGTH);
    addChangedField(changedFields, "region");
  }

  if (hasOwn(input, "timezone") && matchesStoredText(input.timezone, profile.timezone)) {
    unchangedFields.push("timezone");
  } else if (hasOwn(input, "timezone")) {
    patch.timezone = optionalBoundedText(input.timezone, "Timezone", PROFILE_TIMEZONE_MAX_LENGTH);
    addChangedField(changedFields, "timezone");
  }

  if (hasOwn(input, "outboundLinks") && matchesStoredLinks(input.outboundLinks, profile.outboundLinks)) {
    unchangedFields.push("outboundLinks");
  } else if (hasOwn(input, "outboundLinks")) {
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
    // Each row says which provenance it arrived with, and claims that exact one.
    //
    // Two earlier attempts keyed on the destination alone and both got duplicates
    // wrong: the first gave every matching row the same source, the second
    // handed them out in stored order, so deleting an owner-authored link
    // promoted the community-submitted duplicate behind it. Provenance belongs
    // to the row, so the row carries it.
    //
    // Counted per destination and per source, so both rules below can consume
    // from one structure: a claim takes the row carrying that exact source, and
    // an unclaimed write takes the destination's provenance only when every row
    // there agrees on it.
    //
    // Keyed on what each stored link canonicalizes to, not on how it is stored.
    // The submitted side is sanitized before it gets here, so a legacy row still
    // holding a `stream.vrcdn.live/live/<id>.m3u8` or a panel preview URL was
    // being compared against the `vrcdn.live/<id>` it becomes -- the claim missed
    // every time, and an edit to an unrelated field restamped a reviewed or
    // partner link as community-submitted. Same normalizer on both sides, one
    // link at a time so each keeps the source it was stored with rather than the
    // stamp the sanitizer would apply.
    const remaining = new Map<string, Map<ProfileLinkSource, number>>();
    const storedPerDestination = new Map<string, number>();

    for (const link of profile.outboundLinks ?? []) {
      const [canonical] = sanitizeProfileLinksLeniently([link], link.source).links;
      const key = linkIdentity(canonical ?? link);
      const bySource = remaining.get(key) ?? new Map<ProfileLinkSource, number>();

      bySource.set(link.source, (bySource.get(link.source) ?? 0) + 1);
      remaining.set(key, bySource);
      storedPerDestination.set(key, (storedPerDestination.get(key) ?? 0) + 1);
    }

    const claimedSources = requestedLinkSources(input.outboundLinks);
    const submitted = sanitizeProfileLinks(
      input.outboundLinks ?? [],
      LINK_SOURCE_BY_SUBJECT[subject],
    );
    // How many rows the request puts on each destination, counted before any of
    // them consumes anything. Nothing here deduplicates, so a writer can send a
    // destination more times than the profile stores it.
    const submittedPerDestination = new Map<string, number>();

    for (const link of submitted) {
      const key = linkIdentity(link);

      submittedPerDestination.set(key, (submittedPerDestination.get(key) ?? 0) + 1);
    }

    patch.outboundLinks = submitted.map((link, index) => {
      const key = linkIdentity(link);
      const bySource = remaining.get(key);

      if (bySource === undefined) {
        // A destination the profile did not already hold. Genuinely this
        // writer's, so their own stamp is the honest one.
        return link;
      }

      // More rows on this destination than the profile stores there, so which
      // submitted row is the stored one is unanswerable. Consuming in submitted
      // order answered it anyway, and answered wrong: prepending a row to a
      // reviewed link handed that row the `reviewed` stamp and left the real one
      // to be restamped community-submitted as the count ran out. Provenance
      // transferred between rows, which is the one thing claiming it once was
      // supposed to prevent.
      if ((submittedPerDestination.get(key) ?? 0) > (storedPerDestination.get(key) ?? 0)) {
        return link;
      }

      // A destination speaks for its provenance only when its stored rows agree
      // on it. Two rows at one destination carrying different sources are
      // indistinguishable to everyone -- the writer, the form and this function
      // -- so nothing in the request can say which of them survived a delete.
      //
      // That cuts both ways, and the claimed side is the one that bites. Trusting
      // a claim against "some stored row has this source" let a community
      // contributor facing a mixed destination drop the community row, submit
      // `source: "owner_authored"`, and keep the elevated stamp of a row they had
      // just removed. Ambiguity now falls back to the writer's own stamp whether
      // or not they claimed anything, which is the only answer that cannot invent
      // authority nobody granted.
      const live = [...bySource].filter(([, count]) => count > 0);

      if (live.length !== 1) {
        return link;
      }

      const stored = live[0]?.[0];

      if (stored === undefined) {
        return link;
      }

      // An explicit claim still has to match. `ApiProfileUpdateRequestSchema` has
      // no `source` field at all, so an owner patching one link's label through
      // the public API claims nothing for any of them -- and falling through to
      // the sanitizer restamped every reviewed, partner-provided and
      // community-submitted link on the profile as `owner_authored`. Absent a
      // claim, the destination's own provenance is what the row keeps.
      const claimed = claimedSources[index];

      if (claimed !== undefined && claimed !== stored) {
        return link;
      }

      bySource.set(stored, (bySource.get(stored) ?? 0) - 1);

      return { ...link, source: stored };
    });
    addChangedField(changedFields, "outboundLinks");
  }

  if (input.person !== undefined) {
    if (profile.profileType !== "person") {
      throw profileInputError("Person fields cannot be updated for a community profile.");
    }

    const person = { ...profile.person };
    let changed = false;

    // Grandfathered like the top-level scalars: a seeded pronoun string longer
    // than the current cap refused every other correction on the profile until
    // somebody shortened one the writer had not touched.
    if (
      hasOwn(input.person, "pronouns") &&
      !matchesStoredText(input.person.pronouns, profile.person.pronouns)
    ) {
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

    // Grandfathered the same way the top-level lists are: the editor rebuilds and
    // posts this array on every save, so a profile whose stored roles already
    // exceed a cap could not save a bio, headline or pronoun correction either.
    if (
      hasOwn(input.person, "roleTags") &&
      !matchesStoredList(input.person.roleTags, profile.person.roleTags)
    ) {
      person.roleTags = sanitizeProfileTextList(input.person.roleTags, "Role tags", {
        maxItems: PROFILE_TAG_MAX_COUNT,
        maxLength: PROFILE_TAG_MAX_LENGTH,
      });
      changed = true;
    }

    if (changed) {
      patch.person = person;
      addChangedField(changedFields, "person");
    } else if (namesNestedGroupField(input, "person")) {
      // Submitted and identical. Recorded so the permission check still sees it:
      // without this, private role tags are guessable the same way private
      // aliases were, by reading success or refusal off the reply.
      //
      // A nested object that names no field is not a submission. `{"person":{}}`
      // recorded here counted toward "at least one editable field" and returned
      // success for a request that asked for nothing, which is the same empty
      // write the top-level check refuses.
      unchangedFields.push("person");
    }
  }

  if (input.community !== undefined) {
    if (profile.profileType !== "community") {
      throw profileInputError("Community fields cannot be updated for a person profile.");
    }

    const community = { ...profile.community };
    let changed = false;

    // Grandfathered the same way, for the same reason.
    if (
      hasOwn(input.community, "subtype") &&
      !matchesStoredText(input.community.subtype, profile.community.subtype)
    ) {
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

    if (
      hasOwn(input.community, "categoryTags") &&
      !matchesStoredList(input.community.categoryTags, profile.community.categoryTags)
    ) {
      community.categoryTags = sanitizeProfileTextList(input.community.categoryTags, "Category tags", {
        maxItems: PROFILE_TAG_MAX_COUNT,
        maxLength: PROFILE_TAG_MAX_LENGTH,
      });
      changed = true;
    }

    if (changed) {
      patch.community = community;
      addChangedField(changedFields, "community");
    } else if (namesNestedGroupField(input, "community")) {
      unchangedFields.push("community");
    }
  }

  if (changedFields.length === 0 && unchangedFields.length === 0) {
    throw profileInputError("At least one editable profile field is required.");
  }

  // Permission is checked on everything submitted, including the groups that
  // matched what is stored. A writer sending a field they may not touch is
  // refused whether or not the value happens to match -- otherwise the reply
  // tells them whether their guess was right, and their guess was at the value.
  requireEditableFields(profile, [...changedFields, ...unchangedFields], subject);

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
  // Changed, not merely submitted. The editor posts the alias list it rendered on
  // every save, so treating any defined `aliases` as a proposed identity would
  // re-ask the suppression question about names already on the profile -- and a
  // profile carrying a legacy alias that a later name-only request covers would
  // refuse every edit, including a bio typo, with no way for the writer to see
  // why or to act on it. Adding such a name is refused; leaving it where it
  // already is has to stay editable.
  const changesAliases =
    input.aliases !== undefined &&
    JSON.stringify(input.aliases) !== JSON.stringify(profile.aliases);

  if ((!renamesProfile && !changesAliases) || !canReadProfile("public", profile)) {
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
