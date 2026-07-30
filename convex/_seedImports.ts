import type { Doc, Id } from "./_generated/dataModel";
import type { DatabaseWriter } from "./_generated/server";
import type { AuthSubject } from "./_communityAuthority";
import {
  PROFILE_ALIAS_MAX_COUNT,
  PROFILE_ALIAS_MAX_LENGTH,
  PROFILE_DISPLAY_NAME_MAX_LENGTH,
  PROFILE_DISPLAY_NAME_MIN_LENGTH,
  PROFILE_SUBTYPE_MAX_LENGTH,
  PROFILE_TAG_MAX_COUNT,
  PROFILE_TAG_MAX_LENGTH,
} from "./_profileSubmissions";
import {
  PROFILE_BIO_MAX_LENGTH,
  PROFILE_HEADLINE_MAX_LENGTH,
  PROFILE_PERSON_PRONOUNS_MAX_LENGTH,
  PROFILE_REGION_MAX_LENGTH,
  PROFILE_TIMEZONE_MAX_LENGTH,
} from "./_profileUpdates";

export type SeedImportFixture = {
  batchId: string;
  sourceName: string;
  sourceType: SeedImportSourceType;
  sourceContact?: string;
  receivedAt: string;
  sourceObservedAt?: string;
  publicationPolicy?: "private_only" | "reviewed_publication_allowed";
  reviewState?: SeedImportBatchReviewState;
  notes?: string;
  candidates: SeedImportFixtureCandidate[];
};

export type SeedImportFixtureCandidate = {
  candidateId: string;
  profileType: "person" | "community";
  proposedDisplayName: string;
  proposedSlug?: string;
  publicationState?: SeedImportCandidatePublicationState;
  claimState?: SeedImportClaimState;
  matchedProfileId?: Id<"profiles">;
  fields: SeedImportFixtureField[];
};

export type SeedImportFixtureField = {
  fieldKey: string;
  value: unknown;
  sourceLabel: string;
  sourceUrl?: string;
  sourceType: SeedImportSourceType;
  sourceObservedAt?: string;
  lastCheckedAt?: string;
  confidence: SeedImportFieldConfidence;
  reviewState?: SeedImportFieldReviewState;
  visibility: SeedImportFieldVisibility;
};

export type PermissionedSeedImport = {
  permissioned: true;
  batchId: string;
  sourceName: string;
  sourceType: "partner" | "manual" | "import";
  sourceContact?: string;
  receivedAt: string;
  sourceObservedAt?: string;
  candidates: Array<{
    candidateId: string;
    proposedDisplayName: string;
    proposedSlug?: string;
    fields: Array<{
      fieldKey: string;
      value: unknown;
      sourceLabel: string;
      sourceUrl?: string;
      sourceType: "partner" | "manual" | "import";
      sourceObservedAt?: string;
      lastCheckedAt?: string;
      confidence: "low" | "medium" | "high";
      visibility: SeedImportFieldVisibility;
    }>;
  }>;
};

type SeedImportSourceType = "partner" | "manual" | "import" | "community" | "moderator";
type SeedImportBatchReviewState = "draft" | "ready_for_review" | "approved" | "rejected" | "superseded";
type SeedImportCandidateReviewState = "unreviewed" | "accepted" | "rejected" | "needs_correction";
type SeedImportCandidatePublicationState =
  | "draft_private"
  | "review_pending"
  | "published_unclaimed"
  | "rejected"
  | "suppressed";
type SeedImportClaimState = "unclaimed" | "claimed_unverified" | "claimed_verified";
type SeedImportFieldConfidence = "low" | "medium" | "high" | "owner_confirmed";
type SeedImportFieldReviewState = "unreviewed" | "accepted" | "rejected" | "needs_correction";
type SeedImportFieldVisibility = "public" | "unlisted" | "private";

export type NormalizedSeedImport = {
  externalBatchId: string;
  sourceName: string;
  sourceType: SeedImportSourceType;
  sourceContact?: string;
  receivedAt: number;
  sourceObservedAt?: number;
  publicationPolicy: "private_only" | "reviewed_publication_allowed";
  reviewState: SeedImportBatchReviewState;
  notes?: string;
  candidates: NormalizedSeedImportCandidate[];
};

export type NormalizedSeedImportCandidate = {
  externalCandidateId: string;
  profileType: "person" | "community";
  proposedDisplayName: string;
  proposedSlug?: string;
  reviewState: "unreviewed";
  publicationState: SeedImportCandidatePublicationState;
  claimState: SeedImportClaimState;
  matchedProfileId?: Id<"profiles">;
  fields: NormalizedSeedImportField[];
};

type NormalizedSeedImportField = {
  fieldKey: string;
  value: unknown;
  sourceLabel: string;
  sourceUrl?: string;
  sourceType: SeedImportSourceType;
  sourceObservedAt?: number;
  lastCheckedAt?: number;
  confidence: SeedImportFieldConfidence;
  reviewState: SeedImportFieldReviewState;
  visibility: SeedImportFieldVisibility;
};

export type SeedImportPublicationBlocker =
  | "source_private_only"
  | "batch_not_approved"
  | "candidate_not_accepted"
  | "candidate_not_pending_publication"
  | "candidate_already_queued_for_publication"
  | "candidate_rejected_or_suppressed"
  | "candidate_claim_not_unclaimed"
  | "invalid_proposed_slug"
  | "matched_profile_claimed"
  | "matched_profile_not_publicly_surfaceable"
  | "suppression_request_blocks_publication"
  | "slug_collision_blocks_publication"
  | "field_unreviewed"
  | "field_needs_correction"
  | "owner_confirmed_field_without_claim"
  | "unsafe_public_field"
  | "candidate_not_queued_for_publication"
  | "candidate_profile_type_unsupported"
  | "matched_profile_type_mismatch"
  | "field_exceeds_public_profile_limits"
  | "display_name_outside_public_limits"
  | "live_handoff_invitation_blocks_publication";

