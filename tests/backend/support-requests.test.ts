import assert from "node:assert/strict";
import { describe, it } from "node:test";

import { convexTest } from "convex-test";

import { api, internal } from "../../convex/_generated/api";
import type { Id } from "../../convex/_generated/dataModel";
import schemaModule from "../../convex/schema";
import { readProfileReferenceFromInput, readProfileSlugFromInput } from "../../convex/_profileSlugs";
import { clerkTestIdentity, newClerkUserId } from "./_clerkTestIdentity";
import {
  MAX_ANONYMOUS_REQUESTS_PER_HOUR,
  SUPPORT_DIGEST_BATCH_SIZE,
} from "../../convex/_supportIntake";
import { formatDigestEntry, supportDigestConfig } from "../../convex/_supportDigest";

// `supportRequestDigest.ts` is deliberately absent. It is a `"use node"` module,
// so importing it loads the AWS SES client, whose CJS bundle does not survive
// this runner's ESM interop. Everything in it except the send itself lives in
// `_supportDigest.ts` for exactly that reason, and that is what is exercised
// here.
const modules = {
  "../../convex/_generated/api.ts": () => import("../../convex/_generated/api"),
  "../../convex/supportRequests.ts": () => import("../../convex/supportRequests"),
  "../../convex/suppressions.ts": () => import("../../convex/suppressions"),
};

// The intake resolves a pasted absolute URL only when its host is this
// deployment's, so these tests have to say which deployment they are.
process.env.SITE_URL = "https://vrdex.net";
const schema = (
  schemaModule as unknown as { default?: typeof schemaModule }
).default ?? schemaModule;

describe("support request intake", () => {
  it("accepts an anonymous request and keeps the message readable", async () => {
    const t = convexTest({ schema, modules });

    await t.mutation(api.supportRequests.submitSupportRequest, {
      topic: "recovery",
      displayName: "DJ Aurora",
      requesterContact: "  someone@example.test  ",
      message: "I lost my Discord.\r\n\r\n\r\n\r\nThe profile is still mine.   ",
    });

    const stored = await t.run(async (ctx) => ctx.db.query("supportRequests").collect());

    assert.equal(stored.length, 1);
    assert.equal(stored[0].topic, "recovery");
    assert.equal(stored[0].requesterContact, "someone@example.test");
    assert.equal(stored[0].requester, undefined);
    assert.equal(stored[0].notifiedAt, undefined);
    // Paragraphs survive, runs of blank lines and trailing space do not. A
    // dispute arrives structured, and flattening it costs the person who has to
    // act on it the only structure they gave.
    assert.equal(stored[0].message, "I lost my Discord.\n\nThe profile is still mine.");
  });

  /**
   * The three actionable topics all end in a reply to a human. Feedback is the
   * opposite case, where demanding an address only suppresses the feedback.
   */
  it("requires a contact for actionable topics but not for feedback", async () => {
    const t = convexTest({ schema, modules });

    for (const topic of ["ownership_dispute", "transfer", "recovery"] as const) {
      await assert.rejects(
        () =>
          t.mutation(api.supportRequests.submitSupportRequest, {
            topic,
            message: "This profile is about me and someone else claimed it.",
          }),
        /Add a contact so we can reply/,
        `${topic} should require a contact`,
      );
    }

    await t.mutation(api.supportRequests.submitSupportRequest, {
      topic: "feedback",
      message: "The claim page could say what happens next.",
    });

    const stored = await t.run(async (ctx) => ctx.db.query("supportRequests").collect());

    assert.equal(stored.length, 1);
    assert.equal(stored[0].topic, "feedback");
    assert.equal(stored[0].requesterContact, undefined);
  });

  it("refuses a message with nothing in it", async () => {
    const t = convexTest({ schema, modules });

    await assert.rejects(
      () =>
        t.mutation(api.supportRequests.submitSupportRequest, {
          topic: "feedback",
          message: "   \n\n  ",
        }),
      /Tell us a little more/,
    );
  });

  it("reads a slug out of a pasted profile link and borrows the stored display name", async () => {
    const t = convexTest({ schema, modules });
    const now = Date.now();

    await t.run(async (ctx) => {
      await ctx.db.insert("profiles", {
        profileType: "person",
        slug: "dj-aurora",
        displayName: "DJ Aurora",
        sortName: "dj aurora",
        aliases: [],
        tags: [],
        claimState: "unclaimed",
        publicationState: "published",
        publicSurfacingState: "public",
        creationSource: "concierge",
        person: { roleTags: [] },
        updatedAt: now,
      });
    });

    await t.mutation(api.supportRequests.submitSupportRequest, {
      topic: "ownership_dispute",
      profileSlug: "https://vrdex.net/p/dj-aurora",
      requesterContact: "someone@example.test",
      message: "That listing is about me and I did not claim it.",
    });

    const stored = await t.run(async (ctx) => ctx.db.query("supportRequests").collect());

    assert.equal(stored[0].profileSlug, "dj-aurora");
    assert.equal(stored[0].displayName, "DJ Aurora");
  });

  /**
   * One form feeds two mutations, and its profile field says "paste the profile
   * link" on every topic. Parsing that on only one path meant the same link
   * resolved for a dispute and was rejected for an opt-out.
   */
  it("takes the same pasted link on the suppression topics", async () => {
    const t = convexTest({ schema, modules });

    await t.mutation(api.suppressions.requestProfileSuppression, {
      requestType: "owner_opt_out",
      profileSlug: "https://vrdex.net/p/dj-aurora",
      requesterNote: "This listing is mine and I would like it hidden.",
    });

    const stored = await t.run(async (ctx) =>
      ctx.db.query("profileSuppressionRequests").collect(),
    );

    assert.equal(stored.length, 1);
    assert.equal(stored[0].profileSlug, "dj-aurora");
  });

  /**
   * Rejected rather than silently dropped. Losing the only identifier someone
   * gave, without telling them, is worse than making them paste it again.
   */
  it("says what to paste when the profile field holds something else", async () => {
    const t = convexTest({ schema, modules });

    await assert.rejects(
      () =>
        t.mutation(api.supportRequests.submitSupportRequest, {
          topic: "transfer",
          profileSlug: "!!!",
          requesterContact: "someone@example.test",
          message: "I want to hand this profile to someone else.",
        }),
      /Paste the profile link/,
    );
  });
});

