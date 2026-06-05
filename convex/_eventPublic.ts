import type { Doc, Id } from "./_generated/dataModel";
import type { DatabaseReader } from "./_generated/server";
import { createDiscordTimestampSet, type DiscordTimestampSet } from "./_discordTimestamps";
import { optionalField, safeHttpsUrl } from "./_publicFields";
import { canReadProfile } from "./_profilePermissions";
import { getProfileTrustLabel } from "./_profileStates";
import { parseVrcdnStreamLinks } from "./_vrcdnLinks";

const EVENT_PREVIEW_DEFAULT_LIMIT = 6;
const EVENT_ASSOCIATION_LIMIT = 80;
const EVENT_PREVIEW_MAX_LIMIT = EVENT_ASSOCIATION_LIMIT;

type PublicEventSourceType = "manual" | "community" | "partner" | "import" | "ai_suggested";
type PublicEventMediaLinkType =
  | "event_page"
  | "watch"
  | "stream"
  | "vrcdn"
  | "discord"
  | "ticket"
  | "other";
type PublicEventMediaLinkPresentation = "open" | "copy";

export type PublicEventRecord = {
  event: Doc<"events">;
  community?: Doc<"profiles">;
  worlds: Array<{ association: Doc<"eventWorlds">; world: Doc<"worlds"> }>;
  participants: PublicEventParticipantRecord[];
  slots: PublicEventSlotRecord[];
};

type PublicEventParticipantRecord = {
  association: Doc<"eventParticipants">;
  profile: Doc<"profiles">;
};

type PublicEventSlotRecord = {
  slot: Doc<"eventSlots">;
  profile?: Doc<"profiles">;
};

export type PublicEventPreview = {
  slug?: string;
  title: string;
  startAt: number;
  doorsOpenAt?: number;
  endAt?: number;
  timezone?: string;
  communityName?: string;
  communitySlug?: string;
  summary?: string;
  posterImageUrl?: string;
  source: {
    sourceType: PublicEventSourceType;
    label: string;
    url?: string;
  };
  worlds: Array<{
    slug: string;
    displayName: string;
  }>;
  participantCount: number;
  slotCount: number;
};

export type PublicEvent = PublicEventPreview & {
  slug: string;
  notes?: string;
  mediaLinks: Array<{
    type: PublicEventMediaLinkType;
    label: string;
    url: string;
    presentation: PublicEventMediaLinkPresentation;
  }>;
  worlds: Array<{
    slug: string;
    displayName: string;
    tags: string[];
    summary?: string;
    heroImageUrl?: string;
    association: {
      sourceType: PublicEventSourceType;
      confirmationState: "confirmed";
      confirmedAt?: number;
    };
  }>;
  participants: Array<{
    slug: string;
    displayName: string;
    roleLabel: string;
    trustLabel: "community_submitted" | "unclaimed" | "claimed_unverified" | "claimed_verified";
    source: {
      sourceType: PublicEventSourceType;
      label: string;
      url?: string;
    };
  }>;
  slots: Array<{
    position: number;
    startAt: number;
    endAt?: number;
    displayLabel: string;
    roleLabel: string;
    discord: DiscordTimestampSet;
    performer?: {
      slug: string;
      displayName: string;
      trustLabel: "community_submitted" | "unclaimed" | "claimed_unverified" | "claimed_verified";
    };
    source: {
      sourceType: PublicEventSourceType;
      label: string;
      url?: string;
    };
  }>;
};

function eventEndsAt(event: Pick<Doc<"events">, "startAt" | "endAt">): number {
  return event.endAt ?? event.startAt;
}

function safePublicMediaUrl(url: string): string | undefined {
  return parseVrcdnStreamLinks(url)?.pageUrl ?? safeHttpsUrl(url);
}

function createPublicEventMediaLinks(event: Doc<"events">): PublicEvent["mediaLinks"] {
  return (event.mediaLinks ?? []).flatMap((link) => {
    const url = safePublicMediaUrl(link.url);

    if (url === undefined) {
      return [];
    }

    return [{ ...link, url }];
  });
}

