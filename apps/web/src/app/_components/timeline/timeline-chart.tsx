"use client";
import { useLayoutEffect, useRef } from "react";
import type {
  SavedResolution,
  TimelineEvent,
  TimelineRange,
} from "../../../../../../convex/_eventTimelineTypes";
import { localDayBands, timeToX } from "@/lib/timeline/geometry";
import { packEvents } from "@/lib/timeline/packing";
import { HOUR, inRange } from "@/lib/timeline/window-cache";
import { TimelineEventBar, type TimelineActions } from "./timeline-event-bar";
import { TimelineAgenda } from "./timeline-agenda";
import { TimelineNight, nightLayout } from "./timeline-night";
import styles from "./timeline.module.css";
export function TimelineChart({
  records,
  saved,
  range,
  now,
  slotCoverage,
  onPan,
  onWidth,
  onNext,
  ...actions
}: TimelineActions & {
  records: TimelineEvent[];
  saved: SavedResolution[];
  range: TimelineRange;
  now: number;
  slotCoverage: Record<string, "partial" | "complete">;
  onPan: (instant: number) => void;
  onWidth: (width: number) => void;
  onNext: () => void;
}) {
  const scroller = useRef<HTMLDivElement>(null);
  const drag = useRef<{ x: number; scroll: number; moved: boolean } | null>(
    null,
  );
  const suppressClick = useRef(false);
  const origin =
    Math.floor(range.startAt / (48 * HOUR)) * 48 * HOUR - 48 * HOUR;
  const canvasRange = {
    startAt: origin,
    endAt: origin + 144 * HOUR,
    timeZone: range.timeZone,
  };
  const lanes = packEvents({ events: records });
  const visibleSaved = saved.filter(
    (s) =>
      s.kind === "available" &&
      s.status !== "cancelled" &&
      inRange({ schedule: s.slot?.schedule ?? s.event.schedule }, range),
  );
  const nightLanes = nightLayout(visibleSaved);
  const nightHeight = nightLanes.length
    ? (Math.max(...nightLanes.map((l) => l.lane)) + 1) * 42
    : 0;
  const height = Math.max(1, ...lanes.map((l) => l.lane + 1)) * 94;
  useLayoutEffect(() => {
    const el = scroller.current;
    if (!el) return;
    const target = timeToX({
      instant: range.startAt,
      origin,
      pixelsPerHour: 100,
    });
    if (Math.abs(el.scrollLeft - target) > 1) el.scrollLeft = target;
  }, [origin, range.startAt]);
  useLayoutEffect(() => {
    const el = scroller.current;
    if (!el) return;
    const observer = new ResizeObserver((entries) => {
      const width = entries[0]?.contentRect.width;
      if (width) onWidth(width);
    });
    observer.observe(el);
    return () => observer.disconnect();
  }, [onWidth]);
  const formatHour = new Intl.DateTimeFormat(undefined, {
    timeZone: range.timeZone,
    hour: "numeric",
  });
  const unknown = records.filter(
    (e) => e.schedule.kind !== "timed" && inRange(e, range),
  );
  return (
    <>
      <div
        ref={scroller}
        className={styles.scroller}
        role="region"
        aria-label="Timeline chart"
        tabIndex={0}
        onScroll={(event) => {
          const anchor = origin + (event.currentTarget.scrollLeft / 100) * HOUR;
          if (Math.abs(anchor - range.startAt) > HOUR / 200) onPan(anchor);
        }}
        onKeyDown={(event) => {
          if (event.target !== event.currentTarget) return;
          if (event.key === "ArrowRight" || event.key === "ArrowLeft") {
            event.preventDefault();
            onPan(range.startAt + (event.key === "ArrowRight" ? 1 : -1) * HOUR);
          }
        }}
        onPointerDown={(event) => {
          suppressClick.current = false;
          if (event.pointerType === "mouse" && event.button === 0)
            drag.current = {
              x: event.clientX,
              scroll: event.currentTarget.scrollLeft,
              moved: false,
            };
        }}
        onPointerMove={(event) => {
          const current = drag.current;
          if (!current) return;
          const delta = event.clientX - current.x;
          if (Math.abs(delta) > 5) {
            current.moved = true;
            event.currentTarget.setPointerCapture(event.pointerId);
            event.currentTarget.scrollLeft = current.scroll - delta;
          }
        }}
        onPointerUp={() => {
          suppressClick.current = drag.current?.moved ?? false;
          drag.current = null;
        }}
        onPointerCancel={() => {
          drag.current = null;
        }}
        onClickCapture={(event) => {
          if (suppressClick.current) {
            event.preventDefault();
            event.stopPropagation();
            suppressClick.current = false;
          }
        }}
      >
        <div className={styles.canvas} style={{ width: 14400 }}>
          <div className={styles.dayAxis}>
            {localDayBands(canvasRange).map((day) => (
              <div
                key={day.startAt}
                style={{
                  left: timeToX({
                    instant: day.startAt,
                    origin,
                    pixelsPerHour: 100,
                  }),
                  width: ((day.endAt - day.startAt) / HOUR) * 100,
                }}
              >
                <span>{day.label}</span>
              </div>
            ))}
          </div>
          <div className={styles.hourAxis}>
            {Array.from({ length: 144 }, (_, i) => (
              <span key={i} style={{ left: i * 100 }}>
                {formatHour.format(origin + i * HOUR)}
              </span>
            ))}
          </div>
          {nightHeight > 0 && (
            <TimelineNight
              saved={visibleSaved}
              range={range}
              origin={origin}
              onNext={onNext}
              onSave={actions.onSave}
              onSelect={actions.onSelect}
            />
          )}
          <div className={styles.lanes} style={{ height }}>
            {lanes.map((lane) => {
              const event = records.find((e) => e.id === lane.eventId);
              return event ? (
                <TimelineEventBar
                  key={event.id}
                  event={event}
                  origin={origin}
                  top={lane.lane * 94 + 8}
                  {...actions}
                />
              ) : null;
            })}
          </div>
          {records.some((e) => e.schedule.kind === "open_end") && (
            <div className={styles.markers}>
              {records
                .filter((e) => e.schedule.kind === "open_end")
                .map((event) =>
                  event.schedule.kind === "open_end" ? (
                    <button
                      className={styles.marker}
                      key={event.id}
                      style={{
                        left: timeToX({
                          instant: event.schedule.startAt,
                          origin,
                          pixelsPerHour: 100,
                        }),
                      }}
                      aria-label={`Open ${event.title}, Time TBA`}
                      onClick={() =>
                        actions.onSelect({
                          eventId: event.id,
                          slug: event.slug,
                        })
                      }
                    >
                      {event.title} · Time TBA
                    </button>
                  ) : null,
                )}
            </div>
          )}
          {now >= origin && now < canvasRange.endAt && (
            <div
              className={styles.now}
              aria-label="Current time"
              style={{
                left: timeToX({ instant: now, origin, pixelsPerHour: 100 }),
                height: height + nightHeight + 34,
              }}
            >
              <span>
                {new Intl.DateTimeFormat(undefined, {
                  timeZone: range.timeZone,
                  hour: "numeric",
                  minute: "2-digit",
                }).format(now)}
              </span>
            </div>
          )}
        </div>
      </div>
      {unknown.length > 0 && (
        <TimelineAgenda
          records={unknown}
          timeZone={range.timeZone}
          slotCoverage={slotCoverage}
          {...actions}
        />
      )}
    </>
  );
}
