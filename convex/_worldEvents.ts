import type { Doc, Id } from "./_generated/dataModel";
import type { DatabaseReader } from "./_generated/server";
import { firstSafeHttpsUrl, optionalField, safeHttpsUrl } from "./_publicFields";
import { canReadProfile } from "./_profilePermissions";
import { safePublicLinkUrl } from "./_vrcdnLinks";

const WORLD_EVENT_SECTION_LIMIT = 4;
const WORLD_EVENT_SECTION_SCAN_LIMIT = 500;
const ACTIVE_WORLD_QUERY_EVENT_LIMIT = 50;
const ACTIVE_WORLD_QUERY_SCAN_LIMIT = 500;
const ACTIVE_WORLD_ASSOCIATION_LIMIT = 20;
const ACTIVE_WORLD_MAX_LIMIT = 6;

type PublicEventSourceType = "manual" | "community" | "partner" | "import" | "ai_suggested";

type PublicWorldEventRecord = {
  event: Doc<"events">;
  association: Doc<"eventWorlds">;
  community?: Doc<"profiles">;
};

type PublicActiveWorldRecord = PublicWorldEventRecord & {
  world: Doc<"worlds">;
};

export type PublicWorldEventPreview = {
  slug?: string;
  communitySlug?: string;
  title: string;
  startAt: number;
  doorsOpenAt?: number;
  endAt?: number;
  timezone?: string;
  communityName?: string;
  summary?: string;
  posterImageUrl?: string;
  bannerImageUrl?: string;
  thumbnailImageUrl?: string;
  mediaLinks: Array<{
    type: "event_page" | "watch" | "stream" | "vrcdn" | "discord" | "ticket" | "other";
    label: string;
    url: string;
    presentation: "open" | "copy";
  }>;
  source: {
    sourceType: PublicEventSourceType;
    label: string;
    url?: string;
  };
  worldAssociation: {
    sourceType: PublicEventSourceType;
    confirmationState: "confirmed";
    confirmedAt?: number;
  };
};

export type PublicWorldEventContext = {
  upcoming: PublicWorldEventPreview[];
  recent: PublicWorldEventPreview[];
};

export type PublicActiveWorldPreview = {
  slug: string;
  displayName: string;
  tags: string[];
  summary?: string;
  heroImageUrl?: string;
  upcomingEventCount: number;
  activityLabel: "Hosting upcoming events";
  nextEvent: {
    title: string;
    slug?: string;
    communitySlug?: string;
    startAt: number;
    doorsOpenAt?: number;
    endAt?: number;
    timezone?: string;
    communityName?: string;
    source: {
      sourceType: PublicEventSourceType;
      label: string;
      url?: string;
    };
  };
};

async function getVisibleFutureEventCandidates(
  db: DatabaseReader,
  now: number,
): Promise<Doc<"events">[]> {
  const visibleEvents: Doc<"events">[] = [];
  let scannedEvents = 0;
  let startAtCursor = now;
  let creationTimeCursor: number | undefined;
  let includeStartAtCursor = true;

  while (
    visibleEvents.length < ACTIVE_WORLD_QUERY_EVENT_LIMIT &&
    scannedEvents < ACTIVE_WORLD_QUERY_SCAN_LIMIT
  ) {
    const pageSize = Math.min(
      ACTIVE_WORLD_QUERY_EVENT_LIMIT,
      ACTIVE_WORLD_QUERY_SCAN_LIMIT - scannedEvents,
    );
    const page = await db
      .query("events")
      .withIndex("by_publicationState_eventStatus_startAt", (query) => {
        const scheduled = query
          .eq("publicationState", "published")
          .eq("eventStatus", "scheduled");

        if (creationTimeCursor !== undefined) {
          return scheduled
            .eq("startAt", startAtCursor)
            .gt("_creationTime", creationTimeCursor);
        }

        return includeStartAtCursor
          ? scheduled.gte("startAt", startAtCursor)
          : scheduled.gt("startAt", startAtCursor);
      })
      .take(pageSize);

    if (page.length === 0) {
      if (creationTimeCursor === undefined) {
        break;
      }
      creationTimeCursor = undefined;
      includeStartAtCursor = false;
      continue;
    }

    scannedEvents += page.length;
    const visibility = await Promise.all(
      page.map(async (event) => {
        if (event.communityProfileId === undefined) {
          return true;
        }
        const community = await db.get(event.communityProfileId);
        return community !== null && canReadProfile("public", community);
      }),
    );
    for (const [index, event] of page.entries()) {
      if (visibility[index]) {
        visibleEvents.push(event);
      }
      if (visibleEvents.length === ACTIVE_WORLD_QUERY_EVENT_LIMIT) {
        break;
      }
    }

    const lastEvent = page[page.length - 1]!;
    startAtCursor = lastEvent.startAt;
    creationTimeCursor = lastEvent._creationTime;
    includeStartAtCursor = true;
  }

  return visibleEvents;
}

