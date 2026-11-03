import assert from "node:assert/strict";
import { afterEach, beforeEach, it, type TestContext } from "node:test";
import { convexTest } from "convex-test";
import { api, internal } from "../../convex/_generated/api";
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
    // The board channel belongs to the target guild unless a test says otherwise.
    if (call.method === "GET" && call.path === `/channels/${CHANNEL}`) return respond(call) ?? Response.json({ id: CHANNEL, guild_id: GUILD, type: 0 });
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
async function drain(t: ReturnType<typeof convexTest>) {
  const pending = await t.run((ctx) => ctx.db.query("eventSyncJobs").withIndex("by_state_dueAt", (q) => q.eq("state", "pending")).collect());
  for (const job of pending) await t.action(internal.eventSync.runJob, { jobId: job._id });
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
  assert.deepEqual(said(calls), [`GET /channels/${CHANNEL}`, `POST /channels/${CHANNEL}/messages`]);
  assert.equal(calls[1].body?.embeds[0].title, "@everyone Harbor Night");
  assert.deepEqual(calls[1].body?.allowed_mentions, { parse: [] });
  assert.equal((await linkFor(t, s.connectorId, s.eventIds[0]))?.externalId, "900000000000000002");
});

it("edits the linked message in place", async (test) => {
  const calls = fakeDiscord(test);
  const t = convexTest({ schema, modules });
  const s = await seed(t, [{ link: LIVE }]);
  await upsert(t, s);
  assert.deepEqual(said(calls), [`PATCH /channels/${CHANNEL}/messages/${LIVE}`]);
  assert.deepEqual(calls[0].body?.allowed_mentions, { parse: [] });
  assert.ok(calls[0].body && !("content" in calls[0].body));
  assert.equal((await linkFor(t, s.connectorId, s.eventIds[0]))?.externalId, LIVE);
});

it("keeps a non-JSON reply out of lastError", async (test) => {
  fakeDiscord(test, (call) => (call.method === "POST" ? new Response("<!DOCTYPE html><p>upstream</p>", { status: 200 }) : undefined));
  const t = convexTest({ schema, modules });
  const s = await seed(t, [{}]);
  assert.equal((await upsert(t, s))?.lastError, "discord_bad_response");
});

it("does not re-post a cancelled event whose message was deleted", async (test) => {
  const calls = fakeDiscord(test, (call) => (call.method === "PATCH" ? new Response(null, { status: 404 }) : undefined));
  const t = convexTest({ schema, modules });
  const s = await seed(t, [{ eventStatus: "cancelled", link: LIVE }]);
  assert.equal((await upsert(t, s))?.state, "done");
  assert.deepEqual(said(calls), [`PATCH /channels/${CHANNEL}/messages/${LIVE}`]);
  assert.equal((await linkFor(t, s.connectorId, s.eventIds[0]))?.externalId, `none:${s.eventIds[0]}`);
});

it("re-posts when the linked message is gone", async (test) => {
  const calls = fakeDiscord(test, (call) => (call.method === "PATCH" ? new Response(null, { status: 404 }) : undefined));
  const t = convexTest({ schema, modules });
  const s = await seed(t, [{ link: LIVE }]);
  await upsert(t, s);
  assert.deepEqual(said(calls), [`PATCH /channels/${CHANNEL}/messages/${LIVE}`, `GET /channels/${CHANNEL}`, `POST /channels/${CHANNEL}/messages`]);
  assert.equal((await linkFor(t, s.connectorId, s.eventIds[0]))?.externalId, "900000000000000003");
});

for (const [name, status, method, lastError] of [
  ["pauses the connector when Discord refuses the write", 403, "POST", "discord_forbidden"],
  ["pauses when the channel is gone", 404, "POST", "discord_channel_missing"],
  ["pauses when the channel lookup finds nothing", 404, "GET", "discord_channel_missing"],
] as const) {
  it(name, async (test) => {
    fakeDiscord(test, (call) => (call.method === method ? new Response(null, { status }) : undefined));
    const t = convexTest({ schema, modules });
    const s = await seed(t, [{}]);
    assert.notEqual((await upsert(t, s))?.state, "done");
    await drain(t); // the retry is skipped for the paused connector, so it never counts toward the alarm
    const connector = await t.run((ctx) => ctx.db.get(s.connectorId));
    assert.equal(connector?.state, "paused");
    assert.match(connector?.lastError ?? "", new RegExp(lastError));
    assert.ok(!connector?.consecutiveFailures);
  });
}

