import assert from "node:assert/strict";
import { it } from "node:test";
import { convexTest } from "convex-test";
import {
  makeFunctionReference,
  type ApiFromModules,
  type FunctionArgs,
  type FunctionReturnType,
} from "convex/server";
import type * as fixtureModule from "../../convex/localEventBroadcastRehearsal";
import type * as migrationModule from "../../convex/eventMediaControlMigration";
import schemaModule from "../../convex/schema";
const schema =
  (schemaModule as unknown as { default?: typeof schemaModule }).default ??
  schemaModule;
const modules = {
  "../../convex/_generated/api.ts": () => import("../../convex/_generated/api"),
  "../../convex/localEventBroadcastRehearsal.ts": () =>
    import("../../convex/localEventBroadcastRehearsal"),
  "../../convex/eventMediaControlMigration.ts": () =>
    import("../../convex/eventMediaControlMigration"),
};
type API = ApiFromModules<{
  fixture: typeof fixtureModule;
  migration: typeof migrationModule;
}>;
const seed = makeFunctionReference<
  "mutation",
  FunctionArgs<API["fixture"]["seed"]>,
  FunctionReturnType<API["fixture"]["seed"]>
>("localEventBroadcastRehearsal:seed");
const scenario = makeFunctionReference<
  "mutation",
  FunctionArgs<API["fixture"]["setScenario"]>,
  FunctionReturnType<API["fixture"]["setScenario"]>
>("localEventBroadcastRehearsal:setScenario");
const cleanupRef = makeFunctionReference<
  "mutation",
  FunctionArgs<API["fixture"]["cleanup"]>,
  FunctionReturnType<API["fixture"]["cleanup"]>
>("localEventBroadcastRehearsal:cleanup");
const inspect = makeFunctionReference<
  "query",
  FunctionArgs<API["fixture"]["inspect"]>,
  FunctionReturnType<API["fixture"]["inspect"]>
>("localEventBroadcastRehearsal:inspect");
const migration = makeFunctionReference<
  "mutation",
  FunctionArgs<API["migration"]["backfill"]>,
  FunctionReturnType<API["migration"]["backfill"]>