describe("support request digest", () => {
  it("covers only unstamped requests and stamps exactly those", async () => {
    const t = convexTest({ schema, modules });

    for (const suffix of ["first", "second"]) {
      await t.mutation(api.supportRequests.submitSupportRequest, {
        topic: "feedback",
        message: `Something worth saying, the ${suffix} one.`,
      });
    }

    const firstBatch = await t.query(internal.supportRequests.pendingDigestRequests, {});

    assert.equal(firstBatch.length, 2);
    // Oldest first, so a backlog is read in the order it arrived.
    assert.ok(firstBatch[0].createdAt <= firstBatch[1].createdAt);

    const { marked } = await t.mutation(internal.supportRequests.markDigestSent, {
      supportRequestIds: firstBatch.map((request) => request.id as Id<"supportRequests">),
      suppressionRequestIds: [],
    });

    assert.equal(marked, 2);
    assert.deepEqual(await t.query(internal.supportRequests.pendingDigestRequests, {}), []);

    await t.mutation(api.supportRequests.submitSupportRequest, {
      topic: "feedback",
      message: "One that arrived after the first digest went out.",
    });

    const secondBatch = await t.query(internal.supportRequests.pendingDigestRequests, {});

    assert.equal(secondBatch.length, 1);
    assert.match(secondBatch[0].message, /after the first digest/);
  });

  /**
   * The action sends before it stamps, so a failure past the send replays the
   * whole batch. Re-stamping would move the record of when an operator was
   * actually told, so an already-stamped row is left alone.
   */
  it("keeps the original timestamp when a batch is stamped twice", async () => {
    const t = convexTest({ schema, modules });

    await t.mutation(api.supportRequests.submitSupportRequest, {
      topic: "feedback",
      message: "A request that gets delivered twice.",
    });

    const batch = await t.query(internal.supportRequests.pendingDigestRequests, {});
    const supportRequestIds = batch.map((request) => request.id as Id<"supportRequests">);

    await t.mutation(internal.supportRequests.markDigestSent, {
      supportRequestIds,
      suppressionRequestIds: [],
      now: 1_000,
    });
    const second = await t.mutation(internal.supportRequests.markDigestSent, {
      supportRequestIds,
      suppressionRequestIds: [],
      now: 2_000,
    });

    assert.equal(second.marked, 0);

    const stored = await t.run(async (ctx) => ctx.db.query("supportRequests").collect());

    assert.equal(stored[0].notifiedAt, 1_000);
  });

  it("skips a request deleted between the send and the stamp", async () => {
    const t = convexTest({ schema, modules });

    await t.mutation(api.supportRequests.submitSupportRequest, {
      topic: "feedback",
      message: "A request that does not survive the round trip.",
    });

    const batch = await t.query(internal.supportRequests.pendingDigestRequests, {});

    await t.run(async (ctx) => {
      await ctx.db.delete(batch[0].id as Id<"supportRequests">);
    });

    const result = await t.mutation(internal.supportRequests.markDigestSent, {
      supportRequestIds: batch.map((request) => request.id as Id<"supportRequests">),
      suppressionRequestIds: [],
    });

    assert.equal(result.marked, 0);
  });

  /**
   * A deployment that has never configured a recipient is the normal state, not
   * a broken one. The action reports absence rather than throwing, or the cron
   * fails hourly on every such deployment with nothing to fix. Requests keep
   * their unset `notifiedAt` meanwhile, so configuring a recipient later
   * delivers the backlog instead of starting from whatever arrives next.
   */
  it("reports an unconfigured deployment rather than failing on it", () => {
    const ses = {
      AWS_SES_FROM_EMAIL: "no-reply@vrdex.net",
      AWS_SES_REGION: "us-east-1",
    };

    assert.equal(supportDigestConfig(ses), null);
    assert.equal(supportDigestConfig({ ...ses, VRDEX_SUPPORT_DIGEST_TO: "   " }), null);
    // A recipient without SES is a broken mail deployment, not a disabled one.
    // Returning null there let the cron succeed hourly while disputes piled up.
    assert.throws(
      () => supportDigestConfig({ VRDEX_SUPPORT_DIGEST_TO: "ops@vrdex.net" }),
      /cannot be delivered/,
    );

    const configured = supportDigestConfig({
      ...ses,
      VRDEX_SUPPORT_DIGEST_TO: "ops@vrdex.net",
      SITE_URL: "https://vrdex.net/",
    });

    assert.equal(configured?.recipient, "ops@vrdex.net");
    // Trailing slash stripped, so profile links in the body do not double up.
    assert.equal(configured?.siteUrl, "https://vrdex.net");
  });
});

describe("support request helpers", () => {
  it("reads a slug from the shapes people actually paste", () => {
    assert.equal(readProfileSlugFromInput("dj-aurora", "https://vrdex.net"), "dj-aurora");
    assert.equal(readProfileSlugFromInput("  DJ Aurora  ", "https://vrdex.net"), "dj-aurora");
    assert.equal(readProfileSlugFromInput("https://vrdex.net/p/dj-aurora", "https://vrdex.net"), "dj-aurora");
    assert.equal(
      readProfileSlugFromInput("https://vrdex.net/c/afterglow-social?x=1", "https://vrdex.net"),
      "afterglow-social",
    );
    assert.equal(readProfileSlugFromInput("vrdex.net/p/dj-aurora", "https://vrdex.net"), "dj-aurora");
    assert.equal(readProfileSlugFromInput("", "https://vrdex.net"), "");
    // A bare origin carries no profile, and normalizing the host would invent a
    // slug-shaped string that resolves to nothing.
    assert.equal(readProfileSlugFromInput("https://vrdex.net", "https://vrdex.net"), "");
    // Evidence links are the common paste into this field, and any dotted host
    // used to qualify: the last segment became a valid-looking slug pointing at
    // some unrelated profile while the URL that mattered was thrown away.
    assert.equal(readProfileSlugFromInput("https://vrchat.com/home/user/usr_123", "https://vrdex.net"), "");
    assert.equal(readProfileSlugFromInput("https://discord.gg/abcdef", "https://vrdex.net"), "");
    assert.equal(readProfileSlugFromInput("https://vrdex.net/w/neon-harbor", "https://vrdex.net"), "");
  });

  it("names a missing contact rather than leaving a gap in the digest", () => {
    const entry = formatDigestEntry(
      {
        table: "supportRequests" as const,
        id: "irrelevant",
        topic: "feedback",
        profileSlug: null,
        profileType: null,
        displayName: null,
        requesterContact: null,
        requesterSubject: null,
        message: "Anonymous feedback.",
        createdAt: 0,
      },
      undefined,
    );

    assert.match(entry, /Reply to: not given/);
    assert.match(entry, /Signed in as: not signed in/);
    assert.match(entry, /Profile: not given/);
  });

  it("links the profile when the deployment knows its own origin", () => {
    const entry = formatDigestEntry(
      {
        table: "supportRequests" as const,
        id: "irrelevant",
        topic: "ownership_dispute",
        profileSlug: "dj-aurora",
        profileType: "person" as const,
        displayName: "DJ Aurora",
        requesterContact: "someone@example.test",
        requesterSubject: "user_123",
        message: "That listing is about me.",
        createdAt: 0,
      },
      "https://vrdex.net",
    );

    assert.match(entry, /Ownership dispute/);
    assert.match(entry, /https:\/\/vrdex\.net\/p\/dj-aurora/);
  });
});

