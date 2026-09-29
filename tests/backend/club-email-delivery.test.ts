import assert from "node:assert/strict";
import { it } from "node:test";
import { drainClubEmail } from "../../convex/_clubEmailDelivery";

it("bounds delivery to twenty individually claimed messages", async () => {
  let claimed = 0;
  const events: string[] = [];
  const sent = await drainClubEmail({
    claim: async () => {
      events.push("claim");
      return ++claimed;
    },
    send: async (id) => {
      events.push(`send:${id}`);
    },
    finish: async (id) => {
      events.push(`finish:${id}`);
    },
  });
  assert.equal(claimed, 20);
  assert.equal(sent, 20);
  assert.deepEqual(events.slice(0, 6), [
    "claim",
    "send:1",
    "finish:1",
    "claim",
    "send:2",
    "finish:2",
  ]);
});

it("does not retry uncertain transport or acknowledgement and continues remaining messages", async () => {
  const messages = [1, 2, 3];
  const attempts: number[] = [];
  const outcomes: [number, boolean][] = [];
  const sent = await drainClubEmail({
    claim: async () => messages.shift() ?? null,
    send: async (id) => {
      attempts.push(id);
      if (id === 1) throw new Error("uncertain");
    },
    finish: async (id, success) => {
      outcomes.push([id, success]);
      if (id === 2) throw new Error("acknowledgement unavailable");
    },
  });
  assert.equal(sent, 2);
  assert.deepEqual(attempts, [1, 2, 3]);
  assert.deepEqual(outcomes, [
    [1, false],
    [2, true],
    [3, true],
  ]);
});

it("stops when current recipient authorization yields no claim", async () => {
  let calls = 0;
  assert.equal(
    await drainClubEmail({
      claim: async () => {
        calls++;
        return null;
      },
      send: async () => assert.fail("must not send"),
      finish: async () => assert.fail("must not finish"),
    }),
    0,
  );
  assert.equal(calls, 1);
});
