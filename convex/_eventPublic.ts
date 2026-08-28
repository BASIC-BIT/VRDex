import type { Doc, Id } from "./_generated/dataModel";
import type { DatabaseReader } from "./_generated/server";
import { createDiscordTimestampSet, type DiscordTimestampSet } from "./_discordTimestamps";
import { firstSafeHttpsUrl, optionalField, safeHttpsUrl } from "./_publicFields";
import { visibleProfileField } from "./_profileFieldVisibility";
import { canReadProfile } from "./_profilePermissions";
import { getProfileTrustLabel } from "./_profileStates";
import { safePublicLinkUrl } from "./_vrcdnLinks";
import {
  getPublicProfileMediaKit,
  type PublicProfileAvatarAppearance,
} from "./_profileAssets";

const EVENT_PREVIEW_DEFAULT_LIMIT = 6;
const EVENT_ASSOCIATION_LIMIT = 80;
const EVENT_PREVIEW_MAX_LIMIT = EVENT_ASSOCIATION_LIMIT;
const CURRENT_EVENT_CANDIDATE_LIMIT = 128;

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
  communityImageUrl?: string;
  communityAvatarAppearance?: PublicProfileAvatarAppearance;
  mediaProgram?: Doc<"eventMediaPrograms">;
  mediaOutputs?: Doc<"eventMediaOutputs">[];
  worlds: Array<{ association: Doc<"eventWorlds">; world: Doc<"worlds"> }>;
  participants: PublicEventParticipantRecord[];
  slots: PublicEventSlotRecord[];
};

type PublicEventParticipantRecord = {
  association: Doc<"eventParticipants">;
  profile: Doc<"profiles">;
  imageUrl?: string;
  avatarAppearance?: PublicProfileAvatarAppearance;
};

type PublicEventSlotRecord = {
  slot: Doc<"eventSlots">;
  profile?: Doc<"profiles">;
  imageUrl?: string;
  avatarAppearance?: PublicProfileAvatarAppearance;
};

export type PublicEventPreview = {
  slug?: string;
  title: string;
  startAt: number;
  doorsOpenAt?: number;
  endAt?: number;
  timezone?: string;
  status: "scheduled" | "cancelled";
  communityName?: string;
  communitySlug?: string;
  summary?: string;
  posterImageUrl?: string;
  bannerImageUrl?: string;
  thumbnailImageUrl?: string;
  communityImageUrl?: string;
  communityAvatarAppearance?: PublicProfileAvatarAppearance;
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
  nextSlots: Array<{
    startAt: number;
    endAt?: number;
    displayLabel: string;
    roleLabel: string;
    performer?: {
      slug: string;
      displayName: string;
    };
  }>;
};