type SeedImportPublicationCandidate = Pick<
  Doc<"seedImportCandidateProfiles">,
  "reviewState" | "publicationState" | "claimState" | "matchedProfileId" | "proposedSlug"
> & {
  proposedDisplayName?: string;
  profileType?: Doc<"seedImportCandidateProfiles">["profileType"];
};

type SeedImportPublicationField = Pick<
  Doc<"seedImportCandidateFields">,
  "fieldKey" | "value" | "sourceUrl" | "confidence" | "reviewState" | "visibility"
>;

type SeedImportPublicationProfile = Pick<
  Doc<"profiles">,
  "_id" | "claimState" | "publicSurfacingState"
>;

type SeedImportFixtureWriter = Pick<DatabaseWriter, "insert">;

const SAFE_PUBLIC_IMPORT_FIELD_KEYS = new Set([
  "aliases",
  "tags",
  "genres",
  "headline",
  "bio",
  "about",
  "region",
  "timezone",
  "outboundLinks",
  "person.pronouns",
  "person.roleTags",
  "community.subtype",
  "community.categoryTags",
]);

export const FAKE_SEED_IMPORT_FIXTURE_KEY = "example_partner_directory_2026_001";

export const FAKE_SEED_IMPORT_FIXTURES: Record<string, SeedImportFixture> = {
  [FAKE_SEED_IMPORT_FIXTURE_KEY]: {
    batchId: "seed_fake_2026_001",
    sourceName: "Example Partner Directory",
    sourceType: "partner",
    sourceContact: "example-fixture-owner@vrdex.invalid",
    receivedAt: "2026-06-01T00:00:00.000Z",
    reviewState: "draft",
    notes: "Fake fixture for reviewed seed-import workflow tests.",
    candidates: [
      {
        candidateId: "candidate_fake_dj_001",
        profileType: "person",
        proposedDisplayName: "DJ Example",
        proposedSlug: "dj-example",
        publicationState: "draft_private",
        claimState: "unclaimed",
        fields: [
          {
            fieldKey: "person.roleTags",
            value: ["DJ", "Host"],
            sourceLabel: "Example Partner Directory",
            sourceType: "partner",
            confidence: "medium",
            reviewState: "unreviewed",
            visibility: "public",
          },
          {
            fieldKey: "outboundLinks",
            value: [
              {
                type: "website",
                label: "DJ Example",
                url: "https://example.invalid/dj-example",
              },
            ],
            sourceLabel: "Example Partner Directory",
            sourceUrl: "https://example.invalid/directory/dj-example",
            sourceType: "partner",
            confidence: "medium",
            reviewState: "unreviewed",
            visibility: "public",
          },
        ],
      },
      {
        candidateId: "candidate_fake_community_001",
        profileType: "community",
        proposedDisplayName: "Example Social Club",
        proposedSlug: "example-social-club",
        publicationState: "draft_private",
        claimState: "unclaimed",
        fields: [
          {
            fieldKey: "community.categoryTags",
            value: ["Events", "Music"],
            sourceLabel: "Example Partner Directory",
            sourceType: "partner",
            confidence: "medium",
            reviewState: "unreviewed",
            visibility: "public",
          },
          {
            fieldKey: "bio",
            value: "A fake community fixture used for reviewed import tests.",
            sourceLabel: "Example Partner Directory",
            sourceUrl: "https://example.invalid/directory/example-social-club",
            sourceType: "partner",
            confidence: "medium",
            reviewState: "unreviewed",
            visibility: "public",
          },
        ],
      },
    ],
  },
};

function optionalRecord<T>(key: string, value: T | undefined): Record<string, T> {
  return value === undefined ? {} : { [key]: value };
}

function normalizeInlineText(value: string, fieldName: string, maxLength: number): string {
  const normalized = value.trim().replace(/\s+/g, " ");

  if (!normalized) {
    throw new Error(`${fieldName} is required.`);
  }

  return normalized.slice(0, maxLength);
}

function optionalInlineText(value: string | undefined, fieldName: string, maxLength: number): string | undefined {
  if (value === undefined) {
    return undefined;
  }

  const normalized = value.trim().replace(/\s+/g, " ");

  if (!normalized) {
    return undefined;
  }

  return normalizeInlineText(normalized, fieldName, maxLength);
}

function parseIsoTimestamp(value: string, fieldName: string): number {
  const timestamp = Date.parse(value);

  if (!Number.isFinite(timestamp)) {
    throw new Error(`${fieldName} must be an ISO timestamp.`);
  }

  return timestamp;
}

function parseNonFutureIsoTimestamp(
  value: string,
  fieldName: string,
  now: number,
): number {
  const timestamp = parseIsoTimestamp(value, fieldName);

  if (timestamp > now) {
    throw new Error(`${fieldName} cannot be in the future.`);
  }

  return timestamp;
}

function isHttpsUrl(value: string): boolean {
  try {
    return new URL(value).protocol === "https:";
  } catch {
    return false;
  }
}

function requireHttpsUrl(value: string | undefined, fieldName: string): string | undefined {
  if (value === undefined) {
    return undefined;
  }

  const normalized = value.trim();

  if (!isHttpsUrl(normalized)) {
    throw new Error(`${fieldName} must be an HTTPS URL.`);
  }

  return normalized.slice(0, 2_048);
}

function isFakeFixtureUrl(value: string): boolean {
  try {
    const url = new URL(value);

    return url.protocol === "https:" && (url.hostname === "example.invalid" || url.hostname.endsWith(".invalid"));
  } catch {
    return false;
  }
}

function collectUrlStrings(value: unknown): string[] {
  if (Array.isArray(value)) {
    return value.flatMap((entry) => collectUrlStrings(entry));
  }

  if (value !== null && typeof value === "object") {
    return Object.entries(value).flatMap(([key, entry]) => {
      if (key.toLowerCase().includes("url") && typeof entry === "string") {
        return [entry];
      }

      return collectUrlStrings(entry);
    });
  }

  return [];
}

