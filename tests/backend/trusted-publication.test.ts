import assert from "node:assert/strict";
import { it } from "node:test";
import { convexTest } from "convex-test";
import { accountFeatureAccessFromGrants } from "../../convex/_accountFeatureModel";
import {
  eligible,
  type PublicationFacts,
} from "../../convex/_trustedPublication";
import { api, internal } from "../../convex/_generated/api";
import { modules, schema, seed, createAndUpload } from "./_mediaReviewFixture";

process.env.VRDEX_PROFILE_MEDIA_SUBMISSIONS_ENABLED = "true";
process.env.VRDEX_PROFILE_MEDIA_DIRECT_UPLOAD_ENABLED = "true";
process.env.VRDEX_PROFILE_MEDIA_KIT_ENABLED = "true";

async function fixture() {
  const t = convexTest({ schema, modules });
  const s = await seed(t);
  const { intent } = await createAndUpload(t, s);
  const grantId = await t.run((ctx) =>
    ctx.db.insert("accountFeatureGrants", {
      userId: s.contributorUserId,
      feature: "trusted_publisher",
      state: "active",
      grantedBy: {
        tokenIdentifier: "test:operator",
        issuer: "test",
        subject: "operator",
      },
      grantedAt: Date.now(),
      updatedAt: Date.now(),
    }),
  );
  const actor = t.withIdentity(s.contributorIdentity);
  const detail = () =>
    actor.query(api.profileMediaSubmissions.publisherDetail, {
      submissionId: intent.submissionId,
    });
  const declare = async () => {
    const before = await detail();
    assert.ok(before);
    await actor.mutation(
      api.profileMediaSubmissions.declarePublicationEvidence,
      {
        submissionId: intent.submissionId,
        expectedReviewVersion: before.reviewVersion,
        identityConfirmed: true,
        attributionConfirmed: true,
        publicationPermitted: true,
        noKnownRestrictions: true,
        idempotencyKey: crypto.randomUUID(),
      },
    );
  };
  const publish = async () => {
    const before = await detail();
    assert.ok(before);
    return actor.mutation(api.profileMediaSubmissions.publish, {
      submissionId: intent.submissionId,
      expectedReviewVersion: before.reviewVersion,
      idempotencyKey: crypto.randomUUID(),
    });
  };
  return { t, s, intent, grantId, actor, detail, declare, publish };
}
it("requires an explicit declaration and records own publication without inventing review", async () => {
  const f = await fixture();
  assert.equal((await f.publish()).code, "independent_review_required");
  await f.declare();
  assert.equal((await f.publish()).operationState, "committed");
  const row = await f.t.run((ctx) => ctx.db.get(f.intent.submissionId));
  assert.equal(row?.publicationMethod, "trusted_publisher");
  assert.equal(row?.reviewer, undefined);
  assert.ok(row?.publicationOperationId);
  assert.equal((await f.detail())?.publicationMethod, "trusted_publisher");
});
for (const scenario of [
  "legacy",
  "claimed",
  "missing_credit",
  "dispute",
  "suppression",
  "rejection",
  "revoked",
  "changed",
] as const) {
  it(`refuses trusted publication: ${scenario}`, async () => {
    const f = await fixture();
    await f.declare();
    const before = await f.detail();
    assert.ok(before);
    await f.t.run(async (ctx) => {
      if (scenario === "legacy")
        await ctx.db.patch(f.s.profileId, {
          avatarImageUrl: "https://example.test/old.png",
        });
      if (scenario === "claimed")
        await ctx.db.patch(f.s.profileId, { claimState: "claimed_verified" });
      if (scenario === "missing_credit")
        await ctx.db.patch(f.intent.submissionId, { credit: "" });
      if (scenario === "revoked")
        await ctx.db.patch(f.grantId, { state: "revoked" });
      if (scenario === "changed")
        await ctx.db.patch(f.s.profileId, { updatedAt: Date.now() });
      if (["dispute", "suppression", "rejection"].includes(scenario))
        await ctx.db.insert("mediaPublicationRestrictions", {
          profileId: f.s.profileId,
          contentSha256: "proposal-hash",
          submissionId: f.intent.submissionId,
          kind:
            scenario === "dispute"
              ? "dispute"
              : scenario === "suppression"
                ? "suppression"
                : "rejection",
          actorUserId: f.s.moderatorUserId,
          createdAt: Date.now(),
        });
    });
    try {
      const receipt = await f.actor.mutation(
        api.profileMediaSubmissions.publish,
        {
          submissionId: f.intent.submissionId,
          expectedReviewVersion: before.reviewVersion,
          idempotencyKey: scenario,
        },
      );
      assert.equal(receipt.operationState, "refused");
    } catch (error) {
      assert.ok(["claimed", "revoked"].includes(scenario));
      assert.match(String(error), /publication access/i);
    }
    assert.equal(
      (await f.t.run((ctx) => ctx.db.query("profileAssets").collect())).length,
      0,
    );
  });
}

