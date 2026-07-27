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

async function listProofsForAsset(
  db: DatabaseReader,
  userId: Id<"users">,
  assetType: ExternalAssetType,
  assetExternalId: string,
) {
  return await db
    .query("externalControlProofs")
    .withIndex("by_userId_assetType_assetExternalId", (q) =>
      q.eq("userId", userId).eq("assetType", assetType).eq("assetExternalId", assetExternalId),
    )
    .collect();
}

/**
 * The strongest usable proof this user holds over one asset.
 *
 * One user may hold several — a guild manageable through two Discord logins
 * gets one row per identity, so that losing access on one does not revoke the
 * other. Callers only ever ask "may they act on this asset", so pick the row
 * that answers best: still inside its window first, then the higher control
 * level, then the more recent evidence.
 */
export async function getActiveControlProof(
  db: DatabaseReader,
  userId: Id<"users">,
  assetType: ExternalAssetType,
  assetExternalId: string,
  now: number = Date.now(),
) {
  const active = (await listProofsForAsset(db, userId, assetType, assetExternalId)).filter(
    (proof) => proof.state === "active",
  );

  return (
    active.sort((left, right) => {
      const leftLive = left.revalidateAfter === undefined || left.revalidateAfter > now;
      const rightLive = right.revalidateAfter === undefined || right.revalidateAfter > now;

      if (leftLive !== rightLive) {
        return leftLive ? -1 : 1;
      }

      const rank =
        externalControlLevelRank(right.controlLevel) - externalControlLevelRank(left.controlLevel);

      return rank !== 0 ? rank : right.verifiedAt - left.verifiedAt;
    })[0] ?? null
  );
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
  evidenceSubjectId?: string;
  now: number;
  revalidateAfterMs?: number;
};

/**
 * Upsert the caller's proof of control over one external asset.
 *
 * Identity is (user, asset, evidence subject), not (user, asset): a guild the
 * same person manages through two Discord logins earns one row per login, so
 * reconciling one identity cannot revoke what the other proved.
 *
 * Matching ignores state deliberately. A revoked or stale row is refreshed in
 * place rather than superseded, because `profileExternalLinks` reference proofs
 * by id — inserting a replacement would leave every existing link pointing at
 * the dead row and reporting a re-verified connection as unverified forever.
 * A row that predates `evidenceSubjectId` is adopted by the first identity to
 * re-verify it, for the same reason.
 */
async function findProofToRefresh(
  db: DatabaseReader,
  options: RecordControlProofOptions,
) {
  const candidates = await listProofsForAsset(
    db,
    options.userId,
    options.assetType,
    options.assetExternalId,
  );
  const preferActive = <T extends { state: string; updatedAt: number }>(rows: T[]) =>
    rows.sort((left, right) => {
      if ((left.state === "active") !== (right.state === "active")) {
        return left.state === "active" ? -1 : 1;
      }

      return right.updatedAt - left.updatedAt;
    })[0] ?? null;

  return (
    preferActive(
      candidates.filter((proof) => proof.evidenceSubjectId === options.evidenceSubjectId),
    ) ??
    preferActive(candidates.filter((proof) => proof.evidenceSubjectId === undefined))
  );
}