describe("support request review findings", () => {
  /**
   * The whole point of this change was that requests stop landing where nobody
   * looks, and half of it still did: nothing read `profileSuppressionRequests`,
   * so an opt-out or a safety report was told "Request sent" and then sat.
   */
  it("puts suppression requests in the same digest as the rest", async () => {
    const t = convexTest({ schema, modules });

    await t.mutation(api.suppressions.requestProfileSuppression, {
      requestType: "pre_claim_safety",
      displayName: "DJ Aurora",
      profileType: "person",
      requesterNote: "This listing puts a real person at risk.",
    });
    await t.mutation(api.supportRequests.submitSupportRequest, {
      topic: "feedback",
      message: "Unrelated feedback that arrived after it.",
    });

    const batch = await t.query(internal.supportRequests.pendingDigestRequests, {});

    assert.equal(batch.length, 2);
    // Both tables reach one digest. Which of two rows written in the same
    // millisecond sorts first is a tie this does not depend on.
    assert.deepEqual(
      [...new Set(batch.map((entry) => entry.table))].sort(),
      ["profileSuppressionRequests", "supportRequests"],
    );

    const { marked } = await t.mutation(internal.supportRequests.markDigestSent, {
      supportRequestIds: batch
        .filter((entry) => entry.table === "supportRequests")
        .map((entry) => entry.id as Id<"supportRequests">),
      suppressionRequestIds: batch
        .filter((entry) => entry.table === "profileSuppressionRequests")
        .map((entry) => entry.id as Id<"profileSuppressionRequests">),
    });

    assert.equal(marked, 2);
    assert.deepEqual(await t.query(internal.supportRequests.pendingDigestRequests, {}), []);
  });

  /**
   * A name-only suppression with no type makes the acceptance resolver scan
   * people *and* communities, so accepting one opt-out for a common name could
   * retract every namesake of both kinds.
   */
  it("keeps the profile type on a name-only suppression", async () => {
    const t = convexTest({ schema, modules });

    await t.mutation(api.suppressions.requestProfileSuppression, {
      requestType: "owner_opt_out",
      displayName: "Aurora",
      profileType: "community",
      requesterNote: "We run this community and want it delisted.",
    });

    const stored = await t.run(async (ctx) =>
      ctx.db.query("profileSuppressionRequests").collect(),
    );

    assert.equal(stored[0].profileType, "community");
  });

  it("requires a profile on the topics that resolve against one", async () => {
    const t = convexTest({ schema, modules });

    await assert.rejects(
      () =>
        t.mutation(api.supportRequests.submitSupportRequest, {
          topic: "ownership_dispute",
          requesterContact: "someone@example.test",
          message: "Someone took the listing that is about me.",
        }),
      /Tell us which profile this is about/,
    );

    // Feedback is about VRDex rather than about a record, so it asks for none.
    await t.mutation(api.supportRequests.submitSupportRequest, {
      topic: "feedback",
      message: "The claim page could say what happens next.",
    });

    assert.equal((await t.run(async (ctx) => ctx.db.query("supportRequests").collect())).length, 1);
  });

  /**
   * Truncating reported success and then dropped whatever came last, which on a
   * dispute is the evidence links people put at the end.
   */
  it("refuses oversized messages and contacts instead of trimming them", async () => {
    const t = convexTest({ schema, modules });

    await assert.rejects(
      () =>
        t.mutation(api.supportRequests.submitSupportRequest, {
          topic: "feedback",
          message: "x".repeat(4_001),
        }),
      /longer than we can store/,
    );

    await assert.rejects(
      () =>
        t.mutation(api.supportRequests.submitSupportRequest, {
          topic: "recovery",
          displayName: "DJ Aurora",
          requesterContact: `${"a".repeat(160)}@example.test`,
          message: "I lost the account that holds this profile.",
        }),
      /contact is too long/,
    );

    await assert.rejects(
      () =>
        t.mutation(api.suppressions.requestProfileSuppression, {
          requestType: "owner_opt_out",
          displayName: "DJ Aurora",
          requesterNote: "x".repeat(1_001),
        }),
      /longer than we can store/,
    );
  });
});

