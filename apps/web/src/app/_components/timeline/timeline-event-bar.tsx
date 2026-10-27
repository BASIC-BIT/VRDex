import Image from "next/image";
import { BookmarkCheck, Check, Plus, Star } from "lucide-react";
import type {
  PlanReference,
  TimelineEvent,
} from "../../../../../../convex/_eventTimelineTypes";
import { planSaveState } from "@/lib/timeline/plan-actions";
import { scheduleGeometry } from "@/lib/timeline/geometry";
import type { TimelineSelection } from "./home-schedule";
import styles from "./timeline.module.css";
export type TimelineActions = {
  selection: TimelineSelection | null;
  plan: ReadonlyArray<PlanReference>;
  favoriteProfileIds: ReadonlyArray<string>;
  onSelect: (selection: TimelineSelection) => void;
  onSave: (reference: PlanReference) => void;
  onFavorite: (profileId: string) => void;
};
export function isSaved(
  plan: ReadonlyArray<PlanReference>,
  reference: PlanReference,
) {
  return planSaveState(plan, reference) !== "unsaved";
}
export function TimelineEventBar({
  event,
  origin,
  top,
  ...actions
}: TimelineActions & { event: TimelineEvent; origin: number; top: number }) {
  const geometry = scheduleGeometry({
    schedule: event.schedule,
    origin,
    pixelsPerHour: 100,
  });
  if (geometry?.kind !== "bar") return null;
  const reference: PlanReference = { kind: "event", eventId: event.id };
  const saved = isSaved(actions.plan, reference);
  const selected = actions.selection?.eventId === event.id;
  return (
    <article
      data-testid={`event-${event.id}`}
      className={styles.event}
      data-selected={selected}
      style={{ left: geometry.x, width: geometry.width, top }}
    >
      <div className={styles.eventHeader}>
        <button
          className={styles.eventOpen}
          aria-label={`Open ${event.title}`}
          aria-pressed={selected && !actions.selection?.slotId}
          onClick={() =>
            actions.onSelect({ eventId: event.id, slug: event.slug })
          }
        >
          {event.host?.imageUrl ? (
            <Image
              src={event.host.imageUrl}
              alt=""
              width={30}
              height={30}
              unoptimized
              className={styles.logo}
            />
          ) : (
            <span className={styles.logoFallback} aria-hidden="true">
              {(event.host?.displayName ?? event.title).slice(0, 1)}
            </span>
          )}
          <span className={styles.identity}>
            <strong>{event.title}</strong>
            <small>{event.host?.displayName ?? event.communityName}</small>
          </span>
          {saved && <BookmarkCheck size={14} aria-label="Saved" />}
        </button>
        {event.host && (
          <button
            className={styles.favorite}
            aria-label={`${actions.favoriteProfileIds.includes(event.host.id) ? "Unfavorite" : "Favorite"} ${event.host.displayName}`}
            aria-pressed={actions.favoriteProfileIds.includes(event.host.id)}
            onClick={() => {
              if (event.host) actions.onFavorite(event.host.id);
            }}
          >
            <Star size={13} />
          </button>
        )}
        <button
          className={styles.add}
          aria-label={`${saved ? "Remove" : "Add"} ${event.title} ${saved ? "from" : "to"} My night`}
          onClick={() => actions.onSave(reference)}
        >
          {saved ? <Check size={14} /> : <Plus size={14} />}
        </button>
      </div>
      <div className={styles.setTrack}>
        {event.slots.map((slot) => {
          const g = scheduleGeometry({
            schedule: slot.schedule,
            origin:
              event.schedule.kind === "date_only" ? 0 : event.schedule.startAt,
            pixelsPerHour: 100,
          });
          if (g?.kind !== "bar") return null;
          const ref: PlanReference = {
            kind: "set",
            eventId: event.id,
            slotId: slot.id,
          };
          const setState = planSaveState(actions.plan, ref);
          const included = setState === "included";
          const setSaved = setState !== "unsaved";
          return (
            <div
              className={styles.set}
              key={slot.id}
              style={{ left: g.x, width: g.width }}
              data-favorite={
                slot.performer &&
                actions.favoriteProfileIds.includes(slot.performer.id)
              }
            >
              <button
                aria-label={`Open ${slot.displayLabel} at ${event.title}`}
                aria-pressed={actions.selection?.slotId === slot.id}
                onClick={() =>
                  actions.onSelect({
                    eventId: event.id,
                    slug: event.slug,
                    slotId: slot.id,
                  })
                }
              >
                {slot.performer &&
                  actions.favoriteProfileIds.includes(slot.performer.id) && (
                    <Star size={11} />
                  )}
                <span>{slot.displayLabel}</span>
              </button>
              <button
                className={included ? styles.included : styles.add}
                disabled={included}
                aria-label={
                  included
                    ? `${slot.displayLabel}: Included in ${event.title}`
                    : `${setSaved ? "Remove" : "Add"} ${slot.displayLabel} ${setSaved ? "from" : "to"} My night`
                }
                onClick={() => {
                  if (!included) actions.onSave(ref);
                }}
              >
                {included ? (
                  "Included"
                ) : setSaved ? (
                  <Check size={12} />
                ) : (
                  <Plus size={12} />
                )}
              </button>
            </div>
          );
        })}
      </div>
    </article>
  );
}
