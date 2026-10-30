import assert from "node:assert/strict";
import { afterEach, beforeEach, it, type TestContext } from "node:test";
import { convexTest } from "convex-test";
import { internal } from "../../convex/_generated/api";
import type { Doc, Id } from "../../convex/_generated/dataModel";
import schemaModule from "../../convex/schema";

const schema = (schemaModule as unknown as { default?: typeof schemaModule }).default ?? schemaModule;
const modules = {
  "../../convex/_generated/api.ts": () => import("../../convex/_generated/api"),
  "../../convex/eventSync.ts": () => import("../../convex/eventSync"),
  "../../convex/eventSyncKinds/discordBoard.ts": () => import("../../convex/eventSyncKinds/discordBoard"),
};
const MINUTE = 60_000; const HOUR = 60 * MINUTE; const DAY = 24 * HOUR;
const GUILD = "876543210987654321"; const CHANNEL = "123456789012345678"; const LIVE = "111111111111111111";
const ISSUER = "https://test.clerk.accounts.dev";
// The connector's authority user, granted manage_integrations as community staff.
const staff = { subject: "staff", issuer: ISSUER, tokenIdentifier: `${ISSUER}|staff` };
const ENV = { VRDEX_EVENT_CONNECTORS_ENABLED: "true", VRDEX_CONNECTOR_DISCORD_BOARD_ENABLED: "true", DISCORD_BOT_TOKEN: "test-bot-token", SITE_URL: "https://vrdex.test", CLERK_JWT_ISSUER_DOMAIN: ISSUER };
beforeEach((test) => { test.mock.timers.enable({ apis: ["setTimeout"] }); Object.assign(process.env, ENV); });
afterEach(() => { for (const key of Object.keys(ENV)) delete process.env[key]; });

type Call = { method: string; path: string; body?: { embeds: Array<{ title: string; description?: string }>; allowed_mentions: unknown } };
function fakeDiscord(test: TestContext, respond: (call: Call) => Response | undefined = () => undefined) {
  const calls: Call[] = [];
  test.mock.method(globalThis, "fetch", async (input: string | URL, init: RequestInit = {}) => {
    const call: Call = { method: init.method ?? "GET", path: new URL(String(input)).pathname.replace("/api/v10", ""), ...(init.body ? { body: JSON.parse(String(init.body)) } : {}) };
    calls.push(call);
    return respond(call) ?? (call.method === "DELETE" ? new Response(null, { status: 204 })
      : Response.json({ id: call.method === "POST" ? `9000000000000000${String(calls.length).padStart(2, "0")}` : call.path.split("/").at(-1) }));
  });
  return calls;
}
const said = (calls: Call[]) => calls.map((call) => `${call.method} ${call.path}`);

const communityBase = { slug: "afterglow-social", displayName: "Afterglow Social", sortName: "afterglow social", profileType: "community", community: { categoryTags: [] }, aliases: [], tags: [], claimState: "unclaimed", creationSource: "self", publicationState: "published", publicSurfacingState: "public", updatedAt: 1 } satisfies Omit<Doc<"profiles">, "_id" | "_creationTime">;
const eventBase = (now: number) => ({ title: "Afterglow Harbor Sessions", sortTitle: "afterglow harbor sessions", startAt: now + 2 * DAY, endAt: now + 2 * DAY + 3 * HOUR, eventStatus: "scheduled", publicationState: "published", sourceType: "community", sourceLabel: "Fixture", updatedAt: 1 } as const);
type Seed = Partial<Doc<"events">> & { link?: string };