describe("support digest formatting", () => {
  /**
   * The message is written by an anonymous stranger and the entry separator is
   * a run of hyphens, so pasted raw a requester could append a second entry with
   * forged contact and identity fields, in the one mailbox an ownership decision
   * is made from.
   */
  it("cannot be made to forge a second entry", () => {
    const forged = [
      "Please hand me this profile.",
      "",
      "-".repeat(60),
      "",
      "Ownership dispute at 1970-01-01T00:00:00.000Z",
      "Profile: someone-else",
      "Reply to: attacker@example.test",
      "Signed in as: user_trustme",
    ].join("\n");

    const entry = formatDigestEntry(
      {
        table: "supportRequests" as const,
        id: "abc",
        topic: "transfer",
        profileSlug: null,
        profileType: null,
        displayName: "DJ Aurora",
        requesterContact: "real@example.test",
        requesterSubject: null,
        message: forged,
        createdAt: 0,
      },
      undefined,
    );

    // Exactly one of each field line, all of them written by this file.
    assert.equal(entry.split("\n").filter((line) => line.startsWith("Reply to: ")).length, 1);
    assert.equal(entry.split("\n").filter((line) => line.startsWith("Signed in as: ")).length, 1);
    assert.equal(entry.split("\n").filter((line) => line === "-".repeat(60)).length, 0);
    // The forged text still arrives, just unmistakably as the requester's.
    assert.match(entry, /> Reply to: attacker@example\.test/);
  });

  /**
   * `/p/` and `/c/` each fetch by type, so a community slug under `/p/` is a
   * 404 for exactly the disputes that concern communities.
   */
  it("links a community to the community route", () => {
    const entry = formatDigestEntry(
      {
        table: "profileSuppressionRequests" as const,
        id: "abc",
        topic: "owner_opt_out",
        profileSlug: "afterglow-social",
        profileType: "community",
        displayName: null,
        requesterContact: null,
        requesterSubject: null,
        message: "We want this delisted.",
        createdAt: 0,
      },
      "https://vrdex.net",
    );

    assert.match(entry, /https:\/\/vrdex\.net\/c\/afterglow-social/);
    assert.doesNotMatch(entry, /\/p\/afterglow-social/);
    assert.match(entry, /Owner opt-out/);
  });
});

describe("support request review findings, second round", () => {
  /**
   * Convex redacts plain `Error` messages on production deployments, so every
   * fixable refusal here would have reached a real visitor as the generic
   * backend sentence while looking correct in development.
   */
  it("carries correctable refusals in structured data", async () => {
    const t = convexTest({ schema, modules });

    await assert.rejects(
      () =>
        t.mutation(api.supportRequests.submitSupportRequest, {
          topic: "feedback",
          profileSlug: "https://vrchat.com/home/user/usr_123",
          message: "Pasting my evidence into the wrong field.",
        }),
      (error: unknown) => {
        const data = (error as { data?: { code?: string; message?: string } }).data;

        assert.equal(data?.code, "SUPPORT_INPUT_INVALID");
        assert.match(data?.message ?? "", /Paste the profile link/);
        return true;
      },
    );
  });

  /**
   * Signed in used to mean exempt. Nothing requires a verified email, so one
   * throwaway account could out-run the digest and queue ahead of every real
   * dispute, which is what the ceiling exists to stop.
   */
  it("caps a signed-in requester's own share of the backlog", async () => {
    const t = convexTest({ schema, modules });
    const identity = clerkTestIdentity(newClerkUserId());
    const signedIn = t.withIdentity(identity);

    await t.run(async (ctx) => {
      await ctx.db.insert("users", {
        clerkUserId: identity.subject,
        email: "flooder@example.test",
        emailVerificationTime: Date.now(),
      });
    });

    for (let index = 0; index < 10; index += 1) {
      await signedIn.mutation(api.supportRequests.submitSupportRequest, {
        topic: "feedback",
        message: `Message number ${index} from one account.`,
      });
    }

    await assert.rejects(
      () =>
        signedIn.mutation(api.supportRequests.submitSupportRequest, {
          topic: "feedback",
          message: "One more than the ceiling allows.",
        }),
      /already have several requests waiting/,
    );

    // Someone else is unaffected: the ceiling is per subject, so one account
    // cannot spend a shared allowance and lock everybody out.
    await t.mutation(api.supportRequests.submitSupportRequest, {
      topic: "feedback",
      message: "An unrelated visitor with something to say.",
    });
  });

  /**
   * `notifiedAt` is new, so every suppression row written before it reads as
   * unnotified. Without a state check the first digest after deploy announces
   * the whole history, resolved rows included, ahead of current disputes.
   */
  it("leaves resolved suppression requests out of the digest", async () => {
    const t = convexTest({ schema, modules });
    const now = Date.now();

    await t.run(async (ctx) => {
      for (const state of ["accepted", "rejected", "under_review", "submitted"] as const) {
        await ctx.db.insert("profileSuppressionRequests", {
          displayName: `Historic ${state}`,
          requestType: "owner_opt_out",
          state,
          createdAt: now,
          updatedAt: now,
        });
      }
    });

    const batch = await t.query(internal.supportRequests.pendingDigestRequests, {});

    assert.equal(batch.length, 1);
    assert.equal(batch[0].displayName, "Historic submitted");
  });

  /**
   * The form's own `maxLength` invites exactly 160 characters, so rejecting at
   * the boundary refused input the page said was fine.
   */
  it("accepts a contact of exactly the advertised maximum", async () => {
    const t = convexTest({ schema, modules });
    const exactly160 = `${"a".repeat(147)}@example.test`;

    assert.equal(exactly160.length, 160);

    await t.mutation(api.supportRequests.submitSupportRequest, {
      topic: "recovery",
      displayName: "DJ Aurora",
      requesterContact: exactly160,
      message: "I lost the account that holds this profile.",
    });

    const stored = await t.run(async (ctx) => ctx.db.query("supportRequests").collect());

    assert.equal(stored[0].requesterContact, exactly160);
  });

  it("refuses an oversized contact on the suppression path too", async () => {
    const t = convexTest({ schema, modules });

    await assert.rejects(
      () =>
        t.mutation(api.suppressions.requestProfileSuppression, {
          requestType: "owner_opt_out",
          displayName: "DJ Aurora",
          requesterContact: `${"a".repeat(160)}@example.test`,
          requesterNote: "Please delist this.",
        }),
      /contact is too long/,
    );
  });
});

