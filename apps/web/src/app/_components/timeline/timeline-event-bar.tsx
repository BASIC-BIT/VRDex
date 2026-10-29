import Image from "next/image";
import { BookmarkCheck, Star } from "lucide-react";
import { FavoriteButton } from "@/components/ui/favorite-button";
import { InterestButton } from "@/components/ui/interest-button";
import type {
  PlanReference,
  TimelineEvent,
} from "../../../../../../convex/_eventTimelineTypes";
import { planSaveState } from "@/lib/timeline/plan-actions";
import { scheduleGeometry, timeToX } from "@/lib/timeline/geometry";
import type { TimelineSelection } from "../home-browse-provider";
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
  visibleStartAt,
  top,
  ...actions
}: TimelineActions & {
  event: TimelineEvent;
  origin: number;
  visibleStartAt: number;
  top: number;
}) {
  const geometry = scheduleGeometry({
    schedule: event.schedule,
    origin,
    pixelsPerHour: 100,
  });
  if (geometry?.kind !== "bar") return null;
  const headerInset = Math.max(
    0,
    Math.min(
      geometry.width,
      timeToX({ instant: visibleStartAt, origin, pixelsPerHour: 100 }) -
        geometry.x,
    ),
  );
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
      <div className={styles.eventHeader} style={{ marginLeft: headerInset }}>
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
          <FavoriteButton
            label={event.host.displayName}
            pressed={actions.favoriteProfileIds.includes(event.host.id)}
            onToggle={() => {
              if (event.host) actions.onFavorite(event.host.id);
            }}
            size="compact"
            className={styles.headerAction}
          />
        )}
        <InterestButton
          label={event.title}
          state={planSaveState(actions.plan, reference)}
          onToggle={() => actions.onSave(reference)}
          size="compact"
          className={styles.headerAction}
        />
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
          // Below 80px the label and two 24px controls cannot share a row.
          // Attach the actions above it, clamped inside the event header.
          const short = g.width < 80;
          const actionsLeft = Math.max(
            -g.x,
            Math.min(0, geometry.width - 4 - g.x - 48),
          );
          const setStyle = {
            left: g.x,
            width: g.width,
            "--set-actions-left": `${actionsLeft}px`,
            "--set-actions-width": slot.performer ? "48px" : "24px",
          };
          return (
            <div
              className={styles.set}
              key={slot.id}
              style={setStyle}
              data-short={short}
              data-favorite={
                slot.performer &&
                actions.favoriteProfileIds.includes(slot.performer.id)
              }
            >
              <button
                className={styles.setOpen}
                title={slot.displayLabel}
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
              {slot.performer && (
                <FavoriteButton
                  label={slot.performer.displayName}
                  pressed={actions.favoriteProfileIds.includes(
                    slot.performer.id,
                  )}
                  onToggle={() => {
                    if (slot.performer) actions.onFavorite(slot.performer.id);
                  }}
                  size="compact"
                  className={styles.setAction}
                />
              )}
              <InterestButton
                label={`${slot.displayLabel} at ${event.title}`}
                state={setState}
                onToggle={() => actions.onSave(ref)}
                size="compact"
                className={styles.setAction}
              />
            </div>
          );
        })}
      </div>
    </article>
  );
}
