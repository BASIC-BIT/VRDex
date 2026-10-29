"use client";

import Link from "next/link";
import { ArrowRight, LoaderCircle } from "lucide-react";
import { useEffect, useState, type Ref, type FocusEventHandler } from "react";
import type { DiscoverySnapshot } from "@/lib/discovery/controller";
import type { FavoriteLineupSnapshot } from "@/lib/discovery/favorite-lineup";
import { togglePlanAction } from "@/lib/timeline/plan-actions";
import { useHomeBrowse } from "../home-browse-provider";
import { useTimelinePreferences } from "../timeline/use-timeline-preferences";
import { useHomeDiscovery } from "./use-home-discovery";
import { useFavoriteLineup } from "./use-favorite-lineup";
import {
  DiscoveryEventCard,
  type DiscoveryEventCardProps,
} from "./discovery-event-card";
import {
  DiscoveryClubCard,
  type DiscoveryClubCardProps,
} from "./discovery-club-card";
import styles from "./discovery.module.css";

type Available = Extract<DiscoverySnapshot, { kind: "available" }>;
export type HomeDiscoveryViewProps = Pick<
  DiscoveryEventCardProps,
  "preferences" | "timeZone" | "hour12" | "onSelect" | "onSave"
> &
  Pick<DiscoveryClubCardProps, "onFavorite"> & {
    snapshot: DiscoverySnapshot;
    retry(): void;
    sectionRef?: Ref<HTMLElement>;
    favoriteLineup?: FavoriteLineupSnapshot;
    liveFavoriteLineup?: boolean;
    onFocusedClubChange?(profileId: string | null): void;
  };

type FocusedCard =
  | { kind: "event"; item: Available["events"][number]; index: number }
  | { kind: "club"; item: Available["clubs"][number]; index: number };
function retainFocused<T extends { id: string }>(
  items: T[],
  focused: { item: T; index: number } | null,
  eligible: readonly string[],
): T[] {
  if (!focused || !eligible.includes(focused.item.id)) return items;
  const current =
    items.find((item) => item.id === focused.item.id) ?? focused.item;
  const result = items.filter((item) => item.id !== current.id);
  result.splice(Math.min(focused.index, result.length), 0, current);
  return result.slice(0, 2);
}
type EventCardsProps = Pick<
  HomeDiscoveryViewProps,
  | "preferences"
  | "timeZone"
  | "hour12"
  | "onSelect"
  | "onSave"
  | "favoriteLineup"
> & {
  events: Available["events"];
  onFocus(item: Available["events"][number], index: number): void;
  onBlur: FocusEventHandler<HTMLDivElement>;
};
function EventCards({
  events,
  favoriteLineup,
  onFocus,
  onBlur,
  ...props
}: EventCardsProps) {
  return (
    <div className={styles.cards}>
      {events.map((event, index) => (
        <div
          key={event.id}
          onFocusCapture={() => onFocus(event, index)}
          onBlurCapture={onBlur}
        >
          <DiscoveryEventCard
            {...props}
            event={event}
            matchingPeople={
              favoriteLineup?.kind === "available"
                ? favoriteLineup.items.find((item) => item.eventId === event.id)
                    ?.performers
                : undefined
            }
          />
        </div>
      ))}
    </div>
  );
}
function LiveEventCards(props: EventCardsProps) {
  const { snapshot, retry } = useFavoriteLineup({
    eventIds: props.events.map((event) => event.id),
    favoriteProfileIds: props.preferences.favoriteProfileIds,
  });
  return (
    <>
      <EventCards {...props} favoriteLineup={snapshot} />
      {snapshot.kind === "error" && (
        <button
          className={styles.lineup}
          type="button"
          onClick={retry}
          aria-label="Retry favorite lineup"
        >
          Retry
        </button>
      )}
    </>
  );
}
function AvailableDiscovery({
  snapshot,
  liveFavoriteLineup,
  onFocusedClubChange,
  ...props
}: HomeDiscoveryViewProps & { snapshot: Available }) {
  const [focused, setFocused] = useState<FocusedCard | null>(null);
  useEffect(() => () => onFocusedClubChange?.(null), [onFocusedClubChange]);
  const events = retainFocused(
    snapshot.events,
    focused?.kind === "event" ? focused : null,
    snapshot.eligibleEventIds,
  );
  const clubs = retainFocused(
    snapshot.clubs,
    focused?.kind === "club" ? focused : null,
    snapshot.eligibleClubIds,
  );
  const onBlur: FocusEventHandler<HTMLDivElement> = (event) => {
    if (!event.currentTarget.contains(event.relatedTarget)) {
      setFocused(null);
      onFocusedClubChange?.(null);
    }
  };
  const Cards = liveFavoriteLineup ? LiveEventCards : EventCards;
  return (
    <div className={styles.groups}>
      <div role="group" aria-labelledby="discovery-events-heading">
        <h3 id="discovery-events-heading" className={styles.groupHeading}>
          Events
        </h3>
        <Cards
          {...props}
          events={events}
          onFocus={(item, index) => {
            setFocused({ kind: "event", item, index });
            onFocusedClubChange?.(null);
          }}
          onBlur={onBlur}
        />
        {events.length === 0 &&
          (snapshot.coverage.events.length > 0 &&
          snapshot.coverage.events.every((stream) => stream.complete) ? (
            <p className={styles.status}>No events</p>
          ) : (
            <Link className={styles.browse} href="/discovery">
              Browse <ArrowRight size={14} aria-hidden="true" />
            </Link>
          ))}
      </div>
      <div role="group" aria-labelledby="discovery-clubs-heading">
        <h3 id="discovery-clubs-heading" className={styles.groupHeading}>
          Clubs
        </h3>
        <div className={styles.cards}>
          {clubs.map((club, index) =>
            club.profileType === "community" ? (
              <div
                key={club.id}
                onFocusCapture={() => {
                  setFocused({ kind: "club", item: club, index });
                  onFocusedClubChange?.(club.id);
                }}
                onBlurCapture={onBlur}
              >
                <DiscoveryClubCard
                  club={club}
                  preferences={props.preferences}
                  onFavorite={props.onFavorite}
                />
              </div>
            ) : null,
          )}
        </div>
        {clubs.length === 0 &&
          (snapshot.coverage.clubs.length > 0 &&
          snapshot.coverage.clubs.every((stream) => stream.complete) ? (
            <p className={styles.status}>No clubs</p>
          ) : (
            <Link className={styles.browse} href="/discovery">
              Browse <ArrowRight size={14} aria-hidden="true" />
            </Link>
          ))}
      </div>
    </div>
  );
}
function DiscoveryFrames() {
  return (
    <div className={styles.groups} aria-hidden="true">
      {["Events", "Clubs"].map((group, index) => (
        <div key={group}>
          <h3 className={styles.groupHeading}>{group}</h3>
          <div className={styles.cards}>
            {[0, 1].map((slot) => (
              <div
                key={slot}
                data-testid="discovery-placeholder"
                className={styles.card}
              >
                <div className={`${styles.artwork} ${styles.skeleton}`} />
                <div
                  className={
                    index === 0 ? styles.eventMetadata : styles.clubMetadata
                  }
                >
                  <span className={styles.skeletonLine} />
                  <span className={styles.skeletonLine} />
                </div>
              </div>
            ))}
          </div>
        </div>
      ))}
    </div>
  );
}

