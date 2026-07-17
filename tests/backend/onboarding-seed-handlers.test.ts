import assert from "node:assert/strict";
import { describe, it } from "node:test";

import { convexTest } from "convex-test";

import { api, internal } from "../../convex/_generated/api";
import schemaModule from "../../convex/schema";

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
      /signed-in account/,
    );
  });

  it("supports single-character private lookup for an authorized account", async () => {
    const t = convexTest({ schema, modules });
    await importCandidate(t);
    const userId = await t.run((ctx) => ctx.db.insert("users", { name: "Seed lookup operator" }));
    await t.run((ctx) => ctx.db.insert("accountFeatureGrants", {
      userId,
      feature: "super_admin",
      state: "active",
      grantedBy: actor,
      grantedAt: NOW,
      updatedAt: NOW,
    }));

    const results = await t.withIdentity({ subject: userId }).query(
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
    const userId = await t.run(async (ctx) => {
      await ctx.db.patch(candidate.batchId, {
        reviewState: "rejected",
        updatedAt: liveNow + 1,
      });
      return await ctx.db.insert("users", {
        name: "Verified recipient",
        email: "recipient@example.invalid",
        emailVerificationTime: NOW,
      });
    });

    await assert.rejects(
      t.withIdentity({ subject: userId }).mutation(api.seedHandoffs.acceptInvitation, {
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
    const userId = await t.run(async (ctx) => {
      await ctx.db.patch(fieldId, {
        reviewState: "rejected",
        updatedAt: liveNow + 1,
      });
      return await ctx.db.insert("users", {
        name: "Verified recipient",
        email: "recipient@example.invalid",
        emailVerificationTime: NOW,
      });
    });

    await assert.rejects(
      t.withIdentity({ subject: userId }).mutation(api.seedHandoffs.acceptInvitation, {
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
    const { acceptingUserId, otherUserId } = await t.run(async (ctx) => {
      const acceptingUserId = await ctx.db.insert("users", {
        name: "Accepting user",
        email: "accepting@example.invalid",
        emailVerificationTime: NOW,
      });
      const otherUserId = await ctx.db.insert("users", { name: "Other user" });
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
      return { acceptingUserId, otherUserId };
    });

    assert.deepEqual(
      await t.query(api.seedHandoffs.previewInvitation, { token }),
      { state: "accepted" },
    );
    assert.deepEqual(
      await t.withIdentity({ subject: otherUserId }).query(
        api.seedHandoffs.previewInvitation,
        { token },
      ),
      { state: "accepted" },
    );
    const accepted = await t.withIdentity({ subject: acceptingUserId }).query(
      api.seedHandoffs.previewInvitation,
      { token },
    );
    assert.equal(accepted.state, "accepted");
    assert.match(
      "ownerDestination" in accepted ? accepted.ownerDestination : "",
      /^\/account\/privacy\?profileId=/,
    );
  });
});
