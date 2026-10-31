import assert from "node:assert/strict";
import { afterEach, beforeEach, it, type TestContext } from "node:test";
import { convexTest } from "convex-test";
import { api, internal } from "../../convex/_generated/api";
import type { Doc, Id } from "../../convex/_generated/dataModel";
import schemaModule from "../../convex/schema";

const schema = (schemaModule as unknown as { default?: typeof schemaModule }).default ?? schemaModule;
const modules = {
  "../../convex/_generated/api.ts": () => import("../../convex/_generated/api"),
  "../../convex/http.ts": () => import("../../convex/http"),
  "../../convex/discordIntake.ts": () => import("../../convex/discordIntake"),
  "../../convex/eventSync.ts": () => import("../../convex/eventSync"),
  "../../convex/eventConnectors.ts": () => import("../../convex/eventConnectors"),
  "../../convex/eventSyncKinds/discordBoard.ts": () => import("../../convex/eventSyncKinds/discordBoard"),
  "../../convex/eventSyncKinds/discordScheduledEvents.ts": () => import("../../convex/eventSyncKinds/discordScheduledEvents"),
  "../../convex/googleCalendarConnector.ts": () => import("../../convex/googleCalendarConnector"),
};
const HOUR = 3_600_000; const DAY = 24 * HOUR;
const GUILD = "876543210987654321"; const LIVE = "111111111111111111"; const OTHER = "222222222222222222";
const ISSUER = "https://test.clerk.accounts.dev";
// The connector's authority user, granted manage_integrations as community staff.
const staff = { subject: "staff", issuer: ISSUER, tokenIdentifier: `${ISSUER}|staff` };
const ENV = { VRDEX_EVENT_CONNECTORS_ENABLED: "true", VRDEX_CONNECTOR_DISCORD_SCHEDULED_EVENTS_ENABLED: "true", VRDEX_DISCORD_INTAKE_ENABLED: "true", DISCORD_INTAKE_SECRET: "relay-secret", DISCORD_BOT_TOKEN: "test-bot-token", SITE_URL: "https://vrdex.test", CLERK_JWT_ISSUER_DOMAIN: ISSUER };
beforeEach((test) => { test.mock.timers.enable({ apis: ["setTimeout"] }); Object.assign(process.env, ENV); });
afterEach(() => { for (const key of Object.keys(ENV)) delete process.env[key]; });
const iso = (ms: number) => new Date(ms).toISOString();

type Call = { method: string; path: string; body?: Record<string, unknown> };
const PNG = new Uint8Array([0x89, 0x50, 0x4e, 0x47]); // base64 iVBORw==
function fakeDiscord(test: TestContext, respond: (call: Call) => Response | undefined = () => undefined, artwork = () => new Response(PNG, { headers: { "content-type": "image/png" } })) {
  const calls: Call[] = [];
  test.mock.method(globalThis, "fetch", async (input: string | URL, init: RequestInit = {}) => {
    const url = new URL(String(input));
    if (url.hostname === "media.example.test") return artwork();
    const call: Call = { method: init.method ?? "GET", path: url.pathname.replace("/api/v10", ""), ...(init.body ? { body: JSON.parse(String(init.body)) } : {}) };
    calls.push(call);
    return respond(call) ?? (call.method === "DELETE" ? new Response(null, { status: 204 })
      : call.method === "GET" && call.path.endsWith("/scheduled-events") ? Response.json([])
      : call.method === "GET" ? Response.json({ id: call.path.split("/").at(-1), status: 1 })
      : Response.json({ ...call.body, id: call.method === "POST" ? "900000000000000001" : call.path.split("/").at(-1) }));
  });
  return calls;
}
const said = (calls: Call[]) => calls.map((call) => `${call.method} ${call.path}`);

const communityBase = { slug: "afterglow-social", displayName: "Afterglow Social", sortName: "afterglow social", profileType: "community", community: { categoryTags: [] }, aliases: [], tags: [], claimState: "unclaimed", creationSource: "self", publicationState: "published", publicSurfacingState: "public", updatedAt: 1 } satisfies Omit<Doc<"profiles">, "_id" | "_creationTime">;
function eventBase(startAt: number) {
  return { title: "Afterglow Harbor Sessions", sortTitle: "afterglow harbor sessions", summary: "Deep house by the water.", venueLabel: "The Lighthouse", posterImageUrl: "https://media.example.test/poster.png",
    scheduleKind: "timed", startAt, sortAt: startAt, eventDate: iso(startAt).slice(0, 10), endAt: startAt + 3 * HOUR, timezone: "UTC",
    eventStatus: "scheduled", publicationState: "published", sourceType: "community", sourceLabel: "Fixture", updatedAt: 1 } as const;
}
type Seed = Partial<Doc<"events">> & { link?: string; linkState?: Doc<"eventSyncLinks">["state"] };

async function seed(t: ReturnType<typeof convexTest>, events: Seed[], connector: Partial<Doc<"eventConnectors">> = {}) {
  const now = Date.now();
  return t.run(async (ctx) => {
    const userId = await ctx.db.insert("users", { clerkUserId: staff.subject });
    const communityProfileId = await ctx.db.insert("profiles", communityBase);
    await ctx.db.insert("communityAuthorities", { communityProfileId, subjectTokenIdentifier: staff.tokenIdentifier, subject: staff, capabilities: ["manage_integrations"], state: "active", grantedAt: now, updatedAt: now });
    const connectorId = await ctx.db.insert("eventConnectors", { communityProfileId, kind: "discord_scheduled_events", direction: "bidirectional", mode: "hold", authorityUserId: userId, target: { guildId: GUILD }, state: "active", createdAt: now, updatedAt: now, ...connector });
    const eventIds: Id<"events">[] = [];
    for (const [index, { link, linkState, ...event }] of events.entries()) {
      const eventId = await ctx.db.insert("events", { ...eventBase(event.startAt ?? now + 2 * DAY), slug: `night-${index}`, communityProfileId, ...event });
      if (link) await ctx.db.insert("eventSyncLinks", { connectorId, eventId, externalId: link, state: linkState ?? "linked", createdAt: now, updatedAt: now });
      eventIds.push(eventId);
    }
    return { now, userId, communityProfileId, connectorId, eventIds };
  });
}
async function runJob(t: ReturnType<typeof convexTest>, job: { connectorId: Id<"eventConnectors">; eventId?: Id<"events">; kind: Doc<"eventSyncJobs">["kind"]; payload?: unknown }) {
  const jobId = await t.run((ctx) => ctx.db.insert("eventSyncJobs", { payload: null, ...job, dueAt: 0, attempts: 0, state: "pending", createdAt: 0, updatedAt: 0 }));
  await t.action(internal.eventSync.runJob, { jobId });
  return t.run((ctx) => ctx.db.get(jobId));
}
const all = <T extends "eventSyncJobs" | "eventSyncLinks" | "eventIntakeDrafts" | "events">(t: ReturnType<typeof convexTest>, table: T) => t.run((ctx) => ctx.db.query(table).collect());
const discordEvent = (startAt: number, overrides: Record<string, unknown> = {}) => ({
  id: LIVE, guild_id: GUILD, channel_id: null, creator_id: "333333333333333333", name: "Afterglow Harbor Sessions", description: "Deep house by the water.",
  scheduled_start_time: iso(startAt), scheduled_end_time: iso(startAt + 3 * HOUR), privacy_level: 2, status: 1, entity_type: 3, entity_id: null,
  entity_metadata: { location: "The Lighthouse" }, image: null, recurrence_rule: null, ...overrides,
});
const relayPost = (t: ReturnType<typeof convexTest>, body: unknown) => t.fetch("/discord-intake/relay", {
  method: "POST", headers: { authorization: "Bearer relay-secret", "content-type": "application/json" }, body: JSON.stringify(body),
});

