"use client";

import { FavoriteButton } from "@/components/ui/favorite-button";
import { publicSearchGenreLabel } from "@/lib/public-search-genres";
import { EntityImage } from "@/components/ui/entity-image";
import type { DiscoverySnapshot } from "@/lib/discovery/controller";
import type { TimelinePreferences } from "@/lib/timeline/preferences";
import type { TimelineActions } from "../timeline/timeline-event-bar";
import styles from "./discovery.module.css";

type Available = Extract<DiscoverySnapshot, { kind: "available" }>;
export type DiscoveryClubCardProps = {
  club: Extract<Available["clubs"][number], { profileType: "community" }>;
  preferences: TimelinePreferences;
  onFavorite: TimelineActions["onFavorite"];
};

export function DiscoveryClubCard({
  club,
  preferences,
  onFavorite,
}: DiscoveryClubCardProps) {
  const favorite = preferences.favoriteProfileIds.includes(club.id);
  return (
    <article className={styles.card} data-testid="discovery-club-card">
      <a
        href={`/${club.slug}`}
        className={styles.clubLink}
        aria-label={club.displayName}
      >
        <span className={styles.clubArtwork}>
          {club.bannerImageUrl && (
            <EntityImage
              label={club.displayName}
              alt=""
              src={club.bannerImageUrl}
              className={styles.clubBackdrop}
              fallback={<></>}
              sizes="(max-width: 760px) 78vw, 23vw"
            />
          )}
          <EntityImage
            label={club.displayName}
            alt=""
            src={club.logoImageUrl ?? club.imageUrl}
            className={styles.clubLogo}
            fallback={
              <span
                className={styles.clubTypography}
                style={{
                  fontSize: `clamp(1rem, ${Math.min(12, 70 / Math.sqrt(club.displayName.length))}cqi, 2.7rem)`,
                }}
              >
                {club.displayName}
              </span>
            }
            imageClassName={styles.contained}
            sizes="(max-width: 760px) 78vw, 23vw"
          />
        </span>
      </a>
      <div className={styles.clubMetadata}>
        <div className={styles.clubName}>
          <h4 className={styles.name}>{club.displayName}</h4>
          <FavoriteButton
            label={club.displayName}
            pressed={favorite}
            onToggle={() => onFavorite(club.id)}
            className={styles.favorite}
          />
        </div>
        <div className={styles.clubFooter}>
          {club.genres.length > 0 && (
            <ul
              className={styles.genres}
              aria-label={`${club.displayName} genres`}
            >
              {club.genres.slice(0, 3).map((genre) => (
                <li key={genre.slug}>{publicSearchGenreLabel(genre)}</li>
              ))}
            </ul>
          )}
        </div>
      </div>
    </article>
  );
}
