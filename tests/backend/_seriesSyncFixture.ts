import type { TestContext } from "node:test";
import type { TestConvex } from "convex-test";
import { internal } from "../../convex/_generated/api";
import type { Doc, Id } from "../../convex/_generated/dataModel";
import type { ConnectorDirection, ConnectorMode } from "../../convex/_eventConnectors";
import type { SeriesSyncFields } from "../../convex/_eventSeriesSync";
import type { DiscordScheduledEvent } from "../../convex/_discordScheduledEventMap";
import type { GoogleCalendarEvent } from "../../convex/_googleCalendar";
import type { ScheduledEventJobPayload } from "../../convex/eventSyncKinds/discordScheduledEvents";
import { seriesModules } from "./_eventSeriesFixture";
import { googleItem, modules, NOW, runSyncJob, schema, seedGoogleConnector, setupEnv, type FetchCall } from "./_googleCalendarFixture";

type T = TestConvex<typeof schema>;

export const SERIES_FIELDS: SeriesSyncFields = {
  title: "Bass Temple", summary: "Weekly bass night.", venueLabel: "The Temple", timezone: "America/New_York",
  rule: { frequency: "weekly", weekday: 6, startTime: "20:00", endTime: "23:00" }, startsOn: "2026-11-07", endsOn: null, count: null,
};
export const GUILD_ID = "123456789012345678";

export const seriesSyncModules = {
  ...modules,
  ...seriesModules,
  "../../convex/eventSyncKinds/discordBoard.ts": () => import("../../convex/eventSyncKinds/discordBoard"),
  "../../convex/eventSyncKinds/discordScheduledEvents.ts": () => import("../../convex/eventSyncKinds/discordScheduledEvents"),
  "../../convex/eventSeriesSync.ts": () => import("../../convex/eventSeriesSync"),
  "../../convex/migrations.ts": () => import("../../convex/migrations"),
};

export function setupSeriesEnv(context: TestContext): void {
  setupEnv(context);
  Object.assign(process.env, {
    VRDEX_RECURRING_EVENTS_ENABLED: "true", VRDEX_CONNECTOR_SERIES_ENABLED: "true",
    VRDEX_CONNECTOR_DISCORD_SCHEDULED_EVENTS_ENABLED: "true", DISCORD_BOT_TOKEN: "bot-token",
  });
}

/** SERIES_FIELDS as an active series with its nights materialised. Series string fields are never null, so the bounds stay unset. */
export async function seedSeries(t: T, communityProfileId: Id<"profiles">, authorityUserId: Id<"users">, overrides: Partial<Doc<"eventSeries">> = {}): Promise<Id<"eventSeries">> {
  const { title, summary, venueLabel, timezone, rule, startsOn } = SERIES_FIELDS;
  const seriesId = await t.run(ctx => ctx.db.insert("eventSeries", {
    communityProfileId, authorityUserId, title, summary: summary!, venueLabel: venueLabel!, timezone, rule, startsOn,
    horizonDays: 60, state: "active", createdAt: NOW, updatedAt: NOW, ...overrides,
  }));
  await t.mutation(internal.eventSeries.materialize, { seriesId });
  return seriesId;
}

/** Materialisation enqueues one job per night; tests that count jobs start from none. */
export async function clearJobs(t: T): Promise<void> {
  await t.run(async ctx => {
    for (const job of await ctx.db.query("eventSyncJobs").collect()) await ctx.db.delete(job._id);
  });
}

export async function seedDiscordConnector(t: T, options: { direction: ConnectorDirection; mode?: ConnectorMode }): ReturnType<typeof seedGoogleConnector> {
  const seeded = await seedGoogleConnector(t, options);
  await t.run(ctx => ctx.db.patch(seeded.connectorId, { kind: "discord_scheduled_events", target: { guildId: GUILD_ID }, credentialId: undefined }));
  return seeded;
}

export const applySeries = (t: T, connectorId: Id<"eventConnectors">, over: Partial<{ externalUpdatedAt: number; deleted: boolean; fields: Partial<SeriesSyncFields> }> = {}) =>
  t.mutation(internal.eventSeriesSync.applyExternalSeries, {
    connectorId, externalSeriesId: "m1", externalUpdatedAt: over.externalUpdatedAt ?? Date.parse("2026-11-02T11:00:00.000Z"),
    deleted: over.deleted ?? false, fields: { ...SERIES_FIELDS, ...over.fields },
  });

export const MASTER = googleItem({ id: "m1", recurrence: ["RRULE:FREQ=WEEKLY;BYDAY=SA"] });

/** One Saturday of MASTER as Google lists it with singleEvents: the ID is the master's plus the original UTC start. */
export function googleInstance(date: string, overrides: Partial<GoogleCalendarEvent> = {}): GoogleCalendarEvent {
  const start = { dateTime: date + "T20:00:00-05:00", timeZone: "America/New_York" };
  return googleItem({
    id: "m1_" + new Date(Date.parse(start.dateTime)).toISOString().replace(/[-:]|\.\d{3}/g, ""), recurringEventId: "m1", originalStartTime: start, start,
    end: { dateTime: date + "T23:00:00-05:00", timeZone: "America/New_York" }, updated: "2026-11-02T11:00:00.000Z", ...overrides,
  });
}

export const importGoogle = (t: T, connectorId: Id<"eventConnectors">, item: GoogleCalendarEvent) =>
  runSyncJob(t, { connectorId, kind: "import_item", payload: { item, calendarTimeZone: "America/New_York" } });

/** Answers GET .../events/m1 with `master` and everything else with 404. */
export const masterFetch = (master: GoogleCalendarEvent) => (request: FetchCall) =>
  request.method === "GET" && request.url.pathname.endsWith("/events/m1") ? Response.json(master) : new Response(null, { status: 404 });

export function discordSeriesEvent(overrides: Partial<DiscordScheduledEvent> = {}): DiscordScheduledEvent {
  return {
    id: "900000000000000001", guild_id: GUILD_ID, name: "Bass Temple", description: "Weekly bass night.",
    scheduled_start_time: "2026-11-08T01:00:00+00:00", scheduled_end_time: "2026-11-08T04:00:00+00:00", entity_type: 3,
    entity_metadata: { location: "The Temple" }, status: 1, privacy_level: 2,
    recurrence_rule: {
      start: "2026-11-08T01:00:00+00:00", end: null, frequency: 2, interval: 1, by_weekday: [5], by_n_weekday: null,
      by_month: null, by_month_day: null, by_year_day: null, count: null,
    },
    ...overrides,
  };
}

/** One relayed gateway packet for the connector, as an import_item job. */
export const importDiscord = (t: T, connectorId: Id<"eventConnectors">, action: ScheduledEventJobPayload["action"], event: DiscordScheduledEvent, extra: Partial<ScheduledEventJobPayload> = {}) =>
  runSyncJob(t, { connectorId, kind: "import_item", payload: { action, event, receivedAt: NOW, ...extra } satisfies ScheduledEventJobPayload });
