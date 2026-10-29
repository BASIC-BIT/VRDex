"use client";

import Link from "next/link";
import type { Ref } from "react";
import type { DiscoverySnapshot } from "@/lib/discovery/controller";
import { togglePlanAction } from "@/lib/timeline/plan-actions";
import { useHomeBrowse } from "../home-browse-provider";
import { useTimelinePreferences } from "../timeline/use-timeline-preferences";
import { useHomeDiscovery } from "./use-home-discovery";
import {
  DiscoveryEventCard,
  type DiscoveryEventCardProps,
} from "./discovery-event-card";
import {
  DiscoveryClubCard,
  type DiscoveryClubCardProps,
} from "./discovery-club-card";
import styles from "./discovery.module.css";

export type HomeDiscoveryViewProps = Pick<
  DiscoveryEventCardProps,
  "preferences" | "timeZone" | "hour12" | "onSelect" | "onSave"
> &
  Pick<DiscoveryClubCardProps, "onFavorite"> & {
    snapshot: DiscoverySnapshot;
    retry(): void;
    sectionRef?: Ref<HTMLElement>;
  };

/** Static public view also used by Storybook, without storage or live queries. */
export function HomeDiscoveryView({
  snapshot,
  retry,
  sectionRef,
  preferences,
  timeZone,
  hour12,
  onSelect,
  onSave,
  onFavorite,
}: HomeDiscoveryViewProps) {
  return (
    <section
      ref={sectionRef}
      className={styles.discovery}
      aria-labelledby="discover-heading"
    >
      <header className={styles.heading}>
        <h2 id="discover-heading" tabIndex={-1}>
          Discover
        </h2>
        <Link href="/discovery" className={styles.browse}>
          Browse
        </Link>
      </header>
      {snapshot.kind === "loading" ? (
        <p className={styles.status} role="status">
          Loading
        </p>
      ) : snapshot.kind === "error" ? (
        <div className={styles.status} role="status">
          Unavailable{" "}
          <button type="button" onClick={retry}>
            Retry
          </button>
        </div>
      ) : (
        <div className={styles.groups}>
          <div role="group" aria-labelledby="discovery-events-heading">
            <h3 id="discovery-events-heading" className={styles.groupHeading}>
              Events
            </h3>
            <div className={styles.cards}>
              {snapshot.events.map((event) => (
                <DiscoveryEventCard
                  key={event.id}
                  event={event}
                  signal={snapshot.eventSignals.find(
                    (signal) => signal.eventId === event.id,
                  )}
                  preferences={preferences}
                  timeZone={timeZone}
                  hour12={hour12}
                  onSelect={onSelect}
                  onSave={onSave}
                />
              ))}
            </div>
            {snapshot.events.length === 0 &&
              (snapshot.coverage.events.length > 0 &&
              snapshot.coverage.events.every((stream) => stream.complete) ? (
                <p className={styles.status}>No events</p>
              ) : (
                <Link className={styles.browse} href="/discovery">
                  Browse
                </Link>
              ))}
          </div>
          <div role="group" aria-labelledby="discovery-clubs-heading">
            <h3 id="discovery-clubs-heading" className={styles.groupHeading}>
              Clubs
            </h3>
            <div className={styles.cards}>
              {snapshot.clubs.map((club) =>
                club.profileType === "community" ? (
                  <DiscoveryClubCard
                    key={club.id}
                    club={club}
                    preferences={preferences}
                    onFavorite={onFavorite}
                  />
                ) : null,
              )}
            </div>
            {snapshot.clubs.length === 0 &&
              (snapshot.coverage.clubs.length > 0 &&
              snapshot.coverage.clubs.every((stream) => stream.complete) ? (
                <p className={styles.status}>No clubs</p>
              ) : (
                <Link className={styles.browse} href="/discovery">
                  Browse
                </Link>
              ))}
          </div>
        </div>
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
      timeZone={browse.timeZone ?? "UTC"}
      hour12={browse.hour12 ?? false}
      preferences={preference.preferences}
      onSelect={browse.selectEvent}
      onSave={(reference) => {
        const action = togglePlanAction(preference.preferences.plan, reference);
        if (action) browse.onPreferenceAction(action);
      }}
      onFavorite={(profileId) => {
        browse.onPreferenceAction({
          type: preference.preferences.favoriteProfileIds.includes(profileId)
            ? "remove-favorite"
            : "add-favorite",
          profileId,
        });
      }}
    />
  );
}