it("relays a scheduled event to an import job on each matching connector", async () => {
  const t = convexTest({ schema, modules });
  const s = await seed(t, []);
  await t.run(async (ctx) => {
    const base = (await ctx.db.get(s.connectorId))!;
    const { _id, _creationTime, ...copy } = base;
    await ctx.db.insert("eventConnectors", { ...copy, direction: "export" });
    await ctx.db.insert("eventConnectors", { ...copy, state: "paused" });
    await ctx.db.insert("eventConnectors", { ...copy, target: { guildId: "999999999999999999" } });
  });
  const response = await relayPost(t, { kind: "scheduled_event", action: "update", guildId: GUILD, payload: discordEvent(s.now + DAY) });
  assert.equal(response.status, 200);
  assert.deepEqual(await response.json(), { enqueued: 1 });
  const jobs = await all(t, "eventSyncJobs");
  assert.deepEqual(jobs.map((job) => [job.connectorId, job.kind, job.payload.action, job.payload.event.id]), [[s.connectorId, "import_item", "update", LIVE]]);
  assert.equal(typeof jobs[0].payload.receivedAt, "number");
});

it("relays nothing when the flag is off or the payload belongs to another guild", async () => {
  const t = convexTest({ schema, modules });
  const s = await seed(t, []);
  await relayPost(t, { kind: "scheduled_event", action: "update", guildId: GUILD, payload: discordEvent(s.now + DAY, { guild_id: "999999999999999999" }) });
  delete process.env.VRDEX_CONNECTOR_DISCORD_SCHEDULED_EVENTS_ENABLED;
  await relayPost(t, { kind: "scheduled_event", action: "update", guildId: GUILD, payload: discordEvent(s.now + DAY) });
  assert.deepEqual(await all(t, "eventSyncJobs"), []);
});

it("relays nothing for a payload that fails the parse or a guild ID that is not a snowflake", async () => {
  const t = convexTest({ schema, modules });
  const s = await seed(t, []);
  const relay = (guildId: string, payload: unknown) => t.mutation(internal.eventSyncKinds.discordScheduledEvents.relayScheduledEvent, { action: "update", guildId, payload, receivedAt: s.now });
  assert.equal(await relay(GUILD, discordEvent(s.now + DAY, { status: 9 })), 0);
  assert.equal(await relay("guild", discordEvent(s.now + DAY, { guild_id: "guild" })), 0);
  assert.deepEqual(await all(t, "eventSyncJobs"), []);
});

it("rejects a malformed scheduled event relay", async () => {
  const t = convexTest({ schema, modules });
  const s = await seed(t, []);
  const valid = { kind: "scheduled_event", action: "update", guildId: GUILD, payload: discordEvent(s.now + DAY) };
  for (const bad of [{ action: "archive" }, { guildId: "guild" }, { payload: null }, { payload: "text" }]) {
    const response = await relayPost(t, { ...valid, ...bad });
    assert.equal(response.status, 400);
    assert.deepEqual(await response.json(), { error: "invalid_request" });
  }
  assert.deepEqual(await all(t, "eventSyncJobs"), []);
});

it("answers the gateway's guild-only connector lookup", async () => {
  const t = convexTest({ schema, modules });
  const s = await seed(t, []);
  const response = await t.fetch(`/discord-intake/connectors?guildId=${GUILD}`, { headers: { authorization: "Bearer relay-secret" } });
  assert.deepEqual(await response.json(), { connectors: [{ connectorId: s.connectorId, kind: "discord_scheduled_events", direction: "bidirectional", mode: "hold", state: "active", guildId: GUILD }] });
});

const upsert = (t: ReturnType<typeof convexTest>, s: { connectorId: Id<"eventConnectors">; eventIds: Id<"events">[] }, index = 0) =>
  runJob(t, { connectorId: s.connectorId, eventId: s.eventIds[index], kind: "export_upsert" });
const linkOf = async (t: ReturnType<typeof convexTest>, eventId: Id<"events">) => (await all(t, "eventSyncLinks")).find((link) => link.eventId === eventId) ?? null;
const PATH = `/guilds/${GUILD}/scheduled-events`;

it("creates the Discord event from the carried fields with the artwork", async (test) => {
  const calls = fakeDiscord(test);
  const t = convexTest({ schema, modules });
  const s = await seed(t, [{}]);
  const start = s.now + 2 * DAY;
  assert.equal((await upsert(t, s))?.state, "done");
  assert.deepEqual(said(calls), [`GET ${PATH}`, `POST ${PATH}`]);
  assert.deepEqual(calls[1].body, {
    name: "Afterglow Harbor Sessions", privacy_level: 2, entity_type: 3, channel_id: null, entity_metadata: { location: "The Lighthouse" },
    scheduled_start_time: iso(start), scheduled_end_time: iso(start + 3 * HOUR),
    description: "Deep house by the water.\n\nhttps://vrdex.test/afterglow-social/events/night-0", image: "data:image/png;base64,iVBORw==",
  });
  const link = await linkOf(t, s.eventIds[0]);
  assert.equal(link?.externalId, "900000000000000001");
  assert.ok(link?.lastExportedHash);
});

