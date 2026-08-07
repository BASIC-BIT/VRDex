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

/**
 * How many requests one digest delivers.
 *
 * Kept beside the intake rate below rather than next to the query that uses it,
 * because the only thing that makes either number safe is their relationship,
 * and split across two files that relationship went unnoticed.
 */
export const SUPPORT_DIGEST_BATCH_SIZE = 50;

/**
 * How many anonymous requests may arrive in one rolling hour.
 *
 * The pending ceiling above bounds the queue at an instant, not intake over
 * time. Every digest stamps its batch and frees those slots again, so a bot
 * that simply retries refills them hour after hour, and a rolling window on
 * arrival is what bounds the rate instead.
 *
 * **Below `SUPPORT_DIGEST_BATCH_SIZE`, and that is the whole point.** The first
 * version of this allowed sixty an hour against a digest that delivers fifty,
 * which is not a limit but a slow leak: ten net rows an hour, the queue at its
 * ceiling within a day, a bot refilling every freed slot, and real ownership and
 * safety requests refused whenever they arrive after a refill. Intake has to sit
 * under delivery for the queue to drain at all, and the gap left here is the
 * room signed-in requests need, since the digest drains both.
 *
 * Counted on `_creationTime`, so nothing the sender does resets it.
 */
export const MAX_ANONYMOUS_REQUESTS_PER_HOUR = 30;

const RATE_WINDOW_MS = 60 * 60 * 1_000;

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
 * Every count below seeks, and none of them filters a page after reading it.
 * That distinction is the whole correctness of this function: filtering a
 * global prefix by sender returned nothing once the prefix was full of somebody
 * else's rows, so the per-subject quota stopped applying exactly when it was
 * needed. The same shape counted resolved suppressions toward the ceiling, and
 * since the digest never stamps those, waiting could not clear it and anonymous
 * intake would have been refused permanently.
 */
export async function requireSupportBacklogHeadroom(
  db: MutationCtx["db"],
  requester: { subject: string } | undefined,
): Promise<void> {
  if (requester !== undefined) {
    const ownSupport = await db
      .query("supportRequests")
      .withIndex("by_requesterSubject_notifiedAt", (query) =>
        query.eq("requester.subject", requester.subject).eq("notifiedAt", undefined),
      )
      .take(MAX_PENDING_PER_SUBJECT);

    const ownSuppressions =
      ownSupport.length >= MAX_PENDING_PER_SUBJECT
        ? []
        : // `submitted` only, for the same reason the anonymous ceiling and the
          // digest seek on it: a subject's own resolved rows keep their unset
          // watermark forever, so counting them would lock that account out of
          // the form permanently once it had filed ten things that were dealt
          // with.
          await db
            .query("profileSuppressionRequests")
            .withIndex("by_requesterSubject_state_notifiedAt", (query) =>
              query
                .eq("requester.subject", requester.subject)
                .eq("state", "submitted")
                .eq("notifiedAt", undefined),
            )
            .take(MAX_PENDING_PER_SUBJECT - ownSupport.length);

    if (ownSupport.length + ownSuppressions.length >= MAX_PENDING_PER_SUBJECT) {
      throw supportInputError(TOO_MANY_OWN_REQUESTS_MESSAGE);
    }
  }

  // Everyone, not just anonymous callers. This used to return above, so a
  // signed-in requester skipped the shared ceiling and the rate window entirely
  // and was bounded only per subject -- which bounds nothing in aggregate, since
  // twenty-one fresh subjects clear the two hundred row ceiling between them and
  // rotating subjects grow the backlog without limit. A per-subject quota is a
  // fairness rule; the bounds below are the capacity ones.
  const pendingSupport = await db
    .query("supportRequests")
    .withIndex("by_notifiedAt_createdAt", (query) => query.eq("notifiedAt", undefined))
    .take(MAX_PENDING_ANONYMOUS_REQUESTS + 1);

  if (pendingSupport.length > MAX_PENDING_ANONYMOUS_REQUESTS) {
    throw supportInputError(BACKLOG_FULL_MESSAGE);
  }

  // `submitted` only, seeked rather than filtered. Resolved rows predate
  // `notifiedAt` and nothing ever stamps them, so counting them here would have
  // wedged anonymous intake shut on any deployment with a suppression history.
  const pendingSuppressions = await db
    .query("profileSuppressionRequests")
    .withIndex("by_state_notifiedAt_createdAt", (query) =>
      query.eq("state", "submitted").eq("notifiedAt", undefined),
    )
    .take(MAX_PENDING_ANONYMOUS_REQUESTS + 1 - pendingSupport.length);

  if (pendingSupport.length + pendingSuppressions.length > MAX_PENDING_ANONYMOUS_REQUESTS) {
    throw supportInputError(BACKLOG_FULL_MESSAGE);
  }

  await requireRateHeadroom(db, requester);
}

/**
 * Refuse once anonymous intake has used its hour.
 *
 * Counted on arrival rather than on delivery state, which is the whole point:
 * stamping a row hands its pending slot back, so a queue-depth ceiling alone
 * lets a retrying bot refill the queue hour after hour. Nothing the sender does
 * resets this one.
 *
 * Anonymous rows only, seeked on the absent requester rather than filtered out
 * of a page. Counting everything meant a signed-in person's request spent the
 * anonymous budget, and a one-off operator import of suppression rows shut
 * anonymous intake for the window. Import still costs that window, since a
 * seeded row has no requester either, but a time bound always clears itself,
 * which is the difference between this and the ceilings above.
 */
async function requireRateHeadroom(
  db: MutationCtx["db"],
  requester: { subject: string } | undefined,
): Promise<void> {
  // Anonymous arrivals only.
  //
  // A window over *every* arrival was tried and removed: it bounded signed-in
  // traffic by making any bulk write -- an operator import, a backfill, a
  // migration -- shut the form for everyone for an hour, which is a worse
  // failure than the one it guarded. The aggregate bound signed-in senders
  // actually needed is the pending ceiling above, which now applies to them
  // because this function no longer returns early: the backlog cannot pass two
  // hundred rows no matter how many subjects an attacker rotates through, and
  // each subject costs a real account.
  if (requester !== undefined) {
    return;
  }

  await countArrivals(db, Date.now() - RATE_WINDOW_MS, MAX_ANONYMOUS_REQUESTS_PER_HOUR);
}

/**
 * Refuse once `limit` anonymous arrivals already sit inside the window.
 *
 * Seeks on the absent requester rather than filtering a page, so the cost is
 * the size of the window and not of the table.
 */
async function countArrivals(
  db: MutationCtx["db"],
  since: number,
  limit: number,
): Promise<void> {
  let seen = 0;

  for (const table of ["supportRequests", "profileSuppressionRequests"] as const) {
    const recent = await db
      .query(table)
      .withIndex("by_requesterSubject", (query) =>
        query.eq("requester.subject", undefined).gt("_creationTime", since),
      )
      .take(limit - seen);

    seen += recent.length;

    // `>=`, because this runs before the insert: the window being full already
    // is what refuses the request about to be added, and `>` would have let
    // every hour take one more than its allowance.
    if (seen >= limit) {
      throw supportInputError(BACKLOG_FULL_MESSAGE);
    }
  }
}