const SAFE_PERMISSIONED_FIELD_KEYS = new Set([
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
]);

const PROFILE_LINK_TYPES = new Set([
  "vrchat_profile",
  "vrcdn",
  "discord",
  "soundcloud",
  "mixcloud",
  "twitch",
  "youtube",
  "spotify",
  "bandcamp",
  "instagram",
  "linktree",
  "website",
  "gumroad",
  "jinxxy",
  "payhip",
  "woocommerce",
  "kofi",
  "patreon",
  "commissions",
  "generic_store",
  "other",
]);

function requireRecord(value: unknown, fieldName: string): Record<string, unknown> {
  if (value === null || typeof value !== "object" || Array.isArray(value)) {
    throw new Error(`${fieldName} must be an object.`);
  }

  return value as Record<string, unknown>;
}

function assertOnlyKeys(
  value: Record<string, unknown>,
  allowedKeys: string[],
  fieldName: string,
): void {
  const allowed = new Set(allowedKeys);
  const unexpected = Object.keys(value).find((key) => !allowed.has(key));

  if (unexpected !== undefined) {
    throw new Error(`${fieldName} contains unsupported key "${unexpected}".`);
  }
}

function requireStringValue(value: unknown, fieldName: string): string {
  if (typeof value !== "string") {
    throw new Error(`${fieldName} must be a string.`);
  }

  return value;
}

function optionalStringValue(value: unknown, fieldName: string): string | undefined {
  return value === undefined ? undefined : requireStringValue(value, fieldName);
}

function requireArrayValue(value: unknown, fieldName: string): unknown[] {
  if (!Array.isArray(value)) {
    throw new Error(`${fieldName} must be an array.`);
  }

  return value;
}

function normalizeSeedTextList(
  value: unknown,
  fieldName: string,
  maxItems: number,
  maxLength: number,
): string[] {
  const values = requireArrayValue(value, fieldName);

  if (values.length > maxItems) {
    throw new Error(`${fieldName} can include at most ${maxItems} values.`);
  }

  const normalized = values.map((item) =>
    normalizeInlineText(requireStringValue(item, `${fieldName} value`), fieldName, maxLength),
  );

  return [...new Map(normalized.map((item) => [item.toLowerCase(), item])).values()];
}

function normalizeSeedOutboundLinks(value: unknown): Array<Record<string, unknown>> {
  const links = requireArrayValue(value, "Outbound links");

  if (links.length > 20) {
    throw new Error("Outbound links can include at most 20 values.");
  }

  return links.map((entry, index) => {
    const link = requireRecord(entry, `Outbound link ${index + 1}`);
    assertOnlyKeys(
      link,
      ["type", "label", "url", "handle", "presentation"],
      `Outbound link ${index + 1}`,
    );
    const type = requireStringValue(link.type, "Outbound link type");
    const url = requireHttpsUrl(
      requireStringValue(link.url, "Outbound link URL"),
      "Outbound link URL",
    );

    if (!PROFILE_LINK_TYPES.has(type)) {
      throw new Error(`Unsupported outbound link type "${type}".`);
    }

    const parsedUrl = new URL(url!);
    if (parsedUrl.username || parsedUrl.password) {
      throw new Error("Outbound links must not contain embedded credentials.");
    }

    const handle = optionalInlineText(
      optionalStringValue(link.handle, "Outbound link handle"),
      "Outbound link handle",
      160,
    );
    const presentation = optionalStringValue(
      link.presentation,
      "Outbound link presentation",
    );

    if (presentation !== undefined && presentation !== "icon" && presentation !== "copy") {
      throw new Error("Outbound link presentation must be icon or copy.");
    }

    return {
      type,
      label: normalizeInlineText(
        requireStringValue(link.label, "Outbound link label"),
        "Outbound link label",
        120,
      ),
      url,
      ...optionalRecord("handle", handle),
      ...optionalRecord("presentation", presentation),
    };
  });
}

export function normalizeSafePrivateSeedFieldValue(
  fieldKey: string,
  value: unknown,
): unknown {
  if (!SAFE_PERMISSIONED_FIELD_KEYS.has(fieldKey)) {
    throw new Error(`Unsupported permissioned seed field "${fieldKey}".`);
  }

  if (["aliases", "tags", "genres", "person.roleTags"].includes(fieldKey)) {
    return normalizeSeedTextList(value, fieldKey, 20, 80);
  }

  if (fieldKey === "outboundLinks") {
    return normalizeSeedOutboundLinks(value);
  }

  return normalizeInlineText(
    requireStringValue(value, `${fieldKey} value`),
    fieldKey,
    fieldKey === "bio" || fieldKey === "about" ? 4_000 : 240,
  );
}

