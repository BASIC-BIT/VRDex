import { v } from "convex/values";

import type { Doc } from "./_generated/dataModel";
import { internalMutation, internalQuery, mutation } from "./_generated/server";
import { activeBrowserSessionSubjectOrNull } from "./_browserSessionAuthority";
import { getProfileBySlug, resolveRequestedProfileSlug } from "./_profileSlugs";
import { normalizeProfileInlineText } from "./_profileSubmissions";

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

const MESSAGE_MAX_LENGTH = 4_000;
const MESSAGE_MIN_LENGTH = 10;
const CONTACT_MAX_LENGTH = 160;
const DISPLAY_NAME_MAX_LENGTH = 120;

/**
 * How many requests one digest covers.
 *
 * The form is public and unauthenticated, so this is the bound on what a flood
 * can do to a single email rather than an expectation about volume. Anything
 * past the cap keeps its unset `notifiedAt` and rides the next run.
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
  // Sliced before the passes below, not after. This mutation is public and
  // unauthenticated, so the argument size is whatever a caller sends, and
  // running four regex passes over it before trimming means the work scales
  // with what an attacker chooses rather than with what is kept. The generous
  // headroom is so trailing whitespace cannot push real text over the edge.
  return input
    .slice(0, MESSAGE_MAX_LENGTH * 2)
    .replace(/\r\n?/g, "\n")
    .split("\n")
    .map((line) => line.trimEnd())
    .join("\n")
    .replace(/\n{3,}/g, "\n\n")
    .trim()
    .slice(0, MESSAGE_MAX_LENGTH);
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
    displayName: v.optional(v.string()),
    requesterContact: v.optional(v.string()),
    message: v.string(),
  },
  handler: async (ctx, args) => {
    const now = Date.now();
    const requester = (await activeBrowserSessionSubjectOrNull(ctx))?.subject;
    const message = normalizeMessage(args.message);

    if (message.length < MESSAGE_MIN_LENGTH) {
      throw new Error("Tell us a little more about what you need.");
    }

    const contact = optionalText(args.requesterContact, CONTACT_MAX_LENGTH);

    // Checked against the topic rather than the session. A signed-in requester
    // still gets asked, because the account that holds the session is often not
    // the address the answer should go to -- recovery is exactly the case where
    // it cannot be.
    if (contact === undefined && TOPICS_REQUIRING_CONTACT.has(args.topic)) {
      throw new Error("Add a contact so we can reply.");
    }

    const profileSlug = resolveRequestedProfileSlug(args.profileSlug);

    // Resolved only to borrow the display name when the requester left it blank.
    // A slug with no profile behind it is still recorded: someone disputing a
    // listing may be reading it off a URL that has since changed, and dropping
    // it would discard the only identifier they had.
    const profile = profileSlug === undefined ? null : await getProfileBySlug(ctx.db, profileSlug);

    const requestId = await ctx.db.insert("supportRequests", {
      topic: args.topic,
      ...optionalValue("profileSlug", profileSlug),
      ...optionalValue(
        "displayName",
        optionalText(args.displayName ?? profile?.displayName, DISPLAY_NAME_MAX_LENGTH),
      ),
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
 * The requests no digest has covered yet, oldest first.
 *
 * Seeks on `notifiedAt` being unset rather than paging and filtering, so the
 * cost is the size of the backlog and not the size of the table.
 */
export const pendingDigestRequests = internalQuery({
  args: { limit: v.optional(v.number()) },
  handler: async (ctx, args) => {
    const requests = await ctx.db
      .query("supportRequests")
      .withIndex("by_notifiedAt_createdAt", (query) => query.eq("notifiedAt", undefined))
      .order("asc")
      .take(Math.min(args.limit ?? SUPPORT_DIGEST_BATCH_SIZE, SUPPORT_DIGEST_BATCH_SIZE));

    return requests.map((request) => ({
      id: request._id,
      topic: request.topic,
      profileSlug: request.profileSlug ?? null,
      displayName: request.displayName ?? null,
      requesterContact: request.requesterContact ?? null,
      // The signed-in identity, when there was one. Included because "the person
      // asking is already signed in as someone" is usually the first thing an
      // ownership dispute turns on.
      requesterSubject: request.requester?.subject ?? null,
      message: request.message,
      createdAt: request.createdAt,
    }));
  },
});

/**
 * Stamp the requests a digest actually delivered.
 *
 * Called after the send, never before. A crash between the two resends the same
 * rows an hour later, which is noise; stamping first would drop a dispute with
 * nothing left to notice it. Rows deleted in between are skipped rather than
 * failing the batch.
 */
export const markDigestSent = internalMutation({
  args: {
    requestIds: v.array(v.id("supportRequests")),
    now: v.optional(v.number()),
  },
  handler: async (ctx, args) => {
    const now = args.now ?? Date.now();
    let marked = 0;

    for (const requestId of args.requestIds) {
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
