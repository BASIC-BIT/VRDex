import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { convexTest } from "convex-test";
import { ConvexError } from "convex/values";

import { api } from "../../convex/_generated/api";
import schemaModule from "../../convex/schema";
import { clerkTestIdentity } from "./_clerkTestIdentity";

// Match the Node/tsx schema interop used by the backend integration suite.
const schema = (
  schemaModule as unknown as { default?: typeof schemaModule }
).default ?? schemaModule;
const modules = {
  "../../convex/_generated/api.ts": () => import("../../convex/_generated/api"),
  "../../convex/accounts.ts": () => import("../../convex/accounts"),
  "../../convex/users.ts": () => import("../../convex/users"),
};

async function fixture() {
  const t = convexTest({ schema, modules });
  const { actorId, otherId } = await t.run(async (ctx) => ({
    actorId: await ctx.db.insert("users", {
      clerkUserId: "timezone-actor",
      name: "Original name",
      email: "original@example.test",
      emailVerificationTime: 1,
    }),
    otherId: await ctx.db.insert("users", {
      clerkUserId: "timezone-other",
      name: "Other account",
    }),
  }));
  const actor = t.withIdentity(clerkTestIdentity("timezone-actor"));
  const other = t.withIdentity(clerkTestIdentity("timezone-other"));
  return { t, actor, other, actorId, otherId };
}

describe("private account event timezone preference", () => {
  it("keeps the event timezone preference private to its account", async () => {
    const { actor, other, t } = await fixture();
    assert.equal(
      await actor.mutation(api.accounts.setEventTimezonePreference, {
        timezone: "America/New_York",
      }),
      null,
    );
    assert.equal(
      (await actor.query(api.accounts.viewer, {}))?.user.defaultEventTimezone,
      "America/New_York",
    );
    assert.equal(
      (await other.query(api.accounts.viewer, {}))?.user.defaultEventTimezone,
      undefined,
    );
    assert.equal(await t.query(api.accounts.viewer, {}), null);
  });

  it("clears the saved preference with null", async () => {
    const { actor, t, actorId } = await fixture();
    await actor.mutation(api.accounts.setEventTimezonePreference, {
      timezone: "America/New_York",
    });
    assert.equal(
      await actor.mutation(api.accounts.setEventTimezonePreference, { timezone: null }),
      null,
    );
    assert.equal(
      (await actor.query(api.accounts.viewer, {}))?.user.defaultEventTimezone,
      undefined,
    );
    assert.equal(
      Object.hasOwn((await t.run((ctx) => ctx.db.get(actorId)))!, "defaultEventTimezone"),
      false,
    );
  });

  it("changes only the authenticated account when two accounts save preferences", async () => {
    const { actor, other } = await fixture();
    await other.mutation(api.accounts.setEventTimezonePreference, { timezone: "Europe/Berlin" });
    await actor.mutation(api.accounts.setEventTimezonePreference, { timezone: "America/New_York" });
    await actor.mutation(api.accounts.setEventTimezonePreference, { timezone: null });
    assert.equal(
      (await other.query(api.accounts.viewer, {}))?.user.defaultEventTimezone,
      "Europe/Berlin",
    );
  });

  it("rejects a client-supplied target account instead of editing it", async () => {
    const { actor, other, otherId } = await fixture();
    const attemptedTarget = { timezone: "America/New_York", userId: otherId };
    await assert.rejects(
      actor.mutation(api.accounts.setEventTimezonePreference, attemptedTarget),
      /Unexpected field `userId`/,
    );
    assert.equal(
      (await other.query(api.accounts.viewer, {}))?.user.defaultEventTimezone,
      undefined,
    );
  });

  it("rejects signed-out writes with the existing structured auth error", async () => {
    const { t, actorId, otherId } = await fixture();
    const before = await t.run(async (ctx) => [await ctx.db.get(actorId), await ctx.db.get(otherId)]);
    await assert.rejects(
      t.mutation(api.accounts.setEventTimezonePreference, { timezone: "America/New_York" }),
      (error: unknown) => {
        assert.ok(error instanceof ConvexError);
        assert.deepEqual(error.data, { code: "SIGN_IN_REQUIRED" });
        return true;
      },
    );
    assert.deepEqual(
      await t.run(async (ctx) => [await ctx.db.get(actorId), await ctx.db.get(otherId)]),
      before,
    );
  });

  it("rejects invalid timezones without changing the stored row", async () => {
    const { actor, t, actorId } = await fixture();
    await actor.mutation(api.accounts.setEventTimezonePreference, { timezone: "America/New_York" });
    const before = await t.run((ctx) => ctx.db.get(actorId));
    for (const timezone of ["", "   ", "not-a-timezone", "UTC+1", "+01:00"]) {
      await assert.rejects(
        actor.mutation(api.accounts.setEventTimezonePreference, { timezone }),
        /valid IANA time zone/,
      );
      assert.deepEqual(await t.run((ctx) => ctx.db.get(actorId)), before);
    }
  });

  it("retains the preference when refreshing mirrored Clerk identity fields", async () => {
    const { actor, t, actorId } = await fixture();
    await actor.mutation(api.accounts.setEventTimezonePreference, { timezone: "America/New_York" });
    const refreshedActor = t.withIdentity({
      ...clerkTestIdentity("timezone-actor"),
      name: "Refreshed name",
      email: "refreshed@example.test",
      emailVerified: false,
      pictureUrl: "https://example.test/avatar.png",
    });
    assert.deepEqual(await refreshedActor.mutation(api.users.ensureCurrentUser, {}), { id: actorId });
    const viewer = await refreshedActor.query(api.accounts.viewer, {});
    assert.equal(viewer?.user.defaultEventTimezone, "America/New_York");
    assert.equal(viewer?.user.name, "Refreshed name");
    assert.equal(viewer?.user.email, "refreshed@example.test");
    assert.equal(viewer?.user.emailVerified, false);
    assert.equal(viewer?.user.image, "https://example.test/avatar.png");
    const stored = await t.run((ctx) => ctx.db.get(actorId));
    assert.equal(stored?.email, "refreshed@example.test");
    assert.equal(stored?.emailVerificationTime, undefined);
    assert.equal(stored?.defaultEventTimezone, "America/New_York");
  });
});
