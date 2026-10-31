import assert from "node:assert/strict";
import { it } from "node:test";
import {
  parseScheduledEvent, scheduledEventCandidateFields, scheduledEventOccurrences, scheduledEventToFields, toScheduledEventBody,
  type DiscordScheduledEvent, type DiscordScheduledEventBody, type ScheduledEventSource,
} from "../../convex/_discordScheduledEventMap";
import { candidateFromConnectorFields } from "../../convex/_eventCandidateApply";
import { carriedFieldsHash, discordScheduledEventsEnabled } from "../../convex/_eventConnectors";
import { eventDateForInstant, eventLocalTime } from "../../convex/_eventSchedule";
import { candidatePatch } from "../../apps/web/src/lib/event-intake-source";

const HOUR = 3_600_000;
const START = Date.UTC(2026, 10, 6, 20, 0); // 15:00 in New York
const URL_LINE = "https://vrdex.test/afterglow-social/events/7m2kp9q";
const source = (overrides: Partial<ScheduledEventSource> = {}) => ({
  title: "Afterglow Harbor Sessions", summary: "Deep house by the water.", venueLabel: "The Lighthouse", worldNames: [],
  startAt: START, endAt: START + 3 * HOUR, timezone: "America/New_York", status: "scheduled" as const, url: URL_LINE, ...overrides,
}) as ScheduledEventSource & { startAt: number };
const inbound = (overrides = {}) => ({
  name: "Afterglow Harbor Sessions", description: `Deep house by the water.\n\n${URL_LINE}`,
  scheduled_start_time: "2026-11-06T20:00:00.000Z", scheduled_end_time: "2026-11-06T23:00:00.000Z",
  entity_metadata: { location: "The Lighthouse" }, ...overrides,
});

it("maps the carried fields to an external scheduled event", () => {
  assert.deepEqual(toScheduledEventBody(source(), "data:image/png;base64,iVBORw=="), {
    name: "Afterglow Harbor Sessions", privacy_level: 2, entity_type: 3, channel_id: null,
    entity_metadata: { location: "The Lighthouse" },
    scheduled_start_time: "2026-11-06T20:00:00.000Z", scheduled_end_time: "2026-11-06T23:00:00.000Z",
    description: `Deep house by the water.\n\n${URL_LINE}`, image: "data:image/png;base64,iVBORw==",
  });
});

it("ends four hours after the start when the event has no end", () => {
  assert.equal(toScheduledEventBody(source({ endAt: undefined })).scheduled_end_time, "2026-11-07T00:00:00.000Z");
});

it("locates the event at the world, else the venue, else the event page", () => {
  const location = (overrides: Partial<ScheduledEventSource>) => toScheduledEventBody(source(overrides)).entity_metadata.location;
  assert.equal(location({ worldNames: ["Harbor Club"] }), "Harbor Club");
  assert.equal(location({ worldNames: ["Harbor Club", "Night Market"] }), "Harbor Club, Night Market");
  assert.equal(location({}), "The Lighthouse");
  assert.equal(location({ venueLabel: undefined }), URL_LINE);
});

it("keeps the URL as the last description line and omits a missing image", () => {
  const body = toScheduledEventBody(source({ summary: undefined }));
  assert.equal(body.description, URL_LINE);
  assert.equal(Object.hasOwn(body, "image"), false);
});

it("clips to Discord's limits", () => {
  const body = toScheduledEventBody(source({ title: "a".repeat(300), summary: "s".repeat(2000), venueLabel: "v".repeat(300) }));
  assert.equal(body.name.length, 100);
  assert.ok(body.name.endsWith("…"));
  assert.equal(body.entity_metadata.location.length, 100);
  assert.ok(body.description.length <= 1000);
  assert.ok(body.description.endsWith(`\n\n${URL_LINE}`));
});

it("never clips through a surrogate pair", () => {
  const name = toScheduledEventBody(source({ title: `${"a".repeat(98)}🎧 tail` })).name;
  assert.equal(name, `${"a".repeat(98)}…`);
});