describe("support request review findings, third round", () => {
  /**
   * Every one of these was the same mistake: filtering a page after taking it.
   * Once the prefix is full of rows the filter removes, the query returns
   * nothing useful and the guard it feeds stops working.
   */
  it("counts a subject's own backlog even behind a full queue", async () => {
    const t = convexTest({ schema, modules });
    const identity = clerkTestIdentity(newClerkUserId());
    const signedIn = t.withIdentity(identity);
    const now = Date.now();

    await t.run(async (ctx) => {
      await ctx.db.insert("users", {
        clerkUserId: identity.subject,
        email: "flooder@example.test",
        emailVerificationTime: now,
      });

      // Somebody else's backlog, larger than the page the quota check reads.
      //
      // Thirty, not the two hundred an earlier version used: the shared ceiling
      // applies to signed-in senders now, so a queue that large refuses this
      // account for the right reason and stops testing the wrong thing. Ten is
      // what the per-subject query takes, so thirty foreign rows is already more
      // than enough to defeat the filter-a-page shape this pins.
      for (let index = 0; index < 30; index += 1) {
        await ctx.db.insert("supportRequests", {
          topic: "feedback",
          message: `Unrelated pending request ${index}.`,
          // Attributed to somebody, so these are not anonymous arrivals inside
          // the rate window.
          requester: {
            tokenIdentifier: "test|somebody-else",
            issuer: "test",
            subject: "somebody-else",
          },
          createdAt: now - 30 + index,
          updatedAt: now,
        });
      }
    });

    for (let index = 0; index < 10; index += 1) {
      await signedIn.mutation(api.supportRequests.submitSupportRequest, {
        topic: "feedback",
        message: `Message number ${index} from one account.`,
      });
    }

    await assert.rejects(
      () =>
        signedIn.mutation(api.supportRequests.submitSupportRequest, {
          topic: "feedback",
          message: "One more than the ceiling allows.",
        }),
      /already have several requests waiting/,
    );
  });

  /**
   * Resolved suppressions predate `notifiedAt` and nothing stamps them, so a
   * page of them returned the same useless prefix forever and no newer report
   * was ever mailed.
   */
  it("reaches new suppressions behind a page of resolved ones", async () => {
    const t = convexTest({ schema, modules });
    const now = Date.now();

    await t.run(async (ctx) => {
      for (let index = 0; index < 60; index += 1) {
        await ctx.db.insert("profileSuppressionRequests", {
          displayName: `Historic ${index}`,
          requestType: "owner_opt_out",
          state: "accepted",
          // Attributed, so seeded history counts as somebody's rather than as
          // anonymous arrivals inside the rate window. This test is about the
          // digest reaching past resolved rows; the window has its own.
          requester: {
            tokenIdentifier: "test|historic",
            issuer: "test",
            subject: "historic-operator",
          },
          createdAt: now - 60 + index,
          updatedAt: now,
        });
      }
    });

    await t.mutation(api.suppressions.requestProfileSuppression, {
      requestType: "pre_claim_safety",
      displayName: "Someone at risk",
      profileType: "person",
      requesterNote: "This listing needs review.",
    });

    const batch = await t.query(internal.supportRequests.pendingDigestRequests, {});

    assert.equal(batch.length, 1);
    assert.equal(batch[0].displayName, "Someone at risk");
  });

  /**
   * The same resolved rows counted toward the anonymous ceiling, and since the
   * digest never stamps them, waiting could not clear it: intake would have
   * been refused permanently on any deployment with a suppression history.
   */
  it("does not let resolved suppressions wedge intake shut", async () => {
    const t = convexTest({ schema, modules });
    const now = Date.now();

    await t.run(async (ctx) => {
      for (let index = 0; index < 220; index += 1) {
        await ctx.db.insert("profileSuppressionRequests", {
          displayName: `Historic ${index}`,
          requestType: "owner_opt_out",
          state: "accepted",
          // Attributed, so these count as somebody's history rather than as
          // anonymous arrivals inside the rate window. This test is about the
          // pending ceiling; the window has its own.
          requester: {
            tokenIdentifier: "test|historic",
            issuer: "test",
            subject: "historic-operator",
          },
          createdAt: now - 220 + index,
          updatedAt: now,
        });
      }
    });

    await t.mutation(api.supportRequests.submitSupportRequest, {
      topic: "feedback",
      message: "An ordinary request on a deployment with history.",
    });
  });

  /**
   * A pre-normalization slice let whitespace-heavy input shrink back under the
   * limit, so the request succeeded with everything past the cut discarded.
   */
  it("refuses a message whose ending would be dropped", async () => {
    const t = convexTest({ schema, modules });
    const padded = `${"a".repeat(3_900)}${"\n".repeat(5_000)}https://example.invalid/the-evidence`;

    await assert.rejects(
      () =>
        t.mutation(api.supportRequests.submitSupportRequest, {
          topic: "feedback",
          message: padded,
        }),
      /longer than we can store/,
    );
  });

  it("reads a profile link from a deployment without a dotted host", () => {
    assert.equal(readProfileSlugFromInput("http://localhost:3000/p/dj-aurora", "https://vrdex.net"), "dj-aurora");
    assert.equal(readProfileSlugFromInput("http://127.0.0.1:3210/c/afterglow-social", "https://vrdex.net"), "afterglow-social");
    assert.equal(readProfileSlugFromInput("http://[::1]:3000/p/dj-aurora", "https://vrdex.net"), "dj-aurora");
    // Still only the two profile routes, whatever the host.
    assert.equal(readProfileSlugFromInput("http://localhost:3000/w/neon-harbor", "https://vrdex.net"), "");
  });
});

