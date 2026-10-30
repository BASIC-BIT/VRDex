import { monthlyOrdinalOf, type SeriesOwnedEventField, type SeriesRule } from "../../../../convex/_eventSeriesModel";
import { parseMediaLinks, serializeMediaLinks, type EventMediaLink } from "./event-media-links";

type WatchMode = "event_stream" | "performer_sequence";

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
  mediaLinks?: EventMediaLink[];
  watchMode?: WatchMode;
  watchSurfaceEnabled?: boolean;
  rule: SeriesRule;
  startsOn: string;
  endsOn?: string;
  count?: number;
  state: "active" | "ended" | "removed";
};

export type RepeatValue = { frequency: "none" | SeriesRule["frequency"]; endsOn: string };

type RepeatGate = { hasSeries: boolean; timeTba: boolean; enabled: boolean };

export function seriesRepeatAvailable({ hasSeries, timeTba, enabled }: RepeatGate): boolean {
  return !hasSeries && !timeTba && enabled;
}

/** The `eventSeries.create` arguments a save calls for, or null when it creates no series. */
export function seriesCreateArgs({ intent, eventSlug, repeat, ...gate }: RepeatGate & { intent: string; eventSlug: string; repeat: RepeatValue }) {
  if (intent !== "publish" || repeat.frequency === "none" || !seriesRepeatAvailable(gate)) return null;
  return { eventSlug, repeat: { frequency: repeat.frequency, ...(repeat.endsOn ? { endsOn: repeat.endsOn } : {}) } };
}

/** Series writes reach upcoming nights only on an active series, and fail outright with the flag off. */
export function seriesEditable(series: Pick<EditableSeries, "state">, enabled: boolean): boolean {
  return series.state === "active" && enabled;
}

/** What the series note can offer on this night. A reset needs a night that has not started. */
export function seriesNoteActions(
  { series, overrides, startAt }: { series: Pick<EditableSeries, "state">; overrides: string[]; startAt?: number },
  enabled: boolean,
  now: number,
): { editSeries: boolean; overrides: string[] } {
  const editSeries = seriesEditable(series, enabled);
  return { editSeries, overrides: editSeries && startAt !== undefined && startAt > now ? overrides : [] };
}

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
  mediaLinksText: string;
  watchMode: WatchMode;
  watchSurfaceEnabled: boolean;
};

export type SeriesEditorChanges = Partial<Record<(typeof CLEARABLE_FIELDS)[number], string | null>> & {
  title?: string;
  timezone?: string;
  rule?: SeriesRule;
  endsOn?: string | null;
  mediaLinks?: EventMediaLink[];
  watchMode?: WatchMode;
  watchSurfaceEnabled?: boolean;
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
    mediaLinksText: serializeMediaLinks(series.mediaLinks ?? []),
    watchMode: series.watchMode ?? "event_stream",
    watchSurfaceEnabled: series.watchSurfaceEnabled ?? false,
  };
}

const DAY_MINUTES = 24 * 60;
const minutesOf = (time: string) => Number(time.slice(0, 2)) * 60 + Number(time.slice(3));

function clockTime(minutes: number): string {
  const wrapped = ((minutes % DAY_MINUTES) + DAY_MINUTES) % DAY_MINUTES;
  return `${String(Math.floor(wrapped / 60)).padStart(2, "0")}:${String(wrapped % 60).padStart(2, "0")}`;
}

/** The form after `Starts` changes: doors and end keep their distance from the start, and empty ones stay empty. */
export function shiftSeriesTimes(fields: SeriesEditorFields, previousStart: string, startTime: string): SeriesEditorFields {
  if (!previousStart || !startTime) return { ...fields, startTime };
  const delta = minutesOf(startTime) - minutesOf(previousStart);
  const shift = (time: string) => time && clockTime(minutesOf(time) + delta);
  return { ...fields, startTime, doorsTime: shift(fields.doorsTime), endTime: shift(fields.endTime) };
}

/** The `eventSeries.update` arguments for this form: only what differs from `series`, with null to clear. */
export function changedSeriesFields(series: EditableSeries, fields: SeriesEditorFields): SeriesEditorChanges {
  const stored = seriesEditorFields(series);
  const changes: SeriesEditorChanges = {};
  if (fields.title !== stored.title) changes.title = fields.title;
  if (fields.timezone !== stored.timezone) changes.timezone = fields.timezone;
  for (const field of CLEARABLE_FIELDS) if (fields[field] !== stored[field]) changes[field] = fields[field] || null;
  if (fields.endsOn !== stored.endsOn) changes.endsOn = fields.endsOn || null;
  if (fields.mediaLinksText !== stored.mediaLinksText) changes.mediaLinks = parseMediaLinks(fields.mediaLinksText);
  if (fields.watchMode !== stored.watchMode) changes.watchMode = fields.watchMode;
  if (fields.watchSurfaceEnabled !== stored.watchSurfaceEnabled) changes.watchSurfaceEnabled = fields.watchSurfaceEnabled;
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
