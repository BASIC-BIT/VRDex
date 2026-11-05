import assert from "node:assert/strict";
import { test } from "node:test";
import { VrchatClient } from "./vrchat-client.mjs";

const now = Date.parse("2026-10-31T20:00:00Z");
const groupId = "grp_example";
const userId = "usr_collector";
const instance = { instanceId: "123~group(grp_example)", worldId: "wrld_example", location: "wrld_example:123~group(grp_example)", ownerId: groupId, type: "group", active: true, closedAt: null, n_users: 4, memberCount: 2, users: [{ id: "usr_private" }] };
function setup(records = [instance], fetchedAt = now) {
  const paths = [];
  const provider = new VrchatClient({ userId, authCookie: "test-cookie", userAgent: "VRDex/test", clock: () => now,
    fetcher: async url => {
      paths.push(new URL(url).pathname);
      return Response.json(paths.length === 1
        ? { id: groupId, memberCount: 50, membershipStatus: "member", privacy: "default", joinState: "open" }
        : { fetchedAt: new Date(fetchedAt).toISOString(), instances: records });
    },
  });
  return { provider, paths };
}
test("group population uses full occupant count and never returns a roster", async () => {
  const { provider, paths } = setup();
  const snapshot = await provider.readAggregateSnapshot(groupId);
  assert.equal(snapshot.instances[0].population, 4);
  assert.deepEqual(paths, ["/api/1/groups/grp_example", "/api/1/users/usr_collector/instances/groups/grp_example"]);
  assert.equal(JSON.stringify(snapshot).includes("usr_private"), false);
});
test("provider closure is retained even while occupants remain visible", async () => {
  const { provider } = setup([{ ...instance, closedAt: new Date(now - 60_000).toISOString() }]);
  const snapshot = await provider.readAggregateSnapshot(groupId);
  assert.equal(snapshot.instances[0].closedAt, now - 60_000);
  assert.equal(snapshot.instances[0].population, 4);
});
test("provider snapshot time prevents cached data from renewing liveness", async () => {
  const { provider } = setup([instance], now - 120_000);
  assert.equal((await provider.readAggregateSnapshot(groupId)).observedAt, now - 120_000);
  await assert.rejects(setup([instance], now - 360_001).provider.readAggregateSnapshot(groupId), /stale|timestamp/i);
});
test("foreign, malformed and negative counts fail the entire snapshot", async () => {
  for (const changed of [{ ownerId: "grp_other" }, { n_users: -1 }, { location: "wrld_other:123" }, { closedAt: "invalid" }]) {
    await assert.rejects(setup([{ ...instance, ...changed }]).provider.readAggregateSnapshot(groupId));
  }
});
test("every provider request honors the existing policy and request budget", async () => {
  const { provider, paths } = setup();
  const operations = [];
  assert.equal(await provider.readAggregateSnapshot(groupId, { authorizeRequest: async operation => { operations.push(operation); return operation !== "instances"; } }), null);
  assert.deepEqual(operations, ["metadata", "instances"]);
  assert.equal(paths.length, 1);
});
