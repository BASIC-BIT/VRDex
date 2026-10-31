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
