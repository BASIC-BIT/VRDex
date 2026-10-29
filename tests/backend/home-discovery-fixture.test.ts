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
  "../../convex/homeDiscovery.ts": () => import("../../convex/homeDiscovery"),
};
const args = {
  secret: "discovery-secret",
  runId: "playwright-timeline-discovery5b",
  startAt: Date.UTC(2026, 9, 26, 21),
};
function local() {
  Object.assign(process.env, {
    CONVEX_CLOUD_URL: "http://127.0.0.1:3210",
    VRDEX_ENABLE_E2E_HELPERS: "true",
    VRDEX_E2E_CONVEX_SECRET: args.secret,
    VERCEL_ENV: "development",
  });
}
it("dense discovery is loopback gated, reaches day 120 beyond 240 near events, and omits hidden identities", async () => {
  const before = { ...process.env };
  try {
    local();
    const t = convexTest({ schema, modules });
    const input = { ...args, scenario: "discovery-dense" as const };
    for (const change of [
      { CONVEX_CLOUD_URL: "https://host.convex.cloud" },
      { VERCEL_ENV: "production" },
      { VRDEX_ENABLE_E2E_HELPERS: "false" },
      { VRDEX_E2E_CONVEX_SECRET: "wrong" },
    ]) {
      Object.assign(process.env, change);
      await assert.rejects(t.mutation(api.e2eHomeTimeline.create, input));
      local();
    }
    const result = await t.mutation(api.e2eHomeTimeline.create, input);
    assert.equal(result.eventIds.length, 246);
    assert.equal(result.profileIds.length, 8);
    assert.equal(result.slotIds.length, 5);
    const distant = await t.query(api.homeDiscovery.listEvents, {
      now: args.startAt,
      timeZone: "UTC",
      band: 3,
      kind: "timed",
      direction: "asc",
    });
    assert.deepEqual(
      distant.items.map((e) => e.id),
      [result.eventIds[242]],
    );
    const signals = await t.query(api.homeDiscovery.eventSignals, {
      eventIds: [
        result.eventIds[2],
        result.eventIds[242],
        result.eventIds[243],
        result.eventIds[244],
      ],
    });
    assert.deepEqual(
      signals.items.map((e) => e.eventId),
      [result.eventIds[2], result.eventIds[242]],
    );
    assert.equal(signals.items[0].performers.length, 0);
    assert.ok(!JSON.stringify(signals).includes("SECRET"));
    const clubs = await t.query(api.homeDiscovery.profileSignals, {
      profileIds: result.profileIds,
    });
    assert.ok(clubs.items.some((p) => p.id === result.profileIds[4]));
    assert.ok(!JSON.stringify(clubs).includes("SECRET"));
    assert.equal(
      clubs.items.find((p) => p.id === result.profileIds[7])?.genres[1]
        .displayLabel,
      "Deep journeys",
    );
    const foreign = await t.mutation(api.e2eHomeTimeline.create, {
      ...args,
      runId: "playwright-timeline-foreign5b",
      scenario: "discovery-sparse",
    });
    assert.deepEqual(
      await t.mutation(api.e2eHomeTimeline.cleanup, {
        secret: args.secret,
        runId: args.runId,
      }),
      { events: 246, profiles: 8, slots: 5 },
    );
    for (const id of [
      ...result.eventIds,
      ...result.profileIds,
      ...result.slotIds,
    ])
      assert.equal(await t.run((ctx) => ctx.db.get(id)), null);
    assert.ok(await t.run((ctx) => ctx.db.get(foreign.eventIds[0])));
    assert.deepEqual(
      await t.mutation(api.e2eHomeTimeline.cleanup, {
        secret: args.secret,
        runId: args.runId,
      }),
      { events: 0, profiles: 0, slots: 0 },
    );
    assert.deepEqual(
      await t.mutation(api.e2eHomeTimeline.cleanup, {
        secret: args.secret,
        runId: "playwright-timeline-foreign5b",
      }),
      { events: 1, profiles: 4, slots: 1 },
    );
  } finally {
    process.env = before;
  }
});
it("discovery cleanup rejects ownership mismatch atomically", async () => {
  const before = { ...process.env };
  try {
    local();
    const t = convexTest({ schema, modules });
    const result = await t.mutation(api.e2eHomeTimeline.create, {
      ...args,
      scenario: "discovery-sparse",
    });
    await t.run((ctx) =>
      ctx.db.patch(result.slotIds[0], { sourceLabel: "foreign" }),
    );
    await assert.rejects(
      t.mutation(api.e2eHomeTimeline.cleanup, {
        secret: args.secret,
        runId: args.runId,
      }),
      /ownership mismatch/,
    );
    assert.ok(await t.run((ctx) => ctx.db.get(result.eventIds[0])));
    await t.run((ctx) =>
      ctx.db.patch(result.slotIds[0], { sourceLabel: args.runId }),
    );
    assert.deepEqual(
      await t.mutation(api.e2eHomeTimeline.cleanup, {
        secret: args.secret,
        runId: args.runId,
      }),
      { events: 1, profiles: 4, slots: 1 },
    );
  } finally {
    process.env = before;
  }
});
it("run-owned host suppression revokes event, club and favorite signals through public queries", async () => {
  const before = { ...process.env };
  try {
    local();
    const t = convexTest({ schema, modules });
    const fixture = await t.mutation(api.e2eHomeTimeline.create, {
      ...args,
      scenario: "discovery",
    });
    await t.mutation(api.e2eHomeTimeline.changeState, {
      secret: args.secret,
      runId: args.runId,
      eventIndex: 0,
      state: "suppress-host",
    });
    assert.deepEqual(
      (
        await t.query(api.homeDiscovery.eventSignals, {
          eventIds: fixture.eventIds,
        })
      ).items.map((e) => e.eventId),
      [fixture.eventIds[1]],
    );
    assert.deepEqual(
      (
        await t.query(api.homeDiscovery.profileSignals, {
          profileIds: [fixture.profileIds[0]],
        })
      ).items,
      [],
    );
    assert.deepEqual(
      await t.mutation(api.e2eHomeTimeline.cleanup, {
        secret: args.secret,
        runId: args.runId,
      }),
      { events: 2, profiles: 4, slots: 2 },
    );
  } finally {
    process.env = before;
  }
});
it("dense public-handler collection records bounded query and returned-row costs", async () => {
  const before = { ...process.env };
  try {
    local();
    const t = convexTest({ schema, modules });
    const fixture = await t.mutation(api.e2eHomeTimeline.create, {
      ...args,
      scenario: "discovery-dense",
    });
    const handlers = await import("../../convex/homeDiscovery");
    const { createDiscoveryController } =
      await import("../../apps/web/src/lib/discovery/controller");
    const counts: Record<string, number> = {},
      rows: Record<string, number> = {};
    let requests = 0;
    const transport = <T>(
      operation: (
        db: import("../../convex/_generated/server").DatabaseReader,
        ctx: import("../../convex/_generated/server").QueryCtx,
      ) => Promise<T>,
    ) => ({
      subscribe(next: (result: T) => void, error: (error: unknown) => void) {
        requests++;
        void t
          .run(async (ctx) => {
            const db = new Proxy(ctx.db, {
              get(target, property, receiver) {
                if (property === "get")
                  return async (id: Parameters<typeof target.get>[0]) => {
                    counts.get = (counts.get ?? 0) + 1;
                    const value = await target.get(id);
                    rows.get = (rows.get ?? 0) + Number(value !== null);
                    return value;
                  };
                if (property === "query")
                  return (table: Parameters<typeof target.query>[0]) => {
                    function wrap<Q extends object>(query: Q): Q {
                      return new Proxy(query, {
                        get(target, key, receiver) {
                          const value: unknown = Reflect.get(
                            target,
                            key,
                            receiver,
                          );
                          if (typeof value !== "function") return value;
                          return (...args: unknown[]) => {
                            const result: unknown = Reflect.apply(
                              value,
                              target,
                              args,
                            );
                            if (
                              [
                                "paginate",
                                "take",
                                "first",
                                "unique",
                                "collect",
                              ].includes(String(key))
                            ) {
                              const counter = `${table}.${String(key)}`;
                              counts[counter] = (counts[counter] ?? 0) + 1;
                              return Promise.resolve(result).then((value) => {
                                const items = Array.isArray(value)
                                  ? value
                                  : value &&
                                      typeof value === "object" &&
                                      "page" in value &&
                                      Array.isArray(value.page)
                                    ? value.page
                                    : value === null
                                      ? []
                                      : [value];
                                rows[counter] =
                                  (rows[counter] ?? 0) + items.length;
                                return value;
                              });
                            }
                            return result && typeof result === "object"
                              ? wrap(result)
                              : result;
                          };
                        },
                      });
                    }
                    return wrap(target.query(table));
                  };
                return Reflect.get(target, property, receiver);
              },
            });
            return operation(db, ctx);
          })
          .then(next, error);
        return () => {};
      },
    });
    const controller = createDiscoveryController({
      concurrency: 3,
      transport: {
        listEvents: (input) =>
          transport((db, ctx) =>
            handlers.listEvents._handler({ ...ctx, db }, input),
          ),
        listClubs: (input) =>
          transport((db, ctx) =>
            handlers.listClubs._handler({ ...ctx, db }, input),
          ),
        eventSignals: (input) =>
          transport((db, ctx) =>
            handlers.eventSignals._handler({ ...ctx, db }, input),
          ),
        profileSignals: (input) =>
          transport((db, ctx) =>
            handlers.profileSignals._handler({ ...ctx, db }, input),
          ),
      },
    });
    const ready = new Promise<void>((resolve, reject) =>
      controller.subscribe(() => {
        const snapshot = controller.getSnapshot();
        if (snapshot.kind === "available") resolve();
        else if (snapshot.kind === "error") reject(snapshot.error);
      }),
    );
    controller.setFavorites(fixture.profileIds.slice(0, 2));
    controller.setContext({
      now: args.startAt,
      timeZone: "UTC",
      rotationKey: "cost-proof",
    });
    await ready;
    const snapshot = controller.getSnapshot();
    assert.equal(snapshot.kind, "available");
    if (snapshot.kind !== "available") throw Error("No discovery");
    assert.ok(snapshot.events.some((e) => e.id === fixture.eventIds[242]));
    assert.ok(snapshot.coverage.candidateCount <= 32);
    assert.ok(requests <= 72);
    assert.ok(rows["events.paginate"] <= 576);
    assert.ok(rows["profiles.paginate"] <= 72);
    assert.ok(
      (rows["eventSlots.take"] ?? 0) +
        (rows["eventLineupEntries.take"] ?? 0) +
        (rows["eventParticipants.take"] ?? 0) <=
        32 * 27,
    );
    console.log(
      JSON.stringify({
        discoveryDenseCosts: {
          requests,
          candidates: snapshot.coverage.candidateCount,
          counts,
          rows,
        },
      }),
    );
    controller.dispose();
    assert.deepEqual(
      await t.mutation(api.e2eHomeTimeline.cleanup, {
        secret: args.secret,
        runId: args.runId,
      }),
      { events: 246, profiles: 8, slots: 5 },
    );
  } finally {
    process.env = before;
  }
});
it("timeline visual scenario preserves Schedule geometry and uses score-separated owned recommendations without original favorites", async () => {
  const before = { ...process.env };
  try {
    local();
    const t = convexTest({ schema, modules });
    const fixture = await t.mutation(api.e2eHomeTimeline.create, {
      ...args,
      scenario: "timeline-visual",
    });
    assert.equal(fixture.eventIds.length, 10);
    assert.equal(fixture.profileIds.length, 5);
    assert.equal(fixture.slotIds.length, 10);
    const first = await t.run((ctx) => ctx.db.get(fixture.eventIds[0]));
    assert.equal(first?.title, "Soft Focus");
    assert.equal(first?.startAt, args.startAt - 2 * 3600000);
    const favoriteProfileIds = fixture.profileIds.slice(2, 4);
    assert.ok(!favoriteProfileIds.includes(fixture.profileIds[0]));
    assert.ok(!favoriteProfileIds.includes(fixture.profileIds[1]));
    const favoriteProfiles = (
      await t.query(api.homeDiscovery.profileSignals, {
        profileIds: favoriteProfileIds,
      })
    ).items;
    const allProfiles = (
      await t.query(api.homeDiscovery.profileSignals, {
        profileIds: fixture.profileIds,
      })
    ).items;
    const events = [];
    for (const band of [0, 1, 2, 3] as const)
      for (const kind of ["timed", "date_only"] as const) {
        events.push(
          ...(
            await t.query(api.homeDiscovery.listEvents, {
              now: args.startAt + 1800000,
              timeZone: "UTC",
              band,
              kind,
              direction: "asc",
            })
          ).items,
        );
      }
    const signals = [];
    for (let i = 0; i < events.length; i += 4)
      signals.push(
        ...(
          await t.query(api.homeDiscovery.eventSignals, {
            eventIds: events.slice(i, i + 4).map((e) => e.id),
          })
        ).items,
      );
    const { selectDiscovery } =
      await import("../../apps/web/src/lib/discovery/recommendations");
    for (const rotationKey of ["one", "another", "arbitrary"]) {
      const chosen = selectDiscovery({
        events,
        eventSignals: signals,
        clubs: allProfiles.filter((p) => p.profileType === "community"),
        favoriteProfileIds,
        favoriteProfiles,
        rotationKey,
      });
      assert.deepEqual(
        chosen.events.map((e) => e.id),
        fixture.eventIds.slice(8),
      );
      assert.deepEqual(
        chosen.clubs.map((p) => p.id),
        [fixture.profileIds[2], fixture.profileIds[0]],
      );
    }
    assert.deepEqual(
      await t.mutation(api.e2eHomeTimeline.cleanup, {
        secret: args.secret,
        runId: args.runId,
      }),
      { events: 10, profiles: 5, slots: 10 },
    );
  } finally {
    process.env = before;
  }
});

