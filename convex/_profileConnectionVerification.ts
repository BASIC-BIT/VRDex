import { MINIMUM_COMMUNITY_CONTROL_LEVEL, meetsControlLevel } from "./_externalControl";
import type { Doc, Id } from "./_generated/dataModel";
import type { DatabaseReader } from "./_generated/server";
import { getActiveProfileOwner } from "./_profileOwnership";

/** Historical display evidence is separate from fresh proof required to act. */
export async function getProfileConnectionVerifications(
  db: DatabaseReader,
  profileId: Id<"profiles">,
  links: readonly Doc<"profileExternalLinks">[],
): Promise<Map<Id<"profileExternalLinks">, number>> {
  const verified = new Map<Id<"profileExternalLinks">, number>();
  const owner = await getActiveProfileOwner(db, profileId);
  if (owner === null) return verified;
  const now = Date.now();

  for (const link of links) {
    if (
      link.profileId !== profileId || link.state !== "active" ||
      link.provenance === "directory_reference" || link.verifiedByProofId === undefined
    ) continue;

    const reference = await db.get(link.verifiedByProofId);
    if (
      reference === null || reference.userId !== owner.userId ||
      reference.assetType !== link.assetType || reference.assetExternalId !== link.assetExternalId
    ) continue;

    // A revoked reference may use another identity's evidence for the same owner and asset.
    const proofs = db.query("externalControlProofs")
      .withIndex("by_userId_assetType_assetExternalId", q =>
        q.eq("userId", owner.userId).eq("assetType", link.assetType).eq("assetExternalId", link.assetExternalId),
      );
    let selected: Doc<"externalControlProofs"> | undefined;
    for await (const proof of proofs) {
      const enoughControl = link.assetType === "vrchat_user"
        ? proof.controlLevel === "self"
        : proof.controlLevel !== "self" && meetsControlLevel(proof.controlLevel, MINIMUM_COMMUNITY_CONTROL_LEVEL);
      if (
        (proof.state !== "active" && proof.state !== "stale") || !enoughControl ||
        !Number.isFinite(proof.verifiedAt) || proof.verifiedAt < 0 || proof.verifiedAt > now
      ) continue;
      if (
        selected === undefined || proof.verifiedAt > selected.verifiedAt ||
        (proof.verifiedAt === selected.verifiedAt && proof._id < selected._id)
      ) selected = proof;
    }
    if (selected !== undefined) verified.set(link._id, selected.verifiedAt);
  }
  return verified;
}
