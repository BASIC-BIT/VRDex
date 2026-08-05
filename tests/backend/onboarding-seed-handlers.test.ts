import assert from "node:assert/strict";
import { describe, it } from "node:test";

import { convexTest } from "convex-test";

import { api, internal } from "../../convex/_generated/api";
import schemaModule from "../../convex/schema";

import { newClerkUserId } from "./_clerkTestIdentity";
const modules = {
  "../../convex/_generated/api.ts": () => import("../../convex/_generated/api"),
  "../../convex/seedAccess.ts": () => import("../../convex/seedAccess"),
  "../../convex/seedHandoffs.ts": () => import("../../convex/seedHandoffs"),
  "../../convex/seedImports.ts": () => import("../../convex/seedImports"),
};
const schema = (
  schemaModule as unknown as { default?: typeof schemaModule }
).default ?? schemaModule;
const NOW = Date.parse("2026-07-10T12:00:00.000Z");
const actor = {
  tokenIdentifier: "operator:vrdex",
  issuer: "vrdex",
  subject: "handler-tests",
};

function permissionedPayload(displayName = "DJ Example") {
  return {
    permissioned: true,
    batchId: "handler_test_batch",
    sourceName: "NWinn",
    sourceType: "partner",
    receivedAt: "2026-07-09T12:00:00.000Z",
    candidates: [
      {
        candidateId: "handler-test-dj",
        proposedDisplayName: displayName,
        fields: [
          {
            fieldKey: "outboundLinks",
            value: [{
              type: "twitch",
              label: "Twitch",
              url: "https://twitch.tv/dj-example",
            }],
            sourceLabel: "NWinn",
            sourceType: "partner",
            lastCheckedAt: "2026-07-08T00:00:00.000Z",
            confidence: "high",
            visibility: "private",
          },
        ],
      },
    ],
  };
}

async function importCandidate(t: ReturnType<typeof convexTest>) {
  await t.mutation(internal.seedImports.importPermissionedJsonBatch, {
    payload: permissionedPayload(),
    importedBy: actor,
    now: NOW,
  });

  return await t.run(async (ctx) => {
    const candidate = await ctx.db
      .query("seedImportCandidateProfiles")
      .withIndex("by_externalCandidateId", (query) =>
        query.eq("externalCandidateId", "handler-test-dj"),
      )
      .unique();

    if (candidate === null) {
      throw new Error("Handler test candidate was not created.");
    }

    return candidate;
  });
}

function privateProfile(claimState: "unclaimed" | "claimed_unverified" | "claimed_verified") {
  return {
    slug: `handler-${claimState}`,
    displayName: "DJ Example",
    sortName: "dj example",
    aliases: [],
    tags: [],
    outboundLinks: [],
    claimState,
    publicationState: "draft_private" as const,
    publicSurfacingState: "opted_out" as const,
    creationSource: "concierge" as const,
    updatedAt: NOW,
    profileType: "person" as const,
    person: { roleTags: [] },
  };
}

