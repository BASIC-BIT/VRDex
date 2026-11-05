import type { TimelineSchedule } from "../../../../../convex/_eventTimelineTypes";

export function scheduleLabel(schedule: TimelineSchedule, timeZone: string) {
  if (schedule.kind === "date_only") return `${schedule.eventDate} · Time TBA`;
  const format = new Intl.DateTimeFormat(undefined, {
    timeZone,
    month: "short",
    day: "numeric",
    hour: "numeric",
    minute: "2-digit",
    timeZoneName: "shortOffset",
  });
  return schedule.kind === "open_end"
    ? `${format.format(schedule.startAt)} · Time TBA`
    : `${format.format(schedule.startAt)} – ${format.format(schedule.endAt)}`;
}