function normalizePermissionedField(
  value: unknown,
  batchSourceType: "partner" | "manual" | "import",
  now: number,
): NormalizedSeedImportField {
  const field = requireRecord(value, "Seed candidate field");
  assertOnlyKeys(
    field,
    [
      "fieldKey",
      "value",
      "sourceLabel",
      "sourceUrl",
      "sourceType",
      "sourceObservedAt",
      "lastCheckedAt",
      "confidence",
      "visibility",
    ],
    "Seed candidate field",
  );
  const fieldKey = normalizeInlineText(
    requireStringValue(field.fieldKey, "Field key"),
    "Field key",
    120,
  );
  const sourceType = requireStringValue(field.sourceType, "Field source type");

  if (sourceType !== batchSourceType) {
    throw new Error("Field sourceType must match the batch sourceType.");
  }

  const confidence = requireStringValue(field.confidence, "Field confidence");
  if (confidence !== "low" && confidence !== "medium" && confidence !== "high") {
    throw new Error("Real imports cannot create owner-confirmed fields.");
  }

  const visibility = requireStringValue(field.visibility, "Field visibility");
  if (visibility !== "public" && visibility !== "unlisted" && visibility !== "private") {
    throw new Error("Unsupported field visibility.");
  }

  const sourceObservedAt = optionalStringValue(
    field.sourceObservedAt,
    "Field sourceObservedAt",
  );
  const lastCheckedAt = optionalStringValue(field.lastCheckedAt, "Field lastCheckedAt");

  return {
    fieldKey,
    value: normalizeSafePrivateSeedFieldValue(fieldKey, field.value),
    sourceLabel: normalizeInlineText(
      requireStringValue(field.sourceLabel, "Field source label"),
      "Field source label",
      160,
    ),
    ...optionalRecord(
      "sourceUrl",
      requireHttpsUrl(
        optionalStringValue(field.sourceUrl, "Field source URL"),
        "Field source URL",
      ),
    ),
    sourceType: batchSourceType,
    ...optionalRecord(
      "sourceObservedAt",
      sourceObservedAt === undefined
        ? undefined
        : parseNonFutureIsoTimestamp(sourceObservedAt, "Field sourceObservedAt", now),
    ),
    ...optionalRecord(
      "lastCheckedAt",
      lastCheckedAt === undefined
        ? undefined
        : parseNonFutureIsoTimestamp(lastCheckedAt, "Field lastCheckedAt", now),
    ),
    confidence,
    reviewState: "unreviewed",
    visibility,
  };
}

export function normalizePermissionedSeedImport(
  input: unknown,
  now = Date.now(),
): NormalizedSeedImport {
  const value = requireRecord(input, "Permissioned seed import");
  assertOnlyKeys(
    value,
    [
      "permissioned",
      "batchId",
      "sourceName",
      "sourceType",
      "sourceContact",
      "receivedAt",
      "sourceObservedAt",
      "candidates",
    ],
    "Permissioned seed import",
  );

  if (value.permissioned !== true) {
    throw new Error("Permissioned seed imports require permissioned: true.");
  }

  const sourceType = requireStringValue(value.sourceType, "Source type");
  if (sourceType !== "partner" && sourceType !== "manual" && sourceType !== "import") {
    throw new Error("Permissioned JSON imports support partner, manual, or import sources.");
  }

  const candidates = requireArrayValue(value.candidates, "Seed candidates");
  if (candidates.length === 0 || candidates.length > 5_000) {
    throw new Error("Permissioned seed imports require 1 to 5000 candidates.");
  }

  const candidateIds = new Set<string>();
  const normalizedCandidates = candidates.map((entry) => {
    const candidate = requireRecord(entry, "Seed candidate");
    assertOnlyKeys(
      candidate,
      ["candidateId", "proposedDisplayName", "proposedSlug", "fields"],
      "Seed candidate",
    );
    const externalCandidateId = normalizeInlineText(
      requireStringValue(candidate.candidateId, "Candidate id"),
      "Candidate id",
      160,
    );

    if (candidateIds.has(externalCandidateId)) {
      throw new Error(`Duplicate candidate id "${externalCandidateId}".`);
    }
    candidateIds.add(externalCandidateId);

    const fields = requireArrayValue(candidate.fields, "Candidate fields");
    if (fields.length === 0 || fields.length > 50) {
      throw new Error("Each seed candidate requires 1 to 50 fields.");
    }
    const fieldKeys = new Set<string>();
    const normalizedFields = fields.map((field) => {
      const normalized = normalizePermissionedField(field, sourceType, now);
      if (fieldKeys.has(normalized.fieldKey)) {
        throw new Error(`Duplicate field key "${normalized.fieldKey}".`);
      }
      fieldKeys.add(normalized.fieldKey);
      return normalized;
    });
    const proposedSlug = optionalInlineText(
      optionalStringValue(candidate.proposedSlug, "Proposed slug"),
      "Proposed slug",
      120,
    );

    return {
      externalCandidateId,
      profileType: "person" as const,
      proposedDisplayName: normalizeInlineText(
        requireStringValue(candidate.proposedDisplayName, "Proposed display name"),
        "Proposed display name",
        80,
      ),
      ...optionalRecord("proposedSlug", proposedSlug),
      reviewState: "unreviewed" as const,
      publicationState: "draft_private" as const,
      claimState: "unclaimed" as const,
      fields: normalizedFields,
    };
  });
  const receivedAt = requireStringValue(value.receivedAt, "Received at");
  const sourceObservedAt = optionalStringValue(value.sourceObservedAt, "Source observed at");
  const sourceContact = optionalInlineText(
    optionalStringValue(value.sourceContact, "Source contact"),
    "Source contact",
    160,
  );

  return {
    externalBatchId: normalizeInlineText(
      requireStringValue(value.batchId, "Batch id"),
      "Batch id",
      160,
    ),
    sourceName: normalizeInlineText(
      requireStringValue(value.sourceName, "Source name"),
      "Source name",
      160,
    ),
    sourceType,
    ...optionalRecord("sourceContact", sourceContact),
    receivedAt: parseNonFutureIsoTimestamp(receivedAt, "Received at", now),
    ...optionalRecord(
      "sourceObservedAt",
      sourceObservedAt === undefined
        ? undefined
        : parseNonFutureIsoTimestamp(sourceObservedAt, "Source observed at", now),
    ),
    publicationPolicy: "private_only",
    reviewState: "draft",
    candidates: normalizedCandidates,
  };
}

export function assertFakeSeedImportFixture(fixture: SeedImportFixture): void {
  if (!fixture.batchId.startsWith("seed_fake_")) {
    throw new Error("Seed import fixture batch ids must start with seed_fake_.");
  }

  for (const candidate of fixture.candidates) {
    if (!candidate.candidateId.startsWith("candidate_fake_")) {
      throw new Error("Seed import fixture candidate ids must start with candidate_fake_.");
    }

    for (const field of candidate.fields) {
      if (field.confidence === "owner_confirmed") {
        throw new Error("Fake seed import fixtures cannot create owner-confirmed fields.");
      }

      for (const url of [
        ...(field.sourceUrl !== undefined ? [field.sourceUrl] : []),
        ...collectUrlStrings(field.value),
      ]) {
        if (!isFakeFixtureUrl(url)) {
          throw new Error("Fake seed import fixtures may only contain HTTPS .invalid URLs.");
        }
      }
    }
  }
}