it("exports without a cover when the artwork is too large", async (test) => {
  const calls = fakeDiscord(test, undefined, () => new Response(new Uint8Array(8 * 1024 * 1024 + 1), { headers: { "content-type": "image/png" } }));
  const t = convexTest({ schema, modules });
  await upsert(t, await seed(t, [{}]));
  assert.equal(Object.hasOwn(calls[1].body!, "image"), false);
});

it("exports without a cover for any other artwork failure", async (test) => {
  const artwork = [
    () => new Response("<html>", { headers: { "content-type": "text/html" } }),
    () => new Response(PNG, { headers: { "content-type": "image/png", "content-length": String(8 * 1024 * 1024 + 1) } }),
    () => new Response(PNG, { status: 500, headers: { "content-type": "image/png" } }),
    () => new Response(new Uint8Array(0), { headers: { "content-type": "image/png" } }),
    () => { throw new Error("offline"); },
  ];
  const calls = fakeDiscord(test, undefined, () => artwork.shift()!());
  const t = convexTest({ schema, modules });
  const s = await seed(t, [{}, {}, {}, {}, {}]);
  for (const index of s.eventIds.keys()) assert.equal((await upsert(t, s, index))?.state, "done");
  const posts = calls.filter((call) => call.method === "POST");
  assert.equal(posts.length, 5);
  assert.deepEqual(posts.filter((call) => Object.hasOwn(call.body!, "image")), []);
});

it("names the type a JPEG cover came with, without its parameters", async (test) => {
  const calls = fakeDiscord(test, undefined, () => new Response(PNG, { headers: { "content-type": "IMAGE/JPEG; charset=binary" } }));
  const t = convexTest({ schema, modules });
  await upsert(t, await seed(t, [{}]));
  assert.equal(calls[1].body!.image, "data:image/jpeg;base64,iVBORw==");
});

it("updates the linked Discord event in place", async (test) => {
  const calls = fakeDiscord(test);
  const t = convexTest({ schema, modules });
  const s = await seed(t, [{ link: LIVE }]);
  await upsert(t, s);
  assert.deepEqual(said(calls), [`GET ${PATH}/${LIVE}`, `PATCH ${PATH}/${LIVE}`]);
});

it("re-creates a Discord event that ended or was cancelled there", async (test) => {
  const calls = fakeDiscord(test, (call) => (call.method === "GET" && call.path.endsWith(LIVE) ? Response.json({ id: LIVE, status: 4 }) : undefined));
  const t = convexTest({ schema, modules });
  const s = await seed(t, [{ link: LIVE }]);
  await upsert(t, s);
  assert.deepEqual(said(calls), [`GET ${PATH}/${LIVE}`, `POST ${PATH}`]);
  assert.equal((await linkOf(t, s.eventIds[0]))?.externalId, "900000000000000001");
});

it("re-creates a Discord event that is gone", async (test) => {
  const calls = fakeDiscord(test, (call) => (call.method === "GET" && call.path.endsWith(LIVE) ? new Response(null, { status: 404 }) : undefined));
  const t = convexTest({ schema, modules });
  await upsert(t, await seed(t, [{ link: LIVE }]));
  assert.deepEqual(said(calls), [`GET ${PATH}/${LIVE}`, `POST ${PATH}`]);
});

it("links a same-night Discord event instead of creating a duplicate", async (test) => {
  let start = 0;
  const calls = fakeDiscord(test, (call) => (call.method === "GET" && call.path === PATH ? Response.json([discordEvent(start, { id: OTHER, name: " afterglow HARBOR sessions " })]) : undefined));
  const t = convexTest({ schema, modules });
  const s = await seed(t, [{}]);
  start = s.now + 2 * DAY;
  await upsert(t, s);
  assert.deepEqual(said(calls), [`GET ${PATH}`, `PATCH ${PATH}/${OTHER}`]);
  assert.equal((await linkOf(t, s.eventIds[0]))?.externalId, OTHER);
});

it("never adopts a series, a finished event, an invalid item, another night, or one already linked", async (test) => {
  let start = 0;
  const rule = { start: iso(0), end: null, frequency: 2, interval: 1, by_weekday: [0], by_n_weekday: null, by_month: null, by_month_day: null, by_year_day: null, count: null };
  const calls = fakeDiscord(test, (call) => (call.method === "GET" && call.path === PATH ? Response.json([
    discordEvent(start, { id: "333333333333333331", recurrence_rule: rule }), discordEvent(start, { id: "333333333333333332", status: 3 }), discordEvent(start, { id: "333333333333333333", status: 4 }),
    discordEvent(start, { id: "not-a-snowflake" }), discordEvent(start + 2 * DAY, { id: "333333333333333334" }), discordEvent(start, { id: OTHER }),
  ]) : undefined));
  const t = convexTest({ schema, modules });
  const s = await seed(t, [{}, { link: OTHER, title: "Already linked" }]);
  start = s.now + 2 * DAY;
  await upsert(t, s);
  assert.deepEqual(said(calls), [`GET ${PATH}`, `POST ${PATH}`]);
});

it("a cancelled VRDex event cancels the Discord event", async (test) => {
  const calls = fakeDiscord(test);
  const t = convexTest({ schema, modules });
  await upsert(t, await seed(t, [{ eventStatus: "cancelled", link: LIVE }]));
  assert.deepEqual(said(calls), [`GET ${PATH}/${LIVE}`, `PATCH ${PATH}/${LIVE}`]);
  assert.deepEqual(calls[1].body, { status: 4 });
});

it("a cancelled VRDex event leaves a running or missing Discord event alone", async (test) => {
  const calls = fakeDiscord(test, (call) => (call.path.endsWith(LIVE) ? Response.json({ id: LIVE, status: 2 }) : call.path.endsWith(OTHER) ? new Response(null, { status: 404 }) : undefined));
  const t = convexTest({ schema, modules });
  const s = await seed(t, [{ eventStatus: "cancelled", link: LIVE }, { eventStatus: "cancelled", link: OTHER }]);
  assert.equal((await upsert(t, s, 0))?.state, "done");
  assert.equal((await upsert(t, s, 1))?.state, "done");
  assert.deepEqual(said(calls), [`GET ${PATH}/${LIVE}`, `GET ${PATH}/${OTHER}`]);
  assert.equal((await linkOf(t, s.eventIds[0]))?.externalId, LIVE);
});

it("deletes the Discord event when the VRDex event stops being public", async (test) => {
  const calls = fakeDiscord(test);
  const t = convexTest({ schema, modules });
  const s = await seed(t, [{ link: LIVE }]);
  await t.run((ctx) => ctx.db.patch(s.communityProfileId, { publicationState: "draft_private" }));
  assert.equal((await upsert(t, s))?.state, "done");
  assert.deepEqual(said(calls), [`DELETE ${PATH}/${LIVE}`]);
  assert.equal((await linkOf(t, s.eventIds[0]))?.externalId, `none:${s.eventIds[0]}`);
});