export type PublicEvent = PublicEventPreview & {
  id: string;
  slug: string;
  notes?: string;
  watchSurfaceEnabled: boolean;
  authoredBannerImageUrl?: string;
  authoredThumbnailImageUrl?: string;
  authoredMediaLinks: Array<{
    type: PublicEventMediaLinkType;
    label: string;
    url: string;
    presentation: PublicEventMediaLinkPresentation;
  }>;
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
    imageUrl?: string;
    avatarAppearance?: PublicProfileAvatarAppearance;
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
      imageUrl?: string;
      avatarAppearance?: PublicProfileAvatarAppearance;
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

function compareCurrentFirstEvents(
  first: Pick<Doc<"events">, "startAt" | "endAt">,
  second: Pick<Doc<"events">, "startAt" | "endAt">,
  now: number,
): number {
  const firstIsCurrent = first.startAt <= now;
  const secondIsCurrent = second.startAt <= now;

  if (firstIsCurrent !== secondIsCurrent) return firstIsCurrent ? -1 : 1;
  return firstIsCurrent
    ? eventEndsAt(first) - eventEndsAt(second) || first.startAt - second.startAt
    : first.startAt - second.startAt;
}

function publicMediaLinkKey(link: PublicEvent["mediaLinks"][number]) {
  return `${link.type}:${link.url.toLowerCase()}`;
}

function safePublicEventMediaLink(link: PublicEvent["mediaLinks"][number]): PublicEvent["mediaLinks"] {
    const url = safePublicLinkUrl(link.url);

    if (url === undefined) {
      return [];
    }

    return [{ ...link, url }];
}

function publicProfileCardImage(profile: Doc<"profiles">): string | undefined {
  return firstSafeHttpsUrl(
    visibleProfileField(profile, "avatarImageUrl", profile.avatarImageUrl, "discovery"),
    visibleProfileField(profile, "bannerImageUrl", profile.bannerImageUrl, "discovery"),
  );
}

function eventMediaPublicLinkType(platform: Doc<"eventMediaOutputs">["playbackLinks"][number]["platform"]): PublicEventMediaLinkType {
  return platform === "browser" ? "watch" : "vrcdn";
}

function createOutputEventMediaLinks(output: Doc<"eventMediaOutputs">): PublicEvent["mediaLinks"] {
  if (!new Set(["ready", "active"]).has(output.state)) {
    return [];
  }

  return output.playbackLinks.flatMap((link) =>
    safePublicEventMediaLink({
      type: eventMediaPublicLinkType(link.platform),
      label: link.platform === "browser" ? output.label : link.label,
      url: link.url,
      presentation: link.platform === "browser" ? "open" : "copy",
    }),
  );
}

function createProgramEventMediaLinks(program: Doc<"eventMediaPrograms"> | undefined): PublicEvent["mediaLinks"] {
  if (program === undefined || !new Set(["ready", "starting", "live", "hold", "fallback"]).has(program.state)) {
    return [];
  }

  return program.publicLinks.flatMap((link) =>
    safePublicEventMediaLink({
      type: eventMediaPublicLinkType(link.platform),
      label: link.label,
      url: link.url,
      presentation: link.platform === "browser" ? "open" : "copy",
    }),
  );
}

function createPublicEventMediaLinks(
  authoredMediaLinks: PublicEvent["mediaLinks"],
  mediaProgram: Doc<"eventMediaPrograms"> | undefined,
  mediaOutputs: Doc<"eventMediaOutputs">[],
): PublicEvent["mediaLinks"] {
  const links = [
    ...authoredMediaLinks,
    ...mediaOutputs.flatMap(createOutputEventMediaLinks),
    ...createProgramEventMediaLinks(mediaProgram),
  ];
  const seen = new Set<string>();

  return links.filter((link) => {
    const key = publicMediaLinkKey(link);

    if (seen.has(key)) {
      return false;
    }

    seen.add(key);
    return true;
  });
}

export function toPublicEventPreviewFromRecord(
  record: PublicEventRecord,
  options: { now?: number } = {},
): PublicEventPreview {
  const { community, event, participants, slots, worlds } = record;
  const sourceUrl = safeHttpsUrl(event.sourceUrl);
  const posterImageUrl = safeHttpsUrl(event.posterImageUrl);
  const bannerImageUrl = firstSafeHttpsUrl(event.bannerImageUrl, event.posterImageUrl);
  const thumbnailImageUrl = firstSafeHttpsUrl(event.thumbnailImageUrl, event.posterImageUrl, event.bannerImageUrl);
  const communityImageUrl =
    record.communityImageUrl ??
    (community === undefined ? undefined : publicProfileCardImage(community));

  return {
    ...optionalField("slug", event.slug),
    title: event.title,
    startAt: event.startAt,
    status: event.eventStatus,
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
    nextSlots: [...slots]
      .filter(
        ({ slot }) =>
          options.now === undefined || (slot.endAt ?? slot.startAt) >= options.now,
      )
      .sort(
        (first, second) =>
          first.slot.startAt - second.slot.startAt ||
          first.slot.position - second.slot.position,
      )
      .slice(0, 3)
      .map(({ profile, slot }) => ({
        startAt: slot.startAt,
        ...optionalField("endAt", slot.endAt),
        displayLabel: slot.displayLabel,
        roleLabel: slot.roleLabel,
        ...(profile === undefined
          ? {}
          : {
              performer: {
                slug: profile.slug,
                displayName: profile.displayName,
              },
            }),
      })),
    ...optionalField("doorsOpenAt", event.doorsOpenAt),
    ...optionalField("endAt", event.endAt),
    ...optionalField("timezone", event.timezone),
    ...optionalField("communityName", community?.displayName ?? event.communityName),
    ...optionalField("communitySlug", community?.slug),
    ...optionalField("summary", event.summary),
    ...optionalField("posterImageUrl", posterImageUrl),
    ...optionalField("bannerImageUrl", bannerImageUrl),
    ...optionalField("thumbnailImageUrl", thumbnailImageUrl),
    ...optionalField("communityImageUrl", communityImageUrl),
    ...optionalField("communityAvatarAppearance", record.communityAvatarAppearance),
  };
}

export function toPublicEvent(record: PublicEventRecord): PublicEvent | null {
  if (record.event.slug === undefined) {
    return null;
  }

  const preview = toPublicEventPreviewFromRecord(record);
  const authoredMediaLinks = (record.event.mediaLinks ?? [])
    .flatMap(safePublicEventMediaLink)
    .filter(
      (link) =>
        record.event.eventStatus !== "cancelled" ||
        !new Set(["watch", "stream", "vrcdn"]).has(link.type),
    );
  const authoredBannerImageUrl = safeHttpsUrl(record.event.bannerImageUrl);
  const authoredThumbnailImageUrl = safeHttpsUrl(record.event.thumbnailImageUrl);

  return {
    ...preview,
    id: record.event._id,
    slug: record.event.slug,
    watchSurfaceEnabled: record.event.watchSurfaceEnabled ?? false,
    ...optionalField("authoredBannerImageUrl", authoredBannerImageUrl),
    ...optionalField("authoredThumbnailImageUrl", authoredThumbnailImageUrl),
    authoredMediaLinks,
    mediaLinks: createPublicEventMediaLinks(authoredMediaLinks, record.mediaProgram, record.mediaOutputs ?? []),
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
    participants: record.participants.map(({ association, avatarAppearance, imageUrl: projectedImageUrl, profile }) => {
      const sourceUrl = safeHttpsUrl(association.sourceUrl);
      const imageUrl = projectedImageUrl ?? publicProfileCardImage(profile);

      return {
        slug: profile.slug,
        displayName: profile.displayName,
        roleLabel: association.roleLabel,
        trustLabel: getProfileTrustLabel(profile.claimState, profile.creationSource),
        ...optionalField("imageUrl", imageUrl),
        ...optionalField("avatarAppearance", avatarAppearance),
        source: {
          sourceType: association.sourceType,
          label: association.sourceLabel,
          ...optionalField("url", sourceUrl),
        },
      };
    }),
    slots: record.slots
      .sort((first, second) => first.slot.startAt - second.slot.startAt || first.slot.position - second.slot.position)
      .map(({ avatarAppearance, imageUrl: projectedImageUrl, profile, slot }) => {
        const sourceUrl = safeHttpsUrl(slot.sourceUrl);
        const imageUrl =
          projectedImageUrl ??
          (profile === undefined ? undefined : publicProfileCardImage(profile));

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
                  ...optionalField("imageUrl", imageUrl),
                  ...optionalField("avatarAppearance", avatarAppearance),
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

async function getPublicEventParticipantRecords(
  db: DatabaseReader,
  event: Doc<"events">,
  options: { includeMediaKit?: boolean } = {},
) {
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

      if (options.includeMediaKit === false) {
        return {
          association,
          profile,
          imageUrl: publicProfileCardImage(profile),
        };
      }

      const mediaKit = await getPublicProfileMediaKit(db, profile, { surface: "discovery" });
      return {
        association,
        profile,
        imageUrl: mediaKit.profileImage?.imageUrl ?? publicProfileCardImage(profile),
        avatarAppearance: mediaKit.avatarAppearance,
      };
    }),
  );

  return records.filter((record): record is PublicEventParticipantRecord => record !== null);
}

async function getPublicEventSlotRecords(
  db: DatabaseReader,
  event: Doc<"events">,
  options: { includeMediaKit?: boolean } = {},
) {
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

      if (options.includeMediaKit === false) {
        return {
          slot,
          profile,
          imageUrl: publicProfileCardImage(profile),
        };
      }

      const mediaKit = await getPublicProfileMediaKit(db, profile, { surface: "discovery" });
      return {
        slot,
        profile,
        imageUrl: mediaKit.profileImage?.imageUrl ?? publicProfileCardImage(profile),
        avatarAppearance: mediaKit.avatarAppearance,
      };
    }),
  );

  return records.filter((record): record is PublicEventSlotRecord => record !== null);
}

