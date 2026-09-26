import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { test } from "node:test";
import { runInNewContext } from "node:vm";

const source = readFileSync(new URL("./worker.mjs", import.meta.url), "utf8")
  .replaceAll("\r\n", "\n");
const start = source.indexOf("async function collectNextAssignment(");
const end = source.indexOf("/**\n * Hands back", start);
assert.ok(start >= 0 && end > start);

test("slow collection claims the next integration with a fresh lease", async () => {
  let now = 1_000_000;
  let sequence = 0;
  const claims = [];
  const phases = [];
  const sandbox = {
    Date: { now: () => now },
    stopping: false,
    control: {
      send: async (operation, args) => {
        assert.equal(operation, "claim");
        assert.equal(args.limit, 1);
        assert.equal(args.now, now);
        const assignment = {
          integrationId: `group-${++sequence}`,
          fencingToken: sequence,
          leaseExpiresAt: now + 5 * 60_000,
        };
        claims.push({ at: now, assignment });
        return { assignments: [assignment], destinationWorkDueAt: now + 60000 };
      },
    },
    heartbeat: async () => {},
    collect: async (assignment) => {
      now += 4 * 60_000;
      assert.ok(now < assignment.leaseExpiresAt);
    },
  };
  const collectNextAssignment = runInNewContext(
    source.slice(start, end) + "\ncollectNextAssignment;",
    sandbox,
  );
  const first = await collectNextAssignment((phase) => phases.push(phase));
  const second = await collectNextAssignment((phase) => phases.push(phase));
  assert.deepEqual(claims.map(({ at }) => at), [1_000_000, 1_240_000]);
  assert.deepEqual(claims.map(({ assignment }) => assignment.integrationId), ["group-1", "group-2"]);
  assert.deepEqual(phases, ["telemetry_collection", "telemetry_collection"]);
  assert.equal(first.assignmentCount, 1);
  assert.equal(second.assignmentCount, 1);
  assert.equal(second.destinationWorkDueAt, 1_300_000);
});

for (const interruption of ["shutdown", "heartbeat failure"]) {
  test(`a claim interrupted by ${interruption} releases before collection`, async () => {
    const calls = [];
    const assignment = { integrationId: "group-a", fencingToken: 7 };
    const sandbox = {
      Date: { now: () => 1_000_000 },
      stopping: false,
      control: {
        send: async (operation, body) => {
          calls.push({ operation, body });
          if (operation === "claim") {
            if (interruption === "shutdown") sandbox.stopping = true;
            return { assignments: [assignment] };
          }
          assert.equal(operation, "release");
          return { released: true };
        },
      },
      heartbeat: async () => {
        if (interruption === "heartbeat failure") throw new Error("heartbeat failed");
      },
      collect: async () => assert.fail("collection must not start"),
    };
    const collectNextAssignment = runInNewContext(
      source.slice(start, end) + "\ncollectNextAssignment;",
      sandbox,
    );
    if (interruption === "shutdown") {
      const result = await collectNextAssignment(() => {});
      assert.equal(result.assignmentCount, 0);
    } else {
      await assert.rejects(collectNextAssignment(() => {}), /heartbeat failed/);
    }
    assert.deepEqual(calls.map(({ operation }) => operation), ["claim", "release"]);
    assert.equal(calls[1].body.integrationId, assignment.integrationId);
    assert.equal(calls[1].body.fencingToken, assignment.fencingToken);
  });
}
