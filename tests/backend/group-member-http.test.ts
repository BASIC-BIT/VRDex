import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { it } from "node:test";
import httpModule from "../../convex/http";

it("forwards connected group creation time through the worker HTTP ingest route", async () => {
  const router = (httpModule as unknown as { default?: typeof httpModule }).default ?? httpModule;
  const [handler] = router.lookup("/telemetry/worker", "POST")!;
  const action = handler as unknown as { _handler: (ctx: unknown, request: Request) => Promise<Response> };
  const key = "worker-key-long-enough-for-this-test";
  const vrchatUserId = "usr_00000000-0000-4000-8000-000000000001";
  const authorization = {
    workerKeyHash: createHash("sha256").update(key).digest("hex"),
    vrchatUserId, enabled: true,
  };
  let ingested: Record<string, unknown> | undefined;
  const response = await action._handler({
    runQuery: async () => authorization,
    runMutation: async (_reference: unknown, args: Record<string, unknown>) => {
      ingested = args;
      return { duplicate: false };
    },
  }, new Request("https://example.test/telemetry/worker", {
    method: "POST",
    headers: { authorization: `Bearer ${key}`, "x-vrdex-collector-account": "account" },
    body: JSON.stringify({
      operation: "ingest", workerId: "worker", vrchatUserId,
      integrationId: "integration", fencingToken: 1, pollId: "poll", observedAt: 100_000,
      collectorVersion: "test", groupMemberCount: 42, groupCreatedAt: 1_000,
      instances: [], nextPollAt: 200_000,
    }),
  }));
  assert.equal(response.status, 200);
  assert.equal(ingested?.groupCreatedAt, 1_000);
});