/** Static public view also used by Storybook, without storage or live queries. */
export function HomeDiscoveryView(props: HomeDiscoveryViewProps) {
  const { snapshot, sectionRef, retry } = props;
  const [showLoading, setShowLoading] = useState(false);
  useEffect(() => {
    if (snapshot.kind !== "loading") return;
    const timer = setTimeout(() => setShowLoading(true), 150);
    return () => {
      clearTimeout(timer);
      setShowLoading(false);
    };
  }, [snapshot.kind]);
  return (
    <section
      ref={sectionRef}
      className={styles.discovery}
      aria-labelledby="discover-heading"
      aria-busy={snapshot.kind === "loading"}
    >
      <header className={styles.heading}>
        <h2 id="discover-heading" tabIndex={-1}>
          Discover
        </h2>
        {snapshot.kind === "loading" && showLoading && (
          <span className={styles.loading} role="status">
            <LoaderCircle size={16} aria-hidden="true" />
            Loading
          </span>
        )}
        {snapshot.kind === "error" && (
          <div className={styles.failure} role="status">
            Unavailable{" "}
            <button type="button" onClick={retry}>
              Retry
            </button>
          </div>
        )}
        <Link href="/discovery" className={styles.browse}>
          Browse <ArrowRight size={14} aria-hidden="true" />
        </Link>
      </header>
      {snapshot.kind === "available" ? (
        <AvailableDiscovery {...props} snapshot={snapshot} />
      ) : (
        <DiscoveryFrames />
      )}
    </section>
  );
}

export function HomeDiscovery() {
  const discovery = useHomeDiscovery();
  const browse = useHomeBrowse();
  const preference = useTimelinePreferences();
  return (
    <HomeDiscoveryView
      snapshot={browse.kind === "ready" ? discovery : { kind: "loading" }}
      sectionRef={discovery.sectionRef}
      retry={discovery.retry}
      liveFavoriteLineup
      onFocusedClubChange={discovery.setFocusedClub}
      timeZone={browse.timeZone ?? "UTC"}
      hour12={browse.hour12 ?? false}
      preferences={preference.preferences}
      onSelect={browse.selectEvent}
      onSave={(reference) => {
        const action = togglePlanAction(preference.preferences.plan, reference);
        if (action) browse.onPreferenceAction(action);
      }}
      onFavorite={(profileId) =>
        browse.onPreferenceAction({
          type: preference.preferences.favoriteProfileIds.includes(profileId)
            ? "remove-favorite"
            : "add-favorite",
          profileId,
        })
      }
    />
  );
}
