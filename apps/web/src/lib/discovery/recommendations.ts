import type { DiscoveryEventCandidate, DiscoveryEventSignal, DiscoveryProfileSignal } from "../../../../../convex/_homeDiscoveryTypes";
import { discoveryRotationScore } from "./rotation";

type Genre = DiscoveryProfileSignal["genres"][number];
export type DiscoveryPerformerGenres = {
  performer: Pick<DiscoveryProfileSignal, "id" | "slug" | "displayName">;
  genres: Genre[];
};

function uniqueById<T extends { id: string }>(items: readonly T[]): T[] {
  return [...new Map(items.map((item) => [item.id, item])).values()];
}

function uniqueGenres(genres: readonly Genre[]): Genre[] {
  return [...new Map(genres.map((genre) => [genre.slug, genre])).values()];
}

/** Public assignment provenance for cards, never event-authored genre metadata. */
export function discoveryEventGenres(signal: DiscoveryEventSignal | undefined): DiscoveryPerformerGenres[] {
  return uniqueById(signal?.performers ?? []).map(({ id, slug, displayName, genres }) => ({
    performer: { id, slug, displayName },
    genres: uniqueGenres(genres),
  }));
}

type Familiarity = "familiar" | "unfamiliar" | "unknown";
type Ranked<T> = { item: T; familiarity: Familiarity; affinity: number; favoriteDjs: number; favoriteHost: number; hostId?: string; tie: number };

function semanticOrder<T>(left: Ranked<T>, right: Ranked<T>): number {
  return right.affinity - left.affinity || left.tie - right.tie;
}

function familiarOrder<T>(left: Ranked<T>, right: Ranked<T>): number {
  return right.favoriteDjs - left.favoriteDjs || right.favoriteHost - left.favoriteHost || semanticOrder(left, right);
}

function blend<T extends { id: string }>(candidates: Ranked<T>[]): T[] {
  // Entity ID is the final collision tie-breaker, so transport order cannot change a result.
  const stable = (compare: (left: Ranked<T>, right: Ranked<T>) => number) => (left: Ranked<T>, right: Ranked<T>) => compare(left, right) || left.item.id.localeCompare(right.item.id);
  const selected: Ranked<T>[] = [];
  const pick = (pool: Ranked<T>[], compare: (left: Ranked<T>, right: Ranked<T>) => number) => {
    const remaining = pool.filter(({ item }) => !selected.some((choice) => choice.item.id === item.id));
    const differentHosts = remaining.filter((candidate) => !selected.some((choice) => choice.hostId !== undefined && choice.hostId === candidate.hostId));
    const next = (differentHosts.length ? differentHosts : remaining).sort(stable(compare))[0];
    if (next) selected.push(next);
  };
  pick(candidates.filter(({ familiarity }) => familiarity === "familiar"), familiarOrder);
  pick(candidates.filter(({ familiarity }) => familiarity === "unfamiliar"), semanticOrder);
  while (selected.length < 2) {
    const count = selected.length;
    pick(candidates, semanticOrder);
    if (selected.length === count) break;
  }
  return selected.map(({ item }) => item);
}

export function selectDiscovery({ events, eventSignals, clubs, favoriteProfiles, favoriteProfileIds, rotationKey }: {
  events: readonly DiscoveryEventCandidate[];
  eventSignals: readonly DiscoveryEventSignal[];
  clubs: readonly DiscoveryProfileSignal[];
  favoriteProfiles: readonly DiscoveryProfileSignal[];
  favoriteProfileIds: readonly string[];
  rotationKey: string;
}): { events: DiscoveryEventCandidate[]; clubs: DiscoveryProfileSignal[] } {
  const favorites = new Set(favoriteProfileIds);
  const weights = new Map<string, number>();
  for (const profile of uniqueById(favoriteProfiles)) {
    if (!favorites.has(profile.id)) continue;
    for (const { slug } of uniqueGenres(profile.genres)) weights.set(slug, (weights.get(slug) ?? 0) + 1);
  }
  const affinity = (genres: readonly Genre[]) => uniqueGenres(genres).reduce((total, { slug }) => total + (weights.get(slug) ?? 0), 0);
  const signals = new Map(eventSignals.map((signal) => [signal.eventId, signal]));
  const rankedEvents = uniqueById(events).map((item): Ranked<DiscoveryEventCandidate> => {
    const signal = signals.get(item.id);
    const performers = discoveryEventGenres(signal);
    const favoriteDjs = performers.filter(({ performer }) => favorites.has(performer.id)).length;
    const favoriteHost = Number(favorites.has(item.host.id));
    return {
      item, favoriteDjs, favoriteHost, hostId: item.host.id,
      familiarity: favoriteDjs || favoriteHost ? "familiar" : signal?.coverage === "complete" ? "unfamiliar" : "unknown",
      affinity: affinity(performers.flatMap(({ genres }) => genres)),
      tie: discoveryRotationScore(rotationKey, item.id),
    };
  });
  const rankedClubs = uniqueById(clubs).filter(({ profileType }) => profileType === "community").map((item): Ranked<DiscoveryProfileSignal> => ({
    item, familiarity: favorites.has(item.id) ? "familiar" : "unfamiliar",
    favoriteDjs: 0, favoriteHost: 0, affinity: affinity(item.genres), tie: discoveryRotationScore(rotationKey, item.id),
  }));
  return { events: blend(rankedEvents), clubs: blend(rankedClubs) };
}