it("reads Discord times in the linked event's zone and strips its URL line", () => {
  assert.deepEqual(scheduledEventToFields(inbound(), source()), {
    title: "Afterglow Harbor Sessions", eventDate: "2026-11-06", timezone: "America/New_York",
    start: { time: "15:00" }, end: { time: "18:00" }, summary: "Deep house by the water.", venueLabel: "The Lighthouse",
  });
});

it("reads an unlinked Discord event in UTC and keeps its description whole", () => {
  assert.deepEqual(scheduledEventToFields(inbound({ description: "Bring a friend.\n\nhttps://example.test/x", scheduled_end_time: "2026-11-07T01:30:00.000Z" }), null), {
    title: "Afterglow Harbor Sessions", eventDate: "2026-11-06", timezone: "UTC",
    start: { time: "20:00" }, end: { time: "01:30", dayOffset: 1 }, summary: "Bring a friend.\n\nhttps://example.test/x", venueLabel: "The Lighthouse",
  });
});

it("reads a linked description that differs only in whitespace as the event's own summary", () => {
  const description = `Doors at nine.\n\nBring a friend.\n\n${URL_LINE}`;
  for (const summary of ["Doors at nine. Bring a friend.", "Doors at nine.\n\nBring a friend."]) {
    assert.equal(scheduledEventToFields(inbound({ description }), source({ summary })).summary, summary);
  }
  assert.equal(scheduledEventToFields(inbound({ description }), source({ summary: "Doors at ten. Bring a friend." })).summary, "Doors at nine.\n\nBring a friend.");
});

it("a title-only Discord edit keeps VRDex's own venue, end, and full title", () => {
  const linked = source({ title: "T".repeat(120), venueLabel: undefined, worldNames: ["Harbor Club"], endAt: undefined });
  const echoed = toScheduledEventBody(linked);
  assert.deepEqual(scheduledEventToFields(echoed, linked), {
    title: "T".repeat(120), eventDate: "2026-11-06", timezone: "America/New_York",
    start: { time: "15:00" }, end: null, summary: "Deep house by the water.", venueLabel: null,
  });
  const edited = scheduledEventToFields({ ...echoed, name: "Harbor Sessions Live" }, linked);
  assert.equal(edited.title, "Harbor Sessions Live");
  assert.equal(edited.venueLabel, null);
  assert.equal(edited.end, null);
});

it("keeps Discord's own edits and clips a long summary", () => {
  const edited = scheduledEventToFields(inbound({ description: `${"n".repeat(300)}\n\n${URL_LINE}`, entity_metadata: { location: "The Boathouse" } }), source());
  assert.equal(edited.summary, "n".repeat(240));
  assert.equal(edited.venueLabel, "The Boathouse");
  assert.equal(scheduledEventToFields(inbound({ entity_metadata: null, description: null }), source()).summary, null);
});

it("does not invent an end when Discord moves an open-ended event", () => {
  const moved = inbound({ scheduled_start_time: "2026-11-07T20:00:00.000Z", scheduled_end_time: "2026-11-08T00:00:00.000Z" });
  assert.equal(scheduledEventToFields(moved, source({ endAt: undefined })).end, null);
  assert.deepEqual(scheduledEventToFields(moved, null).end, { time: "00:00", dayOffset: 1 });
});

