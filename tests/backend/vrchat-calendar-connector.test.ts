import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { convexTest } from "convex-test";
import schemaModule from "../../convex/schema";
import type { Doc } from "../../convex/_generated/dataModel";
import { carriedFieldsHash } from "../../convex/_eventConnectors";
import { correctionFields } from "../../convex/eventCorrections";
import { exportPayloadFromEvent, fieldsFromVrchatEvent, truncateTitle } from "../../convex/eventSyncKinds/vrchatCalendar";
import { EVENT_URL, SITE, eventDoc, modules, seedEvent, seedVrchatConnector, vrchatItem } from "./_vrchatCalendarFixture";

const schema = (schemaModule as unknown as { default?: typeof schemaModule }).default ?? schemaModule;

describe("vrchat calendar mapping", () => {
  const long = "Bass Temple presents an extremely long night of low frequencies and friends";

  it("truncates titles to 64 characters with an ellipsis", () => {
    assert.equal(truncateTitle("Bass Temple"), "Bass Temple");
    assert.equal(truncateTitle("x".repeat(64)), "x".repeat(64));
    assert.equal(truncateTitle("x".repeat(65)), "x".repeat(63) + "…");
    assert.equal(truncateTitle(long).length, 64);
    // A cut landing inside a surrogate pair drops the whole pair.
    assert.equal(truncateTitle("x".repeat(62) + "🎶🎶"), "x".repeat(62) + "…");
  });

  it("appends world names and the event URL as the last paragraph", () => {
    assert.deepEqual(exportPayloadFromEvent(eventDoc(), { eventUrl: EVENT_URL, worldNames: ["Harbor Club", "Night Market"], artworkUrl: "https://media.vrdex.test/poster.png" }), {
      title: "Bass Temple", description: "Weekly bass night.\n\nHarbor Club, Night Market\n" + EVENT_URL,
      startsAt: "2026-11-08T01:00:00.000Z", endsAt: "2026-11-08T04:00:00.000Z", imageUrl: "https://media.vrdex.test/poster.png", accessType: "group",
    });
    assert.equal(exportPayloadFromEvent(eventDoc({ summary: undefined }), { eventUrl: EVENT_URL, worldNames: [] }).description, EVENT_URL);
    assert.equal(exportPayloadFromEvent(eventDoc({ endAt: undefined }), { eventUrl: EVENT_URL, worldNames: [] }).endsAt, "2026-11-08T05:00:00.000Z");
  });

  it("round-trips a long-titled event with no end to the runner's carried hash", async () => {
    const t = convexTest({ schema, modules });
    const { communityProfileId } = await seedVrchatConnector(t, { connector: false });
    const eventId = await seedEvent(t, communityProfileId, { title: long, endAt: undefined });
    const event = (await t.run((ctx) => ctx.db.get(eventId)))!;
    const out = exportPayloadFromEvent(event, { eventUrl: EVENT_URL, worldNames: ["Harbor Club"] });
    const back = fieldsFromVrchatEvent(vrchatItem({ ...out }), "UTC", SITE, event);
    assert.equal(back.title, long);
    assert.equal(back.end, null);
    const vrdex = await t.run((ctx) => correctionFields(ctx.db, event));
    assert.equal(carriedFieldsHash("vrchat_calendar", back), carriedFieldsHash("vrchat_calendar", vrdex));
  });

  async function roundTrip(overrides: Partial<Doc<"events">>, zone: string) {
    const t = convexTest({ schema, modules });
    const { communityProfileId } = await seedVrchatConnector(t, { connector: false });
    const eventId = await seedEvent(t, communityProfileId, overrides);
    const event = (await t.run((ctx) => ctx.db.get(eventId)))!;
    const back = fieldsFromVrchatEvent(vrchatItem({ ...exportPayloadFromEvent(event, { eventUrl: EVENT_URL, worldNames: ["Harbor Club"] }) }), zone, SITE, event);
    const vrdex = await t.run((ctx) => correctionFields(ctx.db, event));
    assert.equal(carriedFieldsHash("vrchat_calendar", back), carriedFieldsHash("vrchat_calendar", vrdex));
    return back;
  }

  it("reads a timezone-less linked event in UTC, as correctionFields does, under a non-UTC connector", async () => {
    const back = await roundTrip({ timezone: undefined, eventDate: "2026-11-08" }, "America/New_York");
    assert.equal(back.timezone, "UTC");
  });

  it("round-trips a New York event on the fall-back date that ends after local midnight", async () => {
    // Starts in the repeated 01:30 hour (EST, the later one) and ends 00:30 the next local day.
    const startAt = Date.parse("2026-11-01T06:30:00.000Z");
    const back = await roundTrip({ eventDate: "2026-11-01", startAt, sortAt: startAt, endAt: Date.parse("2026-11-02T05:30:00.000Z") }, "America/New_York");
    assert.deepEqual([back.eventDate, back.start, back.end], ["2026-11-01", { time: "01:30", occurrence: "later" }, { time: "00:30", dayOffset: 1 }]);
  });

  it("reads an end that is not after the start, or beyond the schema's day offset, as no end", () => {
    const read = (endsAt: string) => fieldsFromVrchatEvent(vrchatItem({ endsAt }), "UTC", SITE, null).end;
    assert.equal(read("2026-11-08T01:00:00.000Z"), null);
    assert.equal(read("2026-11-07T23:00:00.000Z"), null);
    assert.equal(read("2026-11-16T01:00:00.000Z"), null);
    assert.equal(read("not a date"), null);
    assert.deepEqual(read("2026-11-15T01:00:00.000Z"), { time: "01:00", dayOffset: 7 });
  });

  it("keeps surrogate pairs whole in the summary and accepts a site URL with a trailing slash", () => {
    const summary = (description: string, siteUrl = SITE) => fieldsFromVrchatEvent(vrchatItem({ description }), "UTC", siteUrl, null).summary;
    assert.equal(summary("y".repeat(239) + "🎶"), "y".repeat(239));
    assert.equal(summary("y".repeat(237) + "  🎶"), "y".repeat(237));
    assert.equal(summary("Weekly bass night.\n\n" + EVENT_URL, SITE + "/"), "Weekly bass night.");
  });

  it("reads an unlinked item in the connector zone and strips only the appended paragraph", () => {
    const fields = fieldsFromVrchatEvent(vrchatItem({ description: "Weekly bass night.\n\nHarbor Club\n" + EVENT_URL }), "America/New_York", SITE, null);
    assert.deepEqual([fields.title, fields.eventDate, fields.timezone, fields.start, fields.end, fields.summary],
      ["Bass Temple", "2026-11-07", "America/New_York", { time: "20:00" }, { time: "23:00" }, "Weekly bass night."]);
    const foreign = fieldsFromVrchatEvent(vrchatItem({ description: "Doors at 8.\n\nBring friends." }), "UTC", SITE, null);
    assert.equal(foreign.summary, "Doors at 8.\n\nBring friends.");
    assert.equal(fieldsFromVrchatEvent(vrchatItem({ description: "y".repeat(300) }), "UTC", SITE, null).summary!.length, 240);
  });
});
