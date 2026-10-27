import { BookmarkCheck, TriangleAlert, X } from "lucide-react";
import type {
  SavedResolution,
  TimelineRange,
} from "../../../../../../convex/_eventTimelineTypes";
import { packPlan } from "@/lib/timeline/packing";
import { inRange, referenceKey } from "@/lib/timeline/window-cache";
import { scheduleGeometry } from "@/lib/timeline/geometry";
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
  ...actions
}: Pick<TimelineActions, "onSave" | "onSelect"> & {
  saved: SavedResolution[];
  range: TimelineRange;
  origin?: number;
  onNext: () => void;
}) {
  const lanes = nightLayout(saved);
  const visible = saved.filter(
    (item) =>
      item.kind === "available" &&
      item.status !== "cancelled" &&
      inRange({ schedule: item.slot?.schedule ?? item.event.schedule }, range),
  );
  return (
    <section className={styles.night} aria-label="My night">
      {origin === undefined && (
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
            height: visible.some((s) =>
              lanes.some((l) => l.key === referenceKey(s.reference)),
            )
              ? (Math.max(...lanes.map((l) => l.lane)) + 1) * 42
              : 0,
          }}
        >
          {saved.map((item) => {
            if (item.kind !== "available" || item.status === "cancelled")
              return null;
            const lane = lanes.find(
              (l) => l.key === referenceKey(item.reference),
            );
            if (!lane) return null;
            const geometry = scheduleGeometry({
              schedule: item.slot?.schedule ?? item.event.schedule,
              origin,
              pixelsPerHour: 100,
            });
            if (geometry?.kind !== "bar") return null;
            return (
              <button
                key={lane.key}
                className={styles.nightBar}
                style={{
                  left: geometry.x,
                  width: geometry.width,
                  top: lane.lane * 42,
                }}
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
                <BookmarkCheck size={13} />
                <span>{item.slot?.displayLabel ?? item.event.title}</span>
                {lane.overlapping && (
                  <TriangleAlert size={14} aria-label="Overlap" />
                )}
              </button>
            );
          })}
        </div>
      ) : (
        <div className={styles.savedList}>
          {saved.map((item) => {
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