it("builds a connector candidate with every carried field explicit", () => {
  const fields = scheduledEventToFields(inbound({ scheduled_end_time: "2026-11-07T01:30:00.000Z" }), null);
  const candidate = candidateFromConnectorFields("discord_scheduled_events", scheduledEventCandidateFields(fields), { kind: "new" });
  const { title, eventDate, start, end, startDate, endDate, timezone, venueLabel, summary } = candidate.event;
  assert.deepEqual({ title, eventDate, start, end, startDate, endDate, timezone, venueLabel, summary }, {
    title: "Afterglow Harbor Sessions", eventDate: "2026-11-06", start: "20:00", end: "01:30", startDate: "2026-11-06", endDate: "2026-11-07",
    timezone: "UTC", venueLabel: "The Lighthouse", summary: `Deep house by the water.\n\n${URL_LINE}`,
  });
  const explicit = (c: typeof candidate) => c.evidence.filter((e) => e.origin === "connector" && e.assessment === "explicit").map((e) => e.fieldPath).sort();
  assert.deepEqual(explicit(candidate), ["event.end", "event.eventDate", "event.start", "event.summary", "event.timezone", "event.title", "event.venueLabel"]);
  assert.deepEqual([candidate.lineup, candidate.questions, candidate.decision], [[], [], { kind: "new" }]);
  const linked = candidateFromConnectorFields("discord_scheduled_events", scheduledEventCandidateFields(scheduledEventToFields(inbound(), source())), { kind: "update", slug: "7m2kp9q" });
  assert.equal(linked.event.timezone, "America/New_York");
});

it("drops absent fields so a candidate never clears a value", () => {
  const fields = scheduledEventToFields(inbound({ description: null, entity_metadata: null, scheduled_end_time: null }), null);
  assert.deepEqual(Object.keys(scheduledEventCandidateFields(fields)).sort(), ["eventDate", "start", "timezone", "title"]);
});

const KIND = "discord_scheduled_events";
const DISCORD_STYLE = (iso: string) => iso.replace(".000Z", "+00:00");
// Discord stores the body and sends its times back as +00:00 offsets.
const echo = (body: DiscordScheduledEventBody) => ({ ...body, scheduled_start_time: DISCORD_STYLE(body.scheduled_start_time), scheduled_end_time: DISCORD_STYLE(body.scheduled_end_time) });
// What the runner writes: correctionFields' shape for this event, through carriedFieldsHash.
const ownFields = (event: ReturnType<typeof source>) => {
  const timezone = event.timezone ?? "UTC";
  const eventDate = eventDateForInstant(event.startAt, timezone);
  const local = (instant?: number) => instant === undefined ? undefined : eventLocalTime(instant, eventDate, timezone);
  return { communitySlug: "afterglow-social", title: event.title, eventDate, timeTba: false, timezone, start: local(event.startAt), end: local(event.endAt), venueLabel: event.venueLabel, summary: event.summary };
};
// What applyEventCandidate compares against it.
const inboundHash = (item: ReturnType<typeof echo>, linked: ReturnType<typeof source>) => {
  const candidate = candidateFromConnectorFields(KIND, scheduledEventCandidateFields(scheduledEventToFields(item, linked)), { kind: "update", slug: "7m2kp9q" });
  const tentative = candidatePatch(candidate).tentative ?? {};
  return carriedFieldsHash(KIND, { ...tentative, communitySlug: "afterglow-social", timeTba: !tentative.start });
};

it("an unchanged echo hashes the same as the export", () => {
  const events = {
    "plain": source(),
    "worlds, no venue": source({ venueLabel: undefined, worldNames: ["Harbor Club", "Night Market"] }),
    "worlds and a venue": source({ worldNames: ["Harbor Club"] }),
    "no end": source({ endAt: undefined }),
    "past midnight": source({ endAt: START + 8 * HOUR }),
    "no summary, no venue": source({ summary: undefined, venueLabel: undefined }),
    "clipped by Discord": source({ title: "T".repeat(120), venueLabel: "v".repeat(160) }),
    "east of UTC": source({ timezone: "Asia/Tokyo" }),
    "no zone": source({ timezone: undefined }),
  };
  for (const [name, event] of Object.entries(events)) {
    assert.equal(inboundHash(echo(toScheduledEventBody(event)), event), carriedFieldsHash(KIND, ownFields(event)), name);
  }
  const body = echo(toScheduledEventBody(source()));
  assert.notEqual(inboundHash({ ...body, name: "Harbor Sessions Live" }, source()), carriedFieldsHash(KIND, ownFields(source())));
});

