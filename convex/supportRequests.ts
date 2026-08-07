import { v } from "convex/values";

import type { Doc } from "./_generated/dataModel";
import { internalMutation, internalQuery, mutation } from "./_generated/server";
import { activeBrowserSessionSubjectOrNull } from "./_browserSessionAuthority";
import { getProfileBySlug, resolveRequestedProfile } from "./_profileSlugs";
import { requireSupportBacklogHeadroom, supportInputError } from "./_supportIntake";
import { normalizeProfileInlineText } from "./_profileSubmissions";

const profileType = v.union(v.literal("person"), v.literal("community"));

const supportRequestTopic = v.union(
  v.literal("ownership_dispute"),
  v.literal("transfer"),
  v.literal("recovery"),
  v.literal("feedback"),
);

export type SupportRequestTopic = Doc<"supportRequests">["topic"];

/**
 * Topics that are useless without a way to answer them.
 *
 * A dispute, a transfer, or a recovery all end in a reply to a human, and an
 * anonymous one with no contact is a row nobody can act on. Feedback is the
 * opposite case: demanding an address there just suppresses the feedback.
 */
const TOPICS_REQUIRING_CONTACT: ReadonlySet<string> = new Set([
  "ownership_dispute",
  "transfer",
  "recovery",
]);

export const MESSAGE_MAX_LENGTH = 4_000;
const MESSAGE_MIN_LENGTH = 10;
export const CONTACT_MAX_LENGTH = 160;
const DISPLAY_NAME_MAX_LENGTH = 120;

/**
 * How many requests one digest covers.
 *
 * A bound on the size of one email, not an abuse control. What bounds abuse is
 * `requireSupportBacklogHeadroom` in `_supportIntake.ts`, because this cap drains
 * the oldest rows and so cannot stop a flood from queueing ahead of real ones.
 * Anything past it keeps its unset `notifiedAt` and rides the next run.
 */
export const SUPPORT_DIGEST_BATCH_SIZE = 50;

function optionalValue<T>(key: string, value: T | undefined): Record<string, T> {
  return value === undefined ? {} : { [key]: value };
}

function optionalText(value: string | undefined, maxLength: number): string | undefined {
  const normalized = normalizeProfileInlineText(value ?? "");

  return normalized ? normalized.slice(0, maxLength) : undefined;
}

/**
 * Trim the message without flattening it.
 *
 * `normalizeProfileInlineText` collapses every run of whitespace to one space,
 * which is right for a name or a handle and wrong here: a dispute arrives as
 * paragraphs and a list of links, and running it through the inline normalizer
 * would deliver one unreadable blob to the person who has to act on it. Runs of
 * blank lines still collapse, so the digest cannot be padded into a wall.
 */
function normalizeMessage(input: string): string {
  // No slice. Two versions of one lived here and both lost text silently: cut
  // to the limit, the caller's length check compared an already-truncated
  // string to the same number and could never fire; cut to twice the limit,
  // whitespace-heavy input could normalize back under the limit and be accepted
  // with everything past character eight thousand gone.
  //
  // The bound is a refusal now, in `requireMessageWithinBounds`, so nothing is
  // ever dropped without saying so and the regex work below is still capped.
  return input
    .replace(/\r\n?/g, "\n")
    .split("\n")
    .map((line) => line.trimEnd())
    .join("\n")
    .replace(/\n{3,}/g, "\n\n")
    .trim();
}

/**
 * Refuse an oversized message before any of it is processed or discarded.
 *
 * Two bounds, checked in this order. The raw one exists because this mutation
 * is public and unauthenticated, so the argument size is whatever a caller
 * sends and the normalization passes should not scale with it. The normalized
 * one is the real limit a person is held to, applied to what would actually be
 * stored.
 */
function requireMessageWithinBounds(raw: string, normalized: string): void {
  if (raw.length > MESSAGE_MAX_LENGTH * 2 || normalized.length > MESSAGE_MAX_LENGTH) {
    throw supportInputError(
      `That message is longer than we can store. Keep it under ${MESSAGE_MAX_LENGTH} characters and link to the rest.`,
    );
  }
}