it("export_delete deletes the Discord event and treats a missing one as deleted", async (test) => {
  const calls = fakeDiscord(test, (call) => (call.path.endsWith(OTHER) ? new Response(null, { status: 404 }) : undefined));
  const t = convexTest({ schema, modules });
  // The runner closes export_delete for a still-published event as event_public, so these are private.
  const s = await seed(t, [{ link: LIVE, publicationState: "draft_private" }, { link: OTHER, publicationState: "draft_private" }]);
  assert.equal((await runJob(t, { connectorId: s.connectorId, eventId: s.eventIds[0], kind: "export_delete" }))?.state, "done");
  assert.equal((await runJob(t, { connectorId: s.connectorId, eventId: s.eventIds[1], kind: "export_delete" }))?.state, "done");
  assert.deepEqual(said(calls), [`DELETE ${PATH}/${LIVE}`, `DELETE ${PATH}/${OTHER}`]);
});

it("export_delete of a link with no Discord event makes no request", async (test) => {
  const calls = fakeDiscord(test);
  const t = convexTest({ schema, modules });
  const s = await seed(t, [{ link: "none:held", publicationState: "draft_private" }]);
  assert.equal((await runJob(t, { connectorId: s.connectorId, eventId: s.eventIds[0], kind: "export_delete" }))?.state, "done");
  assert.deepEqual(calls, []);
  assert.equal((await linkOf(t, s.eventIds[0]))?.state, "vrdex_retracted");
});

it("pauses the connector when Discord refuses the write", async (test) => {
  fakeDiscord(test, (call) => (call.method === "POST" ? new Response(null, { status: 403 }) : undefined));
  const t = convexTest({ schema, modules });
  const s = await seed(t, [{}]);
  assert.notEqual((await upsert(t, s))?.state, "done");
  const connector = await t.run((ctx) => ctx.db.get(s.connectorId));
  assert.equal(connector?.state, "paused");
  assert.match(connector?.lastError ?? "", /discord_forbidden/);
});

it("fails with a short code on other Discord errors and bad responses", async (test) => {
  const responses = [new Response(null, { status: 500 }), new Response("<html>"), Response.json({ id: "../1" }), new Response(null, { status: 404 })];
  fakeDiscord(test, (call) => (call.method === "POST" ? responses.shift() : undefined));
  const t = convexTest({ schema, modules });
  const s = await seed(t, [{}, {}, {}, {}]);
  const errors = [];
  for (const index of s.eventIds.keys()) errors.push((await upsert(t, s, index))?.lastError);
  assert.deepEqual(errors, ["discord_500", "discord_bad_response", "discord_bad_response", "discord_404"]);
  assert.equal((await t.run((ctx) => ctx.db.get(s.connectorId)))?.state, "active");
});

it("makes no request for started events, a disabled flag, or a bad guild ID", async (test) => {
  const calls = fakeDiscord(test);
  const t = convexTest({ schema, modules });
  const now = Date.now();
  await upsert(t, await seed(t, [{ startAt: now - HOUR }]));
  const bad = await upsert(t, await seed(t, [{}], { target: { guildId: "../../users/@me" } }));
  assert.match(bad?.lastError ?? "", /SCHEDULED_EVENTS_TARGET_INVALID/);
  delete process.env.VRDEX_CONNECTOR_DISCORD_SCHEDULED_EVENTS_ENABLED;
  const off = await upsert(t, await seed(t, [{}]));
  assert.match(off?.lastError ?? "", /CONNECTOR_KIND_DISABLED/);
  assert.deepEqual(calls, []);
});

it("records a none: link when there is nothing to write on Discord", async (test) => {
  const calls = fakeDiscord(test);
  const t = convexTest({ schema, modules });
  const s = await seed(t, [{ eventStatus: "cancelled" }, { startAt: Date.now() - HOUR }, { scheduleKind: "date_only", startAt: undefined, endAt: undefined }]);
  for (const [index, eventId] of s.eventIds.entries()) {
    assert.equal((await upsert(t, s, index))?.state, "done");
    assert.equal((await linkOf(t, eventId))?.externalId, `none:${eventId}`);
  }
  assert.deepEqual(calls, []);
});

it("keeps a started event's Discord link without writing", async (test) => {
  const calls = fakeDiscord(test);
  const t = convexTest({ schema, modules });
  const s = await seed(t, [{ startAt: Date.now() - HOUR, link: LIVE }]);
  assert.equal((await upsert(t, s))?.state, "done");
  assert.deepEqual(calls, []);
  assert.equal((await linkOf(t, s.eventIds[0]))?.externalId, LIVE);
});

it("leaves imported occurrences and Discord-deleted links alone", async (test) => {
  const calls = fakeDiscord(test);
  const t = convexTest({ schema, modules });
  const occurrence = `${LIVE}:2026-12-01`;
  const s = await seed(t, [{ link: occurrence }, { link: OTHER, linkState: "external_deleted" }]);
  await t.run(async (ctx) => {
    const link = await ctx.db.query("eventSyncLinks").withIndex("by_eventId", (q) => q.eq("eventId", s.eventIds[0])).unique();
    await ctx.db.patch(link!._id, { externalSeriesId: LIVE });
  });
  assert.equal((await upsert(t, s, 0))?.state, "done");
  assert.equal((await upsert(t, s, 1))?.state, "done");
  assert.deepEqual(calls, []);
  assert.equal((await linkOf(t, s.eventIds[0]))?.externalId, occurrence);
  assert.equal((await linkOf(t, s.eventIds[1]))?.externalId, OTHER);
});

const importJob = (t: ReturnType<typeof convexTest>, connectorId: Id<"eventConnectors">, action: string, event: unknown, receivedAt = Date.now()) =>
  runJob(t, { connectorId, kind: "import_item", payload: { action, event, receivedAt } });
const patchLink = (t: ReturnType<typeof convexTest>, eventId: Id<"events">, patch: Partial<Doc<"eventSyncLinks">>) => t.run(async (ctx) => {
  const link = await ctx.db.query("eventSyncLinks").withIndex("by_eventId", (q) => q.eq("eventId", eventId)).unique();
  await ctx.db.patch(link!._id, patch);
});
const weekly = (start: number) => ({ start: iso(start), end: null, frequency: 2, interval: 1, by_weekday: [(new Date(start).getUTCDay() + 6) % 7], by_n_weekday: null, by_month: null, by_month_day: null, by_year_day: null, count: null });
const EVENT_LINE = "Deep house by the water.\n\nhttps://vrdex.test/afterglow-social/events/night-0";

