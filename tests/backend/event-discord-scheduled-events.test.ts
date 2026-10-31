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
  "../../convex/eventSyncKinds/discordScheduledEvents.ts": () => import("../../convex/eventSyncKinds/discordScheduledEvents"),
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
