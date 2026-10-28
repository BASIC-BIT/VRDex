import assert from "node:assert/strict";
import { it } from "node:test";
import { convexTest } from "convex-test";

import { api } from "../../convex/_generated/api";
import type { Doc } from "../../convex/_generated/dataModel";
import { getProfileConnectionVerifications, getPublicVerifiedConnections } from "../../convex/_profileConnectionVerification";
import schemaModule from "../../convex/schema";
import { newClerkUserId } from "./_clerkTestIdentity";

const modules = {
  "../../convex/_generated/api.ts": () => import("../../convex/_generated/api"),
  "../../convex/profileConnections.ts": () => import("../../convex/profileConnections"),
  "../../convex/profiles.ts": () => import("../../convex/profiles"),
};
const schema = (schemaModule as unknown as { default?: typeof schemaModule }).default ?? schemaModule;
const verifiedAt = Date.UTC(2026, 9, 25);
const assetExternalId = "usr_11111111-1111-1111-1111-111111111111";

async function fixture(profileType: "person" | "community" = "person") {
  const t = convexTest({ schema, modules });
  const rows = await t.run(async (ctx) => {
    const clerkUserId = newClerkUserId();
    const userId = await ctx.db.insert("users", { clerkUserId, email: "connection@example.test", emailVerificationTime: verifiedAt });
    const otherClerkUserId = newClerkUserId();
    const otherUserId = await ctx.db.insert("users", { clerkUserId: otherClerkUserId, email: "new-owner@example.test" });
    const profileId = await ctx.db.insert("profiles", {
      ...(profileType === "person" ? { profileType, person: { roleTags: [] } } : { profileType, community: { categoryTags: [] } }),
      slug: "connection-person", displayName: "Person", sortName: "person",
      aliases: [], tags: [], claimState: "claimed_unverified", publicationState: "published",
      publicSurfacingState: "public", creationSource: "self", updatedAt: verifiedAt,
    });
    const ownerId = await ctx.db.insert("profileOwners", {
      profileId, userId, roleKey: "owner", state: "active", grantedAt: verifiedAt, updatedAt: verifiedAt,
    });
    const proof = {
      userId, assetType: "vrchat_user", assetExternalId, controlLevel: "self", state: "active",
      evidenceSource: "vrchat_api", verifiedAt, revalidateAfter: Date.now() + 86_400_000,
      createdAt: verifiedAt, updatedAt: verifiedAt,
    } satisfies Omit<Doc<"externalControlProofs">, "_id" | "_creationTime">;
    const proofId = await ctx.db.insert("externalControlProofs", proof);
    const linkId = await ctx.db.insert("profileExternalLinks", {
      profileId, assetType: "vrchat_user", assetExternalId, linkRole: "primary", state: "active",
      provenance: "control_association", linkedByUserId: userId, verifiedByProofId: proofId,
      createdAt: verifiedAt, updatedAt: verifiedAt,
    });
    return { userId, otherUserId, otherClerkUserId, profileId, ownerId, proofId, proof, linkId, clerkUserId };
  });
  const read = () => t.query(api.profileConnections.listProfileConnections, { profileSlug: "connection-person" });
  const owner = t.withIdentity({ subject: rows.clerkUserId, issuer: "test", tokenIdentifier: `test|${rows.clerkUserId}`, emailVerified: true });
  return { t, ...rows, read, owner };
}

it("historical proof belongs to the current owner and exact asset", async () => {
  const valid = await fixture();
  assert.equal((await valid.read())?.connections[0]?.verified, true);
  assert.equal((await valid.read())?.connections[0]?.verifiedAt, verifiedAt);
  for (const provenance of [undefined, "control_association"] as const) {
    await valid.t.run(async (ctx) => ctx.db.patch(valid.linkId, { provenance, linkedByUserId: undefined }));
    assert.equal((await valid.read())?.connections[0]?.verifiedAt, verifiedAt);
  }

  for (const invalid of ["no owner", "revoked owner", "removed link", "directory reference", "absent reference", "dangling reference", "wrong user", "wrong ID", "wrong type", "insufficient control", "revoked only"]) {
    const f = await fixture();
    await f.t.run(async (ctx) => {
      switch (invalid) {
        case "no owner": await ctx.db.delete(f.ownerId); break;
        case "revoked owner": await ctx.db.patch(f.ownerId, { state: "revoked" }); break;
        case "removed link": await ctx.db.patch(f.linkId, { state: "removed" }); break;
        case "directory reference": await ctx.db.patch(f.linkId, { provenance: "directory_reference" }); break;
        case "absent reference": await ctx.db.patch(f.linkId, { verifiedByProofId: undefined }); break;
        case "dangling reference": await ctx.db.delete(f.proofId); break;
        case "wrong user": await ctx.db.patch(f.proofId, { userId: f.otherUserId }); break;
        case "wrong ID": await ctx.db.patch(f.proofId, { assetExternalId: "usr_other" }); break;
        case "wrong type": await ctx.db.patch(f.proofId, { assetType: "vrchat_group" }); break;
        case "insufficient control": await ctx.db.patch(f.proofId, { controlLevel: "owner" }); break;
        case "revoked only": await ctx.db.patch(f.proofId, { state: "revoked" }); break;
      }
    });
    const result = await f.read();
    if (invalid === "removed link") assert.deepEqual(result?.connections, []);
    else {
      assert.equal(result?.connections[0]?.verified, false, invalid);
      assert.equal(result?.connections[0]?.verifiedAt, undefined, invalid);
    }
  }
});