function eventEndsAt(event: PublicWorldEventPreview): number {
  return event.endAt ?? event.startAt;
}

function eventRecordEndsAt(event: Pick<Doc<"events">, "startAt" | "endAt">): number {
  return event.endAt ?? event.startAt;
}

function compareActiveEvents(
  first: Pick<Doc<"events">, "startAt" | "endAt">,
  second: Pick<Doc<"events">, "startAt" | "endAt">,
  now: number,
): number {
  const firstIsCurrent = first.startAt <= now;
  const secondIsCurrent = second.startAt <= now;

  if (firstIsCurrent !== secondIsCurrent) return firstIsCurrent ? -1 : 1;
  return firstIsCurrent
    ? eventRecordEndsAt(first) - eventRecordEndsAt(second) || first.startAt - second.startAt
    : first.startAt - second.startAt;
}

function toPublicWorldEventPreview(
  record: PublicWorldEventRecord,
): PublicWorldEventPreview | null {
  const { association, community, event } = record;

  if (
    event.publicationState !== "published" ||
    event.eventStatus !== "scheduled" ||
    association.confirmationState !== "confirmed" ||
    (event.communityProfileId !== undefined && community === undefined)
  ) {
    return null;
  }

  const sourceUrl = safeHttpsUrl(event.sourceUrl);
  const posterImageUrl = safeHttpsUrl(event.posterImageUrl);
  const bannerImageUrl = firstSafeHttpsUrl(event.bannerImageUrl, event.posterImageUrl);
  const thumbnailImageUrl = firstSafeHttpsUrl(event.thumbnailImageUrl, event.posterImageUrl, event.bannerImageUrl);

  return {
    ...optionalField("slug", event.slug),
    ...optionalField("communitySlug", community?.slug),
    title: event.title,
    startAt: event.startAt,
    mediaLinks: (event.mediaLinks ?? []).flatMap((link) => {
      const linkUrl = safePublicLinkUrl(link.url);

      if (linkUrl === undefined) {
        return [];
      }

      return [{ ...link, url: linkUrl }];
    }),
    source: {
      sourceType: event.sourceType,
      label: event.sourceLabel,
      ...optionalField("url", sourceUrl),
    },
    worldAssociation: {
      sourceType: association.sourceType,
      confirmationState: "confirmed",
      ...optionalField("confirmedAt", association.confirmedAt),
    },
    ...optionalField("doorsOpenAt", event.doorsOpenAt),
    ...optionalField("endAt", event.endAt),
    ...optionalField("timezone", event.timezone),
    ...optionalField("communityName", community?.displayName),
    ...optionalField("summary", event.summary),
    ...optionalField("posterImageUrl", posterImageUrl),
    ...optionalField("bannerImageUrl", bannerImageUrl),
    ...optionalField("thumbnailImageUrl", thumbnailImageUrl),
  };
}