/**
 * Contact, dispute, transfer, and recovery intake behind `/support`.
 *
 * Anonymous on purpose. Recovery is "I lost access to the account that holds my
 * profile", so requiring a session would lock out the case that needs this most.
 * A session is attached when one exists, which is the identity the operator
 * would otherwise have to ask for.
 *
 * The two suppression topics the same form offers do not come here. They call
 * `suppressions.requestProfileSuppression`, because accepting one of those
 * retracts profiles from discovery and a feedback row must never be one
 * operator click away from that.
 */
export const submitSupportRequest = mutation({
  args: {
    topic: supportRequestTopic,
    profileSlug: v.optional(v.string()),
    profileType: v.optional(profileType),
    displayName: v.optional(v.string()),
    requesterContact: v.optional(v.string()),
    message: v.string(),
  },
  handler: async (ctx, args) => {
    const now = Date.now();
    const requester = (await activeBrowserSessionSubjectOrNull(ctx))?.subject;

    await requireSupportBacklogHeadroom(ctx.db, requester);

    const message = normalizeMessage(args.message);

    if (message.length < MESSAGE_MIN_LENGTH) {
      throw supportInputError("Tell us a little more about what you need.");
    }

    // Refused rather than sliced. Truncating reported success and then dropped
    // whatever came last, which on a safety report or a dispute is the evidence
    // links people put at the end.
    requireMessageWithinBounds(args.message, message);

    // Measured before truncation, and `>` rather than `>=`. Checking the sliced
    // value could only ever see the limit exactly, which rejected an address of
    // precisely the length the form's own `maxLength` invites. Same reason as
    // the message above, and worse here: a sliced address still satisfies the
    // required-contact check below, so the request looks answered for while the
    // reply target is a mangled string nobody reads.
    if (normalizeProfileInlineText(args.requesterContact ?? "").length > CONTACT_MAX_LENGTH) {
      throw supportInputError("That contact is too long. Give us a shorter address or handle.");
    }

    const contact = optionalText(args.requesterContact, CONTACT_MAX_LENGTH);

    // Checked against the topic rather than the session. A signed-in requester
    // still gets asked, because the account that holds the session is often not
    // the address the answer should go to -- recovery is exactly the case where
    // it cannot be.
    if (contact === undefined && TOPICS_REQUIRING_CONTACT.has(args.topic)) {
      throw supportInputError("Add a contact so we can reply.");
    }

    const requested = resolveRequestedProfile(args.profileSlug);
    const profileSlug = requested?.slug;

    // Resolved only to borrow the display name when the requester left it blank.
    // A slug with no profile behind it is still recorded: someone disputing a
    // listing may be reading it off a URL that has since changed, and dropping
    // it would discard the only identifier they had.
    const profile = profileSlug === undefined ? null : await getProfileBySlug(ctx.db, profileSlug);

    // The requester's own text, measured untruncated. A name is an identifier
    // here, so slicing it produced a request that succeeded while naming
    // something subtly different from the listing the person meant. The stored
    // profile's name is not checked: it came from the record, not from them.
    if (normalizeProfileInlineText(args.displayName ?? "").length > DISPLAY_NAME_MAX_LENGTH) {
      throw supportInputError(
        `That name is longer than we can store. Keep it under ${DISPLAY_NAME_MAX_LENGTH} characters.`,
      );
    }

    const displayName = optionalText(
      args.displayName ?? profile?.displayName,
      DISPLAY_NAME_MAX_LENGTH,
    );

    // A dispute, transfer, or recovery resolves against one listing, so one
    // arriving as `Profile: not given` costs a round trip before the operator
    // can start. Either identifier will do: someone reading a name off a
    // profile they cannot find the link for is the case the name field is for.
    // Feedback is about VRDex rather than about a record and asks for neither.
    if (
      profileSlug === undefined &&
      displayName === undefined &&
      TOPICS_REQUIRING_CONTACT.has(args.topic)
    ) {
      throw supportInputError("Tell us which profile this is about, by link or by name.");
    }

    const requestId = await ctx.db.insert("supportRequests", {
      topic: args.topic,
      ...optionalValue("profileSlug", profileSlug),
      // Precedence, strongest evidence first: the resolved record, then the
      // route of the link that was pasted, then the selector. The selector is
      // last because it silently defaults to `person`, and a pre-claim request
      // for a community that does not exist yet has no record to correct it.
      ...optionalValue(
        "profileType",
        profile?.profileType ?? requested?.profileType ?? args.profileType,
      ),
      ...optionalValue("displayName", displayName),
      ...optionalValue("requesterContact", contact),
      message,
      ...optionalValue("requester", requester),
      createdAt: now,
      updatedAt: now,
    });

    return { requestId };
  },
});

