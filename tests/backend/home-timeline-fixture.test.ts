import assert from "node:assert/strict";
import { it } from "node:test";
import { convexTest } from "convex-test";
import { api } from "../../convex/_generated/api";
import schemaModule from "../../convex/schema";
import { getPublicEventBySlug } from "../../convex/_eventPublic";
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
    assert.equal(
      result.items.find((e) => e.id === one.eventIds[3])?.host?.imageUrl,
      `https://timeline-artwork.invalid/${args.runId}/prism.svg`,
    );
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
    const oldSlot = fixture.slotIds[6];
    await t.mutation(api.e2eHomeTimeline.changeState, {
      ...change,
      state: "recreate-slot",
    });
    assert.deepEqual(
      await t.query(api.eventTimeline.resolveSaved, {
        references: [{ kind: "set", eventId: id, slotId: oldSlot }],
      }),
      [
        {
          kind: "unavailable",
          reference: { kind: "set", eventId: id, slotId: oldSlot },
        },
      ],
    );
    const replacement = await t.run((ctx) =>
      ctx.db
        .query("eventSlots")
        .withIndex("by_eventId", (q) => q.eq("eventId", id))
        .collect(),
    );
    assert.equal(replacement.length, 2);
    assert.ok(
      replacement.some(
        (row) => row.displayLabel === "Aurora" && row._id !== oldSlot,
      ),
    );
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

it("the bounded prefetch scenario authors earlier and long ongoing events under normal public reads", async () => {
  const original = { ...process.env };
  try {
    Object.assign(process.env, {
      CONVEX_CLOUD_URL: "http://127.0.0.1:3210",
      VRDEX_ENABLE_E2E_HELPERS: "true",
      VRDEX_E2E_CONVEX_SECRET: "test-secret",
      NODE_ENV: "production",
      VERCEL_ENV: "development",
    });
    const t = convexTest({ schema, modules }),
      startAt = Date.UTC(2026, 9, 26);
    const fixture = await t.mutation(api.e2eHomeTimeline.create, {
      secret: "test-secret",
      runId: "playwright-timeline-prefetch",
      startAt,
      scenario: "prefetch",
    });
    const earlier = await t.run((ctx) => ctx.db.get(fixture.eventIds[0]));
    const ongoing = await t.run((ctx) => ctx.db.get(fixture.eventIds[1]));
    assert.equal(earlier?.startAt, startAt - 4 * 3600000);
    assert.equal(earlier?.endAt, startAt - 3600000);
    assert.equal(ongoing?.startAt, startAt - 2 * 3600000);
    assert.equal(ongoing?.endAt, startAt + 20 * 3600000);
    const saved = await t.query(api.eventTimeline.resolveSaved, {
      references: [{ kind: "event", eventId: fixture.eventIds[1] }],
    });
    assert.equal(saved[0]?.kind, "available");
    assert.deepEqual(
      await t.mutation(api.e2eHomeTimeline.cleanup, {
        secret: "test-secret",
        runId: "playwright-timeline-prefetch",
      }),
      { events: 8, profiles: 2, slots: 8 },
    );
  } finally {
    process.env = original;
  }
});

it("detail scenario owns and exactly cleans dense slots, hidden person and untimed lineup", async()=>{
  const original={...process.env};
  try {
    Object.assign(process.env,{CONVEX_CLOUD_URL:"http://127.0.0.1:3210",VRDEX_ENABLE_E2E_HELPERS:"true",VRDEX_E2E_CONVEX_SECRET:"test-secret",VERCEL_ENV:"development"});
    const t=convexTest({schema,modules});
    const args={secret:"test-secret",runId:"playwright-timeline-detail000",startAt:Date.UTC(2026,9,26,21)};
    const result=await t.mutation(api.e2eHomeTimeline.create,{...args,scenario:"detail"});
    assert.equal(result.slotIds.length,87);assert.equal(result.profileIds.length,3);
    assert.equal(result.lineupEntryIds.length, 2);
    const row=await t.run(ctx=>ctx.db.get(result.eventIds[3]));
    assert.equal(row?.posterImageUrl,"/api/e2e/fixture-assets/fixture-orbit-timeline-poster");
    const canonical = await t.run(async ({db})=>getPublicEventBySlug(db,await db.get(result.eventIds[3])));
    assert.equal(canonical?.slots.length,80);
    assert.ok(!canonical?.lineup.some(entry=>entry.key === result.slotIds[86]));
    let cursor:string|undefined;const rows=[];
    do {const page=await t.query(api.eventTimeline.listPublicRoster,{eventId:result.eventIds[3],range:{startAt:0,endAt:1,timeZone:"UTC"},detail:true,cursor});if(page.detail?.kind === "available") rows.push(...page.detail.rows);cursor=page.cursor??undefined;}while(cursor);
    assert.equal(rows.filter(row=>row.kind === "slot").length,81);
    assert.equal(rows.filter(row=>row.kind === "lineup").length,2);
    assert.equal(rows.find(row=>row.displayLabel === "Manual guest")?.roleLabel,"Host");
    assert.ok(!JSON.stringify(rows).includes("SECRET")); assert.ok(!JSON.stringify(rows).includes(result.profileIds[2]));
    assert.deepEqual(await t.mutation(api.e2eHomeTimeline.cleanup,{secret:args.secret,runId:args.runId}),{events:8,profiles:3,slots:87,lineupEntries:2});
  }finally{process.env=original;}
});

it("short-set fixtures author exact 30/15-minute intervals and preserve owned cleanup counts", async () => {
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
    const startAt = Date.UTC(2026, 9, 26, 21);
    const args = {
      secret: "test-secret",
      runId: "playwright-timeline-shortset1",
      startAt,
      scenario: "short-sets" as const,
    };
    await assert.rejects(
      t.mutation(api.e2eHomeTimeline.create, { ...args, secret: "wrong" }),
    );
    const fixture = await t.mutation(api.e2eHomeTimeline.create, args);
    assert.equal(fixture.eventIds.length, 8);
    assert.equal(fixture.slotIds.length, 8);
    assert.equal(fixture.profileIds.length, 2);
    const short = await t.run(async (ctx) =>
      Promise.all(fixture.slotIds.slice(6).map((id) => ctx.db.get(id))),
    );
    assert.deepEqual(
      short.map((slot) => [slot?.startAt, slot?.endAt]),
      [
        [startAt + 3_600_000, startAt + 5_400_000],
        [startAt + 5_400_000, startAt + 6_300_000],
      ],
    );
    const ordinary = await t.run((ctx) => ctx.db.get(fixture.slotIds[0]));
    assert.equal((ordinary?.endAt ?? 0) - (ordinary?.startAt ?? 0), 3_600_000);
    assert.deepEqual(
      await t.mutation(api.e2eHomeTimeline.cleanup, {
        secret: args.secret,
        runId: args.runId,
      }),
      { events: 8, profiles: 2, slots: 8 },
    );
  } finally {
    process.env = original;
  }
});
