import { loadFixtureEvents } from "../fixtures/event-modules";
import { syntheticAllocation } from "../fixtures/event-capacity.mjs";
import assert from "node:assert/strict";
import { test } from "node:test";
import { convexTest } from "convex-test";
import { ConvexHttpClient } from "convex/browser";
import { makeFunctionReference } from "convex/server";
import { convexToJson, jsonToConvex } from "convex/values";
import schemaModule from "../../convex/schema";
import { resolveWorkerAllocation } from "../../workers/restream/broadcast-capacity.mjs";
import {
  runMigrationRehearsal,
  validateRehearsalInputs,
} from "../../scripts/event-broadcast-migration-rehearsal";
const schema =
  (schemaModule as unknown as { default?: typeof schemaModule }).default ??
  schemaModule;
const modules = {
  "../../convex/_generated/api.ts": () => import("../../convex/_generated/api"),
  "../../convex/localEventBroadcastRehearsal.ts": () =>
    import("../../convex/localEventBroadcastRehearsal"),
  "../../convex/events.ts": () => import("../../convex/events"),
  "../../convex/eventMediaWorker.ts": () =>
    import("../../convex/eventMediaWorker"),
  "../../convex/eventMediaControlMigration.ts": () =>
    import("../../convex/eventMediaControlMigration"),
};
// The client uses its actual codec and dispatch; only transport is in memory.
// Convex-test executes the production handlers and schema. No sockets are opened.
const createTest = (synthetic = false) => convexTest({ schema, modules: synthetic ? { ...modules, "../../convex/events.ts": loadFixtureEvents } : modules });
function localClient(
  t: Pick<ReturnType<typeof createTest>, "mutation" | "query">,
  failAt = 0,
  errors: string[] = [],
) {
  let calls = 0;
  return new ConvexHttpClient("http://127.0.0.1:3210", {
    logger: false,
    fetch: async (url, options) => {
      const body = JSON.parse(String(options?.body));
      assert.equal(typeof body.path, "string");
      assert.ok(Array.isArray(body.args));
      const args = jsonToConvex(body.args[0]);
      assert.ok(
        args &&
          typeof args === "object" &&
          !Array.isArray(args) &&
          !(args instanceof ArrayBuffer),
      );
      try {
        if (++calls === failAt) throw Error("secret-not-for-receipt");
        const value = String(url).endsWith("/api/query")
          ? await t.query(makeFunctionReference<"query">(body.path), args)
          : await t.mutation(
              makeFunctionReference<"mutation">(body.path),
              args,
            );
        return new Response(
          JSON.stringify({ status: "success", value: convexToJson(value) }),
        );
      } catch (error) {
        errors.push(error instanceof Error ? error.message : "Failure");
        return new Response(
          JSON.stringify({
            status: "error",
            errorMessage: error instanceof Error ? error.message : "Failure",
          }),
        );
      }
    },
  });
}
test("driver rejects hosted URLs, embedded credentials and invalid receipt pins before I/O", () => {
  const input = {
    url: "http://127.0.0.1:3210",
    runId: "driver-check",
    sourceSha: "a".repeat(40),
    backendVersion: "precompiled-2026-09-28-5c7cb5b",
  };
  assert.doesNotThrow(() => validateRehearsalInputs(input));
  for (const url of [
    "https://remote.convex.cloud",
    "http://user:secret@127.0.0.1:3210",
    "http://127.0.0.1:3210/path",
    "ftp://127.0.0.1",
  ])
    assert.throws(() => validateRehearsalInputs({ ...input, url }));
  assert.throws(() => validateRehearsalInputs({ ...input, runId: "../bad" }));
  assert.throws(() =>
    validateRehearsalInputs({ ...input, sourceSha: "unknown" }),
  );
});
test("driver calls real migration handlers, replays pages, retains a bounded receipt and always cleans up on success", async () => {
  process.env.CONVEX_CLOUD_URL = "http://127.0.0.1:3210";
  const t = convexTest({ schema, modules });
  const admin = localClient(t);
  const receipt = await runMigrationRehearsal({
    admin,
    runId: "driver-check",
    sourceSha: "a".repeat(40),
    backendVersion: "precompiled-2026-09-28-5c7cb5b",
  });
  assert.equal(receipt.status, "passed");
  assert.ok(receipt.migrationCalls > 50 && receipt.migrationCalls <= 256);
  assert.equal(receipt.cleanup.status, "passed");
  assert.ok(Buffer.byteLength(JSON.stringify(receipt)) < 512 * 1024);
  assert.equal(
    await t.run(({ db }) => db.query("localEventBroadcastRehearsals").first()),
    null,
  );
});
test("failed rehearsal retains negative receipt and cleans up owned rows", async () => {
  process.env.CONVEX_CLOUD_URL = "http://127.0.0.1:3210";
  const t = convexTest({ schema, modules });
  const admin = localClient(t, 4);
  const receipt = await runMigrationRehearsal({
    admin,
    runId: "failure-check",
    sourceSha: "b".repeat(40),
    backendVersion: "precompiled-2026-09-28-5c7cb5b",
  });
  assert.equal(receipt.status, "failed");
  assert.equal(receipt.cleanup.status, "passed");
  assert.equal(
    JSON.stringify(receipt).includes("secret-not-for-receipt"),
    false,
  );
  assert.equal(
    await t.run(({ db }) => db.query("localEventBroadcastRehearsals").first()),
    null,
  );
});