it("ignores its own export coming back", async (test) => {
  const calls = fakeDiscord(test);
  const t = convexTest({ schema, modules });
  const s = await seed(t, [{}]);
  await upsert(t, s);
  const sent = calls.find((call) => call.method === "POST")!.body!;
  const echo = { ...discordEvent(s.now + 2 * DAY), ...sent, id: "900000000000000001", image: "a1b2c3d4" };
  assert.equal((await importJob(t, s.connectorId, "update", echo))?.state, "done");
  assert.deepEqual(await all(t, "eventIntakeDrafts"), []);
  assert.equal((await t.run((ctx) => ctx.db.get(s.eventIds[0])))?.updatedAt, 1);
});

it("files nothing for an update that matches the event before the export hash lands", async () => {
  const t = convexTest({ schema, modules });
  const s = await seed(t, [{ link: LIVE }]);
  const receivedAt = Date.now();
  assert.equal((await importJob(t, s.connectorId, "update", discordEvent(s.now + 2 * DAY, { description: EVENT_LINE }), receivedAt))?.state, "done");
  assert.deepEqual(await all(t, "eventIntakeDrafts"), []);
  const link = await linkOf(t, s.eventIds[0]);
  assert.equal(link?.lastExportedHash, undefined);
  assert.equal(link?.externalUpdatedAt, receivedAt);
  assert.ok(link?.lastImportedAt);
});

it("files a held draft and a link for a new Discord event", async () => {
  const t = convexTest({ schema, modules });
  const s = await seed(t, []);
  await importJob(t, s.connectorId, "create", discordEvent(s.now + DAY, { id: OTHER, name: "Harbor Sunrise" }));
  assert.equal((await all(t, "eventIntakeDrafts")).length, 1);
  const [link] = await all(t, "eventSyncLinks");
  assert.equal(link.externalId, OTHER);
  assert.ok(link.draftId);
  assert.equal(link.eventId, undefined);
  assert.ok(link.lastImportedAt);
  assert.equal(link.externalSeriesId, undefined);
});

it("links an unlinked Discord event to the same VRDex night instead of creating one", async () => {
  const t = convexTest({ schema, modules });
  const s = await seed(t, [{}]);
  await importJob(t, s.connectorId, "create", discordEvent(s.now + 2 * DAY, { name: "AFTERGLOW harbor sessions", description: "New details." }));
  assert.equal((await linkOf(t, s.eventIds[0]))?.externalId, LIVE);
  assert.equal((await all(t, "events")).length, 1);
});

it("gives a none: link the Discord ID instead of adding a second link", async () => {
  const t = convexTest({ schema, modules });
  const s = await seed(t, [{ link: "none:held", linkState: "vrdex_retracted" }]);
  await patchLink(t, s.eventIds[0], { lastExportedAt: 5, lastExportedHash: "stale" });
  await importJob(t, s.connectorId, "create", discordEvent(s.now + 2 * DAY));
  const links = await all(t, "eventSyncLinks");
  assert.equal(links.length, 1);
  assert.deepEqual([links[0].externalId, links[0].state, links[0].lastExportedAt, links[0].lastExportedHash], [LIVE, "linked", undefined, undefined]);
});

it("matches only a public, scheduled event on that night with no Discord copy", async () => {
  const t = convexTest({ schema, modules });
  const s = await seed(t, [
    { link: OTHER }, { eventStatus: "cancelled" }, { publicationState: "draft_private" }, { link: "333333333333333333:2026-12-01" }, { link: "444444444444444444", linkState: "external_deleted" },
    { title: "Another night" }, { startAt: Date.now() + 3 * DAY }, { slug: undefined },
  ]);
  await importJob(t, s.connectorId, "create", discordEvent(s.now + 2 * DAY));
  const links = await all(t, "eventSyncLinks");
  assert.equal(links.length, 4);
  assert.deepEqual(links.filter((link) => link.externalId === LIVE).map((link) => link.eventId), [undefined]);
});

it("reads the match's night in the event's own zone", async () => {
  const t = convexTest({ schema, modules });
  const day = Date.parse(iso(Date.now() + 5 * DAY).slice(0, 10) + "T00:00:00.000Z");
  // 05:00 UTC is the previous evening in Los Angeles, and the event's stored date is that evening.
  const startAt = day + 5 * HOUR;
  const s = await seed(t, [{ startAt, eventDate: iso(day - DAY).slice(0, 10), timezone: "America/Los_Angeles" }]);
  const { findTitleDateMatch } = await import("../../convex/eventSyncKinds/discordScheduledEvents");
  const match = (at: number) => t.run(async (ctx) => (await findTitleDateMatch(ctx.db, (await ctx.db.get(s.connectorId))!, " afterglow harbor SESSIONS ", at))?._id ?? null);
  assert.equal(await match(startAt + HOUR), s.eventIds[0]);
  assert.equal(await match(startAt + 24 * HOUR), null);
});

it("a Discord cancel flags the event and never cancels it", async () => {
  const t = convexTest({ schema, modules });
  const s = await seed(t, [{ link: LIVE }]);
  await importJob(t, s.connectorId, "update", discordEvent(s.now + 2 * DAY, { status: 4 }));
  assert.equal((await linkOf(t, s.eventIds[0]))?.state, "external_deleted");
  const event = await t.run((ctx) => ctx.db.get(s.eventIds[0]));
  assert.deepEqual([event?.eventStatus, event?.publicationState], ["scheduled", "published"]);
  assert.deepEqual(await all(t, "eventIntakeDrafts"), []);
});

it("its own cancel coming back is not a deletion", async () => {
  const t = convexTest({ schema, modules });
  const s = await seed(t, [{ eventStatus: "cancelled", link: LIVE }]);
  await importJob(t, s.connectorId, "update", discordEvent(s.now + 2 * DAY, { status: 4 }));
  assert.equal((await linkOf(t, s.eventIds[0]))?.state, "linked");
});

it("a Discord delete flags the event; its own delete does not", async () => {
  const t = convexTest({ schema, modules });
  const s = await seed(t, [{ link: LIVE }, { link: OTHER, linkState: "vrdex_retracted" }]);
  await importJob(t, s.connectorId, "delete", discordEvent(s.now + 2 * DAY));
  await importJob(t, s.connectorId, "delete", discordEvent(s.now + 2 * DAY, { id: OTHER }));
  assert.equal((await linkOf(t, s.eventIds[0]))?.state, "external_deleted");
  assert.equal((await linkOf(t, s.eventIds[1]))?.state, "vrdex_retracted");
});