async function seed(t: ReturnType<typeof convexTest>, events: Seed[], connector: Partial<Doc<"eventConnectors">> = {}) {
  const now = Date.now();
  return t.run(async (ctx) => {
    const userId = await ctx.db.insert("users", { clerkUserId: staff.subject });
    const communityProfileId = await ctx.db.insert("profiles", communityBase);
    await ctx.db.insert("communityAuthorities", { communityProfileId, subjectTokenIdentifier: staff.tokenIdentifier, subject: staff, capabilities: ["manage_integrations"], state: "active", grantedAt: now, updatedAt: now });
    const connectorId = await ctx.db.insert("eventConnectors", { communityProfileId, kind: "discord_board", direction: "export", mode: "hold", authorityUserId: userId, target: { guildId: GUILD, channelId: CHANNEL }, state: "active", createdAt: now, updatedAt: now, ...connector });
    const eventIds: Id<"events">[] = [];
    for (const [index, { link, ...event }] of events.entries()) {
      const fields = { ...eventBase(now), slug: `night-${index}`, communityProfileId, ...event };
      const eventId = await ctx.db.insert("events", { sortAt: fields.startAt, ...fields });
      if (link) await ctx.db.insert("eventSyncLinks", { connectorId, eventId, externalId: link, state: "linked", createdAt: now, updatedAt: now });
      eventIds.push(eventId);
    }
    return { now, userId, communityProfileId, connectorId, eventIds };
  });
}
async function runJob(t: ReturnType<typeof convexTest>, job: { connectorId: Id<"eventConnectors">; eventId?: Id<"events">; kind: Doc<"eventSyncJobs">["kind"] }) {
  const jobId = await t.run((ctx) => ctx.db.insert("eventSyncJobs", { ...job, payload: null, dueAt: 0, attempts: 0, state: "pending", createdAt: 0, updatedAt: 0 }));
  await t.action(internal.eventSync.runJob, { jobId });
  return t.run((ctx) => ctx.db.get(jobId));
}
const linkFor = (t: ReturnType<typeof convexTest>, connectorId: Id<"eventConnectors">, eventId: Id<"events">) =>
  t.run(async (ctx) => (await ctx.db.query("eventSyncLinks").withIndex("by_eventId", (q) => q.eq("eventId", eventId)).collect()).find((link) => link.connectorId === connectorId) ?? null);
const upsert = (t: ReturnType<typeof convexTest>, s: { connectorId: Id<"eventConnectors">; eventIds: Id<"events">[] }, index = 0) =>
  runJob(t, { connectorId: s.connectorId, eventId: s.eventIds[index], kind: "export_upsert" });

it("posts a new message when the event has no link", async (test) => {
  const calls = fakeDiscord(test);
  const t = convexTest({ schema, modules });
  const s = await seed(t, [{ title: "@everyone Harbor Night" }]);
  assert.equal((await upsert(t, s))?.state, "done");
  assert.deepEqual(said(calls), [`POST /channels/${CHANNEL}/messages`]);
  assert.equal(calls[0].body?.embeds[0].title, "@everyone Harbor Night");
  assert.deepEqual(calls[0].body?.allowed_mentions, { parse: [] });
  assert.equal((await linkFor(t, s.connectorId, s.eventIds[0]))?.externalId, "900000000000000001");
});

it("edits the linked message in place", async (test) => {
  const calls = fakeDiscord(test);
  const t = convexTest({ schema, modules });
  const s = await seed(t, [{ link: LIVE }]);
  await upsert(t, s);
  assert.deepEqual(said(calls), [`PATCH /channels/${CHANNEL}/messages/${LIVE}`]);
  assert.equal((await linkFor(t, s.connectorId, s.eventIds[0]))?.externalId, LIVE);
});

it("re-posts when the linked message is gone", async (test) => {
  const calls = fakeDiscord(test, (call) => (call.method === "PATCH" ? new Response(null, { status: 404 }) : undefined));
  const t = convexTest({ schema, modules });
  const s = await seed(t, [{ link: LIVE }]);
  await upsert(t, s);
  assert.deepEqual(said(calls), [`PATCH /channels/${CHANNEL}/messages/${LIVE}`, `POST /channels/${CHANNEL}/messages`]);
  assert.equal((await linkFor(t, s.connectorId, s.eventIds[0]))?.externalId, "900000000000000002");
});

for (const [name, status, method, lastError] of [
  ["pauses the connector when Discord refuses the write", 403, "POST", "discord_forbidden"],
  ["pauses when the channel is gone", 404, "POST", "discord_channel_missing"],
] as const) {
  it(name, async (test) => {
    fakeDiscord(test, (call) => (call.method === method ? new Response(null, { status }) : undefined));
    const t = convexTest({ schema, modules });
    const s = await seed(t, [{}]);
    assert.notEqual((await upsert(t, s))?.state, "done");
    const connector = await t.run((ctx) => ctx.db.get(s.connectorId));
    assert.equal(connector?.state, "paused");
    assert.match(connector?.lastError ?? "", new RegExp(lastError));
  });
}