it("stale display evidence cannot authorize a new attachment", async () => {
  const f = await fixture();
  const secondProfileId = await f.t.run(async (ctx) => {
    const first = await ctx.db.get(f.profileId);
    assert.ok(first);
    const { _id, _creationTime, ...profile } = first;
    const profileId = await ctx.db.insert("profiles", { ...profile, slug: "second-person" });
    await ctx.db.insert("profileOwners", { profileId, userId: f.userId, roleKey: "owner", state: "active", grantedAt: verifiedAt, updatedAt: verifiedAt });
    return profileId;
  });
  for (const state of ["active", "stale"] as const) {
    await f.t.run(async (ctx) => ctx.db.patch(f.proofId, { state, revalidateAfter: Date.now() - 1 }));
    assert.equal((await f.read())?.connections[0]?.verifiedAt, verifiedAt);
    await assert.rejects(f.owner.mutation(api.profileConnections.addVerifiedConnection, {
      profileSlug: "second-person", assetType: "vrchat_user", assetExternalId,
    }), /CONTROL_NOT_VERIFIED/);
  }
  await f.t.run(async (ctx) => {
    assert.deepEqual(await ctx.db.query("profileExternalLinks").withIndex("by_profileId_state", q => q.eq("profileId", secondProfileId).eq("state", "active")).collect(), []);
    await ctx.db.patch(f.ownerId, { state: "revoked" });
    await ctx.db.insert("profileOwners", { profileId: f.profileId, userId: f.otherUserId, roleKey: "owner", state: "active", grantedAt: verifiedAt, updatedAt: verifiedAt });
  });
  assert.equal((await f.read())?.connections[0]?.verified, false);
  const newDate = verifiedAt + 1000;
  await f.t.run(async (ctx) => {
    await ctx.db.insert("externalControlProofs", { ...f.proof, userId: f.otherUserId, verifiedAt: newDate });
  });
  await f.t.withIdentity({ subject: f.otherClerkUserId, issuer: "test", tokenIdentifier: `test|${f.otherClerkUserId}`, emailVerified: true })
    .mutation(api.profileConnections.addVerifiedConnection, { profileSlug: "connection-person", assetType: "vrchat_user", assetExternalId });
  assert.equal((await f.read())?.connections[0]?.verifiedAt, newDate);
});

it("only a correctly bound reference can use an alternative proof", async () => {
  for (const reference of ["correct", "wrong user", "wrong ID", "wrong type", "missing", "dangling"]) {
    const f = await fixture();
    await f.t.run(async (ctx) => {
      await ctx.db.patch(f.proofId, { state: "revoked" });
      if (reference === "wrong user") await ctx.db.patch(f.proofId, { userId: f.otherUserId });
      if (reference === "wrong ID") await ctx.db.patch(f.proofId, { assetExternalId: "usr_other" });
      if (reference === "wrong type") await ctx.db.patch(f.proofId, { assetType: "vrchat_group" });
      if (reference === "missing") await ctx.db.patch(f.linkId, { verifiedByProofId: undefined });
      if (reference === "dangling") await ctx.db.delete(f.proofId);
      await ctx.db.insert("externalControlProofs", { ...f.proof, verifiedAt: verifiedAt + 1000, state: "stale" });
      await ctx.db.insert("externalControlProofs", { ...f.proof, verifiedAt: verifiedAt + 2000 });
    });
    const result = (await f.read())?.connections[0];
    assert.equal(result?.verified, reference === "correct", reference);
    assert.equal(result?.verifiedAt, reference === "correct" ? verifiedAt + 2000 : undefined, reference);
    if (reference === "correct") {
      await f.t.run(async (ctx) => {
        const proofs = await ctx.db.query("externalControlProofs").withIndex("by_userId_assetType_assetExternalId", q => q.eq("userId", f.userId).eq("assetType", "vrchat_user").eq("assetExternalId", assetExternalId)).collect();
        for (const proof of proofs) if (proof.verifiedAt === verifiedAt + 2000) await ctx.db.patch(proof._id, { state: "revoked" });
      });
      assert.equal((await f.read())?.connections[0]?.verifiedAt, verifiedAt + 1000);
      await f.t.run(async (ctx) => {
        const proofs = await ctx.db.query("externalControlProofs").withIndex("by_userId_assetType_assetExternalId", q => q.eq("userId", f.userId).eq("assetType", "vrchat_user").eq("assetExternalId", assetExternalId)).collect();
        for (const proof of proofs) await ctx.db.patch(proof._id, { state: "revoked" });
      });
      assert.equal((await f.read())?.connections[0]?.verified, false);
      assert.equal((await f.read())?.connections[0]?.verifiedAt, undefined);
    }
  }
});

