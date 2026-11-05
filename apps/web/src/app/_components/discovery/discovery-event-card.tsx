"use client";

import { ArrowRight, Star } from "lucide-react";
import type { MouseEvent } from "react";
import { EntityImage } from "@/components/ui/entity-image";
import { InterestButton } from "@/components/ui/interest-button";
import type { FavoriteLineupResult } from "@/lib/discovery/favorite-lineup";
import type { DiscoverySnapshot } from "@/lib/discovery/controller";
import type { TimelinePreferences } from "@/lib/timeline/preferences";
import type { TimelineActions } from "../timeline/timeline-event-bar";
import type { HomeBrowse } from "../home-browse-provider";
import styles from "./discovery.module.css";

type Available = Extract<DiscoverySnapshot, { kind: "available" }>;
export type DiscoveryEventCardProps = {
  event: Available["events"][number];
  matchingPeople?: FavoriteLineupResult["items"][number]["performers"];
  preferences: TimelinePreferences;
  timeZone: string;
  hour12: boolean;
  onSelect: HomeBrowse["selectEvent"];
  onSave: TimelineActions["onSave"];
};

export function DiscoveryEventCard({
  event,
  matchingPeople,
  preferences,
  timeZone,
  hour12,
  onSelect,
  onSave,
}: DiscoveryEventCardProps) {
  const saved = preferences.plan.some(
    (reference) => reference.kind === "event" && reference.eventId === event.id,
  );
  const schedule = event.schedule;
  const date =
    schedule.kind === "date_only"
      ? schedule.eventDate
      : new Intl.DateTimeFormat(undefined, {
          timeZone,
          weekday: "short",
          month: "short",
          day: "numeric",
          hour: "numeric",
          minute: "2-digit",
          hour12,
        }).format(schedule.startAt);
  const open = (activation: MouseEvent<HTMLAnchorElement>) => {
    if (
      activation.defaultPrevented ||
      activation.button !== 0 ||
      activation.metaKey ||
      activation.ctrlKey ||
      activation.shiftKey ||
      activation.altKey
    )
      return;
    activation.preventDefault();
    onSelect({ eventId: event.id, slug: event.slug }, activation.currentTarget);
  };
  return (
    <article className={styles.card} data-testid="discovery-event-card">
      <div className={styles.artwork}>
        <a
          className={styles.artworkLink}
          href={event.href}
          aria-label={`Open ${event.title}`}
          onClick={open}
        >
          <EntityImage
            className={styles.poster}
            label={event.title}
            alt=""
            src={event.posterImageUrl}
            sizes="(max-width: 760px) 78vw, 23vw"
          />
        </a>
        <InterestButton
          label={event.title}
          state={saved ? "saved" : "unsaved"}
          className={styles.save}
          onToggle={() => onSave({ kind: "event", eventId: event.id })}
        />
      </div>
      <div className={styles.eventMetadata}>
        <h4 className={styles.name}>
          <a href={event.href} onClick={open}>
            {event.title}
          </a>
        </h4>
        <p className={styles.date}>
          {date} ·{" "}
          <a className={styles.host} href={`/${event.host.slug}`}>
            {event.host.displayName}
          </a>
        </p>
        <div className={styles.favoriteSummary}>
          {matchingPeople && matchingPeople.length > 0 && (
            <ul className={styles.performers} aria-label="Favorite people">
              {matchingPeople.map((person) => (
                <li key={person.id}>
                  <a href={`/${person.slug}`} data-favorite="true">
                    <Star size={12} aria-hidden="true" />
                    {person.displayName}
                  </a>
                </li>
              ))}
            </ul>
          )}
        </div>
        <a className={styles.lineup} href={event.href} onClick={open}>
          Full lineup <ArrowRight size={14} aria-hidden="true" />
        </a>
      </div>
    </article>
  );
}
