import type { Doc, Id } from "./_generated/dataModel";
import type { DatabaseReader } from "./_generated/server";
import { optionalField, safeHttpsUrl } from "./_publicFields";

const WORLD_EVENT_SECTION_LIMIT = 4;
const ACTIVE_WORLD_QUERY_EVENT_LIMIT = 50;
const ACTIVE_WORLD_ASSOCIATION_LIMIT = 20;
const ACTIVE_WORLD_MAX_LIMIT = 6;
const WORLD_EVENT_QUERY_ASSOCIATION_LIMIT = 50;

type PublicEventSourceType = "manual" | "community" | "partner" | "import" | "ai_suggested";

type PublicWorldEventRecord = {
  event: Doc<"events">;
  association: Doc<"eventWorlds">;
};

type PublicActiveWorldRecord = PublicWorldEventRecord & {
  world: Doc<"worlds">;
};

export type PublicWorldEventPreview = {
  slug?: string;
  title: string;
  startAt: number;
  endAt?: number;
  timezone?: string;
  communityName?: string;
  summary?: string;
  posterImageUrl?: string;
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
    startAt: number;
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

function eventEndsAt(event: PublicWorldEventPreview): number {
  return event.endAt ?? event.startAt;
}

function eventRecordEndsAt(event: Doc<"events">): number {
  return event.endAt ?? event.startAt;
}

function toPublicWorldEventPreview(
  record: PublicWorldEventRecord,
): PublicWorldEventPreview | null {
  const { association, event } = record;

  if (event.publicationState !== "published" || association.confirmationState !== "confirmed") {
    return null;
  }

  const sourceUrl = safeHttpsUrl(event.sourceUrl);
  const posterImageUrl = safeHttpsUrl(event.posterImageUrl);

  return {
    ...optionalField("slug", event.slug),
    title: event.title,
    startAt: event.startAt,
    mediaLinks: (event.mediaLinks ?? []).flatMap((link) => {
      const linkUrl = safeHttpsUrl(link.url);

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
    ...optionalField("endAt", event.endAt),
    ...optionalField("timezone", event.timezone),
    ...optionalField("communityName", event.communityName),
    ...optionalField("summary", event.summary),
    ...optionalField("posterImageUrl", posterImageUrl),
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
    .sort((first, second) => first.startAt - second.startAt)
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
  const groups = new Map<string, { world: Doc<"worlds">; events: Map<string, Doc<"events">> }>();

  for (const { association, event, world } of records) {
    if (
      world.publicationState !== "published" ||
      event.publicationState !== "published" ||
      association.confirmationState !== "confirmed" ||
      eventRecordEndsAt(event) < now
    ) {
      continue;
    }

    const current = groups.get(world.slug) ?? { world, events: new Map<string, Doc<"events">>() };
    current.events.set(event._id, event);
    groups.set(world.slug, current);
  }

  return [...groups.values()]
    .flatMap(({ events, world }) => {
      const sortedEvents = [...events.values()].sort((first, second) => first.startAt - second.startAt);
      const nextEvent = sortedEvents[0];

      if (nextEvent === undefined) {
        return [];
      }

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
            ...optionalField("endAt", nextEvent.endAt),
            ...optionalField("timezone", nextEvent.timezone),
            ...optionalField("communityName", nextEvent.communityName),
          },
          ...optionalField("summary", world.summary),
          ...optionalField("heroImageUrl", heroImageUrl),
        },
      ];
    })
    .sort((first, second) => first.nextEvent.startAt - second.nextEvent.startAt)
    .slice(0, limitWithinBounds);
}

export async function getPublicWorldEventContext(
  db: DatabaseReader,
  worldId: Id<"worlds">,
  now: number,
): Promise<PublicWorldEventContext> {
  const futureAssociations = await db
    .query("eventWorlds")
    .withIndex("by_worldId_confirmationState_eventStartAt", (query) =>
      query.eq("worldId", worldId).eq("confirmationState", "confirmed").gte("eventStartAt", now),
    )
    .take(WORLD_EVENT_QUERY_ASSOCIATION_LIMIT);
  const previousAssociations = await db
    .query("eventWorlds")
    .withIndex("by_worldId_confirmationState_eventStartAt", (query) =>
      query.eq("worldId", worldId).eq("confirmationState", "confirmed").lt("eventStartAt", now),
    )
    .order("desc")
    .take(WORLD_EVENT_QUERY_ASSOCIATION_LIMIT);
  const associations = [...futureAssociations, ...previousAssociations];

  const records = (
    await Promise.all(
      associations.map(async (association) => {
        const event = await db.get(association.eventId);

        if (event === null) {
          return null;
        }

        return { event, association };
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
  const futureEvents = await db
    .query("events")
    .withIndex("by_publicationState_startAt", (query) =>
      query.eq("publicationState", "published").gte("startAt", now),
    )
    .take(ACTIVE_WORLD_QUERY_EVENT_LIMIT);
  const currentEventCandidates = await db
    .query("events")
    .withIndex("by_publicationState_startAt", (query) =>
      query.eq("publicationState", "published").lt("startAt", now),
    )
    .order("desc")
    .take(ACTIVE_WORLD_QUERY_EVENT_LIMIT);
  const events = [
    ...futureEvents,
    ...currentEventCandidates.filter((event) => eventRecordEndsAt(event) >= now),
  ];

  const recordGroups = await Promise.all(
    events.map(async (event) => {
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

          return { association, event, world };
        }),
      );
    }),
  );

  const records = recordGroups
    .flat()
    .filter((record): record is PublicActiveWorldRecord => record !== null);

  return createPublicActiveWorldPreviews(records, now, limit);
}
