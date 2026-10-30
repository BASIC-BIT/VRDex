import assert from "node:assert/strict";
import { describe, it } from "node:test";

import { changedSeriesFields, seriesCreateArgs, seriesEditorFields, seriesNoteActions, seriesOverrideRows, seriesRepeatAvailable, type EditableSeries } from "../../apps/web/src/lib/event-series-editor";

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

  it("gives a monthly rule the ordinal of its start date and drops it when leaving monthly", () => {
    const toMonthly = changedSeriesFields(series, { ...seriesEditorFields(series), frequency: "monthly_weekday" });
    assert.deepEqual(toMonthly.rule, { frequency: "monthly_weekday", weekday: 6, ordinal: 1, startTime: "18:00", doorsTime: "17:30" });
    const monthly = { ...series, rule: { ...series.rule, frequency: "monthly_weekday" as const, ordinal: -1 as const } };
    assert.deepEqual(changedSeriesFields(monthly, seriesEditorFields(monthly)), {});
    assert.equal(changedSeriesFields(monthly, { ...seriesEditorFields(monthly), startTime: "19:00" }).rule?.ordinal, -1);
    assert.equal("ordinal" in changedSeriesFields(monthly, { ...seriesEditorFields(monthly), frequency: "weekly" }).rule!, false);
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
