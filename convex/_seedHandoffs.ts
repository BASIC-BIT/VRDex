import type { Doc, Id } from "./_generated/dataModel";
import { sanitizeProfileLinksLeniently } from "./_profileLinks";
import { normalizeSafePrivateSeedFieldValue } from "./_seedImports";

type PersonProfile = Extract<Doc<"profiles">, { profileType: "person" }>;

export function isClaimablePrivatePersonSeedCandidate(
  candidate: Pick<
    Doc<"seedImportCandidateProfiles">,
    "claimState" | "profileType" | "publicationState"
  >,
): boolean {
  return candidate.profileType === "person" &&
    candidate.claimState === "unclaimed" &&
    (candidate.publicationState === "draft_private" ||
      candidate.publicationState === "review_pending");
}

export function isReusablePrivateConciergeProfile(
  profile: Pick<PersonProfile, "claimState" | "profileType" | "publicationState">,
): boolean {
  return profile.profileType === "person" &&
    profile.claimState === "unclaimed" &&
    profile.publicationState === "draft_private";
}

export function canRevealAcceptedHandoffDestination(
  acceptedByUserId: Id<"users"> | undefined,
  viewerUserId: Id<"users"> | undefined,
): boolean {
  return acceptedByUserId !== undefined && acceptedByUserId === viewerUserId;
}

export function isLiveHandoffInvitation(
  invitation: Pick<Doc<"seedHandoffInvitations">, "expiresAt" | "state">,
  now: number,
): boolean {
  return invitation.state === "active" && invitation.expiresAt > now;
}

const HANDOFF_TOKEN_PATTERN = /^[A-Za-z0-9_-]{43,128}$/;

export function requireSecureHandoffToken(token: string): string {
  const normalized = token.trim();

  if (!HANDOFF_TOKEN_PATTERN.test(normalized)) {
    throw new Error("Handoff invitation token is invalid.");
  }

  return normalized;
}

export async function hashHandoffToken(token: string): Promise<string> {
  const value = new TextEncoder().encode(requireSecureHandoffToken(token));
  const digest = await crypto.subtle.digest("SHA-256", value);

  return [...new Uint8Array(digest)]
    .map((byte) => byte.toString(16).padStart(2, "0"))
    .join("");
}

const HANDOFF_FIELD_LABELS: Record<string, string> = {
  aliases: "Aliases",
  tags: "Tags",
  genres: "Genres",
  headline: "Headline",
  bio: "Bio",
  about: "About",
  outboundLinks: "Links",
  region: "Region",
  timezone: "Timezone",
  "person.pronouns": "Pronouns",
  "person.roleTags": "Roles",
};

const CONCIERGE_PROFILE_FIELD_KEYS = [
  "aliases",
  "tags",
  "genres",
  "headline",
  "bio",
  "about",
  "outboundLinks",
  "region",
  "timezone",
  "person.pronouns",
  "person.roleTags",
] as const;

export function projectHandoffPreviewField(
  field: Doc<"seedImportCandidateFields">,
) {
  if (!isHandoffFieldAvailable(field)) {
    return null;
  }

  try {
    const normalized = normalizeSafePrivateSeedFieldValue(field.fieldKey, field.value);

    if (field.fieldKey === "outboundLinks") {
      // Through the sanitizer the write uses, not the raw seed value. The two
      // disagree: normalization drops a link whose host no longer matches its
      // provider and rewrites a VRCDN operator panel URL to the public page. A
      // preview built from the raw list showed the owner links that the accept
      // would then discard, so they confirmed one profile and got another --
      // and showed them an operator preview URL that is not theirs to be handed.
      //
      // Provenance does not affect which links survive, so the stamp passed
      // here is immaterial; the accept path decides the stored one from the
      // batch's source type.
      const previewLinks = sanitizeProfileLinksLeniently(normalized, "partner_provided").links.map(
        (link) => ({ label: link.label, url: link.url }),
      );
      // Nothing survived, so there is no field to offer. Listing it as "0
      // prepared links" would invite the owner to confirm an empty write.
      if (previewLinks.length === 0) {
        return null;
      }

      const singleLink = previewLinks.length === 1 ? previewLinks[0] : undefined;

      return {
        id: field._id,
        label: singleLink?.label ?? HANDOFF_FIELD_LABELS[field.fieldKey] ?? "Link",
        value: singleLink?.label ?? `${previewLinks.length} prepared links`,
        kind: singleLink === undefined ? ("link_list" as const) : ("link" as const),
        ...(singleLink !== undefined ? { url: singleLink.url } : {}),
        ...(singleLink === undefined ? { links: previewLinks } : {}),
        selectedByDefault: true,
      };
    }

    if (Array.isArray(normalized)) {
      return {
        id: field._id,
        label: HANDOFF_FIELD_LABELS[field.fieldKey] ?? "Profile field",
        value: normalized.join(", "),
        kind: "list" as const,
        selectedByDefault: true,
      };
    }

    return {
      id: field._id,
      label: HANDOFF_FIELD_LABELS[field.fieldKey] ?? "Profile field",
      value: String(normalized),
      kind: "text" as const,
      selectedByDefault: true,
    };
  } catch {
    return null;
  }
}

