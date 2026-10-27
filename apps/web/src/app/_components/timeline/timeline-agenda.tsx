import { Check, Plus, Star } from "lucide-react";
import type {
  TimelineEvent,
  TimelineSchedule,
} from "../../../../../../convex/_eventTimelineTypes";
import { Button } from "@/components/ui/button";
import { isSaved, type TimelineActions } from "./timeline-event-bar";
import styles from "./timeline.module.css";
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
export function TimelineAgenda({
  records,
  timeZone,
  slotCoverage,
  ...actions
}: TimelineActions & {
  records: TimelineEvent[];
  timeZone: string;
  slotCoverage: Record<string, "partial" | "complete">;
}) {
  return (
    <div className={styles.agenda} aria-label="Schedule agenda">
      {records.map((event) => {
        const ref = { kind: "event" as const, eventId: event.id };
        const saved = isSaved(actions.plan, ref);
        return (
          <article key={event.id}>
            <div className={styles.agendaHeader}>
              <div>
                <button
                  className={styles.agendaTitle}
                  aria-label={`Open ${event.title}`}
                  aria-pressed={actions.selection?.eventId === event.id}
                  onClick={() =>
                    actions.onSelect({ eventId: event.id, slug: event.slug })
                  }
                >
                  {event.title}
                </button>
                <p>{scheduleLabel(event.schedule, timeZone)}</p>
              </div>
              <Button
                size="sm"
                aria-label={`${saved ? "Remove" : "Add"} ${event.title} ${saved ? "from" : "to"} My night`}
                onClick={() => actions.onSave(ref)}
              >
                {saved ? <Check size={14} /> : <Plus size={14} />}
                <span>{saved ? "Remove" : "Add to My night"}</span>
              </Button>
            </div>
            {event.host && (
              <button
                className={styles.agendaFavorite}
                aria-label={`${actions.favoriteProfileIds.includes(event.host.id) ? "Unfavorite" : "Favorite"} ${event.host.displayName}`}
                aria-pressed={actions.favoriteProfileIds.includes(
                  event.host.id,
                )}
                onClick={() => {
                  if (event.host) actions.onFavorite(event.host.id);
                }}
              >
                <Star size={14} />
                {event.host.displayName}
              </button>
            )}
            <ul>
              {event.slots.map((slot) => {
                const reference = {
                  kind: "set" as const,
                  eventId: event.id,
                  slotId: slot.id,
                };
                const included = isSaved(actions.plan, reference);
                return (
                  <li key={slot.id}>
                    <div>
                      <button
                        aria-label={`Open ${slot.displayLabel} at ${event.title}`}
                        onClick={() =>
                          actions.onSelect({
                            eventId: event.id,
                            slug: event.slug,
                            slotId: slot.id,
                          })
                        }
                      >
                        {slot.displayLabel}
                      </button>
                      <small>{scheduleLabel(slot.schedule, timeZone)}</small>
                    </div>
                    <Button
                      size="sm"
                      aria-label={`${included ? "Remove" : "Add"} ${slot.displayLabel} ${included ? "from" : "to"} My night`}
                      onClick={() => actions.onSave(reference)}
                    >
                      {included ? <Check size={14} /> : <Plus size={14} />}
                    </Button>
                  </li>
                );
              })}
            </ul>
            {event.performers.map((person) => (
              <div className={styles.performer} key={person.id}>
                <a href={`/${person.slug}`}>{person.displayName}</a>
                <button
                  aria-label={`${actions.favoriteProfileIds.includes(person.id) ? "Unfavorite" : "Favorite"} ${person.displayName}`}
                  aria-pressed={actions.favoriteProfileIds.includes(person.id)}
                  onClick={() => actions.onFavorite(person.id)}
                >
                  <Star size={14} />
                </button>
              </div>
            ))}
            {slotCoverage[event.id] === "partial" && (
              <small>Loading events</small>
            )}
          </article>
        );
      })}
    </div>
  );
}
