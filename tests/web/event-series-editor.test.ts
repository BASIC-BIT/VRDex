import assert from "node:assert/strict";
import { describe, it } from "node:test";

import { changedSeriesFields, seriesCreateArgs, seriesEditorFields, seriesNoteActions, seriesOverrideRows, seriesRepeatAvailable, shiftSeriesTimes, type EditableSeries } from "../../apps/web/src/lib/event-series-editor";

const series: EditableSeries = {
  id: "s1",
  title: "Harbor Night",
  summary: "Weekly",
  timezone: "America/New_York",
  sourceUrl: "https://example.com/a",
  rule: { frequency: "weekly", weekday: 6, startTime: "18:00", doorsTime: "17:30" },
  startsOn: "2026-11-07",
  endsOn: "2027-01-30",
  state: "active",
};

describe("changedSeriesFields", () => {
  it("is empty for an untouched form", () => {
    assert.deepEqual(changedSeriesFields(series, seriesEditorFields(series)), {});
  });

  it("sends only the edited field, and null to clear", () => {
    const fields = seriesEditorFields(series);
    assert.deepEqual(changedSeriesFields(series, { ...fields, summary: "New" }), { summary: "New" });
    assert.deepEqual(changedSeriesFields(series, { ...fields, sourceUrl: "", endsOn: "" }), { sourceUrl: null, endsOn: null });
    assert.deepEqual(changedSeriesFields(series, { ...fields, timezone: "UTC" }), { timezone: "UTC" });
  });

  it("sends the whole rule when any part of it changes", () => {
    const fields = seriesEditorFields(series);
    assert.deepEqual(changedSeriesFields(series, { ...fields, startTime: "19:00" }), {
      rule: { frequency: "weekly", weekday: 6, startTime: "19:00", doorsTime: "17:30" },
    });
    assert.deepEqual(changedSeriesFields(series, { ...fields, doorsTime: "" }), {
      rule: { frequency: "weekly", weekday: 6, startTime: "18:00" },
    });
  });

  it("sends media links and watch settings only when they change", () => {
    const link = { type: "watch" as const, label: "Harbor stream", url: "https://example.com/live", presentation: "open" as const };
    const streamed = { ...series, mediaLinks: [link], watchMode: "performer_sequence" as const, watchSurfaceEnabled: true };
    const fields = seriesEditorFields(streamed);
    assert.equal(fields.mediaLinksText, "watch | Harbor stream | https://example.com/live | open");
    assert.deepEqual(changedSeriesFields(streamed, fields), {});
    assert.deepEqual(changedSeriesFields(streamed, { ...fields, mediaLinksText: "" }), { mediaLinks: [] });
    assert.deepEqual(changedSeriesFields(streamed, { ...fields, mediaLinksText: "discord | Club | https://example.com/d | copy" }), {
      mediaLinks: [{ type: "discord", label: "Club", url: "https://example.com/d", presentation: "copy" }],
    });
    assert.deepEqual(changedSeriesFields(streamed, { ...fields, watchSurfaceEnabled: false }), { watchSurfaceEnabled: false });
    assert.deepEqual(changedSeriesFields(streamed, { ...fields, watchMode: "event_stream" }), { watchMode: "event_stream" });
  });

  it("reads a series with no media or watch settings as the editor defaults", () => {
    const fields = seriesEditorFields(series);
    assert.deepEqual([fields.mediaLinksText, fields.watchMode, fields.watchSurfaceEnabled], ["", "event_stream", false]);
  });

  it("gives a monthly rule the ordinal of its start date and drops it when leaving monthly", () => {
    const toMonthly = changedSeriesFields(series, { ...seriesEditorFields(series), frequency: "monthly_weekday" });
    assert.deepEqual(toMonthly.rule, { frequency: "monthly_weekday", weekday: 6, ordinal: 1, startTime: "18:00", doorsTime: "17:30" });
    const monthly = { ...series, rule: { ...series.rule, frequency: "monthly_weekday" as const, ordinal: -1 as const } };
    assert.deepEqual(changedSeriesFields(monthly, seriesEditorFields(monthly)), {});
    assert.equal(changedSeriesFields(monthly, { ...seriesEditorFields(monthly), startTime: "19:00" }).rule?.ordinal, -1);
    assert.equal("ordinal" in changedSeriesFields(monthly, { ...seriesEditorFields(monthly), frequency: "weekly" }).rule!, false);
  });
});

