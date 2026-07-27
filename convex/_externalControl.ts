import type { Doc, Id } from "./_generated/dataModel";
import type { DatabaseReader, DatabaseWriter } from "./_generated/server";
import { claimError } from "./_claimErrors";

export type ExternalAssetType = Doc<"externalControlProofs">["assetType"];
export type ExternalControlLevel = Doc<"externalControlProofs">["controlLevel"];
export type ExternalControlEvidenceSource = Doc<"externalControlProofs">["evidenceSource"];
export type ProfileExternalLinkRole = Doc<"profileExternalLinks">["linkRole"];

/** Proofs older than this are re-checked before they grant anything new. */
export const CONTROL_PROOF_REVALIDATE_MS = 30 * 86_400_000;

const CONTROL_LEVEL_RANK: Record<ExternalControlLevel, number> = {
  manager: 1,
  administrator: 2,
  owner: 3,
  // `self` only ever appears on `vrchat_user` assets, where it is the only
  // meaningful level. Ranking across asset types is not meaningful.
  self: 4,
};

export function externalControlLevelRank(level: ExternalControlLevel): number {
  return CONTROL_LEVEL_RANK[level];
}

export function meetsControlLevel(
  actual: ExternalControlLevel,
  required: ExternalControlLevel,
): boolean {
  return externalControlLevelRank(actual) >= externalControlLevelRank(required);
}

/**
 * Minimum control required to act on a community's behalf. Discord's three
 * management tiers (owner, Administrator, Manage Server) all clear this bar.
 */
export const MINIMUM_COMMUNITY_CONTROL_LEVEL: ExternalControlLevel = "manager";

export async function getActiveControlProof(
  db: DatabaseReader,
  userId: Id<"users">,
  assetType: ExternalAssetType,
  assetExternalId: string,
) {
  const proofs = await db
    .query("externalControlProofs")
    .withIndex("by_userId_assetType_assetExternalId", (q) =>
      q.eq("userId", userId).eq("assetType", assetType).eq("assetExternalId", assetExternalId),
    )
    .collect();

  return proofs.find((proof) => proof.state === "active") ?? null;
}

export async function listActiveControlProofsForUser(db: DatabaseReader, userId: Id<"users">) {
  return await db
    .query("externalControlProofs")
    .withIndex("by_userId_state", (q) => q.eq("userId", userId).eq("state", "active"))
    .collect();
}

type RecordControlProofOptions = {
  userId: Id<"users">;
  assetType: ExternalAssetType;
  assetExternalId: string;
  assetDisplayName?: string;
  controlLevel: ExternalControlLevel;
  evidenceSource: ExternalControlEvidenceSource;
  evidenceSummary?: string;
  now: number;
  revalidateAfterMs?: number;
};

/**
 * Upsert the caller's proof of control over one external asset. Re-verifying
 * refreshes the existing row rather than accumulating duplicates, so
 * `by_userId_assetType_assetExternalId` stays effectively unique per user.
 */
export async function recordExternalControlProof(
  db: DatabaseWriter,
  options: RecordControlProofOptions,
): Promise<Id<"externalControlProofs">> {
  const revalidateAfter =
    options.now + (options.revalidateAfterMs ?? CONTROL_PROOF_REVALIDATE_MS);
  const existing = await getActiveControlProof(
    db,
    options.userId,
    options.assetType,
    options.assetExternalId,
  );

  if (existing !== null) {
    await db.patch(existing._id, {
      controlLevel: options.controlLevel,
      evidenceSource: options.evidenceSource,
      ...(options.assetDisplayName !== undefined
        ? { assetDisplayName: options.assetDisplayName }
        : {}),
      ...(options.evidenceSummary !== undefined
        ? { evidenceSummary: options.evidenceSummary }
        : {}),
      verifiedAt: options.now,
      lastRevalidatedAt: options.now,
      revalidateAfter,
      updatedAt: options.now,
    });

    return existing._id;
  }

  return await db.insert("externalControlProofs", {
    userId: options.userId,
    assetType: options.assetType,
    assetExternalId: options.assetExternalId,
    ...(options.assetDisplayName !== undefined
      ? { assetDisplayName: options.assetDisplayName }
      : {}),
    controlLevel: options.controlLevel,
    state: "active",
    evidenceSource: options.evidenceSource,
    ...(options.evidenceSummary !== undefined
      ? { evidenceSummary: options.evidenceSummary }
      : {}),
    verifiedAt: options.now,
    lastRevalidatedAt: options.now,
    revalidateAfter,
    createdAt: options.now,
    updatedAt: options.now,
  });
}

export async function revokeExternalControlProof(
  db: DatabaseWriter,
  proofId: Id<"externalControlProofs">,
  reason: string,
  now: number,
) {
  await db.patch(proofId, {
    state: "revoked",
    revokedAt: now,
    revokedReason: reason,
    updatedAt: now,
  });
}