>("eventMediaControlMigration:backfill");
const runId = "source-check";
process.env.CONVEX_CLOUD_URL = "http://127.0.0.1:3210";
it("fixture refuses hosted deployment and malformed run ownership", async () => {
  const t = convexTest({ schema, modules });
  process.env.CONVEX_CLOUD_URL = "https://hosted.convex.cloud";
  try {
    await assert.rejects(t.mutation(seed, { runId }), /local deployment/);
  } finally {
    process.env.CONVEX_CLOUD_URL = "http://127.0.0.1:3210";
  }
  await assert.rejects(t.mutation(seed, { runId: "../unsafe" }), /runId/);
});
it("real migration rejects all open and legacy ownership blockers, then preserves history with one-row replay", async () => {
  const t = convexTest({ schema, modules });
  const manifest = await t.mutation(seed, { runId });
  assert.deepEqual(await t.mutation(seed, { runId }), manifest);
  await assert.rejects(
    t.mutation(seed, { runId: "other-run" }),
    /isolated|unrelated/,
  );
  for (const caseName of [
    "scheduled",
    "starting",
    "live",
    "hold",
    "fallback",
    "stopping",
    "dispatch-unconfirmed",
    "task-queued",
    "task-running",
    "task-starting",
    "task-stopping",
    "task-failed",
    "task-legacy",
  ] as const) {
    await t.mutation(scenario, { runId, case: caseName });
    if (["task-starting", "task-running", "task-stopping"].includes(caseName)) {
      const row = await t.run(async ({ db }) => {
        const m = await db.query("localEventBroadcastRehearsals").first();
        assert.ok(m);
        return db.get(m.sessions[0].id);
      });
      assert.equal(row?.status, "ended");
      assert.equal(row?.workerTaskId, undefined);
    }
    const before = await t.query(inspect, { runId });
    await assert.rejects(
      t.mutation(migration, { batchSize: 1 }),
      /no open sessions|stop must be confirmed/,
    );
    assert.deepEqual(await t.query(inspect, { runId }), before);
    await t.mutation(scenario, { runId, case: "ended-baseline" });
  }
  await t.mutation(scenario, { runId, case: "task-confirmed" });
  let request: FunctionArgs<typeof migration> = {
    phase: "eventMediaSources",
    cursor: null as string | null,
    batchSize: 1,
  };
  let calls = 0;
  const phases = new Set<string>();
  while (true) {
    assert.ok(++calls < 128);
    phases.add(request.phase ?? "eventMediaSources");
    const response = await t.mutation(migration, request);
    assert.ok(response.processed <= 1);
    const snapshot = await t.query(inspect, { runId });
    assert.deepEqual(await t.mutation(migration, request), response);
    assert.deepEqual(await t.query(inspect, { runId }), snapshot);
    if (calls === 2) {
      await t.mutation(scenario, { runId, case: "live" });
      await assert.rejects(
        t.mutation(migration, {
          phase: response.phase,
          cursor: response.cursor,
          batchSize: 1,
        }),
        /no open sessions/,
      );
      await t.mutation(scenario, {
        runId,
        case: "ended-baseline",
      });
    }
    if (response.done) break;
    request = { phase: response.phase, cursor: response.cursor, batchSize: 1 };
  }
  assert.equal(phases.size, 3);
  const after = await t.query(inspect, { runId });
  const byCase = new Map(after.sessions.map((row) => [row.case, row]));
  for (const name of ["automatic", "explicit"])
    assert.deepEqual(byCase.get(name)?.committedIntent, {
      kind: "automatic",
    });
  for (const name of ["manual-one", "manual-observed", "internal"])
    assert.equal(byCase.get(name)?.committedIntent?.kind, "manual");
  for (const name of [
    "hold",
    "manual-ambiguous",
    "manual-stale",
    "disabled",
    "removed-link",
    "hidden-link",
    "hidden-profile",
    "missing",
    "foreign",
  ])
    assert.deepEqual(byCase.get(name)?.committedIntent, {
      kind: "slate",
    });
  assert.equal(byCase.get("explicit")?.intentSequence, 99);
  assert.ok(
    after.commands
      .filter((row: { case: string }) => row.case.startsWith("pending-"))
      .every(
        (row) =>
          row.status === "cancelled" && row.controlOutcome === "superseded",
      ),
  );
  assert.equal(
    after.commands.find((row) => row.case === "completed")?.status,
    "succeeded",
  );
  assert.equal(
    after.sources.find((row) => row.key === "disabled")?.state,
    "disabled",
  );
  for (const phase of [
    "eventMediaSources",
    "eventMediaSessions",
    "eventMediaCommands",
  ] as const)
    await t.mutation(migration, { phase, batchSize: 100 });
  assert.deepEqual(await t.query(inspect, { runId }), after);
  const cleanup = await t.mutation(cleanupRef, { runId });
  assert.ok(cleanup.deleted > 30);
  assert.deepEqual(await t.mutation(cleanupRef, { runId }), {
    deleted: 0,
  });
});
it("whole-table migration preflight refuses unrelated rows and cleanup preserves them", async () => {
  const t = convexTest({ schema, modules });
  await t.mutation(seed, { runId });
  const unrelated = await t.run(async ({ db }) => {
    const row = await db.query("eventMediaSources").first();
    assert.ok(row);
    const { _id, _creationTime, ...fields } = row;
    return db.insert("eventMediaSources", { ...fields, key: "unrelated" });
  });
  await assert.rejects(
    t.mutation(scenario, {
      runId,
      case: "assert-migration-isolation",
    }),
    /unrelated/,
  );
  await t.mutation(cleanupRef, { runId });
  assert.ok(await t.run(({ db }) => db.get(unrelated)));
});
it("all fixture APIs reject hosted and cross-run access; tampered ownership cannot be cleaned up", async () => {
  const t = convexTest({ schema, modules });
  await t.mutation(seed, { runId });
  await assert.rejects(
    t.query(inspect, { runId: "foreign-run" }),
    /manifest missing/,
  );
  await assert.rejects(
    t.mutation(scenario, { runId: "foreign-run", case: "live" }),
    /manifest missing/,
  );
  assert.deepEqual(await t.mutation(cleanupRef, { runId: "foreign-run" }), {
    deleted: 0,
  });
  process.env.CONVEX_CLOUD_URL = "https://hosted.convex.cloud";
  try {
    await assert.rejects(t.query(inspect, { runId }), /local deployment/);
    await assert.rejects(
      t.mutation(scenario, { runId, case: "live" }),
      /local deployment/,
    );
    await assert.rejects(t.mutation(cleanupRef, { runId }), /local deployment/);
  } finally {
    process.env.CONVEX_CLOUD_URL = "http://127.0.0.1:3210";
  }
  const community = await t.run(async ({ db }) => {
    const m = await db.query("localEventBroadcastRehearsals").first();
    assert.ok(m);
    await db.patch(m.communityId, { publicSurfacingReason: "not-owned" });
    return m.communityId;
  });
  await assert.rejects(t.mutation(cleanupRef, { runId }), /ownership mismatch/);
  assert.ok(await t.run(({ db }) => db.get(community)));
});
