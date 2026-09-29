import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { it } from "node:test";

it("HTTP event routes preserve lineup inputs and serialize typed public roster data", () => {
  const output = execFileSync(process.execPath, ["--import", "tsx", "--input-type=module", "-e", `
    import assert from "node:assert/strict";
    import { GET, PATCH } from "./apps/web/src/app/api/v0/events/[slug]/route.ts";
    import { POST } from "./apps/web/src/app/api/v0/events/route.ts";
    import { lineupRoster } from "./packages/vrdex-mcp/tests/api-fixture.ts";
    process.env.CONVEX_URL = "https://fixture.convex.cloud";
    process.env.CONVEX_ADMIN_TOKEN = "fixture-admin";
    process.env.VRDEX_API_TOKEN_PEPPER = "fixture-pepper";
    const calls = [];
    globalThis.fetch = async (_url, init) => {
      const body = JSON.parse(init.body);
      calls.push(body);
      let value;
      if (body.path === "apiTokens:validateBearerTokenHash") {
        assert.deepEqual(body.args[0].requiredScopes, ["events:write"]);
        value = { ok: true, tokenId: "token", ownerKind: "user", ownerUserId: "user", scopes: ["events:write"], trustTier: "standard" };
      } else if (body.path === "events:getPublicBySlug") {
        value = { id: "event", slug: "lineup", title: "Lineup", startAt: 1798761600000,
          source: { label: "VRDex", sourceType: "manual" }, watchSurfaceEnabled: true, ...lineupRoster };
      } else if (["events:createCommunityEventForApiOwner", "events:updateCommunityEventForApiOwner"].includes(body.path)) {
        value = { eventId: "event", slug: "lineup", eventPath: "/faceless/events/lineup" };
      } else { throw new Error("Unexpected network call " + body.path); }
      return new Response(JSON.stringify({ status: "success", value }), { status: 200, headers: { "content-type": "application/json" } });
    };
    const context = { params: Promise.resolve({ slug: "lineup" }) };
    const read = await GET(new Request("https://example.test/api/v0/events/lineup"), context);
    assert.equal(read.status, 200);
    assert.deepEqual((await read.json()).slots, lineupRoster.slots);
    const headers = { authorization: "Bearer vrdx_" + "a".repeat(24) + "." + "b".repeat(64), "content-type": "application/json" };
    const draft = { title: "Lineup", communitySlug: "faceless", startAt: 1798761600000, watchMode: "performer_sequence",
      participantLinks: [], slotLinks: [{ personSlug: "performer", displayLabel: "Set", startAt: 1798761600000, selectedStreamId: "alpha" }] };
    const created = await POST(new Request("https://example.test/api/v0/events", { method: "POST", headers, body: JSON.stringify(draft) }));
    assert.equal(created.status, 200, await created.text());
    const createArgs = calls.find((call) => call.path === "events:createCommunityEventForApiOwner").args[0];
    assert.equal(createArgs.watchMode, "performer_sequence");
    assert.equal(createArgs.slotLinks[0].selectedStreamId, "alpha");
    const updated = await PATCH(new Request("https://example.test/api/v0/events/lineup", { method: "PATCH", headers,
      body: JSON.stringify({ watchMode: "event_stream", participantLinks: [], slotLinks: [{ ...draft.slotLinks[0], selectedStreamId: null }] }) }), context);
    assert.equal(updated.status, 200, await updated.text());
    const updateArgs = calls.find((call) => call.path === "events:updateCommunityEventForApiOwner").args[0];
    assert.equal(updateArgs.watchMode, "event_stream");
    assert.equal(updateArgs.slotLinks[0].selectedStreamId, null);
    console.log("HTTP lineup contract passed");
  `], { cwd: process.cwd(), encoding: "utf8", env: { ...process.env, TSX_TSCONFIG_PATH: "apps/web/tsconfig.json", VRDEX_RATE_LIMIT_STORE: "memory" } });
  assert.match(output, /HTTP lineup contract passed/);
});