for (const synthetic of [false, true]) test(synthetic
  ? "synthetic nonproduction capacity exercises every whole-flow protocol scenario"
  : "whole-flow driver honors the production map and cleans up both admission outcomes", async () => {
  process.env.CONVEX_CLOUD_URL = "http://127.0.0.1:3210";
  const t = createTest(synthetic);
  const runId = "admission-check";
  await t.mutation(
    makeFunctionReference<"mutation">("localEventBroadcastRehearsal:seed"),
    { runId },
  );
  const m = await t.run(({ db }) =>
    db.query("localEventBroadcastRehearsals").first(),
  );
  assert.ok(m);
  const priorRegistry = process.env.VRDEX_VRCDN_OUTPUT_ACCOUNTS_JSON;
  const priorBridge = process.env.VRDEX_EVENT_MEDIA_BRIDGE_TOKEN;
  process.env.VRDEX_VRCDN_OUTPUT_ACCOUNTS_JSON = JSON.stringify([
    {
      key: "local-rehearsal",
      label: "Local rehearsal",
      credentialRef: "local-rehearsal/output",
      ownerCommunityProfileId: m.communityId,
      playbackLinks: [],
    },
  ]);
  process.env.VRDEX_EVENT_MEDIA_BRIDGE_TOKEN = "local-test-bridge";
  const subject = `user_rehearsal_${runId}`;
  const errors: string[] = [];
  let measured = false;
  try {
    resolveWorkerAllocation({ videoPreset: "720p30", simulcastEnabled: false });
    measured = true;
  } catch (error) {
    assert.match(String(error), /Unproved broadcast configuration/);
  }
  try {
    const receipt = await runMigrationRehearsal({
      admin: localClient(t),
      owner: localClient(
        t.withIdentity({
          subject,
          issuer: "https://local-rehearsal.invalid",
          tokenIdentifier: `https://local-rehearsal.invalid|${subject}`,
          emailVerified: true,
        }),
        0,
        errors,
      ),
      bridgeToken: "local-test-bridge",
      runId,
      sourceSha: "c".repeat(40),
      backendVersion: "precompiled-2026-09-28-5c7cb5b",
    });
    if (measured || synthetic) {
      assert.equal(
        receipt.status,
        "passed",
        JSON.stringify({
          failedStage: receipt.failedStage,
          evidence: receipt.evidence.slice(-3),
          errors,
        }),
      );
      const admissions = receipt.evidence.filter((item) => item.label === "real-admission");
      assert.ok(admissions.length > 0);
      if (synthetic) for (const admission of admissions) {
        assert.ok(admission.data && typeof admission.data === "object" && "allocation" in admission.data);
        assert.deepEqual(admission.data.allocation, syntheticAllocation);
      }
    } else {
      assert.equal(receipt.status, "failed");
      assert.equal(receipt.failedStage, "protocol-lifecycle");
      assert.ok(
        errors.some((message) =>
          /Unproved broadcast configuration/.test(message),
        ),
        errors.join("; "),
      );
      assert.equal(
        receipt.evidence.some((item) => item.label === "real-admission"),
        false,
      );
    }
    assert.equal(receipt.cleanup.status, "passed");
    assert.equal(
      await t.run(({ db }) => db.query("eventMediaSessions").first()),
      null,
    );
  } finally {
    if (priorRegistry === undefined)
      delete process.env.VRDEX_VRCDN_OUTPUT_ACCOUNTS_JSON;
    else process.env.VRDEX_VRCDN_OUTPUT_ACCOUNTS_JSON = priorRegistry;
    if (priorBridge === undefined)
      delete process.env.VRDEX_EVENT_MEDIA_BRIDGE_TOKEN;
    else process.env.VRDEX_EVENT_MEDIA_BRIDGE_TOKEN = priorBridge;
  }
});
