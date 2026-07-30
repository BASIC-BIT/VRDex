import type { Doc, Id } from "./_generated/dataModel";
import type { DatabaseReader } from "./_generated/server";
import { createProfileSortName } from "./_profileSubmissions";

export type SuppressionIdentity = {
  profileId?: Id<"profiles">;
  /** Every slug this publication could occupy: the base slug and any allocated one. */
  slugs?: string[];
  /**
   * Every name this publication could surface. A candidate matched to an existing
   * profile has two: its own proposed name and the matched profile's current
   * display name. A name-only pre-claim request may match either, so both are
   * checked.
   */
  displayNames: string[];
  profileType: Doc<"profiles">["profileType"];
  /**
   * Pre-loaded accepted requests. The name check has no index to use, so a bulk
   * page that calls this per candidate would otherwise re-read the whole accepted
   * set once per candidate.
   *
   * ponytail: one read per page instead of one per candidate. If the accepted
   * history ever grows past a single transaction's read budget, persist the
   * canonical sort name on requests and add a state/type/name index.
   */
  acceptedRequests?: Doc<"profileSuppressionRequests">[];
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

  for (const slug of identity.slugs ?? []) {
    const bySlug = await db
      .query("profileSuppressionRequests")
      .withIndex("by_profileSlug_state", (query) =>
        query.eq("profileSlug", slug).eq("state", "accepted"),
      )
      .collect();

    for (const request of bySlug) {
      if (request.profileType !== undefined && request.profileType !== identity.profileType) {
        continue;
      }

      if (
        request.displayName !== undefined &&
        !identity.displayNames.some(
          (name) => createProfileSortName(name) === createProfileSortName(request.displayName as string),
        )
      ) {
        continue;
      }

      // A request targeting a profile that still exists is about that profile, not
      // whoever else the slug now resolves to. Without this, a distinct namesake
      // allocating `alex-2` would still be blocked by checking the occupied base
      // slug `alex` -- the name scan below already preserves such namesakes, and
      // the two paths must agree.
      if (request.profileId !== undefined && !targetedProfileIds.has(request.profileId)) {
        if ((await db.get(request.profileId)) !== null) {
          continue;
        }
      }

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

  const acceptedRequests =
    identity.acceptedRequests ??
    (await db
      .query("profileSuppressionRequests")
      .withIndex("by_state_createdAt", (query) => query.eq("state", "accepted"))
      .collect());

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
