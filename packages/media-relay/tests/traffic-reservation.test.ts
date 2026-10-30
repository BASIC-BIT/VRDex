import assert from "node:assert/strict";
import { test } from "node:test";
import {
  ConditionalCheckFailedException,
  UpdateItemCommand,
} from "@aws-sdk/client-dynamodb";
import {
  createTrafficReservation,
  MAX_SEGMENT_PAYLOAD_BYTES,
} from "../src/traffic-ceiling/reservation";

const deliveryId = "delivery_12345678";
const generation = "generation_12345678";
const rejected = () =>
  new ConditionalCheckFailedException({ $metadata: {}, message: "condition" });

function ledger(bytes: number, requests: number) {
  let remainingBytes = bytes;
  let remainingRequests = requests;
  let status = "open";
  let itemGeneration = generation;
  let outage = false;
  const commands: UpdateItemCommand[] = [];
  const client = {
    async send(command: UpdateItemCommand) {
      commands.push(command);
      if (outage) throw Error("DynamoDB unavailable");
      const input = command.input;
      assert.equal(input.TableName, "traffic-ledger");
      assert.deepEqual(input.Key, { deliveryId: { S: deliveryId } });
      assert.equal(
        input.ConditionExpression,
        "#status = :open AND #generation = :generation AND #bytes >= :bytes AND #requests >= :one",
      );
      assert.equal(
        input.UpdateExpression,
        "SET #bytes = #bytes - :bytes, #requests = #requests - :one",
      );
      assert.deepEqual(input.ExpressionAttributeNames, {
        "#bytes": "remainingPayloadBytes",
        "#requests": "remainingRequests",
        "#status": "status",
        "#generation": "generation",
      });
      const charge = Number(input.ExpressionAttributeValues?.[":bytes"]?.N);
      assert.equal(charge, MAX_SEGMENT_PAYLOAD_BYTES);
      assert.equal(input.ExpressionAttributeValues?.[":generation"]?.S, generation);
      // A single-item DynamoDB conditional update is atomic. The double applies
      // the same condition and debit synchronously to expose overspend regressions.
      if (
        status !== "open" ||
        itemGeneration !== input.ExpressionAttributeValues?.[":generation"]?.S ||
        remainingBytes < charge ||
        remainingRequests < 1
      )
        throw rejected();
      remainingBytes -= charge;
      remainingRequests--;
    },
  };
  return {
    client,
    commands,
    remaining: () => ({ bytes: remainingBytes, requests: remainingRequests }),
    close: () => (status = "closed"),
    replaceGeneration: () => (itemGeneration = "another_generation"),
    setOutage: (value: boolean) => (outage = value),
  };
}

test("concurrent replays cannot reserve more payload or requests than one delivery permits", async () => {
  const store = ledger(MAX_SEGMENT_PAYLOAD_BYTES * 3, 100);
  const reserve = createTrafficReservation({
    client: store.client,
    tableName: "traffic-ledger",
    deliveryId,
    generation,
  });
  const results = await Promise.all(Array.from({ length: 50 }, () => reserve()));
  assert.equal(results.filter((result) => result.allowed).length, 3);
  assert.equal(results.filter((result) => !result.allowed).length, 47);
  assert.deepEqual(store.remaining(), { bytes: 0, requests: 97 });
  assert.equal(store.commands.length, 50);
});

test("request allowance denies while bytes remain", async () => {
  const store = ledger(MAX_SEGMENT_PAYLOAD_BYTES * 4, 1);
  const reserve = createTrafficReservation({
    client: store.client,
    tableName: "traffic-ledger",
    deliveryId,
    generation,
  });
  assert.deepEqual(await reserve(), { allowed: true });
  assert.deepEqual(await reserve(), {
    allowed: false,
    reason: "exhausted-or-closed",
  });
  assert.equal(store.remaining().bytes, MAX_SEGMENT_PAYLOAD_BYTES * 3);
});

test("closure and generation mismatch deny even with available bytes and requests", async () => {
  for (const alter of ["close", "replaceGeneration"] as const) {
    const store = ledger(MAX_SEGMENT_PAYLOAD_BYTES * 4, 4);
    const reserve = createTrafficReservation({
      client: store.client,
      tableName: "traffic-ledger",
      deliveryId,
      generation,
    });
    store[alter]();
    assert.deepEqual(await reserve(), {
      allowed: false,
      reason: "exhausted-or-closed",
    });
    assert.deepEqual(store.remaining(), {
      bytes: MAX_SEGMENT_PAYLOAD_BYTES * 4,
      requests: 4,
    });
  }
});

test("unknown reservation outcome denies delivery and may conservatively consume allowance", async () => {
  const store = ledger(MAX_SEGMENT_PAYLOAD_BYTES * 2, 2);
  const reserve = createTrafficReservation({
    client: {
      async send(command) {
        await store.client.send(command);
        throw Error("response lost after commit");
      },
    },
    tableName: "traffic-ledger",
    deliveryId,
    generation,
  });
  assert.deepEqual(await reserve(), { allowed: false, reason: "unavailable" });
  assert.deepEqual(store.remaining(), {
    bytes: MAX_SEGMENT_PAYLOAD_BYTES,
    requests: 1,
  });
  store.setOutage(true);
  assert.deepEqual(await reserve(), { allowed: false, reason: "unavailable" });
  assert.deepEqual(store.remaining(), {
    bytes: MAX_SEGMENT_PAYLOAD_BYTES,
    requests: 1,
  });
});

test("a hanging update receives an abort and the reservation denies at its deadline", async () => {
  let observedSignal: AbortSignal | undefined;
  const reserve = createTrafficReservation({
    client: {
      send(_command, options) {
        observedSignal = options.abortSignal;
        return new Promise(() => {});
      },
    },
    tableName: "traffic-ledger",
    deliveryId,
    generation,
    deadlineMs: 20,
  });
  assert.deepEqual(await reserve(), { allowed: false, reason: "unavailable" });
  assert.equal(observedSignal?.aborted, true);
});

test("configuration cannot select an empty, ambiguous or path-like ledger key", () => {
  const store = ledger(MAX_SEGMENT_PAYLOAD_BYTES, 1);
  for (const bad of ["", "x", "../wrong", "a/b/c", "a b c d e"]) {
    assert.throws(() =>
      createTrafficReservation({
        client: store.client,
        tableName: "traffic-ledger",
        deliveryId: bad,
        generation,
      }),
    );
  }
  for (const deadlineMs of [0, -1, 5001, 1.5, Number.NaN]) {
    assert.throws(() =>
      createTrafficReservation({
        client: store.client,
        tableName: "traffic-ledger",
        deliveryId,
        generation,
        deadlineMs,
      }),
    );
  }
});
