import assert from "node:assert/strict";
import { describe, it } from "node:test";

import { convexTest } from "convex-test";

import { api, internal } from "../../convex/_generated/api";
import type { Id } from "../../convex/_generated/dataModel";
import schemaModule from "../../convex/schema";
import { readProfileSlugFromInput } from "../../convex/_profileSlugs";
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
    assert.equal(readProfileSlugFromInput("dj-aurora"), "dj-aurora");
    assert.equal(readProfileSlugFromInput("  DJ Aurora  "), "dj-aurora");
    assert.equal(readProfileSlugFromInput("https://vrdex.net/p/dj-aurora"), "dj-aurora");
    assert.equal(
      readProfileSlugFromInput("https://vrdex.net/c/afterglow-social?x=1"),
      "afterglow-social",
    );
    assert.equal(readProfileSlugFromInput("vrdex.net/p/dj-aurora"), "dj-aurora");
    assert.equal(readProfileSlugFromInput(""), "");
    // A bare origin carries no profile, and normalizing the host would invent a
    // slug-shaped string that resolves to nothing.
    assert.equal(readProfileSlugFromInput("https://vrdex.net"), "");
    // Evidence links are the common paste into this field, and any dotted host
    // used to qualify: the last segment became a valid-looking slug pointing at
    // some unrelated profile while the URL that mattered was thrown away.
    assert.equal(readProfileSlugFromInput("https://vrchat.com/home/user/usr_123"), "");
    assert.equal(readProfileSlugFromInput("https://discord.gg/abcdef"), "");
    assert.equal(readProfileSlugFromInput("https://vrdex.net/w/neon-harbor"), "");
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