it("a delete flags a held draft's link and every night of a series, and no longer ID sharing the prefix", async () => {
  const t = convexTest({ schema, modules });
  const s = await seed(t, [{ link: `${LIVE}:2026-12-01` }, { link: `${LIVE}:2026-12-08` }, { link: `${LIVE}0` }, { link: `${LIVE}0:2026-12-01` }]);
  await t.run((ctx) => ctx.db.insert("eventSyncLinks", { connectorId: s.connectorId, externalId: LIVE, state: "linked", createdAt: s.now, updatedAt: s.now }));
  await importJob(t, s.connectorId, "delete", discordEvent(s.now + 2 * DAY));
  const states = Object.fromEntries((await all(t, "eventSyncLinks")).map((link) => [link.externalId, link.state]));
  assert.deepEqual(states, {
    [LIVE]: "external_deleted", [`${LIVE}:2026-12-01`]: "external_deleted", [`${LIVE}:2026-12-08`]: "external_deleted", [`${LIVE}0`]: "linked", [`${LIVE}0:2026-12-01`]: "linked",
  });
});

it("nothing restores a link Discord deleted or VRDex retracted", async () => {
  const t = convexTest({ schema, modules });
  const s = await seed(t, [{ link: LIVE, linkState: "external_deleted" }, { link: OTHER, linkState: "vrdex_retracted" }]);
  await importJob(t, s.connectorId, "update", discordEvent(s.now + 2 * DAY, { description: "Changed." }));
  await importJob(t, s.connectorId, "update", discordEvent(s.now + 2 * DAY, { id: OTHER, description: "Changed." }));
  assert.deepEqual((await all(t, "eventSyncLinks")).map((link) => link.state), ["external_deleted", "vrdex_retracted"]);
  assert.deepEqual(await all(t, "eventIntakeDrafts"), []);
});

it("ignores an update no newer than the last one seen", async () => {
  const t = convexTest({ schema, modules });
  const s = await seed(t, [{ link: LIVE }]);
  await patchLink(t, s.eventIds[0], { externalUpdatedAt: 500 });
  await importJob(t, s.connectorId, "update", discordEvent(s.now + 2 * DAY, { description: "Late." }), 500);
  assert.deepEqual(await all(t, "eventIntakeDrafts"), []);
  assert.equal((await linkOf(t, s.eventIds[0]))?.lastImportedAt, undefined);
});

it("ignores an update to a linked event that is no longer public", async () => {
  const t = convexTest({ schema, modules });
  const s = await seed(t, [{ link: LIVE, publicationState: "draft_private" }]);
  await importJob(t, s.connectorId, "update", discordEvent(s.now + 2 * DAY, { description: "Changed." }));
  assert.deepEqual(await all(t, "eventIntakeDrafts"), []);
  assert.equal((await linkOf(t, s.eventIds[0]))?.lastImportedAt, undefined);
});

it("ignores a span past the intake's day range instead of failing the job", async () => {
  const t = convexTest({ schema, modules });
  const s = await seed(t, []);
  const start = s.now + DAY;
  const job = await importJob(t, s.connectorId, "create", discordEvent(start, { id: OTHER, scheduled_end_time: iso(start + 9 * DAY) }));
  assert.equal(job?.state, "done");
  assert.deepEqual(await all(t, "eventSyncLinks"), []);
});

it("ignores a completed event, a past unlinked event, another guild, a bad payload, and a connector that does not import", async () => {
  const t = convexTest({ schema, modules });
  const s = await seed(t, []);
  await importJob(t, s.connectorId, "update", discordEvent(s.now + DAY, { id: OTHER, status: 3 }));
  await importJob(t, s.connectorId, "update", discordEvent(s.now - HOUR, { id: OTHER, status: 2 }));
  await importJob(t, s.connectorId, "create", discordEvent(s.now + DAY, { id: OTHER, guild_id: "999999999999999999" }));
  await importJob(t, s.connectorId, "create", { id: "not-a-snowflake" });
  const exporting = await seed(t, [], { direction: "export" });
  await importJob(t, exporting.connectorId, "create", discordEvent(s.now + DAY, { id: OTHER }));
  assert.deepEqual(await all(t, "eventSyncLinks"), []);
});

it("fails an import with the flag off", async () => {
  const t = convexTest({ schema, modules });
  const s = await seed(t, []);
  delete process.env.VRDEX_CONNECTOR_DISCORD_SCHEDULED_EVENTS_ENABLED;
  const job = await importJob(t, s.connectorId, "create", discordEvent(s.now + DAY, { id: OTHER }));
  assert.match(job?.lastError ?? "", /CONNECTOR_KIND_DISABLED/);
  assert.deepEqual(await all(t, "eventSyncLinks"), []);
});

it("bidirectional keeps a newer VRDex edit and applies a newer Discord one", async () => {
  const t = convexTest({ schema, modules });
  const s = await seed(t, [{ link: LIVE, updatedAt: Date.now() }]);
  const updatedAt = (await t.run((ctx) => ctx.db.get(s.eventIds[0])))!.updatedAt;
  const edited = discordEvent(s.now + 2 * DAY, { name: "Harbor Sessions Live" });
  await importJob(t, s.connectorId, "update", edited, updatedAt - 1);
  assert.deepEqual(await all(t, "eventIntakeDrafts"), []);
  await importJob(t, s.connectorId, "update", edited, updatedAt + 1);
  assert.equal((await all(t, "eventIntakeDrafts")).length, 1);
});

it("leaves a link alone while its held draft is pending, so the later edit is not lost", async () => {
  const t = convexTest({ schema, modules });
  const s = await seed(t, []);
  await importJob(t, s.connectorId, "create", discordEvent(s.now + DAY, { id: OTHER, name: "Harbor Sunrise" }), 100);
  await t.run(async (ctx) => ctx.db.patch((await ctx.db.query("eventSyncLinks").first())!._id, { lastImportedAt: 1 }));
  await importJob(t, s.connectorId, "update", discordEvent(s.now + DAY, { id: OTHER, name: "Harbor Sunset" }), 200);
  assert.equal((await all(t, "eventIntakeDrafts")).length, 1);
  const [link] = await all(t, "eventSyncLinks");
  assert.deepEqual([link.externalUpdatedAt, link.lastImportedAt], [100, 1]);
});