/**
 * Everything no digest has covered yet, from both intake tables, oldest first.
 *
 * Both, because the same form writes both and only one of them had a reader.
 * Nothing in the repo watched `profileSuppressionRequests` for `submitted`
 * rows, so an opt-out or a pre-claim safety report was told "Request sent" and
 * then sat unseen until somebody happened to open the Convex dashboard. That is
 * the failure this whole change exists to end, and half of it was still here.
 *
 * Each side seeks on its own `notifiedAt` being unset rather than paging and
 * filtering, so the cost is the size of the backlog and not of the table. They
 * are merged and re-sorted afterwards, so a mail covering both reads in arrival
 * order rather than in table order.
 */
export const pendingDigestRequests = internalQuery({
  args: { limit: v.optional(v.number()) },
  handler: async (ctx, args) => {
    const limit = Math.max(
      1,
      Math.min(args.limit ?? SUPPORT_DIGEST_BATCH_SIZE, SUPPORT_DIGEST_BATCH_SIZE),
    );

    const supportRows = await ctx.db
      .query("supportRequests")
      .withIndex("by_notifiedAt_createdAt", (query) => query.eq("notifiedAt", undefined))
      .order("asc")
      .take(limit);

    // `submitted` only, and seeked on it rather than filtered after the fact.
    // `notifiedAt` is newer than this table, so every row written before it
    // reads as unnotified, accepted and rejected ones included. Filtering a
    // page after taking it meant fifty old resolved rows returned the same
    // useless prefix on every run, and no newer opt-out or safety report was
    // ever mailed. A request resolved between two runs drops out the same way,
    // which is right: it has already been dealt with.
    const suppressionRows = await ctx.db
      .query("profileSuppressionRequests")
      .withIndex("by_state_notifiedAt_createdAt", (query) =>
        query.eq("state", "submitted").eq("notifiedAt", undefined),
      )
      .order("asc")
      .take(limit);

    const entries = [
      ...supportRows.map((request) => ({
        table: "supportRequests" as const,
        id: request._id as string,
        topic: request.topic as string,
        profileSlug: request.profileSlug ?? null,
        profileType: request.profileType ?? null,
        displayName: request.displayName ?? null,
        requesterContact: request.requesterContact ?? null,
        // The signed-in identity, when there was one. Included because "the
        // person asking is already signed in as someone" is usually the first
        // thing an ownership dispute turns on.
        requesterSubject: request.requester?.subject ?? null,
        message: request.message,
        createdAt: request.createdAt,
      })),
      ...suppressionRows.map((request) => ({
        table: "profileSuppressionRequests" as const,
        id: request._id as string,
        topic: request.requestType as string,
        profileSlug: request.profileSlug ?? null,
        profileType: request.profileType ?? null,
        displayName: request.displayName ?? null,
        requesterContact: request.requesterContact ?? null,
        requesterSubject: request.requester?.subject ?? null,
        message: request.requesterNote ?? "",
        createdAt: request.createdAt,
      })),
    ];

    return entries.sort((left, right) => left.createdAt - right.createdAt).slice(0, limit);
  },
});

/**
 * Stamp the requests a digest actually delivered, in whichever table holds them.
 *
 * Called after the send, never before. A crash between the two resends the same
 * rows an hour later, which is noise; stamping first would drop a dispute with
 * nothing left to notice it. Rows deleted in between are skipped rather than
 * failing the batch.
 */
export const markDigestSent = internalMutation({
  args: {
    supportRequestIds: v.array(v.id("supportRequests")),
    suppressionRequestIds: v.array(v.id("profileSuppressionRequests")),
    now: v.optional(v.number()),
  },
  handler: async (ctx, args) => {
    const now = args.now ?? Date.now();
    let marked = 0;

    for (const requestId of [...args.supportRequestIds, ...args.suppressionRequestIds]) {
      const request = await ctx.db.get(requestId);

      // Already stamped means a previous run delivered it and this one is a
      // retry after a failure that happened past the send. Leave the original
      // timestamp: it records when the operator was actually told.
      if (request === null || request.notifiedAt !== undefined) {
        continue;
      }

      await ctx.db.patch(requestId, { notifiedAt: now, updatedAt: now });
      marked += 1;
    }

    return { marked };
  },
});
