import assert from "node:assert/strict";
import { it } from "node:test";
import { assertClerkTestTenant } from "../../apps/web/e2e/clerk-tenant";

const expected = "https://oriented-anemone-94.clerk.accounts.dev";
const domain = (frontend_api_url: string) => ({ object: "domain", is_satellite: false, frontend_api_url });

it("refuses a development secret whose authenticated domain belongs to another tenant", async () => {
  await assert.rejects(assertClerkTestTenant("sk_test_fixture", expected, async () =>
    Response.json({ data: [domain("https://wrong-tenant.clerk.accounts.dev")], total_count: 1 }),
  ), /tenant/);
});

it("binds the secret through a fixed read-only request to Clerk", async () => {
  let calls = 0;
  await assertClerkTestTenant("sk_test_fixture", expected, async (url, init) => {
    calls += 1;
    assert.equal(url, "https://api.clerk.com/v1/domains");
    assert.equal(init?.method, "GET");
    assert.equal(init?.redirect, "error");
    assert.equal(new Headers(init?.headers).get("authorization"), "Bearer sk_test_fixture");
    assert.ok(init?.signal);
    return Response.json({ data: [domain(expected)], total_count: 1 });
  });
  assert.equal(calls, 1);
});

it("fails closed on empty, malformed, satellite-only, ambiguous or unavailable responses", async () => {
  for (const body of [
    {}, null, { data: [] }, { data: "invalid" },
    { data: [{ ...domain(expected), is_satellite: true }] },
    { data: [{ is_satellite: false }] },
    { data: [domain(expected), domain(expected)] },
    { data: [domain(expected + ".evil.test")] },
  ]) {
    await assert.rejects(assertClerkTestTenant("sk_test_fixture", expected, async () => Response.json(body)), /tenant/);
  }
  await assert.rejects(assertClerkTestTenant("sk_test_fixture", expected, async () => new Response("denied", { status: 401 })), /tenant/);
  await assert.rejects(assertClerkTestTenant("sk_test_fixture", expected, async () => new Response("invalid JSON")), /tenant/);
  await assert.rejects(assertClerkTestTenant("sk_test_fixture", expected, async () => { throw new Error("sensitive transport details"); }),
    (error: Error) => error.message === "Clerk tenant verification request failed.");
});

it("rejects production credentials and unexpected targets before making a request", async () => {
  let calls = 0;
  const fetcher: typeof fetch = async () => { calls += 1; return Response.json({}); };
  await assert.rejects(assertClerkTestTenant("sk_live_fixture", expected, fetcher), /development/);
  await assert.rejects(assertClerkTestTenant("sk_test_fixture", "https://example.test", fetcher), /development/);
  assert.equal(calls, 0);
});