describe("private seed Convex handlers", () => {
  it("rejects private lookup without an authenticated feature grant", async () => {
    const t = convexTest({ schema, modules });

    await assert.rejects(
      t.query(api.seedAccess.lookupPeople, { query: "DJ", limit: 5 }),
      /SIGN_IN_REQUIRED/,
    );
  });

  it("supports single-character private lookup for an authorized account", async () => {
    const t = convexTest({ schema, modules });
    await importCandidate(t);
    const identity = await t.run(async (ctx) => {
      const clerkUserId = newClerkUserId();
      const userId = await ctx.db.insert("users", {
        clerkUserId: clerkUserId,
        name: "Seed lookup operator",
      });
      await ctx.db.insert("accountFeatureGrants", {
        userId,
        feature: "super_admin",
        state: "active",
        grantedBy: actor,
        grantedAt: NOW,
        updatedAt: NOW,
      });
      return { subject: clerkUserId, emailVerified: true };
    });

    const results = await t.withIdentity(identity).query(
      api.seedAccess.lookupPeople,
      { query: "D", limit: 5 },
    );

    assert.equal(results.length, 1);
    assert.equal(results[0]?.displayName, "DJ Example");
  });

  it("rejects changed candidate payloads under an existing import id", async () => {
    const t = convexTest({ schema, modules });
    await t.mutation(internal.seedImports.importPermissionedJsonBatch, {
      payload: permissionedPayload(),
      importedBy: actor,
      now: NOW,
    });

    await assert.rejects(
      t.mutation(internal.seedImports.importPermissionedJsonBatch, {
        payload: permissionedPayload("DJ Example Changed"),
        importedBy: actor,
        now: NOW + 1,
      }),
      /conflicts with the existing import/,
    );
  });

  it("clears a mistaken candidate profile match", async () => {
    const t = convexTest({ schema, modules });
    const candidate = await importCandidate(t);
    const profileId = await t.run((ctx) => ctx.db.insert("profiles", privateProfile("unclaimed")));

    await t.mutation(internal.seedImports.matchCandidateToProfile, {
      candidateId: candidate._id,
      matchedProfileId: profileId,
      reviewer: actor,
      reviewNote: "Initial match",
      now: NOW,
    });
    await t.mutation(internal.seedImports.matchCandidateToProfile, {
      candidateId: candidate._id,
      reviewer: actor,
      reviewNote: "Cleared mistaken match",
      now: NOW + 1,
    });

    const updated = await t.run((ctx) => ctx.db.get(candidate._id));
    assert.equal(updated?.matchedProfileId, undefined);
  });

  it("blocks invitation creation after the import batch is rejected", async () => {
    const t = convexTest({ schema, modules });
    const candidate = await importCandidate(t);
    await t.run((ctx) => ctx.db.patch(candidate.batchId, {
      reviewState: "rejected",
      updatedAt: NOW + 1,
    }));

    await assert.rejects(
      t.mutation(internal.seedHandoffs.createInvitation, {
        token: "R".repeat(43),
        candidateId: candidate._id,
        offeredFieldIds: [],
        expiresAt: NOW + 60_000,
        createdBy: actor,
        now: NOW + 2,
      }),
      /active seed import batch/,
    );
  });

  it("blocks an active invitation after the import batch is rejected", async () => {
    const t = convexTest({ schema, modules });
    const candidate = await importCandidate(t);
    const token = "S".repeat(43);
    const liveNow = Date.now();
    await t.mutation(internal.seedHandoffs.createInvitation, {
      token,
      candidateId: candidate._id,
      offeredFieldIds: [],
      expiresAt: liveNow + 60_000,
      createdBy: actor,
      now: liveNow,
    });
    const identity = await t.run(async (ctx) => {
      await ctx.db.patch(candidate.batchId, {
        reviewState: "rejected",
        updatedAt: liveNow + 1,
      });
      const clerkUserId2 = newClerkUserId();
      const userId = await ctx.db.insert("users", {
        clerkUserId: clerkUserId2,
        name: "Verified recipient",
        email: "recipient@example.invalid",
        emailVerificationTime: NOW,
      });
      return { subject: clerkUserId2, emailVerified: true };
    });

    await assert.rejects(
      t.withIdentity(identity).mutation(api.seedHandoffs.acceptInvitation, {
        token,
        selectedFieldIds: [],
      }),
      /unavailable/,
    );
  });

  it("blocks a selected handoff field withdrawn during review", async () => {
    const t = convexTest({ schema, modules });
    const candidate = await importCandidate(t);
    const token = "T".repeat(43);
    const liveNow = Date.now();
    const fieldId = await t.run(async (ctx) => {
      const field = await ctx.db
        .query("seedImportCandidateFields")
        .withIndex("by_candidateId", (query) => query.eq("candidateId", candidate._id))
        .unique();
      if (field === null) {
        throw new Error("Handler test field was not created.");
      }
      return field._id;
    });
    await t.mutation(internal.seedHandoffs.createInvitation, {
      token,
      candidateId: candidate._id,
      offeredFieldIds: [fieldId],
      expiresAt: liveNow + 60_000,
      createdBy: actor,
      now: liveNow,
    });
    const identity = await t.run(async (ctx) => {
      await ctx.db.patch(fieldId, {
        reviewState: "rejected",
        updatedAt: liveNow + 1,
      });
      const clerkUserId3 = newClerkUserId();
      const userId = await ctx.db.insert("users", {
        clerkUserId: clerkUserId3,
        name: "Verified recipient",
        email: "recipient@example.invalid",
        emailVerificationTime: NOW,
      });
      return { subject: clerkUserId3, emailVerified: true };
    });

    await assert.rejects(
      t.withIdentity(identity).mutation(api.seedHandoffs.acceptInvitation, {
        token,
        selectedFieldIds: [fieldId],
      }),
      /no longer available/,
    );
  });

  it("serializes competing invitations and allows only one live token", async () => {
    const t = convexTest({ schema, modules });
    const candidate = await importCandidate(t);
    const invitations = await Promise.allSettled([
      t.mutation(internal.seedHandoffs.createInvitation, {
        token: "A".repeat(43),
        candidateId: candidate._id,
        offeredFieldIds: [],
        expiresAt: NOW + 60_000,
        createdBy: actor,
        now: NOW,
      }),
      t.mutation(internal.seedHandoffs.createInvitation, {
        token: "B".repeat(43),
        candidateId: candidate._id,
        offeredFieldIds: [],
        expiresAt: NOW + 60_000,
        createdBy: actor,
        now: NOW,
      }),
    ]);

    assert.equal(invitations.filter((result) => result.status === "fulfilled").length, 1);
    assert.equal(invitations.filter((result) => result.status === "rejected").length, 1);
  });

  it("rejects a previously claimed profile as a concierge destination", async () => {
    const t = convexTest({ schema, modules });
    const candidate = await importCandidate(t);
    const profileId = await t.run(async (ctx) => {
      const id = await ctx.db.insert("profiles", privateProfile("claimed_verified"));
      await ctx.db.patch(candidate._id, { matchedProfileId: id, updatedAt: NOW });
      return id;
    });

    await assert.rejects(
      t.mutation(internal.seedHandoffs.createInvitation, {
        token: "C".repeat(43),
        candidateId: candidate._id,
        offeredFieldIds: [],
        profileId,
        expiresAt: NOW + 60_000,
        createdBy: actor,
        now: NOW,
      }),
      /unclaimed private person profiles/,
    );
  });

  it("reveals an accepted destination only to the accepting account", async () => {
    const t = convexTest({ schema, modules });
    const candidate = await importCandidate(t);
    const token = "D".repeat(43);
    await t.mutation(internal.seedHandoffs.createInvitation, {
      token,
      candidateId: candidate._id,
      offeredFieldIds: [],
      expiresAt: NOW + 60_000,
      createdBy: actor,
      now: NOW,
    });
    const { acceptingIdentity, otherIdentity } = await t.run(async (ctx) => {
      const clerkUserId4 = newClerkUserId();
      const acceptingUserId = await ctx.db.insert("users", {
        clerkUserId: clerkUserId4,
        name: "Accepting user",
        email: "accepting@example.invalid",
        emailVerificationTime: NOW,
      });
      const clerkUserId5 = newClerkUserId();
      const otherUserId = await ctx.db.insert("users", {
        clerkUserId: clerkUserId5, name: "Other user" });
      const profileId = await ctx.db.insert("profiles", privateProfile("claimed_unverified"));
      const invitation = await ctx.db.query("seedHandoffInvitations").first();
      if (invitation === null) {
        throw new Error("Handler test invitation was not created.");
      }
      await ctx.db.patch(invitation._id, {
        state: "accepted",
        profileId,
        acceptedByUserId: acceptingUserId,
        acceptedAt: NOW,
        updatedAt: NOW,
      });
      return {
        acceptingIdentity: {
          subject: clerkUserId4, emailVerified: true,
        },
        otherIdentity: {
          subject: clerkUserId5, emailVerified: true,
        },
      };
    });

    assert.deepEqual(
      await t.query(api.seedHandoffs.previewInvitation, { token }),
      { state: "accepted" },
    );
    assert.deepEqual(
      await t.withIdentity(otherIdentity).query(
        api.seedHandoffs.previewInvitation,
        { token },
      ),
      { state: "accepted" },
    );
    const accepted = await t.withIdentity(acceptingIdentity).query(
      api.seedHandoffs.previewInvitation,
      { token },
    );
    assert.equal(accepted.state, "accepted");
    assert.match(
      "ownerDestination" in accepted ? accepted.ownerDestination : "",
      /^\/account\/privacy\?profileId=/,
    );
  });

  // The window used to be sized to the answer -- `limit * 2` rows taken, then
  // filtered -- so eligibility, which depends on the batch and on the live
  // profile and cannot be pushed into the search index, was decided over
  // whatever happened to fall inside it. A common name whose leading matches are
  // all unaccepted reported "no records" for somebody the lane holds one for.
  it("reads past ineligible matches rather than reporting none", async () => {
    const t = convexTest({ schema, modules });
    const payload = permissionedPayload();
    await t.mutation(internal.seedImports.importPermissionedJsonBatch, {
      payload: {
        ...payload,
        candidates: Array.from({ length: 11 }, (_unused, index) => ({
          ...payload.candidates[0],
          candidateId: `crowded-${index}`,
          proposedDisplayName: "Crowded Name",
        })),
      },
      importedBy: actor,
      now: NOW,
    });

    const identity = await t.run(async (ctx) => {
      const candidates = await ctx.db.query("seedImportCandidateProfiles").collect();
      // Exactly one acceptance, and it is last in the list -- comfortably past
      // the two rows the old fixed window would have read for `limit: 1`.
      await ctx.db.patch(candidates[candidates.length - 1]._id, {
        reviewState: "accepted",
        updatedAt: NOW,
      });

      const clerkUserId = newClerkUserId();
      const userId = await ctx.db.insert("users", { clerkUserId, name: "Crowded lookup operator" });
      await ctx.db.insert("accountFeatureGrants", {
        userId,
        feature: "view_private_seed_lookup",
        state: "active",
        grantedBy: actor,
        grantedAt: NOW,
        updatedAt: NOW,
      });
      return { subject: clerkUserId, emailVerified: true };
    });

    const results = await t.withIdentity(identity).query(api.seedAccess.lookupPeople, {
      query: "Crowded",
      limit: 1,
    });

    assert.equal(results.length, 1);
    assert.equal(results[0]?.displayName, "Crowded Name");
  });

  // Each state collects up to `limit` on its own, so concatenating and slicing
  // spends the whole limit on whichever state fills first. A common name with
  // enough draft rows dropped every published one -- hiding exactly the
  // published imports this surface was widened to recover.
  it("gives each publication state a share of the lookup limit", async () => {
    const t = convexTest({ schema, modules });
    const payload = permissionedPayload();
    await t.mutation(internal.seedImports.importPermissionedJsonBatch, {
      payload: {
        ...payload,
        candidates: Array.from({ length: 6 }, (_unused, index) => ({
          ...payload.candidates[0],
          candidateId: `shared-${index}`,
          proposedDisplayName: "Shared Name",
        })),
      },
      importedBy: actor,
      now: NOW,
    });

    const identity = await t.run(async (ctx) => {
      const candidates = await ctx.db.query("seedImportCandidateProfiles").collect();
      // The published row goes in its own batch, because one batch cannot hold
      // both: a draft row is visible to this grant only while its batch is still
      // `private_only`, and publishing required the batch to be relaxed past
      // that. A `private_only` batch containing a published candidate is a state
      // publication cannot produce.
      const publishedBatchId = await ctx.db.insert("seedImportBatches", {
        externalBatchId: "handler_test_batch_published",
        sourceName: "NWinn",
        sourceType: "partner",
        receivedAt: NOW,
        publicationPolicy: "reviewed_publication_allowed",
        reviewState: "approved",
        createdAt: NOW,
        updatedAt: NOW,
      });

      // Five drafts and one published, so concatenation would spend a limit of
      // four entirely on drafts and never reach the published row.
      for (const [index, candidate] of candidates.entries()) {
        const published = index === candidates.length - 1;
        const profileId = published
          ? await ctx.db.insert("profiles", {
              ...privateProfile("unclaimed"),
              slug: "shared-name-published",
              publicationState: "published" as const,
              publicSurfacingState: "public" as const,
              creationSource: "import" as const,
            })
          : undefined;
        await ctx.db.patch(candidate._id, {
          reviewState: "accepted",
          ...(published
            ? {
                batchId: publishedBatchId,
                publicationState: "published_unclaimed" as const,
                publishedProfileId: profileId,
                publishedAt: NOW,
              }
            : {}),
          updatedAt: NOW,
        });
      }
      await ctx.db.patch(candidates[0].batchId, {
        publicationPolicy: "private_only",
        reviewState: "approved",
        updatedAt: NOW,
      });

      const clerkUserId = newClerkUserId();
      const userId = await ctx.db.insert("users", { clerkUserId, name: "Share lookup operator" });
      await ctx.db.insert("accountFeatureGrants", {
        userId,
        feature: "view_private_seed_lookup",
        state: "active",
        grantedBy: actor,
        grantedAt: NOW,
        updatedAt: NOW,
      });
      return { subject: clerkUserId, emailVerified: true };
    });

    const results = await t.withIdentity(identity).query(api.seedAccess.lookupPeople, {
      query: "Shared",
      limit: 4,
    });

    assert.equal(results.length, 4);
    assert.equal(
      results.filter((result) => result.publicationState === "published_unclaimed").length,
      1,
    );
  });

  // Both operator surfaces answer to one rule. `lookupPeople` reached the batch
  // through the candidate and stopped returning a withdrawn record; the by-slug
  // record read judged the live profile alone, which a batch rejection does not
  // touch -- so a grant holder went on reading private fields and edit history
  // for a person review had decided to stop handling.
  it("stops the by-slug record read when the batch behind it is withdrawn", async () => {
    const t = convexTest({ schema, modules });
    const candidate = await importCandidate(t);
    const identity = await t.run(async (ctx) => {
      const profileId = await ctx.db.insert("profiles", {
        ...privateProfile("unclaimed"),
        slug: "handler-published-import",
        publicationState: "published" as const,
        publicSurfacingState: "public" as const,
        creationSource: "import" as const,
        fieldVisibility: { bio: "private" as const },
        bio: "Withheld biography",
      });
      await ctx.db.patch(candidate._id, {
        publicationState: "published_unclaimed",
        publishedProfileId: profileId,
        publishedAt: NOW,
        reviewState: "accepted",
        updatedAt: NOW,
      });
      await ctx.db.patch(candidate.batchId, {
        publicationPolicy: "reviewed_publication_allowed",
        reviewState: "approved",
        updatedAt: NOW,
      });

      const clerkUserId = newClerkUserId();
      const userId = await ctx.db.insert("users", {
        clerkUserId,
        name: "Seed lookup grant holder",
      });
      await ctx.db.insert("accountFeatureGrants", {
        userId,
        // The narrow beta grant, not super_admin: super-admins are unrestricted
        // and would pass whatever this checks.
        feature: "view_private_seed_lookup",
        state: "active",
        grantedBy: actor,
        grantedAt: NOW,
        updatedAt: NOW,
      });
      return { subject: clerkUserId, emailVerified: true };
    });

    const before = await t.withIdentity(identity).query(api.seedAccess.withheldProfileRecord, {
      slug: "handler-published-import",
    });

    assert.deepEqual(before?.withheldFields.map((field) => field.key), ["bio"]);

    await t.run(async (ctx) => {
      await ctx.db.patch(candidate.batchId, { reviewState: "rejected", updatedAt: NOW });
    });

    assert.equal(
      await t.withIdentity(identity).query(api.seedAccess.withheldProfileRecord, {
        slug: "handler-published-import",
      }),
      null,
    );

    // A merge can leave two candidates pointing at one profile. The name lookup
    // returns a row per candidate, so such a profile still appears there on the
    // strength of the live one -- judging only whichever row the index returns
    // first would hide it here whenever the withdrawn batch sorted ahead.
    await t.run(async (ctx) => {
      const profile = await ctx.db
        .query("profiles")
        .withIndex("by_slug", (query) => query.eq("slug", "handler-published-import"))
        .unique();
      const batchId = await ctx.db.insert("seedImportBatches", {
        externalBatchId: "handler_test_batch_two",
        sourceName: "NWinn",
        sourceType: "partner",
        receivedAt: NOW,
        publicationPolicy: "reviewed_publication_allowed",
        reviewState: "approved",
        createdAt: NOW,
        updatedAt: NOW,
      });
      await ctx.db.insert("seedImportCandidateProfiles", {
        batchId,
        externalCandidateId: "handler-test-dj-merged",
        profileType: "person",
        proposedDisplayName: "DJ Example",
        reviewState: "accepted",
        publicationState: "published_unclaimed",
        claimState: "unclaimed",
        publishedProfileId: profile!._id,
        publishedAt: NOW,
        createdAt: NOW,
        updatedAt: NOW,
      });
    });

    assert.deepEqual(
      (
        await t.withIdentity(identity).query(api.seedAccess.withheldProfileRecord, {
          slug: "handler-published-import",
        })
      )?.withheldFields.map((field) => field.key),
      ["bio"],
    );
  });
});
