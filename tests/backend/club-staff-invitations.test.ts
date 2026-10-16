import assert from "node:assert/strict";
import { afterEach, beforeEach, describe, it } from "node:test";
import { convexTest } from "convex-test";
import schemaModule from "../../convex/schema";
import { api, internal } from "../../convex/_generated/api";

const schema =
  (schemaModule as unknown as { default?: typeof schemaModule }).default ??
  schemaModule;
const modules = {
  "../../convex/clubStaff.ts": () => import("../../convex/clubStaff"),
  "../../convex/_generated/api.ts": () => import("../../convex/_generated/api"),
};
const identity = (name: string) => ({
  subject: `user_${name}`,
  issuer: "https://club-test.clerk.accounts.dev",
  tokenIdentifier: `https://club-test.clerk.accounts.dev|user_${name}`,
  email: `${name}@example.com`,
  emailVerified: true,
});
const args = { communitySlug: "test-club" };
const priorIssuer = process.env.CLERK_JWT_ISSUER_DOMAIN;
describe("short staff invitations", () => {
  beforeEach(() => {
    process.env.CLERK_JWT_ISSUER_DOMAIN = identity("owner").issuer;
  });
  afterEach(() => {
    if (priorIssuer === undefined) delete process.env.CLERK_JWT_ISSUER_DOMAIN;
    else process.env.CLERK_JWT_ISSUER_DOMAIN = priorIssuer;
  });
  async function setup() {
    const t = convexTest({ schema, modules });
    const owner = identity("owner");
    const recipient = identity("recipient");
    await t.run(async (ctx) => {
      const userId = await ctx.db.insert("users", { clerkUserId: owner.subject });
      await ctx.db.insert("users", {
        clerkUserId: recipient.subject,
        email: recipient.email,
      });
      const profileId = await ctx.db.insert("profiles", {
        slug: args.communitySlug,
        displayName: "Test club",
        sortName: "test club",
        aliases: [],
        tags: [],
        claimState: "claimed_verified",
        publicationState: "published",
        publicSurfacingState: "public",
        creationSource: "self",
        updatedAt: Date.now(),
        profileType: "community",
        community: { categoryTags: [] },
      });
      await ctx.db.insert("profileOwners", {
        profileId,
        userId,
        roleKey: "owner",
        state: "active",
        grantedAt: Date.now(),
        updatedAt: Date.now(),
      });
    });
    const ownerClient = t.withIdentity(owner);
    const client = t.withIdentity(recipient);
    await ownerClient.mutation(api.clubStaff.seedPresetRoles, args);
    const workspace = await ownerClient.query(api.clubStaff.getWorkspace, args);
    const role = workspace!.roles.find((r) => r.presetKey === "event_staff")!;
    const create = () => ownerClient.mutation(api.clubStaff.createStaffInvitation, {
      ...args, roleIds: [role._id],
    });
    return { t, ownerClient, client, create };
  }

  it("creates exactly ten URL-safe characters and persists only the hash", async () => {
    const { t, create } = await setup();
    const invite = await create();
    assert.match(invite.token, /^[A-Za-z0-9_-]{10}$/);
    const stored = await t.run((ctx) => ctx.db.get(invite.invitationId));
    const expectedHash = Buffer.from(await crypto.subtle.digest(
      "SHA-256", new TextEncoder().encode(invite.token),
    )).toString("hex");
    assert.equal(stored!.tokenHash, expectedHash);
    assert.equal(invite.expiresAt - stored!.createdAt, 7 * 86400_000);
    const logs = await t.run((ctx) => ctx.db.query("communityActionLog").collect());
    assert.equal(JSON.stringify({ stored, logs }).includes(invite.token), false);
  });

  it("retries a collision with an expired token without replacing its invitation", async (test) => {
    const { t, create } = await setup();
    let calls = 0;
    test.mock.method(crypto, "getRandomValues", (bytes: Uint8Array) => {
      bytes.fill(calls++ < 2 ? 0 : 63);
      return bytes;
    });
    const original = await create();
    await t.run((ctx) => ctx.db.patch(original.invitationId, { expiresAt: 1 }));
    const prior = await t.run((ctx) => ctx.db.get(original.invitationId));
    const next = await create();
    assert.notEqual(next.token, original.token);
    assert.notEqual(next.invitationId, original.invitationId);
    assert.deepEqual(await t.run((ctx) => ctx.db.get(original.invitationId)), prior);
    assert.equal(calls, 3);
  });

  it("fails after bounded collision retries without creating or aliasing an invitation", async (test) => {
    const { t, create } = await setup();
    let calls = 0;
    test.mock.method(crypto, "getRandomValues", (bytes: Uint8Array) => {
      calls++;
      return bytes.fill(0);
    });
    await create();
    await assert.rejects(create(), /invitation/i);
    assert.ok(calls > 1 && calls <= 10);
    assert.equal((await t.run((ctx) => ctx.db.query("communityStaffInvitations").collect())).length, 1);
    assert.equal((await t.run((ctx) => ctx.db.query("communityActionLog").collect())).filter(
      (row) => row.action === "invitation_created",
    ).length, 1);
  });

  it("previews and accepts both new and legacy tokens through the same lifecycle", async () => {
    for (const legacy of [false, true]) {
      const { t, client, create } = await setup();
      const invite = await create();
      const token = legacy ? "ab".repeat(32) : invite.token;
      if (legacy) await t.run(async (ctx) => ctx.db.patch(invite.invitationId, {
        tokenHash: Buffer.from(await crypto.subtle.digest(
          "SHA-256", new TextEncoder().encode(token),
        )).toString("hex"),
      }));
      assert.equal((await t.action(api.clubStaff.getInvitation, { ...args, token }))!.community.slug, args.communitySlug);
      await client.action(api.clubStaff.acceptStaffInvitation, { ...args, token });
      assert.equal((await t.run((ctx) => ctx.db.get(invite.invitationId)))!.state, "accepted");
      assert.equal(await t.action(api.clubStaff.getInvitation, { ...args, token }), null);
      await assert.rejects(client.action(api.clubStaff.acceptStaffInvitation, { ...args, token }));
    }
  });

  it("counts malformed anonymous previews across tokens and communities and recovers after a minute", async (test) => {
    const { t, create, client } = await setup();
    const invite = await create();
    const now = Date.now();
    test.mock.method(Date, "now", () => now);
    for (let index = 0; index < 60; index++) {
      assert.equal(await t.action(api.clubStaff.getInvitation, {
        communitySlug: `missing-${index}`, token: `bad-${index}`,
      }), null);
    }
    await assert.rejects(
      t.action(api.clubStaff.getInvitation, { ...args, token: invite.token }),
      /STAFF_INVITATION_RATE_LIMITED/,
    );
    // Anonymous traffic must not consume a signed-in recipient's capacity.
    assert.ok(await client.action(api.clubStaff.getInvitation, { ...args, token: invite.token }));
    test.mock.method(Date, "now", () => now + 60_000);
    assert.ok(await t.action(api.clubStaff.getInvitation, { ...args, token: invite.token }));
  });

  it("commits a shared account quota before rejected previews and acceptance attempts", async () => {
    const { t, client, create, ownerClient } = await setup();
    const invite = await create();
    for (let index = 0; index < 10; index++) {
      assert.equal(await client.action(api.clubStaff.getInvitation, {
        ...args, token: `malformed-${index}`,
      }), null);
    }
    for (let index = 0; index < 20; index++) {
      await assert.rejects(client.action(api.clubStaff.acceptStaffInvitation, {
        ...args, token: `wrong-${index}`,
      }), /no longer valid/);
    }
    await assert.rejects(
      client.action(api.clubStaff.getInvitation, { ...args, token: invite.token }),
      /STAFF_INVITATION_RATE_LIMITED/,
    );
    await assert.rejects(
      client.action(api.clubStaff.acceptStaffInvitation, { ...args, token: invite.token }),
      /STAFF_INVITATION_RATE_LIMITED/,
    );
    assert.ok(await ownerClient.action(api.clubStaff.getInvitation, { ...args, token: invite.token }));
    assert.equal((await t.run((ctx) => ctx.db.get(invite.invitationId)))!.state, "pending");
    assert.equal((await t.run((ctx) => ctx.db.query("communityAuthorities").collect())).length, 0);
  });

  for (const reason of ["expired", "revoked", "wrong-community", "malformed", "unknown"] as const) {
    it(`denies ${reason} tokens without granting staff access`, async () => {
      const { t, client, create, ownerClient } = await setup();
      const invite = await create();
      if (reason === "expired") await t.run((ctx) => ctx.db.patch(invite.invitationId, { expiresAt: Date.now() }));
      if (reason === "revoked") await ownerClient.mutation(api.clubStaff.revokeStaffInvitation, { ...args, invitationId: invite.invitationId });
      const request = {
        communitySlug: reason === "wrong-community" ? "another-club" : args.communitySlug,
        token: reason === "malformed" ? `${invite.token}!` : reason === "unknown" ? "123456789_" : invite.token,
      };
      assert.equal(await t.action(api.clubStaff.getInvitation, request), null);
      await assert.rejects(client.action(api.clubStaff.acceptStaffInvitation, request));
      assert.notEqual((await t.run((ctx) => ctx.db.get(invite.invitationId)))!.state, "accepted");
      assert.equal((await t.run((ctx) => ctx.db.query("communityAuthorities").collect())).length, 0);
    });
  }

  it("refuses anonymous acceptance even for a valid short token", async () => {
    const { t, create } = await setup();
    const invite = await create();
    await assert.rejects(t.action(api.clubStaff.acceptStaffInvitation, { ...args, token: invite.token }));
    assert.equal((await t.run((ctx) => ctx.db.get(invite.invitationId)))!.state, "pending");
  });

  it("does not overspend the account quota under concurrent requests", async () => {
    const { t, client } = await setup();
    const results = await Promise.allSettled(Array.from({ length: 35 }, (_, index) =>
      client.action(api.clubStaff.getInvitation, { ...args, token: `bad-${index}` }),
    ));
    assert.equal(results.filter((result) => result.status === "fulfilled").length, 30);
    assert.equal(results.filter((result) => result.status === "rejected").length, 5);
    const rows = await t.run((ctx) => ctx.db.query("staffInvitationRateLimits").collect());
    assert.equal(rows.length, 1);
    assert.equal(rows[0]!.attempts, 30);
  });

  it("retains only account-scoped counters and sweeps expired windows without resetting active ones", async () => {
    const { t, client, create } = await setup();
    const invite = await create();
    await client.action(api.clubStaff.getInvitation, { ...args, token: invite.token });
    await t.run(async (ctx) => {
      for (let index = 0; index < 5; index++) await ctx.db.insert("staffInvitationRateLimits", {
        key: `expired-user-${index}`, attempts: 30, expiresAt: Date.now() - 1,
      });
    });
    await t.mutation(internal.clubStaff.expireInvitationRateLimits, {});
    const rows = await t.run((ctx) => ctx.db.query("staffInvitationRateLimits").collect());
    assert.equal(rows.length, 1);
    assert.equal(rows[0]!.attempts, 1);
    assert.equal(JSON.stringify(rows).includes(invite.token), false);
    assert.equal(JSON.stringify(rows).includes(args.communitySlug), false);
  });
});
