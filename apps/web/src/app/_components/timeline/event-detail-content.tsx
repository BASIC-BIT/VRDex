"use client";
import Image from "next/image";
import { useEffect, useRef } from "react";
import { Button, buttonVariants } from "@/components/ui/button";
import { safeImageUrl } from "@/lib/safe-image";
import { publicEventPath } from "@/lib/event-path";
import { planSaveState, togglePlanAction } from "@/lib/timeline/plan-actions";
import type {
  TimelinePreferences,
  PreferenceAction,
} from "@/lib/timeline/preferences";
import type { CanonicalEvent } from "@/lib/timeline/event-detail";
import type {
  PlanReference,
  TimelineDetailRow,
  TimelineEventIdentity,
} from "../../../../../../convex/_eventTimelineTypes";
import {
  ViewerLocalEventDateTime,
  ViewerLocalEventTimeRange,
} from "../viewer-local-event-times";
import styles from "./event-detail.module.css";
export type DetailPreferenceProps = {
  preferences: TimelinePreferences;
  onPreferenceAction(action: PreferenceAction): void;
};
function Save({
  reference,
  label,
  preferences,
  onPreferenceAction,
  eventTitle,
}: {
  reference: PlanReference;
  label: string;
  eventTitle: string;
} & DetailPreferenceProps) {
  const state = planSaveState(preferences.plan, reference);
  return (
    <Button
      size="sm"
      variant="secondary"
      disabled={state === "included"}
      aria-label={
        state === "included"
          ? `${label}: Included in ${eventTitle}`
          : state === "saved"
            ? `Remove ${label} from My night`
            : `Add ${label} to My night`
      }
      onClick={() => {
        const action = togglePlanAction(preferences.plan, reference);
        if (action) onPreferenceAction(action);
      }}
    >
      {state === "included"
        ? "Included"
        : state === "saved"
          ? "Remove from My night"
          : "Add to My night"}
    </Button>
  );
}
function Favorite({
  person,
  preferences,
  onPreferenceAction,
}: {
  person: NonNullable<TimelineDetailRow["performer"]>;
} & DetailPreferenceProps) {
  const saved = preferences.favoriteProfileIds.includes(person.id);
  return (
    <Button
      size="sm"
      variant="ghost"
      aria-label={`${saved ? "Unfavorite" : "Favorite"} ${person.displayName}`}
      aria-pressed={saved}
      onClick={() =>
        onPreferenceAction({
          type: saved ? "remove-favorite" : "add-favorite",
          profileId: person.id,
        })
      }
    >
      {saved ? "Unfavorite" : "Favorite"}
    </Button>
  );
}
export function EventDetailContent({
  event,
  rows,
  host,
  slotId,
  timeZone,
  ...preferences
}: {
  event: CanonicalEvent;
  rows: ReadonlyArray<TimelineDetailRow>;
  host?: TimelineEventIdentity["host"];
  slotId?: string;
  timeZone: string;
} & DetailPreferenceProps) {
  const selected = useRef<HTMLLIElement | null>(null);
  const selectedIndex = rows.findIndex((row) => row.key === slotId);
  const selectedKey = rows[selectedIndex]?.key;
  useEffect(() => {
    const row = selected.current,
      scroll = row?.closest<HTMLElement>('[data-testid="event-detail-scroll"]');
    if (!row || !scroll) return;
    // Only scroll the panel; scrollIntoView would also move the page/chart.
    scroll.scrollTop +=
      row.getBoundingClientRect().top - scroll.getBoundingClientRect().top - 12;
  }, [selectedKey, selectedIndex, slotId]);
  const poster = safeImageUrl(event.posterImageUrl);
  const href = publicEventPath(event);
  return (
    <>
      {poster ? (
        <div className={styles.poster}>
          <Image
            unoptimized
            src={poster}
            alt={`${event.title} poster`}
            width={800}
            height={1000}
          />
        </div>
      ) : null}
      <div className={styles.content}>
        <h3>{event.title}</h3>
        {event.status === "cancelled" ? <span>Cancelled</span> : null}
        <div className={styles.identity}>
          {event.communitySlug ? (
            <a href={`/${event.communitySlug}`}>{event.communityName}</a>
          ) : (
            event.communityName
          )}
          {host ? <Favorite person={host} {...preferences} /> : null}
        </div>
        <p className={styles.time}>
          <ViewerLocalEventDateTime
            timeZone={timeZone}
            timestamp={event.startAt}
            eventDate={event.eventDate}
            scheduleKind={event.scheduleKind}
          />
          {event.endAt !== undefined ? (
            <>
              {" "}
              - <ViewerLocalEventDateTime timestamp={event.endAt} timeZone={timeZone} />
            </>
          ) : event.scheduleKind !== "date_only" ? (
            " · Time TBA"
          ) : null}
        </p>
        {event.venueLabel ? <p>{event.venueLabel}</p> : null}
        {event.worlds.map((world) => (
          <a key={world.slug} href={`/${world.slug}`}>
            {world.displayName}
          </a>
        ))}
        {event.summary ? (
          <p className={styles.description}>{event.summary}</p>
        ) : null}
        <div className={styles.actions}>
          <Save
            reference={{ kind: "event", eventId: event.id }}
            label={event.title}
            eventTitle={event.title}
            {...preferences}
          />
          {href ? (
            <a
              href={href}
              className={buttonVariants({ size: "sm", variant: "secondary" })}
            >
              Open event
            </a>
          ) : null}
        </div>
        {rows.length > 0 ? (
          <ol className={styles.lineup} aria-label="Lineup">
            {rows.map((row) => (
              <li
                key={row.key}
                ref={row.key === slotId ? selected : undefined}
                data-selected={row.key === slotId}
                data-slot-id={row.kind === "slot" ? row.key : undefined}
              >
                <div className={styles.rowIdentity}>
                  {row.performer ? (
                    <a href={`/${row.performer.slug}`}>{row.displayLabel}</a>
                  ) : (
                    <span>{row.displayLabel}</span>
                  )}
                  {row.roleLabel ? (
                    <span className={styles.meta}>{row.roleLabel}</span>
                  ) : null}
                  {row.startAt !== undefined ? (
                    <ViewerLocalEventTimeRange
                      timeZone={timeZone}
                      showOffset
                      startAt={row.startAt}
                      endAt={row.endAt}
                      className={styles.meta}
                    />
                  ) : null}
                </div>
                <div className={styles.actions}>
                  {row.performer ? (
                    <Favorite person={row.performer} {...preferences} />
                  ) : null}
                  {row.kind === "slot" ? (
                    <Save
                      reference={{
                        kind: "set",
                        eventId: event.id,
                        slotId: row.key,
                      }}
                      label={row.displayLabel}
                      eventTitle={event.title}
                      {...preferences}
                    />
                  ) : null}
                </div>
              </li>
            ))}
          </ol>
        ) : null}
      </div>
    </>
  );
}