export function createPublicWorldEventContext(
  records: PublicWorldEventRecord[],
  now: number,
): PublicWorldEventContext {
  const previewsByEventId = new Map<string, PublicWorldEventPreview>();

  for (const record of records) {
    const preview = toPublicWorldEventPreview(record);

    if (preview !== null && !previewsByEventId.has(record.event._id)) {
      previewsByEventId.set(record.event._id, preview);
    }
  }

  const previews = [...previewsByEventId.values()];

  const upcoming = previews
    .filter((event) => eventEndsAt(event) >= now)
    .sort((first, second) => compareActiveEvents(first, second, now))
    .slice(0, WORLD_EVENT_SECTION_LIMIT);

  const recent = previews
    .filter((event) => eventEndsAt(event) < now)
    .sort((first, second) => second.startAt - first.startAt)
    .slice(0, WORLD_EVENT_SECTION_LIMIT);

  return { upcoming, recent };
}

export function createPublicActiveWorldPreviews(
  records: PublicActiveWorldRecord[],
  now: number,
  limit: number,
): PublicActiveWorldPreview[] {
  const limitWithinBounds = Math.max(1, Math.min(limit, ACTIVE_WORLD_MAX_LIMIT));
  const groups = new Map<
    string,
    {
      world: Doc<"worlds">;
      events: Map<string, { event: Doc<"events">; community?: Doc<"profiles"> }>;
    }
  >();

  for (const { association, community, event, world } of records) {
    if (
      world.publicationState !== "published" ||
      event.publicationState !== "published" ||
      event.eventStatus !== "scheduled" ||
      association.confirmationState !== "confirmed" ||
      (event.communityProfileId !== undefined && community === undefined) ||
      eventRecordEndsAt(event) < now
    ) {
      continue;
    }

    const current = groups.get(world.slug) ?? {
      world,
      events: new Map<string, { event: Doc<"events">; community?: Doc<"profiles"> }>(),
    };
    current.events.set(event._id, { event, ...optionalField("community", community) });
    groups.set(world.slug, current);
  }

  return [...groups.values()]
    .flatMap(({ events, world }) => {
      const sortedEvents = [...events.values()].sort((first, second) =>
        compareActiveEvents(first.event, second.event, now));
      const nextEventRecord = sortedEvents[0];

      if (nextEventRecord === undefined) {
        return [];
      }

      const { community, event: nextEvent } = nextEventRecord;
      const sourceUrl = safeHttpsUrl(nextEvent.sourceUrl);
      const heroImageUrl = safeHttpsUrl(world.heroImageUrl);

      return [
        {
          slug: world.slug,
          displayName: world.displayName,
          tags: world.tags,
          upcomingEventCount: sortedEvents.length,
          activityLabel: "Hosting upcoming events" as const,
          nextEvent: {
            ...optionalField("slug", nextEvent.slug),
            title: nextEvent.title,
            startAt: nextEvent.startAt,
            source: {
              sourceType: nextEvent.sourceType,
              label: nextEvent.sourceLabel,
              ...optionalField("url", sourceUrl),
            },
            ...optionalField("doorsOpenAt", nextEvent.doorsOpenAt),
            ...optionalField("endAt", nextEvent.endAt),
            ...optionalField("timezone", nextEvent.timezone),
            ...optionalField("communityName", community?.displayName),
            ...optionalField("communitySlug", community?.slug),
          },
          ...optionalField("summary", world.summary),
          ...optionalField("heroImageUrl", heroImageUrl),
        },
      ];
    })
    .sort((first, second) => compareActiveEvents(first.nextEvent, second.nextEvent, now))
    .slice(0, limitWithinBounds);
}