describe("support request review findings, fourth round", () => {
  /**
   * A pre-claim request names a listing that does not exist yet, so no stored
   * record corrects a wrong type, and `hasAcceptedSuppression` checks type: the
   * listing someone asked to keep down could be published anyway.
   */
  it("takes the profile type from a pasted community link over the selector", async () => {
    const t = convexTest({ schema, modules });

    await t.mutation(api.suppressions.requestProfileSuppression, {
      requestType: "pre_claim_safety",
      profileSlug: "https://vrdex.net/c/afterglow-social",
      // What the form sends when nobody touches the selector.
      profileType: "person",
      requesterNote: "This community listing should not be published.",
    });

    const stored = await t.run(async (ctx) =>
      ctx.db.query("profileSuppressionRequests").collect(),
    );

    assert.equal(stored[0].profileType, "community");
  });

  /**
   * A subject's own resolved rows keep their unset watermark forever, so
   * counting them locked that account out of the form permanently.
   */
  it("does not count a subject's resolved suppressions against their quota", async () => {
    const t = convexTest({ schema, modules });
    const identity = clerkTestIdentity(newClerkUserId());
    const signedIn = t.withIdentity(identity);
    const now = Date.now();

    await t.run(async (ctx) => {
      await ctx.db.insert("users", {
        clerkUserId: identity.subject,
        email: "long-time-user@example.test",
        emailVerificationTime: now,
      });

      for (let index = 0; index < 12; index += 1) {
        await ctx.db.insert("profileSuppressionRequests", {
          displayName: `Handled ${index}`,
          requestType: "owner_opt_out",
          state: "accepted",
          requester: {
            tokenIdentifier: `${identity.issuer}|${identity.subject}`,
            issuer: identity.issuer,
            subject: identity.subject,
          },
          createdAt: now - 12 + index,
          updatedAt: now,
        });
      }
    });

    await signedIn.mutation(api.supportRequests.submitSupportRequest, {
      topic: "feedback",
      message: "Still able to reach support after a dozen resolved requests.",
    });
  });

  it("reads the route type out of a pasted link", () => {
    assert.deepEqual(readProfileReferenceFromInput("https://vrdex.net/c/afterglow-social", "https://vrdex.net"), {
      slug: "afterglow-social",
      profileType: "community",
    });
    assert.deepEqual(readProfileReferenceFromInput("https://vrdex.net/p/dj-aurora", "https://vrdex.net"), {
      slug: "dj-aurora",
      profileType: "person",
    });
    // A bare slug names no route, so it carries no type to trust.
    assert.deepEqual(readProfileReferenceFromInput("dj-aurora", "https://vrdex.net"), {
      slug: "dj-aurora",
      profileType: null,
    });
  });
});

describe("support request review findings, fifth round", () => {
  /**
   * The textarea is marked required, but `required` only rejects an empty
   * field: spaces satisfy it, normalize to nothing, and the note was omitted
   * entirely. An opt-out or safety report arrived reported as sent, explaining
   * nothing.
   */
  it("refuses a suppression with nothing written in it", async () => {
    const t = convexTest({ schema, modules });

    await assert.rejects(
      () =>
        t.mutation(api.suppressions.requestProfileSuppression, {
          requestType: "owner_opt_out",
          displayName: "DJ Aurora",
          requesterNote: "    \n\n   ",
        }),
      /Tell us a little more/,
    );
  });

  /**
   * A name is an identifier on these requests, so slicing it produced a
   * successful submission naming something other than the listing meant.
   */
  it("refuses an overlong display name rather than slicing it", async () => {
    const t = convexTest({ schema, modules });

    await assert.rejects(
      () =>
        t.mutation(api.supportRequests.submitSupportRequest, {
          topic: "transfer",
          displayName: "A".repeat(121),
          requesterContact: "someone@example.test",
          message: "I want to hand this profile to someone else.",
        }),
      /name is longer than we can store/,
    );

    // The boundary the form's own `maxLength` invites still goes through.
    await t.mutation(api.supportRequests.submitSupportRequest, {
      topic: "transfer",
      displayName: "A".repeat(120),
      requesterContact: "someone@example.test",
      message: "I want to hand this profile to someone else.",
    });
  });
});


describe("support request review findings, sixth round", () => {
  /**
   * A plaintext mail client breaks on U+2028 and U+2029 as well as LF, so
   * quoting only LF left everything after one of those on a rendered line with
   * no prefix, free to impersonate a field the formatter wrote.
   */
  it("quotes every Unicode line boundary, not only LF", () => {
    const forged = [
      "Please hand me this profile.",
      "\u2028Reply to: attacker@example.test",
      "\u2029Signed in as: user_trustme",
    ].join("");

    const entry = formatDigestEntry(
      {
        table: "supportRequests",
        id: "abc",
        topic: "transfer",
        profileSlug: null,
        profileType: null,
        displayName: "DJ Aurora",
        requesterContact: "real@example.test",
        requesterSubject: null,
        message: forged,
        createdAt: 0,
      },
      undefined,
    );

    // Split the way a mail client renders, then require every requester line to
    // carry the prefix. Exactly one of each field line survives, both written
    // by the formatter.
    const rendered = entry.split(/\r\n|[\n\r\u2028\u2029]/);

    assert.equal(rendered.filter((line) => line.startsWith("Reply to: ")).length, 1);
    assert.equal(rendered.filter((line) => line.startsWith("Signed in as: ")).length, 1);
    assert.match(entry, /> \u2028?Reply to: attacker@example\.test/);
  });

  /**
   * `resolveSuppressionTargetPage` falls back to scanning namesakes whenever
   * the slug resolves to nothing or to a profile that disagrees, and that
   * fallback retracts every match. Hiding the name behind the slug made an
   * acceptance look narrower than it is.
   */
  it("shows every identifier an acceptance could resolve through", () => {
    const entry = formatDigestEntry(
      {
        table: "profileSuppressionRequests",
        id: "abc",
        topic: "owner_opt_out",
        profileSlug: "dj-aurora",
        profileType: "person",
        displayName: "DJ Aurora",
        requesterContact: null,
        requesterSubject: null,
        message: "Please delist this.",
        createdAt: 0,
      },
      "https://vrdex.net",
    );

    assert.match(entry, /dj-aurora/);
    assert.match(entry, /name "DJ Aurora"/);
    assert.match(entry, /person/);
  });
});