function normalizeFixtureField(field: SeedImportFixtureField): NormalizedSeedImportField {
  return {
    fieldKey: normalizeInlineText(field.fieldKey, "Field key", 120),
    value: field.value,
    sourceLabel: normalizeInlineText(field.sourceLabel, "Field source label", 160),
    ...optionalRecord("sourceUrl", requireHttpsUrl(field.sourceUrl, "Field source URL")),
    sourceType: field.sourceType,
    ...optionalRecord(
      "sourceObservedAt",
      field.sourceObservedAt === undefined
        ? undefined
        : parseIsoTimestamp(field.sourceObservedAt, "Field sourceObservedAt"),
    ),
    ...optionalRecord(
      "lastCheckedAt",
      field.lastCheckedAt === undefined
        ? undefined
        : parseIsoTimestamp(field.lastCheckedAt, "Field lastCheckedAt"),
    ),
    confidence: field.confidence,
    reviewState: field.reviewState ?? "unreviewed",
    visibility: field.visibility,
  };
}

function normalizeFixtureCandidate(candidate: SeedImportFixtureCandidate): NormalizedSeedImportCandidate {
  const proposedSlug = optionalInlineText(candidate.proposedSlug, "Proposed slug", 120);

  return {
    externalCandidateId: normalizeInlineText(candidate.candidateId, "Candidate id", 160),
    profileType: candidate.profileType,
    proposedDisplayName: normalizeInlineText(candidate.proposedDisplayName, "Proposed display name", 160),
    ...optionalRecord("proposedSlug", proposedSlug),
    reviewState: "unreviewed" as const,
    publicationState: candidate.publicationState ?? "draft_private",
    claimState: candidate.claimState ?? "unclaimed",
    ...optionalRecord("matchedProfileId", candidate.matchedProfileId),
    fields: candidate.fields.map((field) => normalizeFixtureField(field)),
  };
}

export function normalizeSeedImportFixture(fixture: SeedImportFixture): NormalizedSeedImport {
  assertFakeSeedImportFixture(fixture);
  const sourceContact = optionalInlineText(fixture.sourceContact, "Source contact", 160);
  const notes = optionalInlineText(fixture.notes, "Import notes", 1_000);

  return {
    externalBatchId: normalizeInlineText(fixture.batchId, "Batch id", 160),
    sourceName: normalizeInlineText(fixture.sourceName, "Source name", 160),
    sourceType: fixture.sourceType,
    ...optionalRecord("sourceContact", sourceContact),
    receivedAt: parseIsoTimestamp(fixture.receivedAt, "Seed import fixture receivedAt"),
    ...optionalRecord(
      "sourceObservedAt",
      fixture.sourceObservedAt === undefined
        ? undefined
        : parseIsoTimestamp(fixture.sourceObservedAt, "Seed import fixture sourceObservedAt"),
    ),
    publicationPolicy: fixture.publicationPolicy ?? "reviewed_publication_allowed",
    reviewState: fixture.reviewState ?? "draft",
    ...optionalRecord("notes", notes),
    candidates: fixture.candidates.map((candidate) => normalizeFixtureCandidate(candidate)),
  };
}

export async function createSeedImportDocuments(
  db: SeedImportFixtureWriter,
  normalized: NormalizedSeedImport,
  options: { importedBy?: AuthSubject; now: number },
) {
  const batchId = await db.insert("seedImportBatches", {
    externalBatchId: normalized.externalBatchId,
    sourceName: normalized.sourceName,
    sourceType: normalized.sourceType,
    ...optionalRecord("sourceContact", normalized.sourceContact),
    receivedAt: normalized.receivedAt,
    ...optionalRecord("sourceObservedAt", normalized.sourceObservedAt),
    publicationPolicy: normalized.publicationPolicy,
    ...optionalRecord("importedBy", options.importedBy),
    reviewState: normalized.reviewState,
    ...optionalRecord("notes", normalized.notes),
    createdAt: options.now,
    updatedAt: options.now,
  });
  const candidates = await createSeedImportCandidateDocuments(
    db,
    batchId,
    normalized.candidates,
    options.now,
  );

  return {
    batchId,
    ...candidates,
  };
}

export async function seedImportCandidateFingerprint(
  candidate: NormalizedSeedImportCandidate,
): Promise<string> {
  const payload = JSON.stringify({
    externalCandidateId: candidate.externalCandidateId,
    profileType: candidate.profileType,
    proposedDisplayName: candidate.proposedDisplayName,
    proposedSlug: candidate.proposedSlug ?? null,
    fields: candidate.fields.map((field) => ({
      fieldKey: field.fieldKey,
      value: field.value,
      sourceLabel: field.sourceLabel,
      sourceUrl: field.sourceUrl ?? null,
      sourceType: field.sourceType,
      sourceObservedAt: field.sourceObservedAt ?? null,
      lastCheckedAt: field.lastCheckedAt ?? null,
      confidence: field.confidence,
      visibility: field.visibility,
    })),
  });
  const digest = await crypto.subtle.digest(
    "SHA-256",
    new TextEncoder().encode(payload),
  );

  return [...new Uint8Array(digest)]
    .map((byte) => byte.toString(16).padStart(2, "0"))
    .join("");
}