it("autopublish patches the linked event and keeps its zone", async () => {
  const t = convexTest({ schema, modules });
  const s = await seed(t, [{ link: LIVE, timezone: "America/New_York" }], { mode: "autopublish" });
  await importJob(t, s.connectorId, "update", discordEvent(s.now + 2 * DAY, { name: "Harbor Sessions Live" }));
  const event = await t.run((ctx) => ctx.db.get(s.eventIds[0]));
  assert.deepEqual([event?.title, event?.timezone, event?.startAt], ["Harbor Sessions Live", "America/New_York", s.now + 2 * DAY]);
  assert.deepEqual(await all(t, "eventIntakeDrafts"), []);
});

it("expands a recurring Discord event into one link per night within 60 days", async () => {
  const t = convexTest({ schema, modules });
  const s = await seed(t, []);
  const start = s.now + DAY;
  await importJob(t, s.connectorId, "create", discordEvent(start, { id: OTHER, name: "Harbor Fridays", recurrence_rule: weekly(start) }));
  const links = await all(t, "eventSyncLinks");
  assert.equal(links.length, 9);
  assert.equal(new Set(links.map((link) => link.externalId)).size, 9);
  assert.ok(links.every((link) => link.externalSeriesId === OTHER && link.externalId.startsWith(`${OTHER}:`)));
  assert.equal((await all(t, "eventIntakeDrafts")).length, 9);
});

it("marks a night matched from a series even when nothing differs, so an export never reads it as a Discord event", async () => {
  const t = convexTest({ schema, modules });
  const s = await seed(t, [{}]);
  const start = s.now + 2 * DAY;
  await importJob(t, s.connectorId, "create", discordEvent(start, { id: OTHER, description: EVENT_LINE, recurrence_rule: weekly(start) }));
  assert.equal((await linkOf(t, s.eventIds[0]))?.externalSeriesId, OTHER);
  const links = await all(t, "eventSyncLinks");
  assert.ok(links.every((link) => link.externalSeriesId === OTHER));
  assert.equal((await all(t, "eventIntakeDrafts")).length, links.length - 1);
});

const applyReconcile = (t: ReturnType<typeof convexTest>, connectorId: Id<"eventConnectors">, items: unknown[]) =>
  t.mutation(internal.eventSyncKinds.discordScheduledEvents.applyReconcile, { connectorId, items, receivedAt: Date.now() });
const pendingOf = async (t: ReturnType<typeof convexTest>, kind: Doc<"eventSyncJobs">["kind"]) => (await all(t, "eventSyncJobs")).filter((job) => job.kind === kind && job.state === "pending");

it("reconcile links matching Discord events without creating anything", async (test) => {
  let s!: Awaited<ReturnType<typeof seed>>;
  const calls = fakeDiscord(test, (call) => (call.method === "GET" && call.path === PATH ? Response.json([
    discordEvent(s.now + 2 * DAY, { name: "AFTERGLOW HARBOR SESSIONS" }),
    discordEvent(s.now + 3 * DAY, { id: OTHER, name: "Harbor Sunrise" }),
    discordEvent(s.now - DAY, { id: "555555555555555555", name: "Last Week", status: 2 }),
  ]) : undefined));
  const t = convexTest({ schema, modules });
  s = await seed(t, [{}, { title: "Second Night", sortTitle: "second night", startAt: Date.now() + 5 * DAY }]);
  assert.equal((await runJob(t, { connectorId: s.connectorId, kind: "reconcile" }))?.state, "done");
  assert.deepEqual(said(calls), [`GET ${PATH}`]);
  assert.equal((await linkOf(t, s.eventIds[0]))?.externalId, LIVE);
  const imports = await pendingOf(t, "import_item");
  assert.deepEqual(imports.map((job) => [job.payload.action, job.payload.event.id]), [["create", OTHER]]);
  // The runner queues these before the reconcile links anything, and the upsert's own list-and-match prevents duplicates.
  assert.deepEqual(new Set((await pendingOf(t, "export_upsert")).map((job) => job.eventId)), new Set(s.eventIds));
  assert.deepEqual(await all(t, "eventIntakeDrafts"), []);
});

it("reconcile queues a series once, however many nights are unmatched, and links the matched night", async () => {
  const t = convexTest({ schema, modules });
  const s = await seed(t, [{}]);
  const start = s.now + 2 * DAY;
  const series = discordEvent(start, { id: OTHER, recurrence_rule: weekly(start) });
  assert.deepEqual(await applyReconcile(t, s.connectorId, [series]), { linked: 1, imports: 1 });
  const link = await linkOf(t, s.eventIds[0]);
  assert.deepEqual([link?.externalId, link?.externalSeriesId], [`${OTHER}:${iso(start).slice(0, 10)}`, OTHER]);
  const imports = await pendingOf(t, "import_item");
  assert.equal(imports.length, 1);
  assert.equal(imports[0].payload.externalIds.length, 8);
  assert.ok(!imports[0].payload.externalIds.includes(link?.externalId));
});

for (const connector of [{ direction: "import", mode: "hold" }, { direction: "import", mode: "autopublish" }, { direction: "bidirectional", mode: "hold" }, { direction: "bidirectional", mode: "autopublish" }] as const) {
  it(`an edited linked night keeps its edit after a reconcile imports a sibling night (${connector.direction}, ${connector.mode})`, async () => {
    const t = convexTest({ schema, modules });
    const start = Date.now() + 2 * DAY;
    const night = `${OTHER}:${iso(start).slice(0, 10)}`;
    const s = await seed(t, [{ startAt: start, link: night, title: "Edited in VRDex", sortTitle: "edited in vrdex" }], connector);
    await patchLink(t, s.eventIds[0], { externalSeriesId: OTHER });
    const series = discordEvent(start, { id: OTHER, recurrence_rule: { ...weekly(start), count: 2 } });
    assert.deepEqual(await applyReconcile(t, s.connectorId, [series]), { linked: 0, imports: 1 });
    const [job] = await pendingOf(t, "import_item");
    await t.action(internal.eventSync.runJob, { jobId: job._id });
    assert.deepEqual([(await t.run((ctx) => ctx.db.get(job._id)))?.lastError], [undefined]);

    const event = await t.run((ctx) => ctx.db.get(s.eventIds[0]));
    assert.deepEqual([event?.title, event?.updatedAt], ["Edited in VRDex", 1]);
    const link = await linkOf(t, s.eventIds[0]);
    assert.deepEqual([link?.draftId, link?.lastImportedAt], [undefined, undefined]);
    const sibling = (await all(t, "eventSyncLinks")).filter((row) => row.externalId !== night);
    assert.equal(sibling.length, 1);
    assert.ok(connector.mode === "hold" ? sibling[0].draftId : sibling[0].eventId);
    if (connector.mode === "hold") assert.equal((await all(t, "eventIntakeDrafts")).length, 1);
  });
}