it("keeps the fall-back hour's occurrence on the fields, which the candidate cannot carry", () => {
  const later = source({ startAt: Date.UTC(2026, 10, 1, 6, 30), endAt: Date.UTC(2026, 10, 1, 9) }); // 01:30 EST, the repeated hour
  const body = echo(toScheduledEventBody(later));
  assert.equal(carriedFieldsHash(KIND, scheduledEventToFields(body, later)), carriedFieldsHash(KIND, ownFields(later)));
  assert.notEqual(inboundHash(body, later), carriedFieldsHash(KIND, ownFields(later)));
});

const NOW = Date.UTC(2026, 9, 29, 12, 0);
const SERIES = "222222222222222222";
const weekly = (overrides = {}) => ({ start: "2026-10-30T20:00:00.000Z", end: null, frequency: 2 as const, interval: 1, by_weekday: [4], by_n_weekday: null, by_month: null, by_month_day: null, by_year_day: null, count: null, ...overrides });
const series = (rule: DiscordScheduledEvent["recurrence_rule"]): DiscordScheduledEvent => ({
  id: SERIES, guild_id: "876543210987654321", name: "Harbor Fridays", scheduled_start_time: rule!.start,
  scheduled_end_time: new Date(Date.parse(rule!.start) + 3 * HOUR).toISOString(), privacy_level: 2, status: 1, entity_type: 3,
  entity_metadata: { location: "Harbor Club" }, recurrence_rule: rule,
});
const dates = (item: DiscordScheduledEvent, now = NOW) => scheduledEventOccurrences(item, now).map((night) => night.externalId.slice(SERIES.length + 1));

it("expands a weekly series within 60 days, one ID per night", () => {
  const nights = scheduledEventOccurrences(series(weekly()), NOW);
  assert.equal(nights.length, 9);
  assert.deepEqual(nights[0], { externalId: `${SERIES}:2026-10-30`, externalSeriesId: SERIES, startAt: Date.UTC(2026, 9, 30, 20), endAt: Date.UTC(2026, 9, 30, 23) });
  assert.equal(nights.at(-1)?.externalId, `${SERIES}:2026-12-25`);
});

it("skips past nights and honours count, interval, and monthly weekdays", () => {
  assert.equal(dates(series(weekly({ start: "2026-10-02T20:00:00.000Z" })))[0], "2026-10-30");
  assert.deepEqual(dates(series(weekly({ start: "2026-10-02T20:00:00.000Z", count: 6 }))), ["2026-10-30", "2026-11-06"]);
  assert.deepEqual(dates(series(weekly({ interval: 2 }))), ["2026-10-30", "2026-11-13", "2026-11-27", "2026-12-11", "2026-12-25"]);
  assert.deepEqual(dates(series(weekly({ frequency: 1, by_weekday: null, by_n_weekday: [{ n: 2, day: 4 }], start: "2026-11-13T20:00:00.000Z" }))), ["2026-11-13", "2026-12-11"]);
});

it("filters daily rules by weekday and stops after the rule's end", () => {
  const daily = weekly({ frequency: 3, by_weekday: [5, 6], start: "2026-10-30T20:00:00.000Z" });
  assert.deepEqual(dates(series(daily)).slice(0, 3), ["2026-10-31", "2026-11-01", "2026-11-07"]);
  assert.deepEqual(dates(series({ ...daily, end: "2026-11-01T20:00:00.000Z" })), ["2026-10-31", "2026-11-01"]);
  assert.equal(dates(series({ ...daily, by_weekday: null })).length, 59);
});

