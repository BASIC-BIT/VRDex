import type { TestContext } from "node:test";
import type { TestConvex } from "convex-test";
import { internal } from "../../convex/_generated/api";
import type { Doc, Id } from "../../convex/_generated/dataModel";
import type { ConnectorDirection, ConnectorMode } from "../../convex/_eventConnectors";
import type { SeriesSyncFields } from "../../convex/_eventSeriesSync";
import { seriesModules } from "./_eventSeriesFixture";
import { modules, NOW, schema, seedGoogleConnector, setupEnv } from "./_googleCalendarFixture";

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