it("ignores invalid proof dates and selects the latest qualifying date", async () => {
  const f = await fixture();
  for (const date of [NaN, Infinity, -Infinity, -1, Date.now() + 86_400_000]) {
    await f.t.run(async (ctx) => ctx.db.patch(f.proofId, { verifiedAt: date }));
    assert.equal((await f.read())?.connections[0]?.verified, false);
    assert.equal((await f.read())?.connections[0]?.verifiedAt, undefined);
  }
  await f.t.run(async (ctx) => ctx.db.patch(f.proofId, { verifiedAt: 0 }));
  assert.equal((await f.read())?.connections[0]?.verifiedAt, 0);
  await f.t.run(async (ctx) => {
    await ctx.db.insert("externalControlProofs", { ...f.proof, state: "stale" });
    await ctx.db.insert("externalControlProofs", { ...f.proof, state: "stale" });
    await ctx.db.insert("externalControlProofs", { ...f.proof, verifiedAt: verifiedAt + 1000, controlLevel: "manager" });
    await ctx.db.insert("externalControlProofs", { ...f.proof, verifiedAt: verifiedAt + 2000, userId: f.otherUserId });
    await ctx.db.insert("externalControlProofs", { ...f.proof, verifiedAt: Infinity });
  });
  assert.equal((await f.read())?.connections[0]?.verifiedAt, verifiedAt);
});

it("requires community control levels for guilds and groups, and self only for users", async () => {
  for (const assetType of ["vrchat_user", "vrchat_group", "discord_guild"] as const) {
    for (const controlLevel of ["manager", "administrator", "owner", "self"] as const) {
      const f = await fixture(assetType === "vrchat_user" ? "person" : "community");
      await f.t.run(async (ctx) => {
        await ctx.db.patch(f.linkId, { assetType });
        await ctx.db.patch(f.proofId, { assetType, controlLevel });
      });
      const qualifies = assetType === "vrchat_user" ? controlLevel === "self" : controlLevel !== "self";
      assert.equal((await f.read())?.connections[0]?.verified, qualifies, `${assetType}:${controlLevel}`);
      assert.equal((await f.read())?.connections[0]?.verifiedAt, qualifies ? verifiedAt : undefined);
    }
  }
});

it("the shared selector rejects removed links and links from another profile", async () => {
  const f = await fixture();
  await f.t.run(async (ctx) => {
    const link = await ctx.db.get(f.linkId);
    assert.ok(link);
    assert.equal((await getProfileConnectionVerifications(ctx.db, f.profileId, [link])).get(f.linkId), verifiedAt);
    await ctx.db.patch(f.linkId, { state: "removed" });
    const removed = await ctx.db.get(f.linkId);
    assert.ok(removed);
    assert.equal((await getProfileConnectionVerifications(ctx.db, f.profileId, [removed])).size, 0);
    const profile = await ctx.db.get(f.profileId);
    assert.ok(profile);
    const { _id, _creationTime, ...fields } = profile;
    const otherProfileId = await ctx.db.insert("profiles", { ...fields, slug: "other-profile" });
    await ctx.db.insert("profileOwners", { profileId: otherProfileId, userId: f.userId, roleKey: "owner", state: "active", grantedAt: verifiedAt, updatedAt: verifiedAt });
    assert.equal((await getProfileConnectionVerifications(ctx.db, otherProfileId, [link])).size, 0);
  });
});

it("private connections stay visible to the manager and unlisted connections follow profile_page rules", async () => {
  const f = await fixture();
  await f.t.run(async (ctx) => ctx.db.patch(f.profileId, { fieldVisibility: { outboundLinks: "private" } }));
  assert.deepEqual((await f.read())?.connections, []);
  const managed = await f.owner.query(api.profileConnections.listProfileConnections, { profileSlug: "connection-person" });
  assert.equal(managed?.isManager, true);
  assert.equal(managed?.connections[0]?.verifiedAt, verifiedAt);
  await f.t.run(async (ctx) => ctx.db.patch(f.profileId, { fieldVisibility: { outboundLinks: "unlisted" } }));
  assert.equal((await f.read())?.connections[0]?.verifiedAt, verifiedAt);
});