export function toPublicEventPreviewFromRecord(record: PublicEventRecord): PublicEventPreview {
  const { community, event, participants, slots, worlds } = record;
  const sourceUrl = safeHttpsUrl(event.sourceUrl);
  const posterImageUrl = safeHttpsUrl(event.posterImageUrl);

  return {
    ...optionalField("slug", event.slug),
    title: event.title,
    startAt: event.startAt,
    source: {
      sourceType: event.sourceType,
      label: event.sourceLabel,
      ...optionalField("url", sourceUrl),
    },
    worlds: worlds.map(({ world }) => ({
      slug: world.slug,
      displayName: world.displayName,
    })),
    participantCount: participants.length,
    slotCount: slots.length,
    ...optionalField("doorsOpenAt", event.doorsOpenAt),
    ...optionalField("endAt", event.endAt),
    ...optionalField("timezone", event.timezone),
    ...optionalField("communityName", community?.displayName ?? event.communityName),
    ...optionalField("communitySlug", community?.slug),
    ...optionalField("summary", event.summary),
    ...optionalField("posterImageUrl", posterImageUrl),
  };
}

export function toPublicEvent(record: PublicEventRecord): PublicEvent | null {
  if (record.event.slug === undefined) {
    return null;
  }

  const preview = toPublicEventPreviewFromRecord(record);

  return {
    ...preview,
    slug: record.event.slug,
    mediaLinks: createPublicEventMediaLinks(record.event),
    worlds: record.worlds.map(({ association, world }) => {
      const heroImageUrl = safeHttpsUrl(world.heroImageUrl);

      return {
        slug: world.slug,
        displayName: world.displayName,
        tags: world.tags,
        association: {
          sourceType: association.sourceType,
          confirmationState: "confirmed" as const,
          ...optionalField("confirmedAt", association.confirmedAt),
        },
        ...optionalField("summary", world.summary),
        ...optionalField("heroImageUrl", heroImageUrl),
      };
    }),
    participants: record.participants.map(({ association, profile }) => {
      const sourceUrl = safeHttpsUrl(association.sourceUrl);

      return {
        slug: profile.slug,
        displayName: profile.displayName,
        roleLabel: association.roleLabel,
        trustLabel: getProfileTrustLabel(profile.claimState, profile.creationSource),
        source: {
          sourceType: association.sourceType,
          label: association.sourceLabel,
          ...optionalField("url", sourceUrl),
        },
      };
    }),
    slots: record.slots
      .sort((first, second) => first.slot.startAt - second.slot.startAt || first.slot.position - second.slot.position)
      .map(({ profile, slot }) => {
        const sourceUrl = safeHttpsUrl(slot.sourceUrl);

        return {
          position: slot.position,
          startAt: slot.startAt,
          ...optionalField("endAt", slot.endAt),
          displayLabel: slot.displayLabel,
          roleLabel: slot.roleLabel,
          discord: createDiscordTimestampSet(slot.startAt),
          ...(profile === undefined
            ? {}
            : {
                performer: {
                  slug: profile.slug,
                  displayName: profile.displayName,
                  trustLabel: getProfileTrustLabel(profile.claimState, profile.creationSource),
                },
              }),
          source: {
            sourceType: slot.sourceType,
            label: slot.sourceLabel,
            ...optionalField("url", sourceUrl),
          },
        };
      }),
    ...optionalField("notes", record.event.notes),
  };
}

async function getPublishedCommunity(db: DatabaseReader, event: Doc<"events">) {
  if (event.communityProfileId === undefined) {
    return undefined;
  }

  const community = await db.get(event.communityProfileId);

  if (
    community === null ||
    community.profileType !== "community" ||
    !canReadProfile("public", community)
  ) {
    return undefined;
  }

  return community;
}

async function getPublicEventWorldRecords(db: DatabaseReader, event: Doc<"events">) {
  const associations = await db
    .query("eventWorlds")
    .withIndex("by_eventId", (query) => query.eq("eventId", event._id))
    .filter((query) => query.eq(query.field("confirmationState"), "confirmed"))
    .take(EVENT_ASSOCIATION_LIMIT);

  const records = await Promise.all(
    associations.map(async (association) => {
      const world = await db.get(association.worldId);

      if (world === null || world.publicationState !== "published") {
        return null;
      }

      return { association, world };
    }),
  );

  return records.filter((record): record is { association: Doc<"eventWorlds">; world: Doc<"worlds"> } =>
    record !== null,
  );
}