export async function createSeedImportCandidateDocuments(
  db: SeedImportFixtureWriter,
  batchId: Id<"seedImportBatches">,
  candidates: NormalizedSeedImportCandidate[],
  now: number,
) {
  const candidateIds: Id<"seedImportCandidateProfiles">[] = [];
  const fieldIds: Id<"seedImportCandidateFields">[] = [];

  for (const candidate of candidates) {
    const candidateId = await db.insert("seedImportCandidateProfiles", {
      batchId,
      externalCandidateId: candidate.externalCandidateId,
      importFingerprint: await seedImportCandidateFingerprint(candidate),
      profileType: candidate.profileType,
      proposedDisplayName: candidate.proposedDisplayName,
      ...optionalRecord("proposedSlug", candidate.proposedSlug),
      reviewState: candidate.reviewState,
      publicationState: candidate.publicationState,
      claimState: candidate.claimState,
      ...optionalRecord("matchedProfileId", candidate.matchedProfileId),
      createdAt: now,
      updatedAt: now,
    });

    candidateIds.push(candidateId);

    for (const field of candidate.fields) {
      fieldIds.push(
        await db.insert("seedImportCandidateFields", {
          candidateId,
          fieldKey: field.fieldKey,
          value: field.value,
          sourceLabel: field.sourceLabel,
          ...optionalRecord("sourceUrl", field.sourceUrl),
          sourceType: field.sourceType,
          ...optionalRecord("sourceObservedAt", field.sourceObservedAt),
          ...optionalRecord("lastCheckedAt", field.lastCheckedAt),
          confidence: field.confidence,
          reviewState: field.reviewState,
          visibility: field.visibility,
          createdAt: now,
          updatedAt: now,
        }),
      );
    }
  }

  return {
    candidateIds,
    fieldIds,
  };
}

export async function createSeedImportDocumentsFromFixture(
  db: SeedImportFixtureWriter,
  fixture: SeedImportFixture,
  options: { importedBy?: AuthSubject; now: number },
) {
  return await createSeedImportDocuments(
    db,
    normalizeSeedImportFixture(fixture),
    options,
  );
}

function hasSafeOutboundLinkValues(value: unknown): boolean {
  if (!Array.isArray(value)) {
    return false;
  }

  return value.every((entry) => {
    if (entry === null || typeof entry !== "object") {
      return false;
    }

    const url = (entry as { url?: unknown }).url;

    return typeof url === "string" && isHttpsUrl(url);
  });
}

export function isSafePublicSeedImportField(field: SeedImportPublicationField): boolean {
  if (!SAFE_PUBLIC_IMPORT_FIELD_KEYS.has(field.fieldKey)) {
    return false;
  }

  if (field.sourceUrl !== undefined && !isHttpsUrl(field.sourceUrl)) {
    return false;
  }

  if (field.fieldKey === "outboundLinks") {
    return hasSafeOutboundLinkValues(field.value);
  }

  return true;
}

/**
 * Whether a bulk publish run may accept this field on the operator's behalf.
 *
 * Only `unreviewed` qualifies. `rejected` and `needs_correction` record a real
 * review decision and must survive a bulk run, so trusting a source is never
 * the same as undoing a rejection.
 */
export function canBulkAcceptSeedImportField(
  reviewState: SeedImportFieldReviewState,
): boolean {
  return reviewState === "unreviewed";
}

/**
 * Whether a bulk publish run may accept this candidate on the operator's behalf.
 *
 * Mirrors `canBulkAcceptSeedImportField`: only `unreviewed` qualifies, so an
 * explicit `rejected` or `needs_correction` decision survives a bulk run.
 */
export function canBulkAcceptSeedImportCandidate(
  reviewState: SeedImportCandidateReviewState,
): boolean {
  return reviewState === "unreviewed";
}

/**
 * Whether a bulk publish run may approve this batch on the operator's behalf.
 *
 * `rejected` and `superseded` are review decisions, not initial workflow states,
 * so reversing them requires a deliberate `setBatchReviewState` call rather than
 * a side effect of bulk publishing.
 */
export function canBulkApproveSeedImportBatch(
  reviewState: SeedImportBatchReviewState,
): boolean {
  return reviewState === "draft" || reviewState === "ready_for_review" || reviewState === "approved";
}

const PUBLIC_LIST_FIELD_LIMITS: Record<string, { maxItems: number; maxLength: number }> = {
  aliases: { maxItems: PROFILE_ALIAS_MAX_COUNT, maxLength: PROFILE_ALIAS_MAX_LENGTH },
  tags: { maxItems: PROFILE_TAG_MAX_COUNT, maxLength: PROFILE_TAG_MAX_LENGTH },
  "person.roleTags": { maxItems: PROFILE_TAG_MAX_COUNT, maxLength: PROFILE_TAG_MAX_LENGTH },
  "community.categoryTags": { maxItems: PROFILE_TAG_MAX_COUNT, maxLength: PROFILE_TAG_MAX_LENGTH },
};

const PUBLIC_TEXT_FIELD_LIMITS: Record<string, number> = {
  headline: PROFILE_HEADLINE_MAX_LENGTH,
  bio: PROFILE_BIO_MAX_LENGTH,
  region: PROFILE_REGION_MAX_LENGTH,
  timezone: PROFILE_TIMEZONE_MAX_LENGTH,
  "person.pronouns": PROFILE_PERSON_PRONOUNS_MAX_LENGTH,
  "community.subtype": PROFILE_SUBTYPE_MAX_LENGTH,
};

/**
 * Whether an accepted field would exceed the bounds the rest of the app enforces
 * on public profiles.
 *
 * Private seed staging is deliberately more permissive than a public profile: it
 * accepts far longer text and longer lists so a source can be captured verbatim.
 * Writing those values straight onto a public profile would store data no public
 * editing path could ever produce.
 */