export async function getActiveProfileLinks(
  db: DatabaseReader,
  profileId: Id<"profiles">,
  assetType?: ExternalAssetType,
) {
  if (assetType === undefined) {
    return await db
      .query("profileExternalLinks")
      .withIndex("by_profileId_state", (q) => q.eq("profileId", profileId).eq("state", "active"))
      .collect();
  }

  return await db
    .query("profileExternalLinks")
    .withIndex("by_profileId_assetType_state", (q) =>
      q.eq("profileId", profileId).eq("assetType", assetType).eq("state", "active"),
    )
    .collect();
}

/** Every profile currently linked to one external asset (a guild may back several). */
export async function getProfilesLinkedToAsset(
  db: DatabaseReader,
  assetType: ExternalAssetType,
  assetExternalId: string,
) {
  return await db
    .query("profileExternalLinks")
    .withIndex("by_assetType_assetExternalId_state", (q) =>
      q.eq("assetType", assetType).eq("assetExternalId", assetExternalId).eq("state", "active"),
    )
    .collect();
}

async function findLink(
  db: DatabaseReader,
  profileId: Id<"profiles">,
  assetType: ExternalAssetType,
  assetExternalId: string,
) {
  const links = await db
    .query("profileExternalLinks")
    .withIndex("by_profileId_assetType_assetExternalId", (q) =>
      q
        .eq("profileId", profileId)
        .eq("assetType", assetType)
        .eq("assetExternalId", assetExternalId),
    )
    .collect();

  return links.find((link) => link.state === "active") ?? null;
}

type LinkProfileOptions = {
  profileId: Id<"profiles">;
  assetType: ExternalAssetType;
  assetExternalId: string;
  assetDisplayName?: string;
  linkRole?: ProfileExternalLinkRole;
  linkedByUserId: Id<"users">;
  verifiedByProofId?: Id<"externalControlProofs">;
  now: number;
};

/**
 * Attach an external asset to a profile. The first active link of a given
 * asset type becomes `primary` unless told otherwise; promoting a later link
 * demotes the incumbent so at most one primary exists per (profile, type).
 */
export async function linkProfileToAsset(
  db: DatabaseWriter,
  options: LinkProfileOptions,
): Promise<Id<"profileExternalLinks">> {
  const siblings = await getActiveProfileLinks(db, options.profileId, options.assetType);
  const existing = await findLink(
    db,
    options.profileId,
    options.assetType,
    options.assetExternalId,
  );
  const linkRole: ProfileExternalLinkRole =
    options.linkRole ?? (siblings.length === 0 ? "primary" : "secondary");

  if (linkRole === "primary") {
    await Promise.all(
      siblings
        .filter((link) => link.linkRole === "primary" && link._id !== existing?._id)
        .map((link) => db.patch(link._id, { linkRole: "secondary", updatedAt: options.now })),
    );
  }

  if (existing !== null) {
    await db.patch(existing._id, {
      linkRole,
      ...(options.assetDisplayName !== undefined
        ? { assetDisplayName: options.assetDisplayName }
        : {}),
      ...(options.verifiedByProofId !== undefined
        ? { verifiedByProofId: options.verifiedByProofId }
        : {}),
      updatedAt: options.now,
    });

    return existing._id;
  }

  return await db.insert("profileExternalLinks", {
    profileId: options.profileId,
    assetType: options.assetType,
    assetExternalId: options.assetExternalId,
    ...(options.assetDisplayName !== undefined
      ? { assetDisplayName: options.assetDisplayName }
      : {}),
    linkRole,
    state: "active",
    linkedByUserId: options.linkedByUserId,
    ...(options.verifiedByProofId !== undefined
      ? { verifiedByProofId: options.verifiedByProofId }
      : {}),
    createdAt: options.now,
    updatedAt: options.now,
  });
}

export async function removeProfileLink(
  db: DatabaseWriter,
  profileId: Id<"profiles">,
  assetType: ExternalAssetType,
  assetExternalId: string,
  now: number,
) {
  const link = await findLink(db, profileId, assetType, assetExternalId);

  if (link === null) {
    throw claimError("LINK_NOT_FOUND");
  }

  await db.patch(link._id, { state: "removed", removedAt: now, updatedAt: now });

  // Keep exactly one primary when the removed link held that role.
  if (link.linkRole === "primary") {
    const remaining = await getActiveProfileLinks(db, profileId, assetType);
    const next = remaining.find((candidate) => candidate._id !== link._id);

    if (next !== undefined) {
      await db.patch(next._id, { linkRole: "primary", updatedAt: now });
    }
  }

  return link._id;
}

/**
 * Require that `userId` currently proves at least `required` control over the
 * asset, throwing the structured claim error the UI knows how to explain.
 */
export async function requireControlProof(
  db: DatabaseReader,
  userId: Id<"users">,
  assetType: ExternalAssetType,
  assetExternalId: string,
  required: ExternalControlLevel,
) {
  const proof = await getActiveControlProof(db, userId, assetType, assetExternalId);

  if (proof === null) {
    throw claimError("CONTROL_NOT_VERIFIED");
  }

  if (!meetsControlLevel(proof.controlLevel, required)) {
    throw claimError("CONTROL_LEVEL_TOO_LOW", proof.controlLevel);
  }

  return proof;
}