it("a 403 in flight during Disconnect leaves the connector removed", async () => {
  const t = convexTest({ schema, modules });
  const s = await seed(t, [], { state: "removed" });
  await t.mutation(internal.eventSyncKinds.discordBoard.pauseBoardConnector, { connectorId: s.connectorId, lastError: "discord_forbidden" });
  const connector = await t.run((ctx) => ctx.db.get(s.connectorId));
  assert.deepEqual([connector?.state, connector?.lastError], ["removed", undefined]);
});

it("refuses to post into a channel of another guild", async (test) => {
  const calls = fakeDiscord(test, (call) => (call.method === "GET" ? Response.json({ id: CHANNEL, guild_id: "999999999999999999", type: 0 }) : undefined));
  const t = convexTest({ schema, modules });
  const s = await seed(t, [{}]);
  assert.notEqual((await upsert(t, s))?.state, "done");
  const connector = await t.run((ctx) => ctx.db.get(s.connectorId));
  assert.equal(connector?.state, "paused");
  assert.match(connector?.lastError ?? "", /discord_channel_mismatch/);
  assert.deepEqual(said(calls), [`GET /channels/${CHANNEL}`]);
});

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

it("refresh removes the message once the community stops being public", async (test) => {
  const calls = fakeDiscord(test);
  const t = convexTest({ schema, modules });
  const s = await seed(t, [{ link: LIVE }]);
  await t.run((ctx) => ctx.db.patch(s.communityProfileId, { publicSurfacingState: "suppressed" }));
  assert.equal((await runJob(t, { connectorId: s.connectorId, kind: "board_refresh" }))?.state, "done");
  await drain(t);
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

it("refresh posts inside 14 days, retires after 24 hours, and keeps cancelled embeds", async (test) => {
  const calls = fakeDiscord(test);
  const t = convexTest({ schema, modules });
  const now = Date.now();
  const s = await seed(t, [
    { startAt: now + 14 * DAY - MINUTE, endAt: now + 14 * DAY + HOUR }, // posted
    { startAt: now + 14 * DAY + MINUTE, endAt: now + 14 * DAY + 2 * HOUR }, // too far
    { startAt: now - 2 * DAY, endAt: now - DAY + MINUTE, link: "333333333333333333" }, // kept
    { startAt: now - 2 * DAY, endAt: now - DAY - MINUTE, link: "444444444444444444" }, // retired
    { startAt: now + 2 * DAY, eventStatus: "cancelled" }, // not posted
    { startAt: now + 3 * DAY, eventStatus: "cancelled", link: "555555555555555555" }, // kept
  ]);
  assert.equal((await runJob(t, { connectorId: s.connectorId, kind: "board_refresh" }))?.state, "done");
  await drain(t);
  assert.deepEqual(said(calls).sort(), [`DELETE /channels/${CHANNEL}/messages/444444444444444444`, `GET /channels/${CHANNEL}`, `POST /channels/${CHANNEL}/messages`].sort());
  // Retirement removes the message through an upsert; it is not a retraction.
  const retired = await linkFor(t, s.connectorId, s.eventIds[3]);
  assert.equal(retired?.state, "linked");
  assert.ok(retired?.externalId.startsWith("none:"));
});

it("refresh is idempotent", async (test) => {
  const calls = fakeDiscord(test);
  const t = convexTest({ schema, modules });
  const s = await seed(t, [{}, {}]);
  await t.mutation(internal.eventSyncKinds.discordBoard.planBoardRefresh, { connectorId: s.connectorId });
  assert.deepEqual(await t.mutation(internal.eventSyncKinds.discordBoard.planBoardRefresh, { connectorId: s.connectorId }), { upserts: 0, deletes: 0 });
  await drain(t);
  assert.equal(calls.length, 4); // a channel check and a post per event
  await runJob(t, { connectorId: s.connectorId, kind: "board_refresh" });
  await drain(t);
  assert.equal(calls.length, 4);
});

it("the daily cron enqueues one refresh per active export board", async () => {
  const t = convexTest({ schema, modules });
  const s = await seed(t, []);
  await t.run(async (ctx) => {
    const base = await ctx.db.get(s.connectorId);
    const { _id, _creationTime, ...row } = base!;
    await ctx.db.insert("eventConnectors", { ...row, state: "paused" });
    await ctx.db.insert("eventConnectors", { ...row, state: "removed" });
    await ctx.db.insert("eventConnectors", { ...row, kind: "google_calendar", target: { calendarId: "c" } });
  });
  const pendingRefreshes = () => t.run(async (ctx) => (await ctx.db.query("eventSyncJobs").collect()).filter((job) => job.kind === "board_refresh" && job.state === "pending").map((job) => job.connectorId));
  assert.equal(await t.mutation(internal.eventSyncKinds.discordBoard.enqueueBoardRefreshes, {}), 1);
  assert.equal(await t.mutation(internal.eventSyncKinds.discordBoard.enqueueBoardRefreshes, {}), 0);
  assert.deepEqual(await pendingRefreshes(), [s.connectorId]);
  delete process.env.VRDEX_CONNECTOR_DISCORD_BOARD_ENABLED;
  const off = convexTest({ schema, modules });
  await seed(off, []);
  assert.equal(await off.mutation(internal.eventSyncKinds.discordBoard.enqueueBoardRefreshes, {}), 0);
});

// The seeded staff authority, signed in, optionally with a Discord proof for GUILD.
async function staffer(t: ReturnType<typeof convexTest>, proved: boolean) {
  const s = await seed(t, []);
  if (proved) await t.run((ctx) => ctx.db.insert("externalControlProofs", { userId: s.userId, assetType: "discord_guild", assetExternalId: GUILD, controlLevel: "manager", state: "active", evidenceSource: "discord_oauth", verifiedAt: s.now, revalidateAfter: s.now + DAY, createdAt: s.now, updatedAt: s.now }));
  return { s, as: t.withIdentity({ ...staff, email: "staff@example.test", emailVerified: true }) };
}

it("lists only text and announcement channels of a proved guild", async (test) => {
  const calls = fakeDiscord(test, (call) => call.path === `/guilds/${GUILD}/channels` ? Response.json([
    { id: "200000000000000001", name: "general", type: 0, position: 2 },
    { id: "200000000000000002", name: "Voice", type: 2, position: 0 },
    { id: "200000000000000003", name: "Events", type: 4, position: 1 },
    { id: "200000000000000004", name: "announcements", type: 5, position: 1 },
  ]) : undefined);
  const t = convexTest({ schema, modules });
  const { s, as } = await staffer(t, true);
  assert.deepEqual(await as.action(api.eventSyncKinds.discordBoard.listBoardChannels, { communityProfileId: s.communityProfileId, guildId: GUILD }), [
    { id: "200000000000000004", name: "announcements" },
    { id: "200000000000000001", name: "general" },
  ]);
  assert.deepEqual(said(calls), [`GET /guilds/${GUILD}/channels`]);
});

it("refuses to list channels of a guild the staffer has not proved", async (test) => {
  const calls = fakeDiscord(test);
  const t = convexTest({ schema, modules });
  const { s, as } = await staffer(t, false);
  await assert.rejects(as.action(api.eventSyncKinds.discordBoard.listBoardChannels, { communityProfileId: s.communityProfileId, guildId: GUILD }), /CONTROL_NOT_VERIFIED/);
  assert.deepEqual(calls, []);
});

it("reports whether the board is enabled", async () => {
  const t = convexTest({ schema, modules });
  assert.equal(await t.query(api.eventSyncKinds.discordBoard.isEnabled, {}), true);
  delete process.env.VRDEX_CONNECTOR_DISCORD_BOARD_ENABLED;
  assert.equal(await t.query(api.eventSyncKinds.discordBoard.isEnabled, {}), false);
});

async function createBoard(proved: boolean) {
  const t = convexTest({ schema, modules: { ...modules, "../../convex/eventConnectors.ts": () => import("../../convex/eventConnectors") } });
  const { s, as } = await staffer(t, proved);
  await t.run((ctx) => ctx.db.delete(s.connectorId)); // seed's board would be CONNECTOR_EXISTS
  return as.mutation(api.eventConnectors.create, { communityProfileId: s.communityProfileId, kind: "discord_board", direction: "export", mode: "hold", target: { guildId: GUILD, channelId: CHANNEL, channelName: "general" } });
}

it("creating a board needs a proof of its guild", async (test) => {
  fakeDiscord(test);
  await assert.rejects(createBoard(false), /CONTROL_NOT_VERIFIED/);
  assert.ok(await createBoard(true));
});

it("creating a board is refused while the board flag is off", async (test) => {
  fakeDiscord(test);
  delete process.env.VRDEX_CONNECTOR_DISCORD_BOARD_ENABLED;
  await assert.rejects(createBoard(true), /CONNECTOR_KIND_DISABLED/);
});