export async function getPublicWorldEventContext(
  db: DatabaseReader,
  worldId: Id<"worlds">,
  now: number,
): Promise<PublicWorldEventContext> {
  const [startedAssociations, futureAssociations, previousAssociations] = await Promise.all([
    db
      .query("eventWorlds")
      .withIndex("by_world_confirmation_publication_status_start", (query) =>
        query
          .eq("worldId", worldId)
          .eq("confirmationState", "confirmed")
          .eq("eventPublicationState", "published")
          .eq("eventStatus", "scheduled")
          .lt("eventStartAt", now),
      )
      .order("desc")
      .take(WORLD_EVENT_SECTION_SCAN_LIMIT),
    db
      .query("eventWorlds")
      .withIndex("by_world_confirmation_publication_status_start", (query) =>
        query
          .eq("worldId", worldId)
          .eq("confirmationState", "confirmed")
          .eq("eventPublicationState", "published")
          .eq("eventStatus", "scheduled")
          .gte("eventStartAt", now),
      )
      .take(WORLD_EVENT_SECTION_SCAN_LIMIT),
    db
      .query("eventWorlds")
      .withIndex("by_world_confirmation_publication_status_end", (query) =>
        query
          .eq("worldId", worldId)
          .eq("confirmationState", "confirmed")
          .eq("eventPublicationState", "published")
          .eq("eventStatus", "scheduled")
          .lt("eventEndAt", now),
      )
      .order("desc")
      .take(WORLD_EVENT_SECTION_SCAN_LIMIT),
  ]);
  const currentAssociations = startedAssociations.filter(
    (association) => association.eventEndAt >= now,
  );
  const associations = [...currentAssociations, ...futureAssociations, ...previousAssociations];

  const records = (
    await Promise.all(
      associations.map(async (association) => {
        const event = await db.get(association.eventId);

        if (event === null) {
          return null;
        }

        const communityDoc = event.communityProfileId === undefined
          ? null
          : await db.get(event.communityProfileId);
        const community = communityDoc !== null && canReadProfile("public", communityDoc)
          ? communityDoc
          : null;

        if (event.communityProfileId !== undefined && community === null) {
          return null;
        }

        return {
          event,
          association,
          ...optionalField("community", community ?? undefined),
        };
      }),
    )
  ).filter((record): record is PublicWorldEventRecord => record !== null);

  return createPublicWorldEventContext(records, now);
}

export async function getPublicActiveWorlds(
  db: DatabaseReader,
  now: number,
  limit: number,
): Promise<PublicActiveWorldPreview[]> {
  const futureEvents = await getVisibleFutureEventCandidates(db, now);
  const startedEventCandidates = await db
    .query("events")
    .withIndex("by_publicationState_eventStatus_startAt", (query) =>
      query
        .eq("publicationState", "published")
        .eq("eventStatus", "scheduled")
        .lt("startAt", now),
    )
    .order("desc")
    .take(ACTIVE_WORLD_QUERY_SCAN_LIMIT);
  const currentEventCandidates = startedEventCandidates.filter(
    (event) => (event.endAt ?? event.startAt) >= now,
  );
  const events = [...futureEvents, ...currentEventCandidates];

  const recordGroups = await Promise.all(
    events.map(async (event) => {
      const communityDoc = event.communityProfileId === undefined
        ? null
        : await db.get(event.communityProfileId);
      const community = communityDoc !== null && canReadProfile("public", communityDoc)
        ? communityDoc
        : null;

      if (event.communityProfileId !== undefined && community === null) {
        return [];
      }

      const associations = await db
        .query("eventWorlds")
        .withIndex("by_eventId", (query) => query.eq("eventId", event._id))
        .filter((query) => query.eq(query.field("confirmationState"), "confirmed"))
        .take(ACTIVE_WORLD_ASSOCIATION_LIMIT);

      return Promise.all(
        associations.map(async (association) => {
          const world = await db.get(association.worldId);

          if (world === null) {
            return null;
          }

          return {
            association,
            event,
            world,
            ...optionalField("community", community ?? undefined),
          };
        }),
      );
    }),
  );

  const records = recordGroups
    .flat()
    .filter((record): record is PublicActiveWorldRecord => record !== null);

  return createPublicActiveWorldPreviews(records, now, limit);
}