export function isHandoffFieldAvailable(
  field: Pick<Doc<"seedImportCandidateFields">, "reviewState">,
): boolean {
  return field.reviewState !== "rejected" && field.reviewState !== "needs_correction";
}

export function isHandoffBatchAvailable(
  batch: Pick<Doc<"seedImportBatches">, "reviewState"> | null,
): boolean {
  return batch !== null && batch.reviewState !== "rejected" && batch.reviewState !== "superseded";
}

export function selectHandoffFields(
  offeredFields: Doc<"seedImportCandidateFields">[],
  selectedFieldIds: Id<"seedImportCandidateFields">[],
) {
  const selectedIds = new Set(selectedFieldIds);
  if (selectedIds.size !== selectedFieldIds.length) {
    throw new Error("Selected handoff field ids must be unique.");
  }

  const fieldsById = new Map(offeredFields.map((field) => [field._id, field]));
  const selectedFields = selectedFieldIds.map((fieldId) => {
    const field = fieldsById.get(fieldId);
    if (field === undefined) {
      throw new Error("A selected field is not offered by this invitation.");
    }
    return field;
  });

  for (const field of selectedFields) {
    if (!isHandoffFieldAvailable(field)) {
      throw new Error("A selected handoff field is no longer available.");
    }
    normalizeSafePrivateSeedFieldValue(field.fieldKey, field.value);
  }

  return selectedFields;
}

function genreSlug(value: string): string {
  return value
    .normalize("NFKD")
    .replace(/[\u0300-\u036f]/g, "")
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "") || "genre";
}

/**
 * Genre provenance for a seed source. Only a concierge handoff, where the owner
 * confirmed the fields themselves, may claim `owner_selected`.
 */
function genreSourceForSeedSource(
  sourceType: Doc<"seedImportBatches">["sourceType"] | undefined,
): NonNullable<PersonProfile["genres"]>[number]["source"] {
  switch (sourceType) {
    case undefined:
      return "owner_selected";
    case "partner":
      return "partner_import";
    case "community":
      return "community_submitted";
    default:
      return "manual_review";
  }
}

/**
 * Genre confidence for a converted field.
 *
 * Concierge handoffs keep `high`: the owner just confirmed those fields.
 * Publication carries the field's reviewed confidence through instead of
 * flattening it, mapping `owner_confirmed` down to `high` since an unclaimed
 * imported profile cannot claim owner confirmation.
 */
function genreConfidenceForSeedField(
  fieldConfidence: Doc<"seedImportCandidateFields">["confidence"],
  sourceType: Doc<"seedImportBatches">["sourceType"] | undefined,
): NonNullable<PersonProfile["genres"]>[number]["confidence"] {
  if (sourceType === undefined) {
    return "high";
  }

  switch (fieldConfidence) {
    case "low":
      return "low";
    case "high":
    case "owner_confirmed":
      return "high";
    default:
      return "medium";
  }
}

function linkSourceForSeedSource(
  sourceType: Doc<"seedImportBatches">["sourceType"] | undefined,
): NonNullable<PersonProfile["outboundLinks"]>[number]["source"] {
  switch (sourceType) {
    case undefined:
    case "partner":
      return "partner_provided";
    default:
      return "reviewed";
  }
}

function visibilityKeyForSeedField(fieldKey: string) {
  if (fieldKey === "person.pronouns") {
    return "personPronouns" as const;
  }
  if (fieldKey === "person.roleTags") {
    return "personRoleTags" as const;
  }
  return fieldKey as keyof NonNullable<PersonProfile["fieldVisibility"]>;
}

export type SeedFieldPatchOptions = {
  /**
   * `private` forces every copied field private, which is the concierge handoff
   * contract: a prepared profile must reveal nothing until its owner decides.
   * `reviewed` honors each field's reviewed `visibility`, which is what
   * publication needs — forcing private there would publish an empty profile.
   */
  fieldVisibilitySource?: "private" | "reviewed";
  /**
   * Whether supported fields absent from `fields` are cleared on an existing
   * profile. True is the concierge contract (the accepted selection is the whole
   * truth). Publication must not clear, or merging a candidate into an existing
   * profile erases content the import never proposed to replace.
   */
  clearUnselectedFields?: boolean;
  /**
   * Provenance stamped on converted genres and links. The concierge default
   * (`owner_selected` / `partner_provided`) describes a profile its owner just
   * confirmed. Publication of an unclaimed imported profile must not claim owner
   * selection, so it derives provenance from the batch's source type instead.
   */
  sourceType?: Doc<"seedImportBatches">["sourceType"];
  /**
   * Optional accumulator for what link normalization discarded.
   *
   * An out-parameter rather than a second return value because every call site
   * spreads the patch straight into a `db.patch`, and the counts are not profile
   * fields. Publication previews and the re-derivation migration read it so a
   * dropped link is reported rather than noticed later on a live profile.
   */
  linkStats?: SeedFieldPatchLinkStats;
};