async function getPublicEventMediaRecord(db: DatabaseReader, event: Doc<"events">) {
  if (event.eventStatus === "cancelled") {
    return { mediaOutputs: [] };
  }

  const programs = await db
    .query("eventMediaPrograms")
    .withIndex("by_eventId", (query) => query.eq("eventId", event._id))
    .take(10);
  const mediaProgram = programs
    .filter((program) => new Set(["ready", "starting", "live", "hold", "fallback"]).has(program.state))
    .sort((first, second) => second.updatedAt - first.updatedAt)[0];

  if (mediaProgram === undefined) {
    return { mediaOutputs: [] };
  }

  const outputs = await db
    .query("eventMediaOutputs")
    .withIndex("by_programId_state", (query) => query.eq("programId", mediaProgram._id))
    .take(20);
  const currentOutput = mediaProgram.currentOutputId === undefined ? undefined : await db.get(mediaProgram.currentOutputId);
  const mediaOutputs = [
    ...(currentOutput === null || currentOutput === undefined ? [] : [currentOutput]),
    ...outputs,
  ]
    .filter((output) => output.eventId === event._id && new Set(["ready", "active"]).has(output.state))
    .sort((first, second) => {
      if (first._id === mediaProgram.currentOutputId) {
        return -1;
      }

      if (second._id === mediaProgram.currentOutputId) {
        return 1;
      }

      return second.updatedAt - first.updatedAt;
    });
  const seen = new Set<Id<"eventMediaOutputs">>();

  return {
    mediaProgram,
    mediaOutputs: mediaOutputs.filter((output) => {
      if (seen.has(output._id)) {
        return false;
      }

      seen.add(output._id);
      return true;
    }),
  };
}