async function getPublicEventParticipantRecords(db: DatabaseReader, event: Doc<"events">) {
  const associations = await db
    .query("eventParticipants")
    .withIndex("by_eventId", (query) => query.eq("eventId", event._id))
    .filter((query) => query.eq(query.field("confirmationState"), "confirmed"))
    .take(EVENT_ASSOCIATION_LIMIT);

  const records: Array<PublicEventParticipantRecord | null> = await Promise.all(
    associations.map(async (association) => {
      const profile = await db.get(association.personProfileId);

      if (
        profile === null ||
        profile.profileType !== "person" ||
        !canReadProfile("public", profile)
      ) {
        return null;
      }

      return { association, profile };
    }),
  );

  return records.filter((record): record is PublicEventParticipantRecord => record !== null);
}

async function getPublicEventSlotRecords(db: DatabaseReader, event: Doc<"events">) {
  const slots = await db
    .query("eventSlots")
    .withIndex("by_eventId_reviewState_startAt", (query) =>
      query.eq("eventId", event._id).eq("reviewState", "confirmed"),
    )
    .take(EVENT_ASSOCIATION_LIMIT);

  const records: Array<PublicEventSlotRecord | null> = await Promise.all(
    slots.map(async (slot) => {
      if (slot.personProfileId === undefined) {
        return { slot };
      }

      const profile = await db.get(slot.personProfileId);

      if (
        profile === null ||
        profile.profileType !== "person" ||
        !canReadProfile("public", profile)
      ) {
        return { slot };
      }

      return { slot, profile };
    }),
  );

  return records.filter((record): record is PublicEventSlotRecord => record !== null);
}

async function getPublicEventRecord(
  db: DatabaseReader,
  event: Doc<"events">,
): Promise<PublicEventRecord | null> {
  if (event.publicationState !== "published") {
    return null;
  }

  const [community, worlds, participants, slots] = await Promise.all([
    getPublishedCommunity(db, event),
    getPublicEventWorldRecords(db, event),
    getPublicEventParticipantRecords(db, event),
    getPublicEventSlotRecords(db, event),
  ]);

  return { event, worlds, participants, slots, ...optionalField("community", community) };
}

export async function getPublicEventBySlug(
  db: DatabaseReader,
  event: Doc<"events"> | null,
): Promise<PublicEvent | null> {
  if (event === null) {
    return null;
  }

  const record = await getPublicEventRecord(db, event);

  return record === null ? null : toPublicEvent(record);
}

export async function getPublicEventPreviews(
  db: DatabaseReader,
  events: Doc<"events">[],
  options: { now?: number; limit?: number } = {},
): Promise<PublicEventPreview[]> {
  const now = options.now;
  const limit = Math.max(
    1,
    Math.min(options.limit ?? EVENT_PREVIEW_DEFAULT_LIMIT, EVENT_PREVIEW_MAX_LIMIT),
  );
  const records = (
    await Promise.all(events.map((event) => getPublicEventRecord(db, event)))
  ).filter((record): record is PublicEventRecord => record !== null);

  return records
    .filter(({ event }) => now === undefined || eventEndsAt(event) >= now)
    .sort((first, second) => first.event.startAt - second.event.startAt)
    .map(toPublicEventPreviewFromRecord)
    .slice(0, limit);
}

export async function getPublicCommunityHostedEvents(
  db: DatabaseReader,
  communityProfileId: Id<"profiles">,
  now: number,
  limit = EVENT_PREVIEW_DEFAULT_LIMIT,
): Promise<PublicEventPreview[]> {
  const events = await db
    .query("events")
    .withIndex("by_communityProfileId_startAt", (query) =>
      query.eq("communityProfileId", communityProfileId).gte("startAt", now),
    )
    .take(EVENT_ASSOCIATION_LIMIT);

  return getPublicEventPreviews(db, events, { now, limit });
}

export async function getPublicPersonUpcomingEvents(
  db: DatabaseReader,
  personProfileId: Id<"profiles">,
  now: number,
  limit = EVENT_PREVIEW_DEFAULT_LIMIT,
): Promise<PublicEventPreview[]> {
  const participantLinks = await db
    .query("eventParticipants")
    .withIndex("by_personProfileId_confirmationState_eventStartAt", (query) =>
      query
        .eq("personProfileId", personProfileId)
        .eq("confirmationState", "confirmed")
        .gte("eventStartAt", now),
    )
    .take(EVENT_ASSOCIATION_LIMIT);
  const events = (
    await Promise.all(participantLinks.map((link) => db.get(link.eventId)))
  ).filter((event): event is Doc<"events"> => event !== null);

  return getPublicEventPreviews(db, events, { now, limit });
}