export type SeedFieldPatchLinkStats = {
  droppedCount: number;
  deduplicatedCount: number;
};

export function buildConciergeProfileFieldPatch(
  fields: Doc<"seedImportCandidateFields">[],
  profile?: PersonProfile,
  options?: SeedFieldPatchOptions,
): Partial<PersonProfile> {
  const fieldVisibilitySource = options?.fieldVisibilitySource ?? "private";
  const clearUnselectedFields = options?.clearUnselectedFields ?? profile !== undefined;
  const genreSource = genreSourceForSeedSource(options?.sourceType);
  const linkSource = linkSourceForSeedSource(options?.sourceType);
  const patch: Partial<PersonProfile> = {};
  const fieldVisibility: NonNullable<PersonProfile["fieldVisibility"]> = {
    ...(profile?.fieldVisibility ?? {}),
  };
  let person = profile?.person ?? { roleTags: [] };
  let personChanged = false;
  const selectedFieldKeys = new Set(fields.map((field) => field.fieldKey));

  for (const fieldKey of clearUnselectedFields ? CONCIERGE_PROFILE_FIELD_KEYS : []) {
    if (selectedFieldKeys.has(fieldKey)) {
      continue;
    }

    delete fieldVisibility[visibilityKeyForSeedField(fieldKey)];

    switch (fieldKey) {
      case "aliases":
        patch.aliases = [];
        patch.searchAliases = [];
        break;
      case "tags":
        patch.tags = [];
        break;
      case "genres":
        patch.genres = [];
        break;
      case "headline":
        patch.headline = undefined;
        break;
      case "bio":
        patch.bio = undefined;
        break;
      case "about":
        patch.about = undefined;
        break;
      case "outboundLinks":
        patch.outboundLinks = [];
        break;
      case "region":
        patch.region = undefined;
        break;
      case "timezone":
        patch.timezone = undefined;
        break;
      case "person.pronouns": {
        const nextPerson = { ...person };
        delete nextPerson.pronouns;
        person = nextPerson;
        personChanged = true;
        break;
      }
      case "person.roleTags":
        person = { ...person, roleTags: [] };
        personChanged = true;
        break;
    }
  }

  for (const field of fields) {
    const value = normalizeSafePrivateSeedFieldValue(field.fieldKey, field.value);
    fieldVisibility[visibilityKeyForSeedField(field.fieldKey)] =
      fieldVisibilitySource === "private" ? "private" : field.visibility;

    switch (field.fieldKey) {
      case "aliases":
        patch.aliases = value as string[];
        // Only cleared under concierge semantics, where the accepted selection is
        // the whole profile. Publication must not wipe search-only handles and old
        // spellings that the import never proposed to replace.
        if (profile !== undefined && clearUnselectedFields) {
          patch.searchAliases = [];
        }
        break;
      case "tags":
        patch.tags = value as string[];
        break;
      case "genres":
        patch.genres = (value as string[]).map((displayName) => ({
          slug: genreSlug(displayName),
          displayName,
          source: genreSource,
          confidence: genreConfidenceForSeedField(field.confidence, options?.sourceType),
          explicit: false,
        }));
        break;
      case "headline":
      case "bio":
      case "about":
      case "region":
      case "timezone":
        patch[field.fieldKey] = value as string;
        break;
      case "outboundLinks": {
        // Through the same normalizer every other writer uses, rather than
        // copied across as stored. The seed lane validated links as plain URLs,
        // so it carried whatever the export held -- including VRCDN operator
        // panel preview URLs, which are not a link to put on a public profile.
        // Canonicalizing here collapses those onto the public vrcdn.live page
        // and applies the provider host checks the import never ran.
        const sanitized = sanitizeProfileLinksLeniently(value, linkSource);

        if (options?.linkStats !== undefined) {
          options.linkStats.droppedCount += sanitized.droppedCount;
          options.linkStats.deduplicatedCount += sanitized.deduplicatedCount;
        }

        // Normalization discarding everything is not an instruction to delete.
        // A merge or a re-derivation writes onto a profile that already exists,
        // and a seed field whose every entry failed the provider-host checks
        // would have patched `outboundLinks: []` over that profile's real links
        // -- destroying live data to carry across nothing, while the run reported
        // only that some seed rows had dropped. The counts still say it happened;
        // the profile keeps what it had.
        //
        // A create is unaffected: there is nothing to preserve, and `[]` is what
        // the profile would get anyway.
        if (sanitized.links.length > 0 || (profile?.outboundLinks?.length ?? 0) === 0) {
          patch.outboundLinks = sanitized.links;
        }

        break;
      }
      case "person.pronouns":
        person = { ...person, pronouns: value as string };
        personChanged = true;
        break;
      case "person.roleTags":
        person = { ...person, roleTags: value as string[] };
        personChanged = true;
        break;
    }
  }

  if (personChanged) {
    patch.person = person;
  }
  patch.fieldVisibility = fieldVisibility;

  return patch;
}