async function getPublicEventRecord(
  db: DatabaseReader,
  event: Doc<"events">,
  options: {
    includeAssociationMediaKits?: boolean;
    includeUnpublished?: boolean;
  } = {},
): Promise<PublicEventRecord | null> {
  if (event.publicationState !== "published" && options.includeUnpublished !== true) {
    return null;
  }

  const [community, worlds, participants, slots, media] = await Promise.all([
    getPublishedCommunity(db, event),
    getPublicEventWorldRecords(db, event),
    getPublicEventParticipantRecords(db, event, {
      includeMediaKit: options.includeAssociationMediaKits,
    }),
    getPublicEventSlotRecords(db, event, {
      includeMediaKit: options.includeAssociationMediaKits,
    }),
    getPublicEventMediaRecord(db, event),
  ]);

  const communityMediaKit = community === undefined
    ? undefined
    : await getPublicProfileMediaKit(db, community, { surface: "discovery" });
  const communityProfileImageUrl = communityMediaKit?.profileImage?.imageUrl;
  const communityLogoImageUrl = communityMediaKit?.primaryLogo?.imageUrl;
  const communityImageUrl = communityMediaKit?.compactDisplay === "logo"
    ? communityLogoImageUrl ?? communityProfileImageUrl
    : communityProfileImageUrl ?? communityLogoImageUrl;

  return {
    event,
    worlds,
    participants,
    slots,
    ...media,
    ...optionalField("community", community),
    ...optionalField(
      "communityImageUrl",
      communityImageUrl ?? (community === undefined ? undefined : publicProfileCardImage(community)),
    ),
    ...optionalField("communityAvatarAppearance", communityMediaKit?.avatarAppearance),
  };
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

export async function getEventForEditor(
  db: DatabaseReader,
  event: Doc<"events">,
) {
  const record = await getPublicEventRecord(db, event, {
    includeAssociationMediaKits: false,
    includeUnpublished: true,
  });
  const projected = record === null ? null : toPublicEvent(record);
  const authoredMediaLinks = (event.mediaLinks ?? []).flatMap(safePublicEventMediaLink);
  const [worldAssociations, participantAssociations, slotAssociations] = await Promise.all([
    db.query("eventWorlds").withIndex("by_eventId", (query) => query.eq("eventId", event._id)).collect(),
    db.query("eventParticipants").withIndex("by_eventId", (query) => query.eq("eventId", event._id)).collect(),
    db.query("eventSlots").withIndex("by_eventId", (query) => query.eq("eventId", event._id)).collect(),
  ]);
  const preservedWorldAssociationIds = (
    await Promise.all(worldAssociations.map(async (association) => {
      const world = await db.get(association.worldId);
      return world?.publicationState !== "published" ? association._id : null;
    }))
  ).filter((associationId): associationId is Id<"eventWorlds"> => associationId !== null);
  const preservedParticipantAssociationIds = (
    await Promise.all(participantAssociations.map(async (association) => {
      const profile = await db.get(association.personProfileId);
      return profile === null || !canReadProfile("public", profile) ? association._id : null;
    }))
  ).filter((associationId): associationId is Id<"eventParticipants"> => associationId !== null);
  const preservedSlotAssociationIds = (
    await Promise.all(slotAssociations.map(async (association) => {
      if (association.personProfileId === undefined) return null;
      const profile = await db.get(association.personProfileId);
      return profile === null || !canReadProfile("public", profile) ? association._id : null;
    }))
  ).filter((associationId): associationId is Id<"eventSlots"> => associationId !== null);
  return projected === null
    ? null
    : {
        ...projected,
        authoredMediaLinks,
        preservedParticipantAssociationIds,
        preservedSlotAssociationIds,
        preservedWorldAssociationIds,
        preservedCommunityProfileId: event.communityProfileId,
        publicationState: event.publicationState,
      };
}

export async function getPublicEventPreviews(
  db: DatabaseReader,
  events: Doc<"events">[],
  options: { now?: number; limit?: number; order?: "start" | "input" } = {},
): Promise<PublicEventPreview[]> {
  const now = options.now;
  const limit = Math.max(
    1,
    Math.min(options.limit ?? EVENT_PREVIEW_DEFAULT_LIMIT, EVENT_PREVIEW_MAX_LIMIT),
  );
  const eligibleEvents = events.filter(
    (event) =>
      event.publicationState === "published" &&
      event.eventStatus === "scheduled" &&
      (now === undefined || eventEndsAt(event) >= now),
  );
  const selectedEvents = (options.order === "input"
    ? eligibleEvents
    : eligibleEvents.sort((first, second) => first.startAt - second.startAt)).slice(0, limit);
  const records = (
    await Promise.all(
      selectedEvents.map((event) =>
        getPublicEventRecord(db, event, { includeAssociationMediaKits: false }),
      ),
    )
  ).filter((record): record is PublicEventRecord => record !== null);

  return records.map((record) => toPublicEventPreviewFromRecord(record, { now }));
}

export async function getPublicCommunityHostedEvents(
  db: DatabaseReader,
  communityProfileId: Id<"profiles">,
  now: number,
  limit = EVENT_PREVIEW_DEFAULT_LIMIT,
): Promise<PublicEventPreview[]> {
  // ponytail: Current events use a fixed recent-start window. If real volume
  // can hide a valid multi-day event, replace this with indexed active state.
  const [startedCandidates, upcoming] = await Promise.all([
    db
      .query("events")
      .withIndex("by_communityProfileId_publicationState_eventStatus_startAt", (query) =>
        query
          .eq("communityProfileId", communityProfileId)
          .eq("publicationState", "published")
          .eq("eventStatus", "scheduled")
          .lt("startAt", now),
      )
      .order("desc")
      .take(CURRENT_EVENT_CANDIDATE_LIMIT),
    db
      .query("events")
      .withIndex("by_communityProfileId_publicationState_eventStatus_startAt", (query) =>
        query
          .eq("communityProfileId", communityProfileId)
          .eq("publicationState", "published")
          .eq("eventStatus", "scheduled")
          .gte("startAt", now),
      )
      .take(EVENT_ASSOCIATION_LIMIT),
  ]);
  const started = startedCandidates
    .filter((event) => eventEndsAt(event) >= now)
    .sort((first, second) => compareCurrentFirstEvents(first, second, now));
  const events = [...started, ...upcoming];

  return getPublicEventPreviews(db, events, { now, limit, order: "input" });
}

export async function getPublicPersonUpcomingEvents(
  db: DatabaseReader,
  personProfileId: Id<"profiles">,
  now: number,
  limit = EVENT_PREVIEW_DEFAULT_LIMIT,
): Promise<PublicEventPreview[]> {
  // ponytail: Current events use a fixed recent-start window. If real volume
  // can hide a valid multi-day event, replace this with indexed active state.
  const [startedCandidates, upcoming] = await Promise.all([
    db
      .query("eventParticipants")
      .withIndex("by_person_confirmation_publication_status_start", (query) =>
        query
          .eq("personProfileId", personProfileId)
          .eq("confirmationState", "confirmed")
          .eq("eventPublicationState", "published")
          .eq("eventStatus", "scheduled")
          .lt("eventStartAt", now),
      )
      .order("desc")
      .take(CURRENT_EVENT_CANDIDATE_LIMIT),
    db
      .query("eventParticipants")
      .withIndex("by_person_confirmation_publication_status_start", (query) =>
        query
          .eq("personProfileId", personProfileId)
          .eq("confirmationState", "confirmed")
          .eq("eventPublicationState", "published")
          .eq("eventStatus", "scheduled")
          .gte("eventStartAt", now),
      )
      .take(EVENT_ASSOCIATION_LIMIT),
  ]);
  const participantLinks = [
    ...startedCandidates.filter((link) => link.eventEndAt >= now),
    ...upcoming,
  ];
  const events = (
    await Promise.all(participantLinks.map((link) => db.get(link.eventId)))
  )
    .filter((event): event is Doc<"events"> => event !== null)
    .sort((first, second) => compareCurrentFirstEvents(first, second, now));

  return getPublicEventPreviews(db, events, { now, limit, order: "input" });
}