it("a relayed series update still walks every night", async () => {
  const t = convexTest({ schema, modules });
  const start = Date.now() + 2 * DAY;
  const night = `${OTHER}:${iso(start).slice(0, 10)}`;
  const s = await seed(t, [{ startAt: start, link: night, title: "Edited in VRDex", sortTitle: "edited in vrdex" }], { direction: "import" });
  await patchLink(t, s.eventIds[0], { externalSeriesId: OTHER });
  await importJob(t, s.connectorId, "update", discordEvent(start, { id: OTHER, recurrence_rule: { ...weekly(start), count: 2 } }));
  assert.equal((await all(t, "eventIntakeDrafts")).length, 2);
});

it("reconcile leaves linked, finished, foreign, distant, and unreadable items alone", async () => {
  const t = convexTest({ schema, modules });
  const s = await seed(t, [{ link: LIVE, linkState: "external_deleted" }, { startAt: Date.now() + 3 * DAY }, { startAt: Date.now() + 4 * DAY }, { startAt: Date.now() + 91 * DAY }]);
  const summary = await applyReconcile(t, s.connectorId, [
    discordEvent(s.now + 2 * DAY, { description: "Changed." }),
    discordEvent(s.now + 3 * DAY, { id: OTHER, status: 3 }),
    discordEvent(s.now + 4 * DAY, { id: OTHER, status: 4 }),
    discordEvent(s.now + 2 * DAY, { id: OTHER, guild_id: "999999999999999999" }),
    discordEvent(s.now + 91 * DAY, { id: OTHER }),
    { id: "not-a-snowflake" },
  ]);
  assert.deepEqual(summary, { linked: 0, imports: 0 });
  assert.equal((await all(t, "eventSyncLinks")).length, 1);
  assert.deepEqual(await pendingOf(t, "import_item"), []);
  assert.equal((await linkOf(t, s.eventIds[0]))?.state, "external_deleted");
});

it("reconcile takes a one-off near the end of the 90 day window", async () => {
  const t = convexTest({ schema, modules });
  const s = await seed(t, []);
  assert.deepEqual(await applyReconcile(t, s.connectorId, [discordEvent(s.now + 89 * DAY, { id: OTHER })]), { linked: 0, imports: 1 });
});

it("an exporting connector links on reconcile but never imports, and a stopped one does nothing", async () => {
  const t = convexTest({ schema, modules });
  const items = (now: number) => [discordEvent(now + 2 * DAY), discordEvent(now + 3 * DAY, { id: OTHER, name: "Harbor Sunrise" })];
  const exporting = await seed(t, [{}], { direction: "export" });
  assert.deepEqual(await applyReconcile(t, exporting.connectorId, items(exporting.now)), { linked: 1, imports: 0 });
  for (const stopped of [{ direction: "off" }, { state: "paused" }] as const) {
    const s = await seed(t, [{}], stopped);
    assert.deepEqual(await applyReconcile(t, s.connectorId, items(s.now)), { linked: 0, imports: 0 });
  }
});

it("reconcile pauses on a 403, and fails with a short code on a bad list or a disabled flag", async (test) => {
  const responses = [new Response(null, { status: 403 }), Response.json({ message: "nope" }), new Response(null, { status: 500 })];
  const calls = fakeDiscord(test, () => responses.shift());
  const t = convexTest({ schema, modules });
  const run = async () => (await runJob(t, { connectorId: (await seed(t, [])).connectorId, kind: "reconcile" }))?.lastError;
  assert.equal(await run(), "discord_forbidden");
  const [connector] = (await t.run((ctx) => ctx.db.query("eventConnectors").collect()));
  assert.deepEqual([connector.state, connector.lastError], ["paused", "discord_forbidden"]);
  assert.equal(await run(), "discord_bad_response");
  assert.equal(await run(), "discord_500");
  assert.equal(calls.length, 3);
  delete process.env.VRDEX_CONNECTOR_DISCORD_SCHEDULED_EVENTS_ENABLED;
  assert.match(await run() ?? "", /CONNECTOR_KIND_DISABLED/);
  assert.equal(calls.length, 3);
});

it("enqueues one daily reconcile per active connector", async () => {
  const t = convexTest({ schema, modules });
  const s = await seed(t, []);
  await t.run(async (ctx) => {
    const { _id, _creationTime, ...copy } = (await ctx.db.get(s.connectorId))!;
    await ctx.db.insert("eventConnectors", { ...copy, direction: "export", target: { guildId: "999999999999999999" } });
    await ctx.db.insert("eventConnectors", { ...copy, state: "paused" });
    await ctx.db.insert("eventConnectors", { ...copy, direction: "off" });
    await ctx.db.insert("eventConnectors", { ...copy, kind: "discord_board", target: { guildId: GUILD, channelId: "123456789012345678" } });
  });
  assert.equal(await t.mutation(internal.eventSyncKinds.discordScheduledEvents.enqueueReconciles, {}), 2);
  assert.equal(await t.mutation(internal.eventSyncKinds.discordScheduledEvents.enqueueReconciles, {}), 0);
});

it("sees a pending reconcile behind a burst of import jobs, and enqueues nothing with the flag off", async () => {
  const t = convexTest({ schema, modules });
  const s = await seed(t, []);
  const enqueue = () => t.mutation(internal.eventSyncKinds.discordScheduledEvents.enqueueReconciles, {});
  await t.run(async (ctx) => {
    const job = { connectorId: s.connectorId, payload: null, dueAt: 0, attempts: 0, state: "pending", createdAt: 0, updatedAt: 0 } as const;
    for (let index = 0; index < 25; index++) await ctx.db.insert("eventSyncJobs", { ...job, kind: "import_item" });
    await ctx.db.insert("eventSyncJobs", { ...job, kind: "reconcile" });
  });
  assert.equal(await enqueue(), 0);
  await t.run(async (ctx) => { for (const job of await ctx.db.query("eventSyncJobs").collect()) await ctx.db.delete(job._id); });
  delete process.env.VRDEX_CONNECTOR_DISCORD_SCHEDULED_EVENTS_ENABLED;
  assert.equal(await enqueue(), 0);
  assert.deepEqual(await all(t, "eventSyncJobs"), []);
});
