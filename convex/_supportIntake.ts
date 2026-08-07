import type { MutationCtx } from "./_generated/server";

/**
 * The abuse ceiling shared by both public intake mutations behind `/support`.
 *
 * Lives here rather than in either of them because both are unauthenticated,
 * both write rows the same hourly digest drains, and both land in one mailbox.
 * Putting the guard in one would leave the other as the open door.
 */

/**
 * How many undelivered requests may be waiting before anonymous ones are
 * refused.
 *
 * The digest is not the abuse control it first looked like. It drains the
 * *oldest* rows, so a flood does not merely cost one email an hour: it pushes
 * every real dispute behind an ever-growing head of junk and holds it there,
 * which is worse than the noise it was reasoned about as.
 *
 * A ceiling is what actually bounds that. Set well above any plausible real
 * hour, it costs nothing in normal use, and when it does trip the requester is
 * told rather than silently queued behind a wall.
 */
const MAX_PENDING_ANONYMOUS_REQUESTS = 200;

export const BACKLOG_FULL_MESSAGE =
  "We have more requests than we can answer right now. Try again in a few hours, or sign in to send this one now.";

/**
 * Refuse an anonymous request once the undelivered backlog is at its ceiling.
 *
 * A signed-in caller is never refused. They carry an identity that can be
 * traced and blocked after the fact, which is the property an anonymous insert
 * lacks and the whole reason it needs a cap. That also keeps a route open for a
 * real person during a flood, which a flat cap would close.
 *
 * Counts both tables, since a flood of either is what buries the other, and
 * reads at most the ceiling plus one row, so the cost never grows with the
 * table.
 */
export async function requireSupportBacklogHeadroom(
  db: MutationCtx["db"],
  requester: unknown,
): Promise<void> {
  if (requester !== undefined) {
    return;
  }

  const pendingSupport = await db
    .query("supportRequests")
    .withIndex("by_notifiedAt_createdAt", (query) => query.eq("notifiedAt", undefined))
    .take(MAX_PENDING_ANONYMOUS_REQUESTS + 1);

  if (pendingSupport.length > MAX_PENDING_ANONYMOUS_REQUESTS) {
    throw new Error(BACKLOG_FULL_MESSAGE);
  }

  const pendingSuppressions = await db
    .query("profileSuppressionRequests")
    .withIndex("by_notifiedAt_createdAt", (query) => query.eq("notifiedAt", undefined))
    .take(MAX_PENDING_ANONYMOUS_REQUESTS + 1 - pendingSupport.length);

  if (pendingSupport.length + pendingSuppressions.length > MAX_PENDING_ANONYMOUS_REQUESTS) {
    throw new Error(BACKLOG_FULL_MESSAGE);
  }
}
