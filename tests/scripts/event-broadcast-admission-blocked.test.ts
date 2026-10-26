import assert from "node:assert/strict";
import { test } from "node:test";
import { convexTest } from "convex-test";
import { ConvexHttpClient } from "convex/browser";
import { getFunctionName, makeFunctionReference } from "convex/server";
import { convexToJson, jsonToConvex } from "convex/values";
import schemaModule from "../../convex/schema";
import { runMigrationRehearsal, type RehearsalClient } from "../../scripts/event-broadcast-migration-rehearsal";

const schema = (schemaModule as unknown as { default?: typeof schemaModule }).default ?? schemaModule;
// Pristine production modules: no synthetic capacity resolver in this lane.
const modules = {
  "../../convex/_generated/api.ts": () => import("../../convex/_generated/api"),
  "../../convex/localEventBroadcastRehearsal.ts": () => import("../../convex/localEventBroadcastRehearsal"),
  "../../convex/events.ts": () => import("../../convex/events"),
  "../../convex/eventMediaWorker.ts": () => import("../../convex/eventMediaWorker"),
  "../../convex/eventMediaControlMigration.ts": () => import("../../convex/eventMediaControlMigration"),
};
const createTest = () => convexTest({ schema, modules });
function client(t: Pick<ReturnType<typeof createTest>, "mutation" | "query">) {
  return new ConvexHttpClient("http://127.0.0.1:3210", {
    logger: false,
    fetch: async (url, options) => {
      const request = JSON.parse(String(options?.body));
      const args = jsonToConvex(request.args[0]);
      assert.ok(args && typeof args === "object" && !Array.isArray(args) && !(args instanceof ArrayBuffer));
      try {
        const value = String(url).endsWith("/api/query")
          ? await t.query(makeFunctionReference<"query">(request.path), args)
          : await t.mutation(makeFunctionReference<"mutation">(request.path), args);
        return new Response(JSON.stringify({ status: "success", value: convexToJson(value) }));
      } catch (error) {
        return new Response(JSON.stringify({ status: "error", errorMessage: error instanceof Error ? error.message : "Failure" }));
      }
    },
  });
}
const pins = { runId: "blocked-admission", sourceSha: "b".repeat(40), backendVersion: "precompiled-2026-09-28-5c7cb5b" };
async function fixture() {
  process.env.CONVEX_CLOUD_URL = "http://127.0.0.1:3210";
  const t = createTest();
  const manifest = await t.mutation(makeFunctionReference<"mutation">("localEventBroadcastRehearsal:seed"), { runId: pins.runId });
  const prior = process.env.VRDEX_VRCDN_OUTPUT_ACCOUNTS_JSON;
  process.env.VRDEX_VRCDN_OUTPUT_ACCOUNTS_JSON = JSON.stringify([{ key: "local-rehearsal", label: "Local rehearsal", credentialRef: "local-rehearsal/output", ownerCommunityProfileId: manifest.communityId, playbackLinks: [] }]);
  const subject = `user_rehearsal_${pins.runId}`;
  return {
    t, admin: client(t), owner: client(t.withIdentity({ subject, issuer: "https://local-rehearsal.invalid", tokenIdentifier: `https://local-rehearsal.invalid|${subject}`, emailVerified: true })),
    restore: () => { if (prior === undefined) delete process.env.VRDEX_VRCDN_OUTPUT_ACCOUNTS_JSON; else process.env.VRDEX_VRCDN_OUTPUT_ACCOUNTS_JSON = prior; },
  };
}

test("explicit blocked scope proves actual migration and production admission denial without whole-flow success", async () => {
  const f = await fixture();
  try {
    const receipt = await runMigrationRehearsal({ ...pins, admin: f.admin, owner: f.owner, scope: "migration-admission-blocked" });
    assert.equal(receipt.scope, "migration-admission-blocked");
    assert.equal(receipt.status, "passed", JSON.stringify(receipt.evidence.at(-1)));
    assert.equal(receipt.failedStage, null);
    assert.ok(receipt.migrationCalls > 50 && receipt.migrationCalls <= 256);
    assert.ok(receipt.evidence.some(e => e.label === "historical-result"));
    assert.deepEqual(receipt.evidence.at(-1), { label: "production-admission-blocked", data: { reason: "unproved-broadcast-configuration", unchanged: true, noSessionWrites: true, noStartCommandWrites: true } });
    assert.ok(!receipt.evidence.some(e => e.label === "real-admission"));
    assert.equal(receipt.cleanup.status, "passed");
    assert.equal(await f.t.run(({ db }) => db.query("localEventBroadcastRehearsals").first()), null);
  } finally { f.restore(); }
});

test("blocked scope rejects unexpected schedule success, other errors, state writes and missing owner", async () => {
  for (const kind of ["success", "other-error", "substring-error", "event-write", "program-write", "output-write", "session-write", "command-write", "missing-owner"] as const) {
    const f = await fixture();
    try {
      let writeApplied = false;
      const owner: RehearsalClient = {
        query: f.owner.query.bind(f.owner),
        mutation: async (reference, args) => {
          if (getFunctionName(reference) !== "events:scheduleEventMediaWorker") return f.owner.mutation(reference, args);
          if (kind === "success") return {} as never;
          if (kind === "other-error") throw Error("Invalid capacity profile");
          if (kind === "substring-error") throw Error("Unexpected Unproved broadcast configuration suffix");
          await f.t.run(async ({ db }) => {
            if (kind === "event-write") { const row = await db.query("events").first(); assert.ok(row); await db.patch(row._id, { updatedAt: row.updatedAt + 1 }); }
            if (kind === "program-write") { const row = await db.query("eventMediaPrograms").first(); assert.ok(row); await db.patch(row._id, { updatedAt: row.updatedAt + 1 }); }
            if (kind === "output-write") { const row = await db.query("eventMediaOutputs").first(); assert.ok(row); await db.patch(row._id, { state: "disabled" }); }
            if (kind === "session-write") { const row = await db.query("eventMediaSessions").first(); assert.ok(row); await db.patch(row._id, { updatedAt: row.updatedAt + 1 }); }
            if (kind === "command-write") { const row = await db.query("eventMediaCommands").first(); assert.ok(row); const { _id, _creationTime, ...record } = row; await db.insert("eventMediaCommands", { ...record, commandType: "start_program" }); }
          });
          writeApplied = true;
          throw Error("Unproved broadcast configuration");
        },
      };
      const receipt = await runMigrationRehearsal({ ...pins, admin: f.admin, ...(kind === "missing-owner" ? {} : { owner }), scope: "migration-admission-blocked" });
      assert.equal(receipt.status, "failed", kind);
      if (kind.endsWith("-write")) assert.equal(writeApplied, true, kind);
      assert.equal(receipt.cleanup.status, "passed", kind);
      assert.ok(!receipt.evidence.some(e => e.label === "production-admission-blocked"), kind);
      assert.equal(await f.t.run(({ db }) => db.query("eventMediaSessions").first()), null, kind);
      assert.ok(!JSON.stringify(receipt).includes("Unexpected"));
    } finally { f.restore(); }
  }
});

test("default whole-flow stays failed against the unproved production map", async () => {
  const f = await fixture();
  try {
    const receipt = await runMigrationRehearsal({ ...pins, admin: f.admin, owner: f.owner, bridgeToken: "local-test-bridge" });
    assert.equal(receipt.scope, "whole-flow");
    assert.equal(receipt.status, "failed");
    assert.equal(receipt.failedStage, "protocol-lifecycle");
    assert.equal(receipt.cleanup.status, "passed");
  } finally { f.restore(); }
});
