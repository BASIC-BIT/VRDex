"use client";
import type { EventIntakePatch, EventIntakeLocalTime } from "../../../../../packages/api-contracts/src/event-intake";
import { selectEventLocalTime } from "../../../../../packages/api-contracts/src/event-intake";

export function eventLocalDate(date?: string | null, value?: EventIntakeLocalTime | null) {
  const base = date ? Date.parse(`${date}T00:00:00Z`) : NaN;
  return Number.isFinite(base) ? new Date(base + (value?.dayOffset ?? 0) * 86_400_000).toISOString().slice(0, 10) : "";
}

export function EventEditorPreview({ fields, artwork }: { fields: EventIntakePatch; artwork?: string }) {
  function time(local?: EventIntakeLocalTime | null) {
    if (!local || !fields.eventDate || !fields.timezone) return "";
    try { return new Intl.DateTimeFormat(undefined, { month: "short", day: "numeric", hour: "numeric", minute: "2-digit" }).format(selectEventLocalTime(fields.eventDate, local, fields.timezone)); }
    catch { return ""; }
  }
  return <>
    <h2 className="text-lg font-semibold">Event preview</h2>
    {artwork ? <>{/* Private preview stays local to the editor. */}{/* eslint-disable-next-line @next/next/no-img-element */}
      <img src={artwork} alt="Event artwork" className="max-h-80 w-full rounded-control object-contain" /></> : null}
    {fields.title ? <h3 className="break-words text-2xl font-semibold">{fields.title}</h3> : null}
    <div className="grid gap-2 text-sm text-muted">
      {fields.communitySlug ? <p>{fields.communitySlug}</p> : null}
      {fields.eventDate ? <p>{time(fields.start) || eventLocalDate(fields.eventDate, fields.timeTba ? null : fields.start)}{fields.timeTba ? " · Time TBA" : ""}</p> : null}
      {fields.venueLabel ? <p>{fields.venueLabel}</p> : null}
    </div>
    {fields.summary ? <p className="break-words text-sm">{fields.summary}</p> : null}
    {fields.lineup?.length ? <div className="grid gap-3 border-t border-border pt-4"><h3 className="font-medium">Lineup</h3>{fields.lineup.map(row => <div key={row.clientKey} className="text-sm"><p>{row.performerLabel || row.personSlug}</p><p className="text-muted">{time(row.start)}{time(row.end) ? ` – ${time(row.end)}` : ""}</p></div>)}</div> : null}
  </>;
}