export function exceedsPublicProfileLimits(
  field: Pick<Doc<"seedImportCandidateFields">, "fieldKey" | "value">,
): boolean {
  const listLimits = PUBLIC_LIST_FIELD_LIMITS[field.fieldKey];

  if (listLimits !== undefined) {
    const values = Array.isArray(field.value) ? field.value : [];

    return (
      values.length > listLimits.maxItems ||
      values.some((value) => typeof value === "string" && value.trim().length > listLimits.maxLength)
    );
  }

  const textLimit = PUBLIC_TEXT_FIELD_LIMITS[field.fieldKey];

  if (textLimit !== undefined) {
    return typeof field.value === "string" && field.value.trim().length > textLimit;
  }

  return false;
}

/**
 * Whether the publication mapper can actually convert this field.
 *
 * `normalizeSafePrivateSeedFieldValue` is the same function the mapper calls, and
 * it throws on unsupported keys and malformed values — an `aliases` string instead
 * of an array, a link with an HTTPS URL but no label. Running it here turns those
 * into a blocker instead of an exception mid-page.
 */
export function isMappableSeedImportField(
  field: Pick<Doc<"seedImportCandidateFields">, "fieldKey" | "value">,
): boolean {
  try {
    normalizeSafePrivateSeedFieldValue(field.fieldKey, field.value);
    return true;
  } catch {
    return false;
  }
}

/**
 * Whether a proposed display name is outside the bounds the public profile paths
 * enforce. Seed normalization allows up to 160 characters and no minimum, so a
 * name valid in staging can be invalid as a public profile.
 */
export function displayNameOutsidePublicLimits(displayName: string): boolean {
  const normalized = displayName.trim();

  return (
    normalized.length < PROFILE_DISPLAY_NAME_MIN_LENGTH ||
    normalized.length > PROFILE_DISPLAY_NAME_MAX_LENGTH
  );
}

/**
 * Field-level review and safety gates.
 *
 * Shared by the queue-time and publish-time gates: field review states can change
 * between queueing and publishing, so consuming the queue has to re-run these or
 * a field moved back to `needs_correction` would simply be dropped and the
 * profile published anyway.
 */
export function getSeedImportFieldBlockers(
  fields: SeedImportPublicationField[],
): SeedImportPublicationBlocker[] {
  const blockers = new Set<SeedImportPublicationBlocker>();

  for (const field of fields) {
    if (field.reviewState === "unreviewed") {
      blockers.add("field_unreviewed");
    }

    if (field.reviewState === "needs_correction") {
      blockers.add("field_needs_correction");
    }

    if (field.reviewState === "accepted" && field.confidence === "owner_confirmed") {
      blockers.add("owner_confirmed_field_without_claim");
    }

    // Visibility is deliberately not part of this condition, and the mapper's own
    // normalization is run here rather than only checking key/URL shape. The mapper
    // throws for unsupported keys *and* malformed values at any visibility, and a
    // throw inside a bulk page rolls back every candidate in it instead of
    // reporting one blocker and continuing.
    if (
      field.reviewState === "accepted" &&
      (!isSafePublicSeedImportField(field) || !isMappableSeedImportField(field))
    ) {
      blockers.add("unsafe_public_field");
    }

    if (field.reviewState === "accepted" && exceedsPublicProfileLimits(field)) {
      blockers.add("field_exceeds_public_profile_limits");
    }
  }

  return [...blockers];
}

/**
 * Publish-time gates for a candidate that was already queued for publication.
 *
 * Distinct from `getSeedImportPublicationBlockers`, which gates the *queue*
 * step: that one rejects a candidate already in `published_unclaimed`, while
 * this one requires it. Policy, review state, and suppression requests are all
 * re-checked here because any of them can change between queue and publish.
 */
export function getSeedImportPublishBlockers(args: {
  batch: Pick<Doc<"seedImportBatches">, "publicationPolicy" | "reviewState">;
  candidate: SeedImportPublicationCandidate & Pick<Doc<"seedImportCandidateProfiles">, "profileType">;
  fields?: SeedImportPublicationField[];
  matchedProfile?: (SeedImportPublicationProfile & { profileType?: Doc<"profiles">["profileType"] }) | null;
  hasInvalidProposedSlug?: boolean;
  hasAcceptedSuppressionRequest?: boolean;
  hasLiveHandoffInvitation?: boolean;
  slugCollisionProfile?: SeedImportPublicationProfile | null;
}): SeedImportPublicationBlocker[] {
  const blockers = new Set<SeedImportPublicationBlocker>();

  if ((args.batch.publicationPolicy ?? "private_only") !== "reviewed_publication_allowed") {
    blockers.add("source_private_only");
  }

  if (args.batch.reviewState !== "approved") {
    blockers.add("batch_not_approved");
  }

  if (args.candidate.reviewState !== "accepted") {
    blockers.add("candidate_not_accepted");
  }

  if (args.candidate.publicationState !== "published_unclaimed") {
    blockers.add("candidate_not_queued_for_publication");
  }

  if (args.candidate.claimState !== "unclaimed") {
    blockers.add("candidate_claim_not_unclaimed");
  }

  // ponytail: person-only for this slice. Community candidates need a community
  // field mapper; they are skipped rather than half-published.
  if (args.candidate.profileType !== "person") {
    blockers.add("candidate_profile_type_unsupported");
  }

  if (args.hasInvalidProposedSlug === true) {
    blockers.add("invalid_proposed_slug");
  }

  if (args.matchedProfile !== null && args.matchedProfile !== undefined) {
    if (args.matchedProfile.claimState !== "unclaimed") {
      blockers.add("matched_profile_claimed");
    }

    // A person candidate matched to a community profile would feed a community
    // document to the person-only mapper and fail schema validation on write.
    if (
      args.matchedProfile.profileType !== undefined &&
      args.matchedProfile.profileType !== args.candidate.profileType
    ) {
      blockers.add("matched_profile_type_mismatch");
    }

    // Re-checked at publish time, not just at queue time: a merge resets
    // publicSurfacingState to public, so a profile opted out or suppressed after
    // queueing would have its explicit surfacing decision erased.
    if (args.matchedProfile.publicSurfacingState !== "public") {
      blockers.add("matched_profile_not_publicly_surfaceable");
    }
  }

  // Only when creating a new profile. A deliberate match merges into the matched
  // profile and keeps its existing slug, so the colliding slug is never written --
  // blocking there would strand the exact same-name case that
  // matchCandidateToProfile exists to resolve.
  if (
    (args.matchedProfile === null || args.matchedProfile === undefined) &&
    args.slugCollisionProfile !== null &&
    args.slugCollisionProfile !== undefined
  ) {
    blockers.add("slug_collision_blocks_publication");
  }

  if (args.hasAcceptedSuppressionRequest === true) {
    blockers.add("suppression_request_blocks_publication");
  }

  if (args.hasLiveHandoffInvitation === true) {
    blockers.add("live_handoff_invitation_blocks_publication");
  }

  // Create-only: a merge preserves the matched profile's existing displayName and
  // never writes the candidate's, so the public bound does not apply there.
  if (
    (args.matchedProfile === null || args.matchedProfile === undefined) &&
    args.candidate.proposedDisplayName !== undefined &&
    displayNameOutsidePublicLimits(args.candidate.proposedDisplayName)
  ) {
    blockers.add("display_name_outside_public_limits");
  }

  for (const blocker of getSeedImportFieldBlockers(args.fields ?? [])) {
    blockers.add(blocker);
  }

  return [...blockers];
}

