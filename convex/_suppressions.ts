import type { Doc, Id } from "./_generated/dataModel";
import type { DatabaseReader } from "./_generated/server";
import { createProfileSortName } from "./_profileSubmissions";

export type SuppressionIdentity = {
  profileId?: Id<"profiles">;
  slug?: string;
  /**
   * Every name this publication could surface. A candidate matched to an existing
   * profile has two: its own proposed name and the matched profile's current
   * display name. A name-only pre-claim request may match either, so both are
   * checked.
   */
  displayNames: string[];
  profileType: Doc<"profiles">["profileType"];
};

/**
 * Whether an accepted suppression request covers this profile identity.
 *
 * `requestProfileSuppression` accepts three shapes: a profile id, a slug, or a
 * pre-claim `displayName` + `profileType` with no slug at all. A slug-only
 * lookup therefore misses pre-claim safety requests entirely, and misses
 * profile-targeted requests whose stored slug no longer matches the profile, so
 * every supported identity key is checked before anything is published.
 */
export async function hasAcceptedSuppression(
  db: DatabaseReader,
  identity: SuppressionIdentity,
): Promise<boolean> {
  const profileId = identity.profileId;
  // Requests that name a specific profile are excluded from the name scan below.
  // Such a request already resolved to its target by id or slug; letting it also
  // match on name would block an unrelated namesake the requester never named.
  const targetedProfileIds = new Set<string>();

  if (profileId !== undefined) {
    const byProfileId = await db
      .query("profileSuppressionRequests")
      .withIndex("by_profileId_state", (query) =>
        query.eq("profileId", profileId).eq("state", "accepted"),
      )
      .take(1);

    if (byProfileId.length > 0) {
      return true;
    }

    targetedProfileIds.add(profileId);
  }

  const slug = identity.slug;

  if (slug !== undefined) {
    const bySlug = await db
      .query("profileSuppressionRequests")
      .withIndex("by_profileSlug_state", (query) =>
        query.eq("profileSlug", slug).eq("state", "accepted"),
      )
      .collect();

    // A slug-only request may have recorded a slug before any profile held it, so
    // a match alone does not mean the request covers whoever holds it now. The
    // same agreement check the acceptance resolver applies is used here, or an
    // unrelated slug owner would stay blocked from publication indefinitely.
    const coversThisIdentity = bySlug.some(
      (request) =>
        (request.profileType === undefined || request.profileType === identity.profileType) &&
        (request.displayName === undefined ||
          identity.displayNames.some(
            (name) => createProfileSortName(name) === createProfileSortName(request.displayName as string),
          )),
    );

    if (coversThisIdentity) {
      return true;
    }
  }

  // Pre-claim requests carry no profile id or slug, so they can only be matched
  // on the name/type identity and there is no index for that. Accepted requests
  // are the small set of people who asked not to be listed, so scanning is fine.
  //
  // Canonicalized with createProfileSortName, the same function the acceptance
  // resolver uses. Trim-and-lowercase alone would treat "DJ Exámple" and
  // "DJ Example" as different identities here while acceptance treats them as the
  // same, letting a spelling variant publish past an accepted safety request.
  const normalizedNames = new Set(
    identity.displayNames.map((name) => createProfileSortName(name)).filter(Boolean),
  );

  if (normalizedNames.size === 0) {
    return false;
  }

  const acceptedRequests = await db
    .query("profileSuppressionRequests")
    .withIndex("by_state_createdAt", (query) => query.eq("state", "accepted"))
    .collect();

  for (const request of acceptedRequests) {
    if (request.displayName === undefined) {
      continue;
    }

    if (!normalizedNames.has(createProfileSortName(request.displayName))) {
      continue;
    }

    if (request.profileType !== undefined && request.profileType !== identity.profileType) {
      continue;
    }

    // A request filed against a profile that still exists is targeted, not a
    // name-only pre-claim request, so it must not match a namesake.
    if (request.profileId !== undefined) {
      if (targetedProfileIds.has(request.profileId)) {
        return true;
      }

      if ((await db.get(request.profileId)) !== null) {
        continue;
      }
    }

    return true;
  }

  return false;
}
