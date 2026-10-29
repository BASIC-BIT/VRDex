import Image from "next/image";
import { BookmarkCheck, Star, TriangleAlert, X } from "lucide-react";
import { InterestButton } from "@/components/ui/interest-button";
import { planSaveState } from "@/lib/timeline/plan-actions";
import type {
  SavedResolution,
  TimelineRange,
  TimelineEvent,
} from "../../../../../../convex/_eventTimelineTypes";
import { packPlan } from "@/lib/timeline/packing";
import { inRange, referenceKey } from "@/lib/timeline/window-cache";
import { scheduleGeometry, timeToX } from "@/lib/timeline/geometry";
import { Button } from "@/components/ui/button";
import { scheduleLabel } from "./timeline-agenda";
import type { TimelineActions } from "./timeline-event-bar";
import styles from "./timeline.module.css";
export function nightLayout(saved: SavedResolution[]) {
  return packPlan({
    items: saved.flatMap((item) => {
      if (item.kind !== "available" || item.status === "cancelled") return [];
      const schedule = item.slot?.schedule ?? item.event.schedule;
      return schedule.kind === "timed"
        ? [{ key: referenceKey(item.reference), schedule }]
        : [];
    }),
  });
}
export function TimelineNight({
  saved,
  range,
  origin,
  onNext,
  records = [],
  slotCoverage = {},
  fallbackOnly = false,
  now,
  ...actions
}: Pick<
  TimelineActions,
  "onSave" | "onSelect" | "plan" | "favoriteProfileIds" | "onFavorite"
> & {
  saved: SavedResolution[];
  range: TimelineRange;
  origin?: number;
  onNext: () => void;
  records?: TimelineEvent[];
  slotCoverage?: Record<string, "partial" | "complete">;
  fallbackOnly?: boolean;
  now: number;
}) {
  const visible = saved.filter((item) => {
    if (item.kind !== "available" || item.status === "cancelled") return false;
    const schedule = item.slot?.schedule ?? item.event.schedule;
    return (
      schedule.kind === "timed" &&
      schedule.endAt > now &&
      inRange({ schedule }, range)
    );
  });
  const lanes = nightLayout(visible);
  const fallback = fallbackOnly
    ? saved.filter((item) => {
        if (!visible.includes(item)) return true;
        if (item.kind !== "available") return true;
        const schedule = item.slot?.schedule ?? item.event.schedule;
        // Narrow authored intervals keep their true width and a full-size removal path.
        return (
          schedule.kind === "timed" &&
          ((schedule.endAt - schedule.startAt) / 3_600_000) * 100 < 72
        );
      })
    : saved;
  if (origin !== undefined && lanes.length === 0) return null;
  if (origin === undefined && fallback.length === 0) return null;
  return (
    <section className={styles.night} aria-label="My night">
      {origin === undefined && !(fallbackOnly && lanes.length > 0) && (
        <div className={styles.nightHeading}>
          <h3>
            <BookmarkCheck size={15} />
            My night
          </h3>
          {visible.length === 0 &&
            saved.some(
              (s) =>
                s.kind === "available" &&
                s.status !== "cancelled" &&
                s.event.schedule.kind !== "date_only",
            ) && (
              <Button size="sm" onClick={onNext}>
                Next saved
              </Button>
            )}
        </div>
      )}
      {origin !== undefined ? (
        <div
          data-testid="night-lanes"
          className={styles.nightLanes}
          style={{
            height: (Math.max(...lanes.map((lane) => lane.lane)) + 1) * 50,
          }}
        >
          <h3 className={styles.nightLabel}>My night</h3>
          {visible.map((item) => {
            if (item.kind !== "available") return null;
            const lane = lanes.find(
              (entry) => entry.key === referenceKey(item.reference),
            );
            const schedule = item.slot?.schedule ?? item.event.schedule;
            const geometry = scheduleGeometry({
              schedule,
              origin,
              pixelsPerHour: 100,
            });
            if (!lane || geometry?.kind !== "bar" || schedule.kind !== "timed")
              return null;
            const loaded = records.find(
              (record) => record.id === item.event.id,
            );
            const slots = item.slot ? [item.slot] : (loaded?.slots ?? []);
            const partial =
              !item.slot &&
              (!loaded || slotCoverage[item.event.id] !== "complete");
            const inset = Math.max(
              0,
              timeToX({ instant: range.startAt, origin, pixelsPerHour: 100 }) +
                (lane.lane === 0 ? 92 : 0) -
                geometry.x,
            );
            const select = () =>
              actions.onSelect({
                eventId: item.event.id,
                slug: item.event.slug,
                ...(item.reference.kind === "set"
                  ? { slotId: item.reference.slotId }
                  : {}),
              });
            return (
              <article
                key={lane.key}
                data-night-reference={lane.key}
                className={styles.nightBar}
                title={`${item.event.title}${item.slot ? `: ${item.slot.displayLabel}` : ""}`}
                style={{
                  left: geometry.x,
                  width: geometry.width,
                  top: lane.lane * 50,
                }}
              >
                <div
                  className={styles.nightHeader}
                  style={{
                    marginLeft: Math.min(
                      inset,
                      Math.max(0, geometry.width - 1),
                    ),
                  }}
                >
                  <button
                    className={styles.nightOpen}
                    aria-label={`Open ${item.event.title}`}
                    onClick={select}
                  >
                    <span
                      className={styles.nightClub}
                      title={
                        item.event.host &&
                        actions.favoriteProfileIds.includes(item.event.host.id)
                          ? `Favorite club: ${item.event.host.displayName}`
                          : undefined
                      }
                    >
                      {item.event.host?.imageUrl ? (
                        <Image
                          src={item.event.host.imageUrl}
                          alt=""
                          width={16}
                          height={16}
                          unoptimized
                        />
                      ) : (
                        <span className={styles.nightLogo} aria-hidden="true">
                          {(
                            item.event.host?.displayName ?? item.event.title
                          ).slice(0, 1)}
                        </span>
                      )}
                      {item.event.host &&
                        actions.favoriteProfileIds.includes(
                          item.event.host.id,
                        ) && (
                          <Star
                            size={9}
                            data-favorite-mark="club"
                            className={styles.gold}
                            aria-label={`Favorite club: ${item.event.host.displayName}`}
                          >
                            <title>{`Favorite club: ${item.event.host.displayName}`}</title>
                          </Star>
                        )}
                    </span>
                    <strong>{item.event.title}</strong>
                    {lane.overlapping && (
                      <TriangleAlert size={12} aria-label="Overlap" />
                    )}
                    {partial && (
                      <span className={styles.partial}>Partial lineup</span>
                    )}
                  </button>
                  <InterestButton
                    label={
                      item.slot
                        ? `${item.slot.displayLabel} at ${item.event.title}`
                        : item.event.title
                    }
                    state={planSaveState(actions.plan, item.reference)}
                    size="compact"
                    className={styles.nightInterest}
                    onToggle={() => {
                      // Removing a focused bar must leave keyboard navigation in the chart.
                      document
                        .querySelector<HTMLElement>(
                          '[aria-label="Timeline chart"]',
                        )
                        ?.focus({ preventScroll: true });
                      actions.onSave(item.reference);
                    }}
                  />
                </div>
                <div className={styles.nightTrack}>
                  {slots.map((slot) => {
                    const interval = scheduleGeometry({
                      schedule: slot.schedule,
                      origin: schedule.startAt,
                      pixelsPerHour: 100,
                    });
                    if (interval?.kind !== "bar") return null;
                    return (
                      <button
                        key={slot.id}
                        data-slot-id={slot.id}
                        className={styles.nightSet}
                        style={{ left: interval.x, width: interval.width }}
                        title={slot.displayLabel}
                        aria-label={`Open ${slot.displayLabel} at ${item.event.title}`}
                        onClick={() =>
                          actions.onSelect({
                            eventId: item.event.id,
                            slug: item.event.slug,
                            slotId: slot.id,
                          })
                        }
                      >
                        {slot.performer &&
                          actions.favoriteProfileIds.includes(
                            slot.performer.id,
                          ) && (
                            <Star
                              size={10}
                              data-favorite-mark="dj"
                              className={styles.gold}
                              aria-label={`Favorite: ${slot.performer.displayName}`}
                            />
                          )}
                        <span>{slot.displayLabel}</span>
                      </button>
                    );
                  })}
                </div>
              </article>
            );
          })}
        </div>
      ) : (
        <div className={styles.savedList}>
          {fallback.map((item) => {
            const key = referenceKey(item.reference);
            const lane = lanes.find((l) => l.key === key);
            return (
              <div key={key}>
                <BookmarkCheck size={13} />
                {item.kind === "unavailable" ? (
                  <span>Unavailable</span>
                ) : (
                  <button
                    onClick={() =>
                      actions.onSelect({
                        eventId: item.event.id,
                        slug: item.event.slug,
                        ...(item.reference.kind === "set"
                          ? { slotId: item.reference.slotId }
                          : {}),
                      })
                    }
                  >
                    {item.slot?.displayLabel ?? item.event.title}
                    <small>
                      {item.status === "cancelled"
                        ? "Cancelled"
                        : scheduleLabel(
                            item.slot?.schedule ?? item.event.schedule,
                            range.timeZone,
                          )}
                    </small>
                  </button>
                )}
                {lane?.overlapping && (
                  <span className={styles.overlap}>
                    <TriangleAlert size={13} />
                    Overlap
                  </span>
                )}
                <button
                  aria-label={`Remove ${item.kind === "unavailable" ? "unavailable item" : (item.slot?.displayLabel ?? item.event.title)} from My night`}
                  onClick={() => actions.onSave(item.reference)}
                >
                  <X size={14} />
                </button>
              </div>
            );
          })}
        </div>
      )}
    </section>
  );
}
