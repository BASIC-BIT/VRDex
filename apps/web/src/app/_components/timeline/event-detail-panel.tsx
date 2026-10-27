"use client";
import { useEffect, useEffectEvent, useState } from "react";
import { Button } from "@/components/ui/button";
import type { TimelineSelection } from "./home-schedule";
import { useEventDetail } from "./use-event-detail";
import { useEventRoster } from "./use-event-roster";
import {
  EventDetailContent,
  type DetailPreferenceProps,
} from "./event-detail-content";
import styles from "./event-detail.module.css";
export function EventDetailPanel({
  selection,
  onClose,
  ...preferences
}: {
  selection: TimelineSelection | null;
  onClose(): void;
} & DetailPreferenceProps) {
  const detail = useEventDetail({ slug: selection?.slug ?? null });
  const event = detail.kind === "available" ? detail.event : null;
  const roster = useEventRoster(event, selection?.slotId);
  const [expanded, setExpanded] = useState(false);
  const dismiss = () => {
    setExpanded(false);
    onClose();
  };
  const close = useEffectEvent(dismiss);
  const unavailable =
    detail.kind === "unavailable" ||
    roster.state.kind === "unavailable" ||
    (event !== null && event.id !== selection?.eventId);
  useEffect(() => {
    if (unavailable) close();
  }, [unavailable]);
  useEffect(() => {
    if (!selection) return;
    const escape = (e: KeyboardEvent) => {
      if (e.key === "Escape" && !e.defaultPrevented) {
        e.preventDefault();
        close();
      }
    };
    document.addEventListener("keydown", escape);
    return () => document.removeEventListener("keydown", escape);
  }, [selection]);
  if (!selection || unavailable) return null;
  const rows = roster.state.kind === "available" ? roster.state.rows : [];
  const selected =
    roster.state.kind === "available" &&
    !roster.state.complete &&
    roster.selected &&
    !rows.some((row) => row.key === roster.selected?.key)
      ? roster.selected
      : undefined;
  return (
    <section
      className={styles.panel}
      aria-label="Event details"
      data-expanded={expanded}
    >
      <div className={styles.header}>
        <Button
          className={styles.expand}
          size="sm"
          variant="ghost"
          onClick={() => setExpanded((value) => !value)}
          aria-expanded={expanded}
        >
          {expanded ? "Collapse" : "Expand"}
        </Button>
        <Button size="sm" variant="ghost" onClick={dismiss}>
          Close
        </Button>
      </div>
      <div className={styles.scroll} data-testid="event-detail-scroll">
        {detail.kind === "loading" ? (
          <p role="status" className={styles.notice}>
            Loading events
          </p>
        ) : null}
        {detail.kind === "error" ? (
          <div role="status" className={styles.notice}>
            Events unavailable{" "}
            <Button size="sm" onClick={detail.retry}>
              Retry
            </Button>
          </div>
        ) : null}
        {event &&
        selection.slotId &&
        !rows.some((row) => row.key === selection.slotId) &&
        (roster.selectedRead.kind === "error" ||
          roster.selectedRead.kind === "unavailable") ? (
          <div role="status" className={styles.notice}>
            {roster.selectedRead.kind === "error" ? (
              <>
                Events unavailable{" "}
                <Button
                  size="sm"
                  aria-label="Retry selected set"
                  onClick={() => void roster.retrySelected()}
                >
                  Retry
                </Button>
              </>
            ) : (
              "Unavailable"
            )}
          </div>
        ) : null}
        {event ? (
          <EventDetailContent
            event={event}
            rows={selected ? [selected, ...rows] : rows}
            host={
              roster.state.kind === "available" ? roster.state.host : undefined
            }
            slotId={selection.slotId}
            {...preferences}
          />
        ) : null}
        {event && roster.state.kind === "loading" ? (
          <p role="status" className={styles.notice}>
            Loading events
          </p>
        ) : null}
        {event &&
        (roster.state.kind === "error" ||
          (roster.state.kind === "available" && roster.state.failed)) ? (
          <div role="status" className={styles.notice}>
            Events unavailable{" "}
            <Button size="sm" onClick={() => void roster.retry()}>
              Retry
            </Button>
          </div>
        ) : null}
        {roster.state.kind === "available" &&
        !roster.state.complete &&
        !roster.state.failed ? (
          <div role="status" className={styles.notice}>
            {roster.state.loading ? (
              "Loading events"
            ) : (
              <>
                <Button size="sm" onClick={() => void roster.more()}>
                  More
                </Button>
              </>
            )}
          </div>
        ) : null}
      </div>
    </section>
  );
}
