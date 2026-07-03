import type { Doc, Id } from "./_generated/dataModel";
import type { DatabaseWriter } from "./_generated/server";
import type { AuthSubject } from "./_communityAuthority";

export type SeedImportFixture = {
  batchId: string;
  sourceName: string;
  sourceType: SeedImportSourceType;
  sourceContact?: string;
  receivedAt: string;
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
  confidence: SeedImportFieldConfidence;
  reviewState?: SeedImportFieldReviewState;
  visibility: SeedImportFieldVisibility;
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

type NormalizedSeedImportFixture = {
  externalBatchId: string;
  sourceName: string;
  sourceType: SeedImportSourceType;
  sourceContact?: string;
  receivedAt: number;
  reviewState: SeedImportBatchReviewState;
  notes?: string;
  candidates: NormalizedSeedImportCandidate[];
};

type NormalizedSeedImportCandidate = {
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
  confidence: SeedImportFieldConfidence;
  reviewState: SeedImportFieldReviewState;
  visibility: SeedImportFieldVisibility;
};

export type SeedImportPublicationBlocker =
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
  | "unsafe_public_field";

type SeedImportPublicationCandidate = Pick<
  Doc<"seedImportCandidateProfiles">,
  "reviewState" | "publicationState" | "claimState" | "matchedProfileId" | "proposedSlug"
>;

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

function parseFixtureReceivedAt(receivedAt: string): number {
  const timestamp = Date.parse(receivedAt);

  if (!Number.isFinite(timestamp)) {
    throw new Error("Seed import fixture receivedAt must be an ISO timestamp.");
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

export function normalizeSeedImportFixture(fixture: SeedImportFixture): NormalizedSeedImportFixture {
  assertFakeSeedImportFixture(fixture);
  const sourceContact = optionalInlineText(fixture.sourceContact, "Source contact", 160);
  const notes = optionalInlineText(fixture.notes, "Import notes", 1_000);

  return {
    externalBatchId: normalizeInlineText(fixture.batchId, "Batch id", 160),
    sourceName: normalizeInlineText(fixture.sourceName, "Source name", 160),
    sourceType: fixture.sourceType,
    ...optionalRecord("sourceContact", sourceContact),
    receivedAt: parseFixtureReceivedAt(fixture.receivedAt),
    reviewState: fixture.reviewState ?? "draft",
    ...optionalRecord("notes", notes),
    candidates: fixture.candidates.map((candidate) => normalizeFixtureCandidate(candidate)),
  };
}

export async function createSeedImportDocumentsFromFixture(
  db: SeedImportFixtureWriter,
  fixture: SeedImportFixture,
  options: { importedBy?: AuthSubject; now: number },
) {
  const normalized = normalizeSeedImportFixture(fixture);
  const batchId = await db.insert("seedImportBatches", {
    externalBatchId: normalized.externalBatchId,
    sourceName: normalized.sourceName,
    sourceType: normalized.sourceType,
    ...optionalRecord("sourceContact", normalized.sourceContact),
    receivedAt: normalized.receivedAt,
    ...optionalRecord("importedBy", options.importedBy),
    reviewState: normalized.reviewState,
    ...optionalRecord("notes", normalized.notes),
    createdAt: options.now,
    updatedAt: options.now,
  });
  const candidateIds: Id<"seedImportCandidateProfiles">[] = [];
  const fieldIds: Id<"seedImportCandidateFields">[] = [];

  for (const candidate of normalized.candidates) {
    const candidateId = await db.insert("seedImportCandidateProfiles", {
      batchId,
      externalCandidateId: candidate.externalCandidateId,
      profileType: candidate.profileType,
      proposedDisplayName: candidate.proposedDisplayName,
      ...optionalRecord("proposedSlug", candidate.proposedSlug),
      reviewState: candidate.reviewState,
      publicationState: candidate.publicationState,
      claimState: candidate.claimState,
      ...optionalRecord("matchedProfileId", candidate.matchedProfileId),
      createdAt: options.now,
      updatedAt: options.now,
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
          confidence: field.confidence,
          reviewState: field.reviewState,
          visibility: field.visibility,
          createdAt: options.now,
          updatedAt: options.now,
        }),
      );
    }
  }

  return {
    batchId,
    candidateIds,
    fieldIds,
  };
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

export function getSeedImportPublicationBlockers(args: {
  batch: Pick<Doc<"seedImportBatches">, "reviewState">;
  candidate: SeedImportPublicationCandidate;
  fields: SeedImportPublicationField[];
  matchedProfile?: SeedImportPublicationProfile | null;
  hasInvalidProposedSlug?: boolean;
  hasAcceptedSuppressionRequest?: boolean;
  slugCollisionProfile?: SeedImportPublicationProfile | null;
}): SeedImportPublicationBlocker[] {
  const blockers = new Set<SeedImportPublicationBlocker>();

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

  if (args.hasAcceptedSuppressionRequest === true) {
    blockers.add("suppression_request_blocks_publication");
  }

  if (
    args.slugCollisionProfile !== null &&
    args.slugCollisionProfile !== undefined &&
    args.slugCollisionProfile._id !== args.candidate.matchedProfileId
  ) {
    blockers.add("slug_collision_blocks_publication");
  }

  for (const field of args.fields) {
    if (field.reviewState === "unreviewed") {
      blockers.add("field_unreviewed");
    }

    if (field.reviewState === "needs_correction") {
      blockers.add("field_needs_correction");
    }

    if (field.reviewState === "accepted" && field.confidence === "owner_confirmed") {
      blockers.add("owner_confirmed_field_without_claim");
    }

    if (
      field.reviewState === "accepted" &&
      field.visibility === "public" &&
      !isSafePublicSeedImportField(field)
    ) {
      blockers.add("unsafe_public_field");
    }
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
