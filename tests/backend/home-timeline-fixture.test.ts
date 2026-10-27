import assert from "node:assert/strict";
import { it } from "node:test";
import { convexTest } from "convex-test";
import { api } from "../../convex/_generated/api";
import schemaModule from "../../convex/schema";
const schema =
  (schemaModule as unknown as { default?: typeof schemaModule }).default ??
  schemaModule;
const modules = {
  "../../convex/_generated/api.ts": () => import("../../convex/_generated/api"),
  "../../convex/e2eHomeTimeline.ts": () =>
    import("../../convex/e2eHomeTimeline"),
  "../../convex/eventTimeline.ts": () => import("../../convex/eventTimeline"),
};
it("rejects hosted/production/disabled/wrong-secret fixtures and cleans only the exact run", async () => {
  const t = convexTest({ schema, modules });
  const original = { ...process.env };
  try {
    Object.assign(process.env, {
      CONVEX_CLOUD_URL: "http://127.0.0.1:3210",
      VRDEX_ENABLE_E2E_HELPERS: "true",
      VRDEX_E2E_CONVEX_SECRET: "test-secret",
      VERCEL_ENV: "development",
      NODE_ENV: "production",
    });
    const args = {
      secret: "test-secret",
      runId: "playwright-timeline-11111111",
      startAt: Date.UTC(2026, 9, 26, 21),
    };
    for (const changes of [
      { CONVEX_CLOUD_URL: "https://host.convex.cloud" },
      { VERCEL_ENV: "production" },
      { VRDEX_ENABLE_E2E_HELPERS: "false" },
      { VRDEX_E2E_CONVEX_SECRET: "wrong" },
    ]) {
      const before = { ...process.env };
      Object.assign(process.env, changes);
      await assert.rejects(t.mutation(api.e2eHomeTimeline.create, args));
      process.env = before;
    }
    await assert.rejects(
      t.mutation(api.e2eHomeTimeline.create, { ...args, runId: "anything" }),
    );
    const one = await t.mutation(api.e2eHomeTimeline.create, args);
    const two = await t.mutation(api.e2eHomeTimeline.create, {
      ...args,
      runId: "playwright-timeline-22222222",
    });
    await assert.rejects(t.mutation(api.e2eHomeTimeline.create, args));
    const result = await t.query(api.eventTimeline.listPublic, {
      range: {
        startAt: args.startAt,
        endAt: args.startAt + 48 * 3600000,
        timeZone: "UTC",
      },
    });
    assert.ok(result.items.some((e) => e.id === one.eventIds[3]));
    assert.deepEqual(
      await t.mutation(api.e2eHomeTimeline.cleanup, {
        secret: args.secret,
        runId: args.runId,
      }),
      { events: 8, profiles: 2, slots: 8 },
    );
    assert.equal(await t.run((ctx) => ctx.db.get(one.eventIds[0])), null);
    assert.ok(await t.run((ctx) => ctx.db.get(two.eventIds[0])));
    assert.deepEqual(
      await t.mutation(api.e2eHomeTimeline.cleanup, {
        secret: args.secret,
        runId: args.runId,
      }),
      { events: 0, profiles: 0, slots: 0 },
    );
  } finally {
    process.env = original;
  }
});

it("only changes owned event state and saved reads drop hidden content", async () => {
  const original = { ...process.env };
  try {
    Object.assign(process.env, {
      CONVEX_CLOUD_URL: "http://127.0.0.1:3210",
      VRDEX_ENABLE_E2E_HELPERS: "true",
      VRDEX_E2E_CONVEX_SECRET: "test-secret",
      NODE_ENV: "production",
      VERCEL_ENV: "development",
    });
    const t = convexTest({ schema, modules });
    const args = {
      secret: "test-secret",
      runId: "playwright-timeline-33333333",
      startAt: Date.UTC(2026, 9, 26, 21),
    };
    const fixture = await t.mutation(api.e2eHomeTimeline.create, args);
    const change = {
      secret: args.secret,
      runId: args.runId,
      eventIndex: 3,
      state: "cancelled" as const,
    };
    await assert.rejects(
      t.mutation(api.e2eHomeTimeline.changeState, {
        ...change,
        runId: "playwright-timeline-foreign1",
      }),
    );
    await assert.rejects(
      t.mutation(api.e2eHomeTimeline.changeState, { ...change, eventIndex: 8 }),
    );
    const id = fixture.eventIds[3];
    await t.run((ctx) => ctx.db.patch(id, { sourceLabel: "foreign" }));
    await assert.rejects(t.mutation(api.e2eHomeTimeline.changeState, change));
    await t.run((ctx) => ctx.db.patch(id, { sourceLabel: args.runId }));
    await t.mutation(api.e2eHomeTimeline.changeState, change);
    const cancelled = await t.query(api.eventTimeline.resolveSaved, {
      references: [{ kind: "event", eventId: id }],
    });
    assert.equal(cancelled[0]?.kind, "available");
    assert.equal(
      cancelled[0]?.kind === "available" && cancelled[0].status,
      "cancelled",
    );
    await t.mutation(api.e2eHomeTimeline.changeState, {
      ...change,
      state: "hidden",
    });
    assert.deepEqual(
      await t.query(api.eventTimeline.resolveSaved, {
        references: [{ kind: "event", eventId: id }],
      }),
      [{ kind: "unavailable", reference: { kind: "event", eventId: id } }],
    );
  } finally {
    process.env = original;
  }
});