export async function recordExternalControlProof(
  db: DatabaseWriter,
  options: RecordControlProofOptions,
): Promise<Id<"externalControlProofs">> {
  const revalidateAfter =
    options.now + (options.revalidateAfterMs ?? CONTROL_PROOF_REVALIDATE_MS);
  const existing = await findProofToRefresh(db, options);

  if (existing !== null) {
    await db.patch(existing._id, {
      // Re-verification restores a row the sweeper marked stale or reconciliation
      // revoked; that is the whole point of re-verifying.
      state: "active",
      revokedAt: undefined,
      revokedReason: undefined,
      controlLevel: options.controlLevel,
      evidenceSource: options.evidenceSource,
      ...(options.assetDisplayName !== undefined
        ? { assetDisplayName: options.assetDisplayName }
        : {}),
      ...(options.evidenceSummary !== undefined
        ? { evidenceSummary: options.evidenceSummary }
        : {}),
      ...(options.evidenceSubjectId !== undefined
        ? { evidenceSubjectId: options.evidenceSubjectId }
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
    ...(options.evidenceSubjectId !== undefined
      ? { evidenceSubjectId: options.evidenceSubjectId }
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

/**
 * A previously removed link for the same asset, if one exists.
 *
 * Re-attaching reuses it rather than inserting a replacement, because
 * `linkedByUserId` is what tells an operator-recorded association from the
 * owner's own. Inserting a fresh row on re-add meant one click on "Remove"
 * followed by re-adding from the picker silently converted an operator record
 * into the owner's own assertion — permanently, and with nothing to show why
 * the listing could no longer be verified.
 */
async function findRemovedLink(
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

  return links.find((link) => link.state === "removed") ?? null;
}

type LinkProfileOptions = {
  profileId: Id<"profiles">;
  assetType: ExternalAssetType;
  assetExternalId: string;
  assetDisplayName?: string;
  linkRole?: ProfileExternalLinkRole;
  linkedByUserId?: Id<"users">;
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
  // A removed link is reused, not superseded, so re-attaching an asset restores
  // the row — and with it whoever originally put the association on record.
  const existing =
    (await findLink(db, options.profileId, options.assetType, options.assetExternalId)) ??
    (await findRemovedLink(db, options.profileId, options.assetType, options.assetExternalId));
  // Re-linking an asset that is already attached must not change its role.
  // `siblings` includes the existing row, so defaulting on count alone demoted
  // an incumbent primary to secondary and left the profile with none.
  const requested: ProfileExternalLinkRole =
    options.linkRole ?? existing?.linkRole ?? (siblings.length === 0 ? "primary" : "secondary");
  // An explicit `secondary` — which `addVerifiedConnection` takes straight from
  // the client — must not be able to leave the type with no primary at all,
  // whether by being the only link or by demoting the incumbent. Removal
  // already repairs this invariant; adding has to as well.
  const wouldLeaveNoPrimary =
    requested === "secondary" &&
    !siblings.some((link) => link.linkRole === "primary" && link._id !== existing?._id);
  const linkRole: ProfileExternalLinkRole = wouldLeaveNoPrimary ? "primary" : requested;

  if (linkRole === "primary") {
    await Promise.all(
      siblings
        .filter((link) => link.linkRole === "primary" && link._id !== existing?._id)
        .map((link) => db.patch(link._id, { linkRole: "secondary", updatedAt: options.now })),
    );
  }

  if (existing !== null) {
    await db.patch(existing._id, {
      // Restores a removed row; a no-op for one that is already active.
      state: "active",
      removedAt: undefined,
      linkRole,
      ...(options.assetDisplayName !== undefined
        ? { assetDisplayName: options.assetDisplayName }
        : {}),
      ...(options.verifiedByProofId !== undefined
        ? { verifiedByProofId: options.verifiedByProofId }
        : {}),
      // `linkedByUserId` records who put this association on record, and the
      // verified claim paths read it to tell independent corroboration from a
      // claimant's own assertion. An operator write (no id) clears it and wins;
      // a claimant re-linking an asset never overwrites what is already there,
      // or re-running their own claim would launder an operator record into
      // their own and destroy the corroboration it exists to provide.
      ...(options.linkedByUserId === undefined ? { linkedByUserId: undefined } : {}),
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
    ...(options.linkedByUserId !== undefined
      ? { linkedByUserId: options.linkedByUserId }
      : {}),
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
  now: number = Date.now(),
) {
  // `now` forwarded, not just used for the expiry check below: the selection
  // prefers proofs that are live *at that instant*, so letting it fall back to
  // wall-clock time would pick against one instant and judge against another.
  const proof = await getActiveControlProof(db, userId, assetType, assetExternalId, now);

  if (proof === null) {
    throw claimError("CONTROL_NOT_VERIFIED");
  }

  // Expiry is enforced here, not only by the sweeper. The cron marks overdue
  // proofs stale in batches, so between a proof's window closing and its batch
  // being processed the row is still `active`; relying on the sweep alone would
  // let a lapsed proof authorize a claim in that gap.
  if (proof.revalidateAfter !== undefined && proof.revalidateAfter <= now) {
    throw claimError("CONTROL_NOT_VERIFIED", "revalidation_overdue");
  }

  if (!meetsControlLevel(proof.controlLevel, required)) {
    throw claimError("CONTROL_LEVEL_TOO_LOW", proof.controlLevel);
  }

  return proof;
}
