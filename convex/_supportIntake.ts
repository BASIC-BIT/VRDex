import { ConvexError } from "convex/values";

import type { MutationCtx } from "./_generated/server";

/**
 * A refusal the requester can act on, in a form that survives production.
 *
 * Convex redacts plain `Error` messages on production deployments, so every
 * fixable rejection here -- a link that names no profile, a missing contact, a
 * message over the limit, a full backlog -- reached the form as the generic
 * backend-unreachable sentence, for problems entirely fixable in the form the
 * person was looking at. Matching on `error.message` in the client works in
 * development and silently stops working where it matters.
 *
 * The structured payload survives redaction, which is why
 * `_profileSubmissions.ts` and `_claimErrors.ts` already answer this way.
 * Internal failures stay plain, and stay redacted.
 */
export function supportInputError(message: string): ConvexError<{ code: string; message: string }> {
  return new ConvexError({ code: "SUPPORT_INPUT_INVALID", message });
}

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
 * How many undelivered requests one signed-in subject may have waiting.
 *
 * Signed in used to mean exempt, on the reasoning that an identity can be
 * traced and blocked afterwards. That is a remedy, not a bound: nothing here
 * requires a verified email, so one throwaway account could still insert faster
 * than the digest drains and queue ahead of every real dispute, which is the
 * exact failure the ceiling was added to prevent.
 *
 * Per subject rather than shared, so one abusive account cannot spend the
 * global allowance and lock everyone else out. Generous against real use: a
 * person with a genuine problem files one request, maybe two.
 */
const MAX_PENDING_PER_SUBJECT = 10;

const TOO_MANY_OWN_REQUESTS_MESSAGE =
  "You already have several requests waiting. We will answer those first.";

/**
 * Refuse a request once its sender's share of the undelivered backlog is full.
 *
 * Two ceilings, because the two callers are different risks. An anonymous
 * insert is bounded globally, since there is nothing else to attribute it to. A
 * signed-in one is bounded per subject, which both stops one account from
 * flooding and keeps a route open for a real person while anonymous traffic is
 * at its ceiling.
 *
 * Counts both tables, since a flood of either is what buries the other, and
 * reads at most a ceiling plus one row, so the cost never grows with the table.
 */
export async function requireSupportBacklogHeadroom(
  db: MutationCtx["db"],
  requester: { subject: string } | undefined,
): Promise<void> {
  if (requester !== undefined) {
    const own = [
      ...(await db
        .query("supportRequests")
        .withIndex("by_notifiedAt_createdAt", (query) => query.eq("notifiedAt", undefined))
        .take(MAX_PENDING_ANONYMOUS_REQUESTS + 1)),
      ...(await db
        .query("profileSuppressionRequests")
        .withIndex("by_notifiedAt_createdAt", (query) => query.eq("notifiedAt", undefined))
        .take(MAX_PENDING_ANONYMOUS_REQUESTS + 1)),
    ].filter((row) => row.requester?.subject === requester.subject);

    if (own.length >= MAX_PENDING_PER_SUBJECT) {
      throw supportInputError(TOO_MANY_OWN_REQUESTS_MESSAGE);
    }

    return;
  }

  const pendingSupport = await db
    .query("supportRequests")
    .withIndex("by_notifiedAt_createdAt", (query) => query.eq("notifiedAt", undefined))
    .take(MAX_PENDING_ANONYMOUS_REQUESTS + 1);

  if (pendingSupport.length > MAX_PENDING_ANONYMOUS_REQUESTS) {
    throw supportInputError(BACKLOG_FULL_MESSAGE);
  }

  const pendingSuppressions = await db
    .query("profileSuppressionRequests")
    .withIndex("by_notifiedAt_createdAt", (query) => query.eq("notifiedAt", undefined))
    .take(MAX_PENDING_ANONYMOUS_REQUESTS + 1 - pendingSupport.length);

  if (pendingSupport.length + pendingSuppressions.length > MAX_PENDING_ANONYMOUS_REQUESTS) {
    throw supportInputError(BACKLOG_FULL_MESSAGE);
  }
}
