"use client";

import { Check, Plus, Star } from "lucide-react";
import type { MouseEvent } from "react";
import { publicSearchGenreLabel } from "@/lib/public-search-genres";
import { EntityImage } from "@/components/ui/entity-image";
import { discoveryEventGenres } from "@/lib/discovery/recommendations";
import type { DiscoverySnapshot } from "@/lib/discovery/controller";
import type { TimelinePreferences } from "@/lib/timeline/preferences";
import type { TimelineActions } from "../timeline/timeline-event-bar";
import type { HomeBrowse } from "../home-browse-provider";
import styles from "./discovery.module.css";

type Available = Extract<DiscoverySnapshot, { kind: "available" }>;
export type DiscoveryEventCardProps = {
  event: Available["events"][number];
  signal: Available["eventSignals"][number] | undefined;
  preferences: TimelinePreferences;
  timeZone: string;
  hour12: boolean;
  onSelect: HomeBrowse["selectEvent"];
  onSave: TimelineActions["onSave"];
};

export function DiscoveryEventCard({
  event,
  signal,
  preferences,
  timeZone,
  hour12,
  onSelect,
  onSave,
}: DiscoveryEventCardProps) {
  const saved = preferences.plan.some(
    (reference) => reference.kind === "event" && reference.eventId === event.id,
  );
  const favoriteIds = new Set(preferences.favoriteProfileIds);
  const performers = [...(signal?.performers ?? [])]
    .sort(
      (left, right) =>
        Number(favoriteIds.has(right.id)) - Number(favoriteIds.has(left.id)),
    )
    .slice(0, 3);
  const attributedGenres = discoveryEventGenres(signal);
  const genres = performers
    .flatMap((performer) =>
      (
        attributedGenres.find((entry) => entry.performer.id === performer.id)
          ?.genres ?? []
      ).map((genre) => ({ performer, genre })),
    )
    .slice(0, 3);
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
            sizes="(max-width: 760px) 45vw, 23vw"
          />
        </a>
        <button
          type="button"
          className={styles.save}
          data-saved={saved}
          aria-label={`${saved ? "Remove" : "Add"} ${event.title} ${saved ? "from" : "to"} My night`}
          aria-pressed={saved}
          onClick={() => onSave({ kind: "event", eventId: event.id })}
        >
          {saved ? (
            <Check size={18} aria-hidden="true" />
          ) : (
            <Plus size={18} aria-hidden="true" />
          )}
        </button>
      </div>
      <p className={styles.date}>{date}</p>
      <h4 className={styles.name}>
        <a href={event.href} onClick={open}>
          {event.title}
        </a>
      </h4>
      <a className={styles.host} href={`/${event.host.slug}`}>
        {event.host.displayName}
      </a>
      {performers.length > 0 && (
        <ul
          className={styles.performers}
          aria-label={genres.length > 0 ? "Lineup genres" : "Lineup"}
        >
          {performers.map((performer) => (
            <li key={performer.id}>
              <a
                href={`/${performer.slug}`}
                data-favorite={favoriteIds.has(performer.id)}
              >
                {favoriteIds.has(performer.id) && (
                  <Star size={11} aria-hidden="true" />
                )}
                {performer.displayName}
              </a>
              {genres.some((entry) => entry.performer.id === performer.id) && (
                <span className={styles.performerGenres}>
                  :{" "}
                  {genres
                    .filter((entry) => entry.performer.id === performer.id)
                    .map((entry) => publicSearchGenreLabel(entry.genre))
                    .join(" · ")}
                </span>
              )}
            </li>
          ))}
        </ul>
      )}
    </article>
  );
}