describe("shiftSeriesTimes", () => {
  const fields = { ...seriesEditorFields(series), startTime: "20:00", doorsTime: "19:30", endTime: "22:00" };

  it("moves doors and end by the same delta as the start", () => {
    const moved = shiftSeriesTimes(fields, "20:00", "18:00");
    assert.deepEqual([moved.startTime, moved.doorsTime, moved.endTime], ["18:00", "17:30", "20:00"]);
  });

  it("wraps past midnight both ways", () => {
    const later = shiftSeriesTimes(fields, "20:00", "23:00");
    assert.deepEqual([later.doorsTime, later.endTime], ["22:30", "01:00"]);
    const earlier = shiftSeriesTimes(fields, "20:00", "00:15");
    assert.deepEqual([earlier.doorsTime, earlier.endTime], ["23:45", "02:15"]);
  });

  it("leaves empty optional times empty", () => {
    const moved = shiftSeriesTimes({ ...fields, doorsTime: "", endTime: "" }, "20:00", "21:00");
    assert.deepEqual([moved.startTime, moved.doorsTime, moved.endTime], ["21:00", "", ""]);
  });

  it("shifts nothing while the start is cleared, and measures from the last real start", () => {
    const cleared = shiftSeriesTimes(fields, "20:00", "");
    assert.deepEqual([cleared.startTime, cleared.doorsTime, cleared.endTime], ["", "19:30", "22:00"]);
    const retyped = shiftSeriesTimes(cleared, "20:00", "21:00");
    assert.deepEqual([retyped.startTime, retyped.doorsTime, retyped.endTime], ["21:00", "20:30", "23:00"]);
  });
});

describe("seriesNoteActions", () => {
  const NOW = 1_000;
  const night = { series, overrides: ["summary"], startAt: NOW + 1 };

  it("offers the series editor and resets on an upcoming night of an active series", () => {
    assert.deepEqual(seriesNoteActions(night, true, NOW), { editSeries: true, overrides: ["summary"] });
  });

  it("offers neither with the flag off", () => {
    assert.deepEqual(seriesNoteActions(night, false, NOW), { editSeries: false, overrides: [] });
  });

  it("offers neither on an ended or removed series", () => {
    for (const state of ["ended", "removed"] as const) {
      assert.deepEqual(seriesNoteActions({ ...night, series: { ...series, state } }, true, NOW), { editSeries: false, overrides: [] });
    }
  });

  it("keeps the series editor but drops resets once the night has started or has no start", () => {
    for (const startAt of [NOW, NOW - 1, undefined]) {
      assert.deepEqual(seriesNoteActions({ ...night, startAt }, true, NOW), { editSeries: true, overrides: [] });
    }
  });
});

describe("seriesCreateArgs", () => {
  const publish = {
    intent: "publish",
    eventSlug: "harbor-night",
    repeat: { frequency: "weekly" as const, endsOn: "" },
    hasSeries: false,
    timeTba: false,
    enabled: true,
  };

  it("creates on publish, with endsOn only when set", () => {
    assert.deepEqual(seriesCreateArgs(publish), { eventSlug: "harbor-night", repeat: { frequency: "weekly" } });
    assert.deepEqual(seriesCreateArgs({ ...publish, repeat: { frequency: "monthly_weekday", endsOn: "2027-01-30" } }), {
      eventSlug: "harbor-night",
      repeat: { frequency: "monthly_weekday", endsOn: "2027-01-30" },
    });
  });

  it("creates nothing for a draft, no repeat, an existing series, a date-only event, or the flag off", () => {
    assert.equal(seriesCreateArgs({ ...publish, intent: "draft" }), null);
    assert.equal(seriesCreateArgs({ ...publish, repeat: { frequency: "none", endsOn: "" } }), null);
    assert.equal(seriesCreateArgs({ ...publish, hasSeries: true }), null);
    assert.equal(seriesCreateArgs({ ...publish, timeTba: true }), null);
    assert.equal(seriesCreateArgs({ ...publish, enabled: false }), null);
  });

  it("shows the control under the same gate", () => {
    assert.equal(seriesRepeatAvailable({ hasSeries: false, timeTba: false, enabled: true }), true);
    assert.equal(seriesRepeatAvailable({ hasSeries: true, timeTba: false, enabled: true }), false);
    assert.equal(seriesRepeatAvailable({ hasSeries: false, timeTba: true, enabled: true }), false);
    assert.equal(seriesRepeatAvailable({ hasSeries: false, timeTba: false, enabled: false }), false);
  });
});

describe("seriesOverrideRows", () => {
  it("names each override by its editor label", () => {
    assert.deepEqual(seriesOverrideRows(["summary", "title", "sourceUrl"]), [
      { label: "Description", fields: ["summary"] },
      { label: "Event title", fields: ["title"] },
      { label: "Announcement link", fields: ["sourceUrl"] },
    ]);
  });

  it("folds the two fields behind Where into one row and skips unknown names", () => {
    assert.deepEqual(seriesOverrideRows(["venueLabel", "worldSlug", "sortTitle"]), [
      { label: "Where", fields: ["venueLabel", "worldSlug"] },
    ]);
  });
});