export function getSeedImportPublicationBlockers(args: {
  batch: Pick<Doc<"seedImportBatches">, "publicationPolicy" | "reviewState">;
  candidate: SeedImportPublicationCandidate;
  fields: SeedImportPublicationField[];
  matchedProfile?: (SeedImportPublicationProfile & { profileType?: Doc<"profiles">["profileType"] }) | null;
  hasInvalidProposedSlug?: boolean;
  hasAcceptedSuppressionRequest?: boolean;
  hasLiveHandoffInvitation?: boolean;
  slugCollisionProfile?: SeedImportPublicationProfile | null;
}): SeedImportPublicationBlocker[] {
  const blockers = new Set<SeedImportPublicationBlocker>();

  // Fail closed on a missing policy, matching the publish gate. Rejecting only the
  // literal private_only would queue a legacy candidate — mutating it out of the
  // private review lookup — and then skip it at publish.
  if ((args.batch.publicationPolicy ?? "private_only") !== "reviewed_publication_allowed") {
    blockers.add("source_private_only");
  }

  if (args.batch.reviewState !== "approved") {
    blockers.add("batch_not_approved");
  }

  if (args.candidate.reviewState !== "accepted") {
    blockers.add("candidate_not_accepted");
  }

  if (args.candidate.publicationState === "published_unclaimed") {
    blockers.add("candidate_already_queued_for_publication");
  } else if (
    args.candidate.publicationState === "rejected" ||
    args.candidate.publicationState === "suppressed"
  ) {
    blockers.add("candidate_rejected_or_suppressed");
  } else if (args.candidate.publicationState !== "review_pending") {
    blockers.add("candidate_not_pending_publication");
  }

  if (args.candidate.claimState !== "unclaimed") {
    blockers.add("candidate_claim_not_unclaimed");
  }

  if (args.hasInvalidProposedSlug === true) {
    blockers.add("invalid_proposed_slug");
  }

  const matchedProfile = args.matchedProfile ?? args.slugCollisionProfile;
  if (matchedProfile !== null && matchedProfile !== undefined) {
    if (matchedProfile.claimState !== "unclaimed") {
      blockers.add("matched_profile_claimed");
    }

    if (matchedProfile.publicSurfacingState !== "public") {
      blockers.add("matched_profile_not_publicly_surfaceable");
    }
  }

  // Rejected before queueing, not only at publish: queueing mutates the candidate
  // out of the private review lookup, so a cross-type match would strand it there.
  if (
    args.matchedProfile !== null &&
    args.matchedProfile !== undefined &&
    args.matchedProfile.profileType !== undefined &&
    args.candidate.profileType !== undefined &&
    args.matchedProfile.profileType !== args.candidate.profileType
  ) {
    blockers.add("matched_profile_type_mismatch");
  }

  if (args.hasAcceptedSuppressionRequest === true) {
    blockers.add("suppression_request_blocks_publication");
  }

  if (args.hasLiveHandoffInvitation === true) {
    blockers.add("live_handoff_invitation_blocks_publication");
  }

  // Also checked here, not only at publish: queueing mutates the candidate's
  // publication state, so a community candidate would be moved out of the private
  // draft/review lookup and then merely skipped at publish.
  if (
    args.candidate.profileType !== undefined &&
    args.candidate.profileType !== "person"
  ) {
    blockers.add("candidate_profile_type_unsupported");
  }

  // Create-only: a merge preserves the matched profile's existing displayName and
  // never writes the candidate's, so the public bound does not apply there.
  if (
    (args.matchedProfile === null || args.matchedProfile === undefined) &&
    args.candidate.proposedDisplayName !== undefined &&
    displayNameOutsidePublicLimits(args.candidate.proposedDisplayName)
  ) {
    blockers.add("display_name_outside_public_limits");
  }

  // Create-only, matching the publish gate: a deliberate match merges into the
  // matched profile and keeps its slug, so the colliding slug is never written.
  if (
    (args.matchedProfile === null || args.matchedProfile === undefined) &&
    args.slugCollisionProfile !== null &&
    args.slugCollisionProfile !== undefined
  ) {
    blockers.add("slug_collision_blocks_publication");
  }

  for (const blocker of getSeedImportFieldBlockers(args.fields)) {
    blockers.add(blocker);
  }

  return [...blockers];
}

export function candidatePublicationStateForReviewState(
  reviewState: SeedImportCandidateReviewState,
): SeedImportCandidatePublicationState {
  if (reviewState === "accepted") {
    return "review_pending";
  }

  if (reviewState === "rejected") {
    return "rejected";
  }

  return "draft_private";
}
