import { monthlyOrdinalOf, type SeriesOwnedEventField, type SeriesRule } from "../../../../convex/_eventSeriesModel";

export type EditableSeries = {
  id: string;
  title: string;
  summary?: string;
  timezone: string;
  venueLabel?: string;
  worldSlug?: string;
  sourceUrl?: string;
  bannerImageUrl?: string;
  thumbnailImageUrl?: string;
  rule: SeriesRule;
  startsOn: string;
  endsOn?: string;
  count?: number;
  state: "active" | "ended" | "removed";
};

/** The editor's own label for each series-owned field. `Where` covers both the world and the free-text venue. */
const SERIES_FIELD_LABELS: Record<SeriesOwnedEventField, string> = {
  title: "Event title",
  summary: "Description",
  timezone: "Time zone",
  venueLabel: "Where",
  worldSlug: "Where",
  mediaLinks: "Media links",
  watchMode: "Watch mode",
  watchSurfaceEnabled: "Promote a watch surface during the event window",
  bannerImageUrl: "Banner image URL",
  thumbnailImageUrl: "Thumbnail image URL",
  sourceUrl: "Announcement link",
  startAt: "Starts",
  doorsOpenAt: "Doors open",
  endAt: "Ends (optional)",
};

/** One row per editor label, so the two fields behind `Where` reset together. */
export function seriesOverrideRows(overrides: string[]): { label: string; fields: string[] }[] {
  const rows = new Map<string, string[]>();
  for (const field of overrides) {
    const label = SERIES_FIELD_LABELS[field as SeriesOwnedEventField];
    if (label !== undefined) rows.set(label, [...(rows.get(label) ?? []), field]);
  }
  return [...rows].map(([label, fields]) => ({ label, fields }));
}

const CLEARABLE_FIELDS = ["summary", "venueLabel", "worldSlug", "sourceUrl", "bannerImageUrl", "thumbnailImageUrl"] as const;

export type SeriesEditorFields = Record<(typeof CLEARABLE_FIELDS)[number], string> & {
  title: string;
  timezone: string;
  frequency: SeriesRule["frequency"];
  startTime: string;
  doorsTime: string;
  endTime: string;
  endsOn: string;
};

export type SeriesEditorChanges = Partial<Record<(typeof CLEARABLE_FIELDS)[number], string | null>> & {
  title?: string;
  timezone?: string;
  rule?: SeriesRule;
  endsOn?: string | null;
};

export function seriesEditorFields(series: EditableSeries): SeriesEditorFields {
  return {
    title: series.title,
    summary: series.summary ?? "",
    venueLabel: series.venueLabel ?? "",
    worldSlug: series.worldSlug ?? "",
    sourceUrl: series.sourceUrl ?? "",
    bannerImageUrl: series.bannerImageUrl ?? "",
    thumbnailImageUrl: series.thumbnailImageUrl ?? "",
    timezone: series.timezone,
    frequency: series.rule.frequency,
    startTime: series.rule.startTime,
    doorsTime: series.rule.doorsTime ?? "",
    endTime: series.rule.endTime ?? "",
    endsOn: series.endsOn ?? "",
  };
}

/** The `eventSeries.update` arguments for this form: only what differs from `series`, with null to clear. */
export function changedSeriesFields(series: EditableSeries, fields: SeriesEditorFields): SeriesEditorChanges {
  const stored = seriesEditorFields(series);
  const changes: SeriesEditorChanges = {};
  if (fields.title !== stored.title) changes.title = fields.title;
  if (fields.timezone !== stored.timezone) changes.timezone = fields.timezone;
  for (const field of CLEARABLE_FIELDS) if (fields[field] !== stored[field]) changes[field] = fields[field] || null;
  if (fields.endsOn !== stored.endsOn) changes.endsOn = fields.endsOn || null;
  if ((["frequency", "startTime", "doorsTime", "endTime"] as const).some(key => fields[key] !== stored[key])) {
    changes.rule = {
      frequency: fields.frequency,
      weekday: series.rule.weekday,
      ...(fields.frequency === "monthly_weekday" ? { ordinal: series.rule.ordinal ?? monthlyOrdinalOf(series.startsOn) } : {}),
      startTime: fields.startTime,
      ...(fields.doorsTime ? { doorsTime: fields.doorsTime } : {}),
      ...(fields.endTime ? { endTime: fields.endTime } : {}),
    };
  }
  return changes;
}
