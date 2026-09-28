import assert from "node:assert/strict";
import { test } from "node:test";
import { RequestBudget } from "./runtime.mjs";
import { budgetedClubProvider } from "./club-request-budget.mjs";
test("multi-step reads cross a budget window without increasing its limit", async () => {
  let now = 1000, calls = 0, reservations = 0;
  const client = budgetedClubProvider({
    provider: { async request() { calls++; return calls; } },
    control: { async send(_op, body) { reservations++; assert.equal(body.requestCount, 1); return { granted: true }; } },
    assignment: { integrationId: "i", fencingToken: 1 }, accountBudget: new RequestBudget(4), integrationBudget: new RequestBudget(2),
    clock: () => now, pause: async ms => { now += ms; },
  });
  for (let i = 0; i < 5; i++) await client.request("/read");
  assert.equal(calls, 5);
  assert.equal(reservations, 5);
  assert.equal(now, 121000);
});
test("shared denial waits and never sends beyond the bounded deadline", async () => {
  let now = 1000, calls = 0;
  const client = budgetedClubProvider({
    provider: { async request() { calls++; } },
    control: { async send() { return { granted: false, retryAt: now + 60000 }; } },
    assignment: { integrationId: "i", fencingToken: 1 }, accountBudget: new RequestBudget(4), integrationBudget: new RequestBudget(4),
    clock: () => now, pause: async ms => { now += ms; }, deadline: 91000,
  });
  await assert.rejects(client.request("/read"), { category: "rate_limit" });
  assert.equal(calls, 0);
  assert.equal(now, 91000);
});

test("concurrent local consumption during shared reservation cannot overspend", async () => {
  const accountBudget = new RequestBudget(1), integrationBudget = new RequestBudget(1);
  let calls = 0;
  const client = budgetedClubProvider({
    provider: { async request() { calls++; } },
    control: { async send() { accountBudget.tryConsume(1, 1000); return { granted: true }; } },
    assignment: { integrationId: "i", fencingToken: 1 }, accountBudget, integrationBudget,
    clock: () => 1000, pause: async () => {},
  });
  await assert.rejects(client.request("/read"), { category: "rate_limit" });
  assert.equal(calls, 0);
  assert.equal(accountBudget.remaining(1000), 0);
});
