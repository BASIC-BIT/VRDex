import { randomUUID } from "node:crypto";

/**
 * Clerk is the identity provider, so a test subject is a Clerk user id that
 * must match `users.clerkUserId` — there is no session row to fabricate and no
 * `userId|sessionId` subject format any more.
 *
 * Ids are unique per call so a seed helper invoked twice in one test does not
 * produce two `users` rows sharing a `clerkUserId`, which would make the
 * `clerkUserId` index lookup throw on `unique()`.
 */
export function newClerkUserId(prefix = "user") {
  return `${prefix}_${randomUUID().replaceAll("-", "")}`;
}

export function clerkTestIdentity(clerkUserId: string) {
  return {
    subject: clerkUserId,
    issuer: "https://test.clerk.accounts.dev",
    tokenIdentifier: `https://test.clerk.accounts.dev|${clerkUserId}`,
  };
}