it("separates the publisher grant from admin and reviewer authority", () => {
  for (const feature of ["super_admin", "media_reviewer"] as const) {
    assert.equal(
      accountFeatureAccessFromGrants([{ feature, state: "active" }], Date.now())
        .canPublishMedia,
      false,
    );
  }
  const facts: PublicationFacts = {
    publisherGrant: true,
    independentReviewerGrant: false,
    publicUnclaimed: true,
    ownSubmission: true,
    sourceRecorded: true,
    credit: "Photographer",
    identityConfirmed: true,
    attributionConfirmed: true,
    publicationPermitted: true,
    noKnownRestrictions: true,
    currentPlacement: null,
    legacyImageUrl: null,
    automaticImageUrl: null,
    priorSuppression: false,
    priorRejection: false,
    unresolvedDispute: false,
  };
  assert.equal(eligible(facts), true);
  for (const patch of [
    { publisherGrant: false, independentReviewerGrant: true },
    { identityConfirmed: false },
    { attributionConfirmed: false },
    { sourceRecorded: false },
    { publicationPermitted: false },
    { noKnownRestrictions: false },
    { ownSubmission: false },
    { publicUnclaimed: false },
    { currentPlacement: {} },
    { legacyImageUrl: "https://example.test/old.png" },
  ]) {
    assert.equal(eligible({ ...facts, ...patch }), false);
  }
});
it("publishes a community logo, preserves independent self-review refusal, and replays once", async () => {
  const f = await fixture();
  await f.t.run(async (ctx) => {
    const existing = await ctx.db.get(f.s.profileId);
    assert.ok(existing);
    const { _id, _creationTime, ...fields } = existing;
    if ("person" in fields) {
      const { person, ...rest } = fields;
      await ctx.db.replace(_id, {
        ...rest,
        profileType: "community",
        community: { categoryTags: [] },
      });
    }
    await ctx.db.patch(f.intent.submissionId, {
      requestedPlacement: "primary_logo",
    });
    await ctx.db.insert("accountFeatureGrants", {
      userId: f.s.contributorUserId,
      feature: "super_admin",
      state: "active",
      grantedBy: {
        tokenIdentifier: "operator",
        issuer: "test",
        subject: "operator",
      },
      grantedAt: Date.now(),
      updatedAt: Date.now(),
    });
  });
  await f.declare();
  const detail = await f.detail();
  assert.ok(detail);
  assert.equal(
    (
      await f.actor.mutation(api.profileMediaSubmissions.decideWithReceipt, {
        submissionId: f.intent.submissionId,
        expectedReviewVersion: detail.reviewVersion,
        decision: "approve",
        privateReason: "Own logo",
        idempotencyKey: "self-review",
      })
    ).code,
    "self_review",
  );
  const input = {
    submissionId: f.intent.submissionId,
    expectedReviewVersion: detail.reviewVersion,
    idempotencyKey: "logo",
  };
  const result = await f.actor.mutation(
    api.profileMediaSubmissions.publish,
    input,
  );
  assert.equal(result.operationState, "committed");
  assert.deepEqual(
    await f.actor.mutation(api.profileMediaSubmissions.publish, input),
    result,
  );
  assert.equal(
    (await f.t.run((ctx) => ctx.db.query("profileAssets").collect())).length,
    1,
  );
  await f.t.run((ctx) => ctx.db.patch(f.grantId, { state: "revoked" }));
  await assert.rejects(
    f.actor.mutation(api.profileMediaSubmissions.publish, input),
    /publication access/,
  );
});
it("confines publisher-only detail and candidate to own public unclaimed submissions", async () => {
  const f = await fixture();
  const detail = await f.detail();
  assert.ok(detail?.candidate.rendition);
  assert.equal("privateReason" in detail, false);
  assert.equal("submitterEmail" in detail, false);
  assert.equal("reviewerTokenIdentifier" in detail, false);
  await assert.rejects(
    f.actor.query(api.profileMediaSubmissions.reviewDetail, {
      submissionId: f.intent.submissionId,
    }),
    /access/,
  );
  const auth = {
    actorUserId: f.s.contributorUserId,
    emailVerified: true,
    emailVerificationAttestedAt: Date.now(),
    submissionId: f.intent.submissionId,
  };
  assert.ok(
    await f.t.query(
      internal.profileMediaSubmissions.publisherCandidateForMcpActor,
      auth,
    ),
  );
  await f.t.run((ctx) =>
    ctx.db.patch(f.grantId, { userId: f.s.moderatorUserId }),
  );
  await assert.rejects(
    f.t.query(internal.profileMediaSubmissions.publisherDetailForMcpActor, {
      ...auth,
      actorUserId: f.s.moderatorUserId,
    }),
    /publication access/,
  );
  await assert.rejects(
    f.t.query(
      internal.profileMediaSubmissions.publisherCandidateForMcpActor,
      auth,
    ),
    /publication access/,
  );
});
for (const kind of ["vrchat_user", "vrchat_group", "discord_guild"] as const) {
  it(`refuses rendered ${kind} automatic artwork and versions cache changes`, async () => {
    const f = await fixture();
    const locator =
      kind === "vrchat_user"
        ? "usr_7023d326-083f-41fe-a3e9-27ea303b50c5"
        : kind === "vrchat_group"
          ? "grp_7023d326-083f-41fe-a3e9-27ea303b50c5"
          : "Club";
    const url =
      kind === "vrchat_user"
        ? `https://vrchat.com/home/user/${locator}`
        : kind === "vrchat_group"
          ? `https://vrchat.com/home/group/${locator}`
          : `https://discord.gg/${locator}`;
    const destinationId = await f.t.run(async (ctx) => {
      if (kind !== "vrchat_user") {
        const existing = await ctx.db.get(f.s.profileId);
        assert.ok(existing && existing.profileType === "person");
        const { _id, _creationTime, person, ...rest } = existing;
        await ctx.db.replace(_id, {
          ...rest,
          profileType: "community",
          community: { categoryTags: [] },
        });
      }
      await ctx.db.patch(f.s.profileId, {
        outboundLinks: [
          {
            type:
              kind === "discord_guild"
                ? "discord"
                : kind === "vrchat_group"
                  ? "website"
                  : "vrchat_profile",
            url,
            label: "Source",
            source: "community_submitted",
          },
        ],
      });
      if (kind !== "vrchat_user")
        await ctx.db.patch(f.intent.submissionId, {
          requestedPlacement: "primary_logo",
        });
      return ctx.db.insert("profileLinkDestinations", {
        key: `${kind}:${locator}`,
        kind,
        locator,
        provider: kind === "discord_guild" ? "discord" : "vrchat",
        status: "resolved",
        artworkSourceUrl: "https://example.test/icon.png",
        ...(kind === "vrchat_user"
          ? { artworkType: "user_icon" as const }
          : {}),
        observedAt: 1,
      });
    });
    await f.declare();
    const before = await f.detail();
    assert.ok(before?.currentAutomaticImageUrl);
    assert.equal((await f.publish()).code, "independent_review_required");
    await f.t.run((ctx) =>
      ctx.db.patch(destinationId, {
        artworkSourceUrl: "https://example.test/changed.png",
      }),
    );
    const after = await f.detail();
    assert.ok(after);
    assert.notEqual(after.reviewVersion, before.reviewVersion);
    await f.t.run((ctx) =>
      ctx.db.patch(f.s.profileId, { imageFallback: { disabled: true } }),
    );
    assert.equal((await f.detail())?.currentAutomaticImageUrl, null);
    assert.equal((await f.publish()).operationState, "committed");
  });
}
it("keeps unrelated rejection eligible but prevents fresh URLs and item keys evading known content", async () => {
  const f = await fixture();
  await f.declare();
  await f.t.run((ctx) =>
    ctx.db.insert("mediaPublicationRestrictions", {
      profileId: f.s.profileId,
      submissionId: f.intent.submissionId,
      contentSha256: "unrelated-digest",
      kind: "rejection",
      actorUserId: f.s.moderatorUserId,
      createdAt: Date.now(),
    }),
  );
  assert.equal((await f.publish()).operationState, "committed");
  const g = await fixture();
  await g.declare();
  await g.t.run(async (ctx) => {
    const row = await ctx.db.get(g.intent.submissionId);
    assert.ok(row);
    const { _id, _creationTime, ...previous } = row;
    await ctx.db.insert("profileMediaSubmissions", {
      ...previous,
      status: "rejected",
      sourceUrl: "https://example.test/old-location",
      createdAt: 1,
    });
  });
  assert.equal((await g.publish()).code, "independent_review_required");
});
it("invalidates declarations on changed credit or source and records correction lineage", async () => {
  const f = await fixture();
  await f.declare();
  await f.t.run((ctx) =>
    ctx.db.patch(f.intent.submissionId, { credit: "Different attribution" }),
  );
  assert.equal((await f.publish()).code, "independent_review_required");
  await f.declare();
  const published = await f.publish();
  assert.equal(published.operationState, "committed");
  await f.t
    .withIdentity(f.s.moderatorIdentity)
    .mutation(api.profileMediaSubmissions.suppressApprovedAsset, {
      submissionId: f.intent.submissionId,
      reason: "Wrong attribution",
    });
  const restriction = await f.t.run((ctx) =>
    ctx.db.query("mediaPublicationRestrictions").first(),
  );
  assert.equal(restriction?.correctionOfOperationId, published.operationId);
});
it("fresh transaction refuses concurrent slot fill and independent review can still approve legacy evidence", async () => {
  const f = await fixture();
  await f.declare();
  const before = await f.detail();
  assert.ok(before);
  const command = {
    submissionId: f.intent.submissionId,
    expectedReviewVersion: before.reviewVersion,
    idempotencyKey: "racing-publish",
  };
  await f.t.run((ctx) =>
    ctx.db.patch(f.intent.submissionId, { createdAt: Date.now() - 3_600_000 }),
  );
  const { intent: competitor } = await createAndUpload(
    f.t,
    f.s,
    "other-content",
  );
  const competitorDetail = await f.t
    .withIdentity(f.s.moderatorIdentity)
    .query(api.profileMediaSubmissions.reviewDetail, {
      submissionId: competitor.submissionId,
    });
  assert.ok(competitorDetail);
  await f.t
    .withIdentity(f.s.moderatorIdentity)
    .mutation(api.profileMediaSubmissions.decideWithReceipt, {
      submissionId: competitor.submissionId,
      expectedReviewVersion: competitorDetail.reviewVersion,
      decision: "approve",
      privateReason: "Reviewed",
      idempotencyKey: "independent",
    });
  assert.equal(
    (await f.actor.mutation(api.profileMediaSubmissions.publish, command))
      .operationState,
    "refused",
  );
  assert.equal((await f.publish()).code, "independent_review_required");
  const row = await f.t.run((ctx) => ctx.db.get(competitor.submissionId));
  assert.equal(row?.publicationMethod, "independent_review");
  assert.ok(row?.publicationOperationId);
  const g = await fixture();
  const legacy = await g.t
    .withIdentity(g.s.moderatorIdentity)
    .query(api.profileMediaSubmissions.reviewDetail, {
      submissionId: g.intent.submissionId,
    });
  assert.ok(legacy);
  assert.equal(
    (
      await g.t
        .withIdentity(g.s.moderatorIdentity)
        .mutation(api.profileMediaSubmissions.decideWithReceipt, {
          submissionId: g.intent.submissionId,
          expectedReviewVersion: legacy.reviewVersion,
          decision: "approve",
          privateReason: "Independent evidence",
          idempotencyKey: "legacy",
        })
    ).operationState,
    "committed",
  );
});

