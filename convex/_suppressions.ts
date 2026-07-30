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
  }

  const slug = identity.slug;

  if (slug !== undefined) {
    const bySlug = await db
      .query("profileSuppressionRequests")
      .withIndex("by_profileSlug_state", (query) =>
        query.eq("profileSlug", slug).eq("state", "accepted"),
      )
      .take(1);

    if (bySlug.length > 0) {
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

  return acceptedRequests.some(
    (request) =>
      request.displayName !== undefined &&
      normalizedNames.has(createProfileSortName(request.displayName)) &&
      (request.profileType === undefined || request.profileType === identity.profileType),
  );
}