it("skips months and years without the rule's day", () => {
  const fifthFriday = weekly({ frequency: 1, by_weekday: null, by_n_weekday: [{ n: 5, day: 4 }] });
  assert.deepEqual(dates(series(fifthFriday), Date.UTC(2026, 9, 1)), ["2026-10-30"]);
  const leapDay = weekly({ frequency: 0, by_weekday: null, by_month: [2], by_month_day: [29], start: "2024-02-29T20:00:00.000Z" });
  assert.deepEqual(dates(series(leapDay), Date.UTC(2027, 1, 1)), []);
  assert.deepEqual(dates(series(leapDay), Date.UTC(2028, 1, 1)), ["2028-02-29"]);
  assert.deepEqual(dates(series({ ...leapDay, interval: 3 }), Date.UTC(2028, 1, 1)), []);
});

it("passes a one-off event through as itself", () => {
  assert.deepEqual(scheduledEventOccurrences({ ...series(weekly()), recurrence_rule: null, scheduled_start_time: "2026-11-06T20:00:00.000Z", scheduled_end_time: null }, NOW),
    [{ externalId: SERIES, startAt: START, endAt: null }]);
});

const raw = (overrides = {}) => ({
  id: SERIES, guild_id: "876543210987654321", name: "Harbor Fridays", description: null, scheduled_start_time: "2026-11-06T20:00:00+00:00",
  scheduled_end_time: "2026-11-06T23:00:00+00:00", privacy_level: 2, status: 1, entity_type: 3, entity_metadata: { location: "Harbor Club" }, recurrence_rule: null, ...overrides,
});

it("accepts a Discord payload and fills what it leaves out", () => {
  assert.equal(parseScheduledEvent(raw())?.id, SERIES);
  assert.equal(parseScheduledEvent(raw({ recurrence_rule: weekly() }))?.recurrence_rule?.interval, 1);
  const { description: _description, scheduled_end_time: _end, entity_metadata: _metadata, recurrence_rule: _rule, ...sparse } = raw();
  const parsed = parseScheduledEvent(sparse);
  assert.deepEqual([parsed?.description, parsed?.scheduled_end_time, parsed?.entity_metadata, parsed?.recurrence_rule], [null, null, null, null]);
  const wrong = parseScheduledEvent(raw({ description: 5, scheduled_end_time: "soon", entity_metadata: { location: 5 } }));
  assert.deepEqual([wrong?.name, wrong?.description, wrong?.scheduled_end_time, wrong?.entity_metadata], ["Harbor Fridays", null, null, null]);
});

it("reads the flag only as an exact true", () => {
  const before = process.env.VRDEX_CONNECTOR_DISCORD_SCHEDULED_EVENTS_ENABLED;
  try {
    for (const [value, enabled] of [[undefined, false], ["1", false], ["true", true]] as const) {
      if (value === undefined) delete process.env.VRDEX_CONNECTOR_DISCORD_SCHEDULED_EVENTS_ENABLED;
      else process.env.VRDEX_CONNECTOR_DISCORD_SCHEDULED_EVENTS_ENABLED = value;
      assert.equal(discordScheduledEventsEnabled(), enabled);
    }
  } finally {
    if (before === undefined) delete process.env.VRDEX_CONNECTOR_DISCORD_SCHEDULED_EVENTS_ENABLED;
    else process.env.VRDEX_CONNECTOR_DISCORD_SCHEDULED_EVENTS_ENABLED = before;
  }
});

it("rejects anything that is not a scheduled event", () => {
  for (const value of [null, "event", [], raw({ id: "12" }), raw({ guild_id: undefined }), raw({ name: 5 }), raw({ scheduled_start_time: "soon" }), raw({ status: 5 }), raw({ status: 0 })]) {
    assert.equal(parseScheduledEvent(value), null);
  }
});

it("rejects a recurrence rule the stepper cannot trust", () => {
  for (const rule of [{ interval: 0 }, { interval: 1.5 }, { interval: undefined }, { frequency: 4 }, { frequency: "2" }, { start: "soon" }]) {
    assert.equal(parseScheduledEvent(raw({ recurrence_rule: weekly(rule) })), null);
  }
  assert.equal(parseScheduledEvent(raw({ recurrence_rule: "weekly" })), null);
});