describe("support request review findings, seventh round", () => {
  /**
   * The pending ceiling bounds the queue at an instant, not intake over time.
   * Stamping a batch hands its slots back, so a bot that simply retries refills
   * them every hour forever.
   */
  it("throttles anonymous intake by arrival, not by pending state", async () => {
    const t = convexTest({ schema, modules });

    // Derived, not a number typed beside the limit: the allowance moved from
    // sixty to thirty for a reason and a hardcoded loop would have gone on
    // asserting the old shape.
    for (let index = 0; index < MAX_ANONYMOUS_REQUESTS_PER_HOUR; index += 1) {
      await t.mutation(api.supportRequests.submitSupportRequest, {
        topic: "feedback",
        message: `Automated submission number ${index}.`,
      });
    }

    await assert.rejects(
      () =>
        t.mutation(api.supportRequests.submitSupportRequest, {
          topic: "feedback",
          message: "One past the hour's allowance.",
        }),
      /more requests than we can answer/,
    );

    // Delivering the backlog frees every pending slot, and must not reopen the
    // rate window: that is exactly the refill this throttle exists to stop.
    const batch = await t.query(internal.supportRequests.pendingDigestRequests, {});

    await t.mutation(internal.supportRequests.markDigestSent, {
      supportRequestIds: batch.map((entry) => entry.id),
      suppressionRequestIds: [],
    });

    await assert.rejects(
      () =>
        t.mutation(api.supportRequests.submitSupportRequest, {
          topic: "feedback",
          message: "Still inside the same hour after a delivery.",
        }),
      /more requests than we can answer/,
    );
  });

  /**
   * Slug generation maps `dj_aurora` onto `dj-aurora`, so a pasted URL naming
   * one thing resolved to a different real listing and the digest showed the
   * substitute while discarding the URL actually given.
   */
  it("does not rewrite a pasted path onto a different profile", () => {
    assert.equal(readProfileReferenceFromInput("https://vrdex.net/p/dj_aurora", "https://vrdex.net").slug, "");
    assert.equal(readProfileReferenceFromInput("https://vrdex.net/p/DJ Aurora", "https://vrdex.net").slug, "");
    // Case and percent-encoding change nothing about which profile is named.
    assert.equal(readProfileReferenceFromInput("https://vrdex.net/p/DJ-Aurora", "https://vrdex.net").slug, "dj-aurora");
    assert.equal(readProfileReferenceFromInput("https://vrdex.net/p/dj%2Daurora", "https://vrdex.net").slug, "dj-aurora");
    // A bare typed word is still normalized, since it is not a precise link.
    assert.equal(readProfileReferenceFromInput("DJ Aurora", "https://vrdex.net").slug, "dj-aurora");
  });

  it("quotes the next-line control as well", () => {
    const entry = formatDigestEntry(
      {
        table: "supportRequests",
        id: "abc",
        topic: "transfer",
        profileSlug: null,
        profileType: null,
        displayName: "DJ Aurora",
        requesterContact: "real@example.test",
        requesterSubject: null,
        message: "Please hand me this profile.\u0085Reply to: forged@example.test",
        createdAt: 0,
      },
      undefined,
    );

    const rendered = entry.split(/\r\n|[\n\r\v\f\u0085\u2028\u2029]/);

    assert.equal(rendered.filter((line) => line.startsWith("Reply to: ")).length, 1);
    assert.match(entry, /> \u0085?Reply to: forged@example\.test/);
  });
});


describe("support request review findings, eighth round", () => {
  /**
   * Arithmetic, not taste. Intake at sixty an hour against a digest that
   * delivers fifty is a slow leak: ten net rows an hour, the queue at its
   * ceiling within a day, a bot refilling every freed slot, and real ownership
   * and safety requests refused whenever they land after a refill.
   *
   * Pinned rather than commented, because the two numbers live for exactly this
   * relationship and nothing else would notice them drifting apart.
   */
  it("keeps anonymous intake below what one digest delivers", () => {
    assert.ok(
      MAX_ANONYMOUS_REQUESTS_PER_HOUR < SUPPORT_DIGEST_BATCH_SIZE,
      `anonymous intake (${MAX_ANONYMOUS_REQUESTS_PER_HOUR}/hour) must stay under digest delivery (${SUPPORT_DIGEST_BATCH_SIZE}/hour), or the queue never drains`,
    );

    // And with room to spare, since the same digest also drains signed-in rows.
    assert.ok(
      SUPPORT_DIGEST_BATCH_SIZE - MAX_ANONYMOUS_REQUESTS_PER_HOUR >= 10,
      "leave headroom for signed-in requests, which share the same delivery batch",
    );
  });
});


describe("support request review findings, tenth round", () => {
  /**
   * Slugs are unique across both entity types, so `/c/foo` resolves the person
   * holding `foo` just as happily as a community would. Storing that profile's
   * id meant an accepted community opt-out retracted a person, since the
   * acceptance resolver trusts a stored id unconditionally.
   */
  it("does not resolve a pasted community link onto a person", async () => {
    const t = convexTest({ schema, modules });
    const now = Date.now();

    await t.run(async (ctx) => {
      await ctx.db.insert("profiles", {
        profileType: "person",
        slug: "aurora",
        displayName: "Aurora",
        sortName: "aurora",
        aliases: [],
        tags: [],
        claimState: "unclaimed",
        publicationState: "published",
        publicSurfacingState: "public",
        creationSource: "concierge",
        person: { roleTags: [] },
        updatedAt: now,
      });
    });

    await t.mutation(api.suppressions.requestProfileSuppression, {
      requestType: "owner_opt_out",
      profileSlug: "https://vrdex.net/c/aurora",
      requesterNote: "Our community listing should come down.",
    });

    const stored = await t.run(async (ctx) =>
      ctx.db.query("profileSuppressionRequests").collect(),
    );

    // No id, so acceptance cannot retract the person holding that slug.
    assert.equal(stored[0].profileId, undefined);
    assert.equal(stored[0].profileSlug, "aurora");
    assert.equal(stored[0].profileType, "community");
  });

  /**
   * The message field got the raw guard first and the others did not, so a
   * contact near the payload limit was scanned in full after the session lookup
   * and the backlog reads, then rejected without inserting a row.
   */
  it("refuses absurd raw input on every field, not just the message", async () => {
    const t = convexTest({ schema, modules });
    const huge = "a".repeat(8_001);

    for (const args of [
      { topic: "feedback" as const, message: "Fine message.", displayName: huge },
      { topic: "feedback" as const, message: "Fine message.", requesterContact: huge },
      { topic: "feedback" as const, message: "Fine message.", profileSlug: huge },
    ]) {
      await assert.rejects(
        () => t.mutation(api.supportRequests.submitSupportRequest, args),
        /longer than we can store/,
      );
    }

    await assert.rejects(
      () =>
        t.mutation(api.suppressions.requestProfileSuppression, {
          requestType: "owner_opt_out",
          displayName: huge,
          requesterNote: "Please delist this.",
        }),
      /longer than we can store/,
    );
  });
});