it("records explicit unresolved declarations and local provenance without inferring truth from credit", async () => {
  const f = await fixture();
  await f.t.run((ctx) =>
    ctx.db.patch(f.intent.submissionId, {
      sourceUrl: undefined,
      sourceKind: "local",
      sourceDescription: "Photo supplied directly by creator",
    }),
  );
  const before = await f.detail();
  assert.ok(before);
  await f.actor.mutation(
    api.profileMediaSubmissions.declarePublicationEvidence,
    {
      submissionId: f.intent.submissionId,
      expectedReviewVersion: before.reviewVersion,
      identityConfirmed: false,
      attributionConfirmed: true,
      publicationPermitted: true,
      noKnownRestrictions: true,
      idempotencyKey: "uncertain",
    },
  );
  assert.equal((await f.publish()).code, "independent_review_required");
  await f.declare();
  assert.equal((await f.publish()).operationState, "committed");
});
it("samples publisher publications with resource-bound pagination and omits legacy approvals", async () => {
  const f = await fixture();
  await f.declare();
  const published = await f.publish();
  const admin = f.t.withIdentity(f.s.moderatorIdentity);
  const page = await admin.query(
    api.profileMediaSubmissions.publisherPublications,
    {
      publisherUserId: f.s.contributorUserId,
      paginationOpts: { cursor: null, numItems: 1 },
    },
  );
  assert.equal(page.page[0]?.operationId, published.operationId);
  assert.equal("privateReason" in page.page[0]!, false);
  await assert.rejects(
    admin.query(api.profileMediaSubmissions.publisherPublications, {
      publisherUserId: f.s.moderatorUserId,
      paginationOpts: { cursor: page.continueCursor, numItems: 1 },
    }),
    /PAGE_CURSOR_INVALID/,
  );
  await assert.rejects(
    f.actor.query(api.profileMediaSubmissions.publisherPublications, {
      publisherUserId: f.s.contributorUserId,
      paginationOpts: { cursor: null, numItems: 1 },
    }),
    /Super admin/,
  );
});
