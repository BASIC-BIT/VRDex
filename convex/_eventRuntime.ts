// A runtime window does not create an authored end or a displayed schedule time.
export const UNKNOWN_EVENT_END_WINDOW_MS = 6 * 60 * 60 * 1000;

export function timedEventRuntimeEndAt(event: { startAt: number; endAt?: number | null }): number {
  return event.endAt ?? event.startAt + UNKNOWN_EVENT_END_WINDOW_MS;
}

export function publicScheduleStatus(event: {
  scheduleKind?: "timed" | "date_only";
  startAt?: number;
  endAt?: number;
}, now: number): "now" | "soon" | "later" {
  if (event.scheduleKind === "date_only" || event.startAt === undefined) return "later";
  if (event.startAt <= now && timedEventRuntimeEndAt({ ...event, startAt: event.startAt }) >= now) return "now";
  return event.startAt - now <= 2 * 60 * 60 * 1000 ? "soon" : "later";
}

export function isInScheduledWatchWindow(event: {
  doorsOpenAt?: number;
  endAt?: number;
  now: number | null;
  startAt: number;
}): boolean {
  return event.now !== null && event.now >= (event.doorsOpenAt ?? event.startAt) &&
    event.now <= timedEventRuntimeEndAt(event);
}