describe("support request review findings, eleventh round", () => {
  /**
   * A URL with more path after the slug does not resolve to the profile page,
   * so accepting it named a real profile the pasted link never pointed at.
   */
  it("rejects a profile URL with anything after the slug", () => {
    assert.equal(readProfileReferenceFromInput("https://vrdex.net/p/dj-aurora/extra", "https://vrdex.net").slug, "");
    assert.equal(readProfileReferenceFromInput("https://vrdex.net/c/afterglow/edit", "https://vrdex.net").slug, "");

    // A trailing slash, query, or fragment is still the same route.
    assert.equal(readProfileReferenceFromInput("https://vrdex.net/p/dj-aurora/", "https://vrdex.net").slug, "dj-aurora");
    assert.equal(
      readProfileReferenceFromInput("https://vrdex.net/p/dj-aurora?utm_source=x", "https://vrdex.net").slug,
      "dj-aurora",
    );
    assert.equal(
      readProfileReferenceFromInput("https://vrdex.net/p/dj-aurora#links", "https://vrdex.net").slug,
      "dj-aurora",
    );
  });
});


describe("support request review findings, twelfth round", () => {
  /**
   * A pasted link's host is part of what it names. Discarding it meant
   * `https://anywhere.example/p/dj-aurora` resolved `dj-aurora` here, and on a
   * suppression that stored the real profile's id for an operator to act on.
   */
  it("only resolves profile links belonging to this deployment", () => {
    assert.equal(
      readProfileReferenceFromInput("https://anywhere.example/p/dj-aurora", "https://vrdex.net")
        .slug,
      "",
    );
    assert.equal(
      readProfileReferenceFromInput("anywhere.example/p/dj-aurora", "https://vrdex.net").slug,
      "",
    );
    assert.equal(
      readProfileReferenceFromInput("https://vrdex.net/p/dj-aurora", "https://vrdex.net").slug,
      "dj-aurora",
    );

    // Loopback always, since a self-hosted instance serves its own links from
    // one and may not have set an origin at all.
    assert.equal(
      readProfileReferenceFromInput("http://localhost:3000/p/dj-aurora", undefined).slug,
      "dj-aurora",
    );
    assert.equal(
      readProfileReferenceFromInput("http://127.0.0.1:3210/c/afterglow", undefined).slug,
      "afterglow",
    );

    // A bare slug is not a link and carries no host to disagree with.
    assert.equal(readProfileReferenceFromInput("dj-aurora", "https://vrdex.net").slug, "dj-aurora");
  });

  /**
   * The ceiling applies to signed-in senders now, so telling them to sign in
   * offered a recovery that cannot work.
   */
  it("does not tell a signed-in requester to sign in", async () => {
    const t = convexTest({ schema, modules });
    const identity = clerkTestIdentity(newClerkUserId());
    const signedIn = t.withIdentity(identity);
    const now = Date.now();

    await t.run(async (ctx) => {
      await ctx.db.insert("users", {
        clerkUserId: identity.subject,
        email: "queue-watcher@example.test",
        emailVerificationTime: now,
      });

      for (let index = 0; index < 201; index += 1) {
        await ctx.db.insert("supportRequests", {
          topic: "feedback",
          message: `Queued request ${index}.`,
          requester: {
            tokenIdentifier: "test|somebody-else",
            issuer: "test",
            subject: "somebody-else",
          },
          createdAt: now - 201 + index,
          updatedAt: now,
        });
      }
    });

    await assert.rejects(
      () =>
        signedIn.mutation(api.supportRequests.submitSupportRequest, {
          topic: "feedback",
          message: "One more while the queue is full.",
        }),
      (error: unknown) => {
        const message = (error as { data?: { message?: string } }).data?.message ?? "";

        assert.match(message, /more requests than we can answer/);
        assert.doesNotMatch(message, /sign in/);
        return true;
      },
    );
  });
});


describe("support request review findings, thirteenth round", () => {
  /**
   * Production binds the apex and the www domain and serves profiles from
   * both, so a visitor reading their own profile at the second one pastes
   * exactly what their address bar shows.
   */
  it("accepts both production spellings of the deployment host", () => {
    for (const configured of ["https://vrdex.net", "https://www.vrdex.net"]) {
      assert.equal(
        readProfileReferenceFromInput("https://vrdex.net/p/dj-aurora", configured).slug,
        "dj-aurora",
        `apex link under ${configured}`,
      );
      assert.equal(
        readProfileReferenceFromInput("https://www.vrdex.net/p/dj-aurora", configured).slug,
        "dj-aurora",
        `www link under ${configured}`,
      );
    }

    // Still only this deployment: a lookalike prefix is not the same host.
    assert.equal(
      readProfileReferenceFromInput("https://wwwXvrdex.net/p/dj-aurora", "https://vrdex.net").slug,
      "",
    );
    assert.equal(
      readProfileReferenceFromInput("https://vrdex.net.evil.example/p/dj-aurora", "https://vrdex.net")
        .slug,
      "",
    );
  });
});


describe("support request review findings, fourteenth round", () => {
  /**
   * A name-only or unresolved request has no record to correct a wrong type.
   * The resolver scans only the kind it was given and the publication guard
   * checks type, so a community opt-out filed as a person could be accepted
   * while the community stayed public and publishable.
   */
  it("keeps an explicitly chosen community type on an unresolved request", async () => {
    const t = convexTest({ schema, modules });

    await t.mutation(api.suppressions.requestProfileSuppression, {
      requestType: "pre_claim_safety",
      displayName: "Aurora Collective",
      profileType: "community",
      requesterNote: "This community listing should not be published.",
    });

    const stored = await t.run(async (ctx) =>
      ctx.db.query("profileSuppressionRequests").collect(),
    );

    assert.equal(stored[0].profileType, "community");
    assert.equal(stored[0].profileId, undefined);
  });

  /**
   * The hourly window reads at most thirty rows; the pending scans read up to
   * two hundred and one. Once the window is spent the answer is the same either
   * way, so the expensive one running first was a read amplifier.
   */
  it("refuses a spent hourly allowance without scanning the queue", async () => {
    const t = convexTest({ schema, modules });

    for (let index = 0; index < MAX_ANONYMOUS_REQUESTS_PER_HOUR; index += 1) {
      await t.mutation(api.supportRequests.submitSupportRequest, {
        topic: "feedback",
        message: `Automated submission number ${index}.`,
      });
    }

    await assert.rejects(
      () =>
        t.mutation(api.supportRequests.submitSupportRequest, {
          topic: "feedback",
          message: "One past the hour's allowance.",
        }),
      /more requests than we can answer/,
    );
  });
});