it("outside-sample club fixture preserves gates, candidate exclusion and exact owned cleanup", async () => {
  const before = { ...process.env };
  try {
    local();
    const t = convexTest({ schema, modules });
    const input = { ...args, scenario: "discovery-clubs" as const };
    await assert.rejects(t.mutation(api.e2eHomeTimeline.create, { ...input, secret: "wrong" }));
    const fixture = await t.mutation(api.e2eHomeTimeline.create, input);
    assert.equal(fixture.eventIds.length, 2); assert.equal(fixture.profileIds.length, 32); assert.equal(fixture.slotIds.length, 2);
    const club = fixture.profileIds[0];
    for (const direction of ["asc", "desc"] as const) {
      const candidates = await t.query(api.homeDiscovery.listClubs, { direction });
      assert.equal(candidates.items.length, 12);
      assert.ok(!candidates.items.some(item => item.id === club));
    }
    assert.equal((await t.query(api.homeDiscovery.profileSignals, { profileIds: [club] })).items[0]?.id, club);
    await assert.rejects(t.mutation(api.e2eHomeTimeline.cleanup, { secret: "wrong", runId: args.runId }));
    const extra = fixture.profileIds.at(-1)!;
    const original = await t.run(ctx => ctx.db.get(extra));
    await t.run(ctx => ctx.db.patch(extra, { sourceAttribution: undefined }));
    await assert.rejects(t.mutation(api.e2eHomeTimeline.cleanup, { secret: args.secret, runId: args.runId }), /ownership mismatch/);
    assert.ok(await t.run(ctx => ctx.db.get(fixture.eventIds[0])));
    await t.run(ctx => ctx.db.patch(extra, { sourceAttribution: original?.sourceAttribution }));
    await t.mutation(api.e2eHomeTimeline.changeState, { secret: args.secret, runId: args.runId, eventIndex: 0, state: "suppress-host" });
    assert.deepEqual((await t.query(api.homeDiscovery.profileSignals, { profileIds: [club] })).items, []);
    assert.deepEqual(await t.mutation(api.e2eHomeTimeline.cleanup, { secret: args.secret, runId: args.runId }), { events: 2, profiles: 32, slots: 2 });
    for (const id of [...fixture.eventIds, ...fixture.profileIds, ...fixture.slotIds]) assert.equal(await t.run(ctx => ctx.db.get(id)), null);
    assert.deepEqual(await t.mutation(api.e2eHomeTimeline.cleanup, { secret: args.secret, runId: args.runId }), { events: 0, profiles: 0, slots: 0 });
  } finally { process.env = before; }
});