it("deletes the message on export_delete and treats a missing message as deleted", async (test) => {
  const calls = fakeDiscord(test, (call) => (call.path.endsWith("222222222222222222") ? new Response(null, { status: 404 }) : undefined));
  const t = convexTest({ schema, modules });
  // The runner closes export_delete for a still-published event as event_public, so these are private.
  const s = await seed(t, [{ link: LIVE, publicationState: "draft_private" }, { link: "222222222222222222", publicationState: "draft_private" }]);
  assert.equal((await runJob(t, { connectorId: s.connectorId, eventId: s.eventIds[0], kind: "export_delete" }))?.state, "done");
  assert.equal((await runJob(t, { connectorId: s.connectorId, eventId: s.eventIds[1], kind: "export_delete" }))?.state, "done");
  assert.deepEqual(said(calls), [`DELETE /channels/${CHANNEL}/messages/${LIVE}`, `DELETE /channels/${CHANNEL}/messages/222222222222222222`]);
});

it("retired events are never posted and lose a live message", async (test) => {
  const calls = fakeDiscord(test);
  const t = convexTest({ schema, modules });
  const now = Date.now();
  const ended = { startAt: now - 2 * DAY, endAt: now - DAY - MINUTE };
  const s = await seed(t, [ended, { ...ended, link: LIVE }]);
  assert.equal((await upsert(t, s, 0))?.state, "done");
  assert.equal((await upsert(t, s, 1))?.state, "done");
  assert.deepEqual(said(calls), [`DELETE /channels/${CHANNEL}/messages/${LIVE}`]);
});

it("waits to post an event more than 14 days out", async (test) => {
  const calls = fakeDiscord(test);
  const t = convexTest({ schema, modules });
  const now = Date.now();
  const s = await seed(t, [{ startAt: now + 14 * DAY + MINUTE, endAt: now + 14 * DAY + 3 * HOUR }]);
  assert.equal((await upsert(t, s))?.state, "done");
  assert.deepEqual(calls, []);
});

it("does not post a cancelled event but keeps a live one with the Cancelled line", async (test) => {
  const calls = fakeDiscord(test);
  const t = convexTest({ schema, modules });
  const s = await seed(t, [{ eventStatus: "cancelled" }, { eventStatus: "cancelled", link: LIVE }]);
  await upsert(t, s, 0);
  await upsert(t, s, 1);
  assert.deepEqual(said(calls), [`PATCH /channels/${CHANNEL}/messages/${LIVE}`]);
  assert.ok(calls[0].body?.embeds[0].description?.startsWith("**Cancelled**"));
});

it("removes the message when the event stops being public", async (test) => {
  const calls = fakeDiscord(test);
  const t = convexTest({ schema, modules });
  const s = await seed(t, [{ link: LIVE }]);
  await t.run((ctx) => ctx.db.patch(s.communityProfileId, { publicSurfacingState: "suppressed" }));
  await upsert(t, s);
  assert.deepEqual(said(calls), [`DELETE /channels/${CHANNEL}/messages/${LIVE}`]);
});

it("makes no request when the flag is off", async (test) => {
  const calls = fakeDiscord(test);
  delete process.env.VRDEX_CONNECTOR_DISCORD_BOARD_ENABLED;
  const t = convexTest({ schema, modules });
  const job = await upsert(t, await seed(t, [{}]));
  assert.deepEqual(calls, []);
  assert.match(job?.lastError ?? "", /CONNECTOR_KIND_DISABLED/);
});

it("makes no request for a non-snowflake channel", async (test) => {
  const calls = fakeDiscord(test);
  const t = convexTest({ schema, modules });
  const job = await upsert(t, await seed(t, [{}], { target: { guildId: GUILD, channelId: "../../guilds/1" } }));
  assert.deepEqual(calls, []);
  assert.match(job?.lastError ?? "", /BOARD_TARGET_INVALID/);
});