it("public readers expose the same dated VRChat connection", async () => {
  for (const profileType of ["person", "community"] as const) {
    const f = await fixture(profileType);
    const assetType = profileType === "person" ? "vrchat_user" : "vrchat_group";
    const externalId = profileType === "person" ? assetExternalId : "grp_11111111-1111-1111-1111-111111111111";
    const route = profileType === "person" ? "user" : "group";
    await f.t.run(async ctx => {
      await ctx.db.patch(f.linkId, { assetType, assetExternalId: externalId, assetDisplayName: "Exact VRChat name" });
      await ctx.db.patch(f.proofId, { assetType, assetExternalId: externalId, controlLevel: profileType === "person" ? "self" : "owner" });
    });
    const readPublic = () => f.t.query(api.profiles.getPublicBySlug, { slug: "connection-person", includeTelemetry: false });
    const expected = {
      assetType, assetExternalId: externalId, displayName: "Exact VRChat name",
      url: `https://vrchat.com/home/${route}/${externalId}`, verifiedAt, linkRole: "primary",
    };
    const result = await readPublic();
    assert.deepEqual(result?.verifiedConnections, [expected]);
    assert.deepEqual(result?.outboundLinks, []);
    assert.equal(result?.trustLabel, "claimed_unverified");
    assert.deepEqual(Object.keys(result!.verifiedConnections[0]!).sort(), ["assetExternalId", "assetType", "displayName", "linkRole", "url", "verifiedAt"]);

    const secondaryIds = [externalId.replace("11111111", "33333333"), externalId.replace("11111111", "22222222")];
    await f.t.run(async ctx => {
      const link = await ctx.db.get(f.linkId);
      assert.ok(link);
      const { _id, _creationTime, ...fields } = link;
      for (const id of secondaryIds) {
        const proofId = await ctx.db.insert("externalControlProofs", { ...f.proof, assetType, assetExternalId: id, controlLevel: profileType === "person" ? "self" : "owner" });
        await ctx.db.insert("profileExternalLinks", { ...fields, assetExternalId: id, assetDisplayName: undefined, linkRole: "secondary", verifiedByProofId: proofId });
      }
      const discordProofId = await ctx.db.insert("externalControlProofs", { ...f.proof, assetType: "discord_guild", assetExternalId: "12345678901234567", controlLevel: "owner" });
      await ctx.db.insert("profileExternalLinks", { ...fields, assetType: "discord_guild", assetExternalId: "12345678901234567", verifiedByProofId: discordProofId });
      await ctx.db.insert("profileExternalLinks", { ...fields, provenance: "directory_reference" });
    });
    const ordered = (await readPublic())?.verifiedConnections;
    assert.deepEqual(ordered, [expected, ...secondaryIds.toSorted().map(id => ({ assetType, assetExternalId: id, url: `https://vrchat.com/home/${route}/${id}`, verifiedAt, linkRole: "secondary" }))]);

    for (const visibility of ["private", "unlisted"] as const) {
      await f.t.run(async ctx => ctx.db.patch(f.profileId, { fieldVisibility: { outboundLinks: visibility } }));
      assert.deepEqual((await readPublic())?.verifiedConnections, visibility === "private" ? [] : ordered);
      await f.t.run(async ctx => {
        const profile = await ctx.db.get(f.profileId);
        assert.ok(profile);
        assert.deepEqual(await getPublicVerifiedConnections(ctx.db, profile, "discovery"), []);
      });
    }
    const storedLinks = [{ label: "Custom link", url: "https://example.test/custom", type: "website", source: "owner_authored" }] satisfies NonNullable<Doc<"profiles">["outboundLinks"]>;
    await f.t.run(async ctx => ctx.db.patch(f.profileId, { fieldVisibility: undefined, outboundLinks: storedLinks }));
    await readPublic();
    await f.t.run(async ctx => assert.deepEqual((await ctx.db.get(f.profileId))?.outboundLinks, storedLinks));
    await f.t.run(async ctx => ctx.db.patch(f.profileId, { publicSurfacingState: "suppressed" }));
    assert.equal(await readPublic(), null);
    await f.t.run(async ctx => {
      await ctx.db.patch(f.profileId, { publicSurfacingState: "public" });
      for (const proof of await ctx.db.query("externalControlProofs").collect()) await ctx.db.patch(proof._id, { state: "revoked" });
    });
    assert.deepEqual((await readPublic())?.verifiedConnections, []);
    await f.t.run(async ctx => {
      await ctx.db.patch(f.proofId, { state: "stale" });
      await ctx.db.delete(f.ownerId);
    });
    assert.deepEqual((await readPublic())?.verifiedConnections, []);
  }
});
