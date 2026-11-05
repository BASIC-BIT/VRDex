import assert from "node:assert/strict";
import { beforeEach, it, type TestContext } from "node:test";

import { convexTest } from "convex-test";

import { internal } from "../../convex/_generated/api";
import type { Id } from "../../convex/_generated/dataModel";
import schemaModule from "../../convex/schema";
import { ApiEventCreateRequestSchema, ApiEventUpdateRequestSchema } from "../../packages/api-contracts/src/schemas";
import { NOW, occurrences, seedSeriesCommunity, seriesModules } from "./_eventSeriesFixture";

const schema = (schemaModule as unknown as { default?: typeof schemaModule }).default ?? schemaModule;
type T = ReturnType<typeof convexTest>;
type Repeat = { frequency: "weekly" | "biweekly" | "monthly_weekday"; weekday: number; ordinal?: 1 | 2 | 3 | 4 | -1 };

const startAt = Date.parse("2026-11-07T01:00:00Z"); // Friday 2026-11-06 20:00 EST

beforeEach(() => {
  process.env.VRDEX_RECURRING_EVENTS_ENABLED = "true";
  delete process.env.VRDEX_EVENT_CONNECTORS_ENABLED;
});

async function setup(test: TestContext) {
  test.mock.timers.enable({ apis: ["Date"], now: NOW });
  const t = convexTest({ schema, modules: seriesModules });
  const owner = await seedSeriesCommunity(t);
  return { t, owner };
}

function attribution(ownerUserId: Id<"users">) {
  return {
    ownerUserId,
    oauthClientId: "https://client.example/mcp.json",
    oauthTokenId: "oauth-token-id-1",
    requestId: "mcp-request-1",
    idempotencyKeyHash: "a".repeat(64),
    requestFingerprint: "b".repeat(64),
  };
}

function createWithRepeat(t: T, ownerUserId: Id<"users">, repeat: Repeat, timezone: string | null = "America/New_York") {
  return t.mutation(internal.events.createCommunityEventForApiOwner, {
    actorKind: "personal_api_token",
    ownerUserId,
    title: "Harbor Night",
    communitySlug: "faceless",
    startAt,
    ...(timezone === null ? {} : { timezone }),
    repeat,
  });
}

async function eventCount(t: T) {
  return (await t.run((ctx) => ctx.db.query("events").collect())).length;
}

it("API create with repeat creates a series and its occurrences", async (test) => {
  const { t, owner } = await setup(test);
  const result = await createWithRepeat(t, owner.userId, { frequency: "weekly", weekday: 5 });
  assert.ok(result.seriesId);
  assert.equal((await occurrences(t, result.seriesId)).length, 8);
  const first = await t.run((ctx) => ctx.db.get(result.eventId as Id<"events">));
  assert.equal(first!.seriesId, result.seriesId);
});

it("API create without repeat returns no series ID", async (test) => {
  const { t, owner } = await setup(test);
  const result = await t.mutation(internal.events.createCommunityEventForApiOwner, {
    actorKind: "personal_api_token",
    ownerUserId: owner.userId,
    title: "Harbor Night",
    communitySlug: "faceless",
    startAt,
    timezone: "America/New_York",
  });
  assert.equal("seriesId" in result, false);
});

it("API create rejects a weekday that is not the start day, and repeat while disabled", async (test) => {
  const { t, owner } = await setup(test);
  await assert.rejects(createWithRepeat(t, owner.userId, { frequency: "weekly", weekday: 4 }), /Repeat weekday must match/);
  process.env.VRDEX_RECURRING_EVENTS_ENABLED = "false";
  await assert.rejects(createWithRepeat(t, owner.userId, { frequency: "weekly", weekday: 5 }), /Recurring events are not enabled/);
  assert.equal(await eventCount(t), 0);
});

it("API create rejects repeat without a timezone", async (test) => {
  const { t, owner } = await setup(test);
  await assert.rejects(createWithRepeat(t, owner.userId, { frequency: "weekly", weekday: 5 }, null), /Repeat requires a timezone\./);
  assert.equal(await eventCount(t), 0);
});

it("MCP create with repeat returns the series ID and replays it", async (test) => {
  const { t, owner } = await setup(test);
  const args = {
    ...attribution(owner.userId),
    title: "Harbor Night",
    communitySlug: "faceless",
    startAt,
    timezone: "America/New_York",
    repeat: { frequency: "weekly" as const, weekday: 5 },
  };
  const first = await t.mutation(internal.events.createCommunityEventForMcpOwner, args);
  const replay = await t.mutation(internal.events.createCommunityEventForMcpOwner, args);
  assert.ok(first.seriesId);
  assert.equal(replay.seriesId, first.seriesId);
  assert.equal((await t.run((ctx) => ctx.db.query("eventSeries").collect())).length, 1);
});

it("MCP create denies a bad repeat with its own message", async (test) => {
  const { t, owner } = await setup(test);
  await assert.rejects(
    t.mutation(internal.events.createCommunityEventForMcpOwner, {
      ...attribution(owner.userId),
      title: "Harbor Night",
      communitySlug: "faceless",
      startAt,
      timezone: "America/New_York",
      repeat: { frequency: "weekly", weekday: 4 },
    }),
    (error: unknown) => {
      assert.deepEqual((error as { data?: unknown }).data, { code: "MCP_WRITE_DENIED", message: "Repeat weekday must match the event's start day." });
      return true;
    },
  );
  assert.equal(await eventCount(t), 0);
});

it("the create schema accepts repeat and the update schema does not", () => {
  const base = { title: "Harbor Night", communitySlug: "faceless", startAt };
  const created = ApiEventCreateRequestSchema.safeParse({ ...base, repeat: { frequency: "monthly_weekday", weekday: 5, ordinal: -1 } });
  assert.deepEqual(created.data?.repeat, { frequency: "monthly_weekday", weekday: 5, ordinal: -1 });
  assert.equal(ApiEventCreateRequestSchema.safeParse({ ...base, repeat: { frequency: "weekly", weekday: 5, every: 3 } }).success, false);
  // The update schema strips unknown keys rather than rejecting them.
  const updated = ApiEventUpdateRequestSchema.safeParse({ repeat: { frequency: "weekly", weekday: 5 } });
  assert.equal(updated.success, true);
  assert.equal("repeat" in updated.data!, false);
});
