import assert from "node:assert/strict";
import { describe, it } from "node:test";

import { convexTest } from "convex-test";

import { api, internal } from "../../convex/_generated/api";
import schemaModule from "../../convex/schema";
import { formatDigestEntry, supportDigestConfig } from "../../convex/_supportDigest";
import { supportProfileSlugInput } from "../../convex/supportRequests";

// `supportRequestDigest.ts` is deliberately absent. It is a `"use node"` module,
// so importing it loads the AWS SES client, whose CJS bundle does not survive
// this runner's ESM interop. Everything in it except the send itself lives in
// `_supportDigest.ts` for exactly that reason, and that is what is exercised
// here.
const modules = {
  "../../convex/_generated/api.ts": () => import("../../convex/_generated/api"),
  "../../convex/supportRequests.ts": () => import("../../convex/supportRequests"),
};
const schema = (
  schemaModule as unknown as { default?: typeof schemaModule }
).default ?? schemaModule;

describe("support request intake", () => {
  it("accepts an anonymous request and keeps the message readable", async () => {
    const t = convexTest({ schema, modules });

    await t.mutation(api.supportRequests.submitSupportRequest, {
      topic: "recovery",
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
      requestIds: firstBatch.map((request) => request.id),
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
    const requestIds = batch.map((request) => request.id);

    await t.mutation(internal.supportRequests.markDigestSent, { requestIds, now: 1_000 });
    const second = await t.mutation(internal.supportRequests.markDigestSent, {
      requestIds,
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
      await ctx.db.delete(batch[0].id);
    });

    const result = await t.mutation(internal.supportRequests.markDigestSent, {
      requestIds: batch.map((request) => request.id),
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
    assert.equal(supportDigestConfig({ VRDEX_SUPPORT_DIGEST_TO: "ops@vrdex.net" }), null);

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
    assert.equal(supportProfileSlugInput("dj-aurora"), "dj-aurora");
    assert.equal(supportProfileSlugInput("  DJ Aurora  "), "dj-aurora");
    assert.equal(supportProfileSlugInput("https://vrdex.net/p/dj-aurora"), "dj-aurora");
    assert.equal(supportProfileSlugInput("https://vrdex.net/c/afterglow-social?x=1"), "afterglow-social");
    assert.equal(supportProfileSlugInput("vrdex.net/p/dj-aurora"), "dj-aurora");
    assert.equal(supportProfileSlugInput(""), "");
    // A bare origin carries no profile, and normalizing the host would invent a
    // slug-shaped string that resolves to nothing.
    assert.equal(supportProfileSlugInput("https://vrdex.net"), "");
  });

  it("names a missing contact rather than leaving a gap in the digest", () => {
    const entry = formatDigestEntry(
      {
        id: "irrelevant" as never,
        topic: "feedback",
        profileSlug: null,
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
        id: "irrelevant" as never,
        topic: "ownership_dispute",
        profileSlug: "dj-aurora",
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
