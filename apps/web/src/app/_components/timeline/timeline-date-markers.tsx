import type { TimelineEvent, TimelineRange } from "../../../../../../convex/_eventTimelineTypes";
import { InterestButton } from "@/components/ui/interest-button";
import { formatZonedDateTimeInput } from "@/lib/calendar/zoned-date-time";
import { localDayBands, timeToX } from "@/lib/timeline/geometry";
import { planSaveState } from "@/lib/timeline/plan-actions";
import { HOUR, inRange } from "@/lib/timeline/window-cache";
import type { TimelineActions } from "./timeline-event-bar";
import styles from "./timeline.module.css";

/** Calendar-day containers position untimed choices without suggesting an hourly duration. */
export function TimelineDateMarkers({ records, range, origin, ...actions }: TimelineActions & {
  records: TimelineEvent[];
  range: TimelineRange;
  origin: number;
}) {
  const days = localDayBands(range);
  return records.filter((event) => event.schedule.kind !== "timed" && inRange(event, range)).map((event) => {
    const schedule = event.schedule;
    if (schedule.kind === "timed") return null;
    const day = schedule.kind === "date_only"
      ? days.find((day) => formatZonedDateTimeInput(day.startAt, range.timeZone).slice(0, 10) === schedule.eventDate)
      : undefined;
    const startAt = schedule.kind === "open_end" ? schedule.startAt : day?.startAt;
    if (startAt === undefined) return null;
    const reference = { kind: "event" as const, eventId: event.id };
    return (
      <div key={event.id} className={styles.dateMarkerRow}>
        <div className={styles.dateMarkerDay} style={{
          marginLeft: timeToX({ instant: startAt, origin, pixelsPerHour: 100 }),
          width: day ? ((day.endAt - day.startAt) / HOUR) * 100 : "max-content",
        }}>
          <div className={styles.dateMarker} data-testid={`date-marker-${event.id}`}
            data-calendar-date={schedule.kind === "date_only" ? schedule.eventDate : undefined}
            data-start-at={schedule.kind === "open_end" ? schedule.startAt : undefined}>
            <button aria-label={`Open ${event.title}, Time TBA`}
              aria-pressed={actions.selection?.eventId === event.id}
              onClick={() => actions.onSelect({ eventId: event.id, slug: event.slug })}>
              <strong>{event.title}</strong><span>Time TBA</span>
            </button>
            <InterestButton label={event.title} state={planSaveState(actions.plan, reference)} onToggle={() => actions.onSave(reference)} />
          </div>
        </div>
      </div>
    );
  });
}
