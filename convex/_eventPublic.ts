import { eventProfileStreamChoices, resolveEventStream, type PlaybackStream } from "./_eventPlayback";
import { dateOnlyEventsEnabled, eventSortAt, eventSortEndAt, publicEventSchedule, type StoredEventSchedule } from "./_eventSchedule";
import { publicProfileOutboundLinks } from "./_profilePublic";
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
const EVENT_ASSOCIATION_SCAN_LIMIT = 500;
const EVENT_PREVIEW_MAX_LIMIT = EVENT_ASSOCIATION_LIMIT;

type PublicEventSourceType = "manual" | "community" | "partner" | "import" | "ai_suggested" | "contributor";
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
  lineupEntries?: PublicEventLineupRecord[];
};

type PublicEventLineupRecord = {
  entry: Doc<"eventLineupEntries">;
  profile?: Doc<"profiles">;
  imageUrl?: string;
  avatarAppearance?: PublicProfileAvatarAppearance;
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
  venueLabel?: string;
  slug?: string;
  title: string;
  startAt?: number;
  scheduleKind?: "timed" | "date_only";
  eventDate?: string;
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
  lineup: PublicEventLineupEntry[];
  id: string;
  slug: string;
  watchMode: "event_stream" | "performer_sequence";
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
    outboundLinks: ReturnType<typeof publicProfileOutboundLinks>;
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
    playbackKey: string;
    stream?: PlaybackStream;
    position: number;
    startAt: number;
    endAt?: number;
    displayLabel: string;
    roleLabel: string;
    discord: DiscordTimestampSet;
    performer?: {
      slug: string;
      displayName: string;
      outboundLinks: ReturnType<typeof publicProfileOutboundLinks>;
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

const eventEndsAt = eventSortEndAt;

export type PublicEventLineupEntry = {
  key: string;
  position: number;
  displayLabel: string;
  roleLabel?: string;
  startAt?: number;
  endAt?: number;
  performer?: NonNullable<PublicEvent["slots"][number]["performer"]>;
};

function publicLineup(record: PublicEventRecord): PublicEventLineupEntry[] {
  const represented = new Set<Id<"profiles">>();
  function performer(row: { profile?: Doc<"profiles">; imageUrl?: string; avatarAppearance?: PublicProfileAvatarAppearance }) {
    const { profile } = row;
    if (profile === undefined) return {};
    represented.add(profile._id);
    return { performer: {
      slug: profile.slug, displayName: profile.displayName,
      trustLabel: getProfileTrustLabel(profile.claimState, profile.creationSource),
      outboundLinks: publicProfileOutboundLinks(profile, "discovery"),
      ...optionalField("imageUrl", row.imageUrl ?? publicProfileCardImage(profile)),
      ...optionalField("avatarAppearance", row.avatarAppearance),
    } };
  }
  const rows: PublicEventLineupEntry[] = [
    ...(record.event.scheduleKind === "date_only" ? [] : record.slots).map(row => ({
      key: row.slot._id, position: row.slot.position, displayLabel: row.slot.displayLabel,
      ...optionalField("roleLabel", row.slot.roleLabel || undefined),
      startAt: row.slot.startAt, ...optionalField("endAt", row.slot.endAt), ...performer(row),
    })),
    ...(record.lineupEntries ?? []).map(row => ({
      key: row.entry._id, position: row.entry.position, displayLabel: row.entry.performerLabel,
      ...optionalField("roleLabel", row.entry.roleLabel), ...performer(row),
    })),
  ];
  rows.sort((a, b) => a.position - b.position || (a.startAt ?? Infinity) - (b.startAt ?? Infinity));
  for (const row of record.participants) {
    if (represented.has(row.profile._id)) continue;
    rows.push({ key: row.association._id, position: rows.length, displayLabel: row.profile.displayName,
      ...optionalField("roleLabel", row.association.roleLabel || undefined), ...performer(row) });
  }
  return rows;
}

function compareCurrentFirstEvents(
  first: StoredEventSchedule,
  second: StoredEventSchedule,
  now: number,
): number {
  const firstIsCurrent = first.scheduleKind !== "date_only" && eventSortAt(first) <= now;
  const secondIsCurrent = second.scheduleKind !== "date_only" && eventSortAt(second) <= now;

  if (firstIsCurrent !== secondIsCurrent) return firstIsCurrent ? -1 : 1;
  return firstIsCurrent
    ? eventEndsAt(first) - eventEndsAt(second) || eventSortAt(first) - eventSortAt(second)
    : eventSortAt(first) - eventSortAt(second);
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

function publicProfileCardImage(profile: Doc<"profiles">, automaticAvatarImageUrl?: string): string | undefined {
  return firstSafeHttpsUrl(visibleProfileField(profile, "avatarImageUrl", profile.avatarImageUrl, "discovery"))
    ?? automaticAvatarImageUrl
    ?? firstSafeHttpsUrl(visibleProfileField(profile, "bannerImageUrl", profile.bannerImageUrl, "discovery"));
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
    ...optionalField("venueLabel", event.venueLabel),
    ...publicEventSchedule(event),
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
    nextSlots: (event.scheduleKind === "date_only" ? [] : [...slots])
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
    ...optionalField("doorsOpenAt", event.scheduleKind === "date_only" ? undefined : event.doorsOpenAt),
    ...optionalField("endAt", event.scheduleKind === "date_only" ? undefined : event.endAt),
    ...optionalField("timezone", event.timezone),
    ...optionalField("communityName", community?.displayName),
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

  const roster = new Map<Id<"profiles">, { outboundLinks: ReturnType<typeof publicProfileOutboundLinks>; streamChoices: PlaybackStream[] }>();
  for (const { profile } of [...record.participants, ...record.slots, ...(record.lineupEntries ?? [])]) {
    if (profile !== undefined && !roster.has(profile._id)) {
      roster.set(profile._id, { outboundLinks: publicProfileOutboundLinks(profile, "discovery"), streamChoices: eventProfileStreamChoices(profile) });
    }
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
    lineup: publicLineup(record),
    slug: record.event.slug,
    watchMode: record.event.watchMode ?? "event_stream",
    watchSurfaceEnabled: record.event.scheduleKind !== "date_only" && (record.event.watchSurfaceEnabled ?? false),
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
        outboundLinks: roster.get(profile._id)!.outboundLinks,
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
    slots: (record.event.scheduleKind === "date_only" ? [] : record.slots)
      .sort((first, second) => first.slot.startAt - second.slot.startAt || first.slot.position - second.slot.position)
      .map(({ avatarAppearance, imageUrl: projectedImageUrl, profile, slot }) => {
        const sourceUrl = safeHttpsUrl(slot.sourceUrl);
        const imageUrl =
          projectedImageUrl ??
          (profile === undefined ? undefined : publicProfileCardImage(profile));

        return {
          playbackKey: slot._id,
          ...optionalField("stream", profile === undefined || record.event.eventStatus === "cancelled" || record.event.publicationState !== "published"
            ? undefined : resolveEventStream(roster.get(profile._id)!.streamChoices, slot.selectedStreamId)),
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
                  outboundLinks: roster.get(profile._id)!.outboundLinks,
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

type RosterLoadOptions = {
  includeMediaKit?: boolean;
  profileCache?: Map<Id<"profiles">, Promise<Doc<"profiles"> | null>>;
  mediaKitCache?: Map<Id<"profiles">, ReturnType<typeof getPublicProfileMediaKit>>;
};
function loadRosterProfile(db: DatabaseReader, id: Id<"profiles">, options: RosterLoadOptions) {
  const existing = options.profileCache?.get(id);
  if (existing !== undefined) return existing;
  const pending = db.get(id);
  options.profileCache?.set(id, pending);
  return pending;
}
function loadRosterMediaKit(db: DatabaseReader, profile: Doc<"profiles">, options: RosterLoadOptions) {
  const existing = options.mediaKitCache?.get(profile._id);
  if (existing !== undefined) return existing;
  const pending = getPublicProfileMediaKit(db, profile, { surface: "discovery" });
  options.mediaKitCache?.set(profile._id, pending);
  return pending;
}

async function getPublicEventParticipantRecords(
  db: DatabaseReader,
  event: Doc<"events">,
  options: RosterLoadOptions = {},
) {
  const associations = await db
    .query("eventParticipants")
    .withIndex("by_eventId", (query) => query.eq("eventId", event._id))
    .filter((query) => query.eq(query.field("confirmationState"), "confirmed"))
    .take(EVENT_ASSOCIATION_LIMIT);

  const records: Array<PublicEventParticipantRecord | null> = await Promise.all(
    associations.map(async (association) => {
      const profile = await loadRosterProfile(db, association.personProfileId, options);

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

      const mediaKit = await loadRosterMediaKit(db, profile, options);
      return {
        association,
        profile,
        imageUrl: mediaKit.profileImage?.imageUrl ?? mediaKit.primaryLogo?.imageUrl
          ?? publicProfileCardImage(profile, mediaKit.automaticAvatarImageUrl),
        avatarAppearance: mediaKit.avatarAppearance,
      };
    }),
  );

  return records.filter((record): record is PublicEventParticipantRecord => record !== null);
}

async function getPublicEventSlotRecords(
  db: DatabaseReader,
  event: Doc<"events">,
  options: RosterLoadOptions = {},
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

      const profile = await loadRosterProfile(db, slot.personProfileId, options);

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

      const mediaKit = await loadRosterMediaKit(db, profile, options);
      return {
        slot,
        profile,
        imageUrl: mediaKit.profileImage?.imageUrl ?? mediaKit.primaryLogo?.imageUrl
          ?? publicProfileCardImage(profile, mediaKit.automaticAvatarImageUrl),
        avatarAppearance: mediaKit.avatarAppearance,
      };
    }),
  );

  return records.filter((record): record is PublicEventSlotRecord => record !== null);
}

async function getPublicEventLineupRecords(db: DatabaseReader, event: Doc<"events">, options: RosterLoadOptions): Promise<PublicEventLineupRecord[]> {
  const entries = await db.query("eventLineupEntries")
    .withIndex("by_eventId_position", q => q.eq("eventId", event._id)).take(EVENT_ASSOCIATION_LIMIT);
  return Promise.all(entries.map(async entry => {
    if (entry.personProfileId === undefined) return { entry };
    const profile = await loadRosterProfile(db, entry.personProfileId, options);
    if (profile === null || profile.profileType !== "person" || !canReadProfile("public", profile)) return { entry };
    if (options.includeMediaKit === false) return { entry, profile, imageUrl: publicProfileCardImage(profile) };
    const mediaKit = await loadRosterMediaKit(db, profile, options);
    return { entry, profile,
      imageUrl: mediaKit.profileImage?.imageUrl ?? mediaKit.primaryLogo?.imageUrl
        ?? publicProfileCardImage(profile, mediaKit.automaticAvatarImageUrl),
      avatarAppearance: mediaKit.avatarAppearance,
    };
  }));
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

  const rosterOptions: RosterLoadOptions = {
    includeMediaKit: options.includeAssociationMediaKits,
    profileCache: new Map(),
    mediaKitCache: new Map(),
  };
  const [community, worlds, participants, slots, media, lineupEntries] = await Promise.all([
    getPublishedCommunity(db, event),
    getPublicEventWorldRecords(db, event),
    getPublicEventParticipantRecords(db, event, rosterOptions),
    getPublicEventSlotRecords(db, event, rosterOptions),
    getPublicEventMediaRecord(db, event),
    getPublicEventLineupRecords(db, event, rosterOptions),
  ]);

  if (
    options.includeUnpublished !== true &&
    event.communityProfileId !== undefined &&
    community === undefined
  ) {
    return null;
  }

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
    lineupEntries,
    ...media,
    ...optionalField("community", community),
    ...optionalField(
      "communityImageUrl",
      communityImageUrl ?? (community === undefined ? undefined
        : publicProfileCardImage(community, communityMediaKit?.automaticAvatarImageUrl)),
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
  const [community, worldAssociations, participantAssociations, slotAssociations] = await Promise.all([
    event.communityProfileId === undefined ? null : db.get(event.communityProfileId),
    db.query("eventWorlds").withIndex("by_eventId", (query) => query.eq("eventId", event._id)).collect(),
    db.query("eventParticipants").withIndex("by_eventId", (query) => query.eq("eventId", event._id)).collect(),
    db.query("eventSlots").withIndex("by_eventId", (query) => query.eq("eventId", event._id)).collect(),
  ]);
  // These IDs are an opaque snapshot, not client authority. The update path
  // scopes them back to this event and uses the submitted slug/row to tell an
  // unchanged association from a replacement. Capturing every loaded row also
  // covers a profile or world becoming private after the editor rendered.
  const preservedWorldAssociationIds = worldAssociations.map((association) => association._id);
  const preservedParticipantAssociationIds = participantAssociations.map(
    (association) => association._id,
  );
  const preservedSlotAssociationIds = slotAssociations.map((association) => association._id);
  return projected === null
    ? null
    : {
        ...projected,
        slots: projected.slots.map((slot) => {
          const source = record?.slots.find((entry) => entry.slot._id === slot.playbackKey);
          return {
            ...slot,
            ...optionalField("selectedStreamId", source?.slot.selectedStreamId),
            streamChoices: source?.profile === undefined ? [] : eventProfileStreamChoices(source.profile),
          };
        }),
        ...(community?.profileType === "community"
          ? {
              communityName: community.displayName,
              communitySlug: community.slug,
            }
          : {}),
        authoredMediaLinks,
        ...optionalField("notes", event.notes),
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
  const orderedEvents = options.order === "input"
    ? eligibleEvents
    : eligibleEvents.sort((first, second) => eventSortAt(first) - eventSortAt(second));
  const readableEvents = (
    await Promise.all(
      orderedEvents.map(async (event) => ({
        event,
        communityIsReadable:
          event.communityProfileId === undefined ||
          (await getPublishedCommunity(db, event)) !== undefined,
      })),
    )
  )
    .filter(({ communityIsReadable }) => communityIsReadable)
    .map(({ event }) => event);
  const selectedEvents = readableEvents.slice(0, limit);
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
  const [startedCandidates, upcoming] = await Promise.all([
    db
      .query("events")
      .withIndex(dateOnlyEventsEnabled() ? "by_communityProfileId_publicationState_eventStatus_sortAt" : "by_communityProfileId_publicationState_eventStatus_startAt", (query) =>
        query
          .eq("communityProfileId", communityProfileId)
          .eq("publicationState", "published")
          .eq("eventStatus", "scheduled")
          .lt(dateOnlyEventsEnabled() ? "sortAt" : "startAt", now),
      )
      .order("desc")
      .take(EVENT_ASSOCIATION_SCAN_LIMIT),
    db
      .query("events")
      .withIndex(dateOnlyEventsEnabled() ? "by_communityProfileId_publicationState_eventStatus_sortAt" : "by_communityProfileId_publicationState_eventStatus_startAt", (query) =>
        query
          .eq("communityProfileId", communityProfileId)
          .eq("publicationState", "published")
          .eq("eventStatus", "scheduled")
          .gte(dateOnlyEventsEnabled() ? "sortAt" : "startAt", now),
      )
      .take(EVENT_ASSOCIATION_SCAN_LIMIT),
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
      .withIndex(dateOnlyEventsEnabled() ? "by_person_confirmation_publication_status_sort" : "by_person_confirmation_publication_status_start", (query) =>
        query
          .eq("personProfileId", personProfileId)
          .eq("confirmationState", "confirmed")
          .eq("eventPublicationState", "published")
          .eq("eventStatus", "scheduled")
          .lt(dateOnlyEventsEnabled() ? "eventSortAt" : "eventStartAt", now),
      )
      .order("desc")
      .take(EVENT_ASSOCIATION_SCAN_LIMIT),
    db
      .query("eventParticipants")
      .withIndex(dateOnlyEventsEnabled() ? "by_person_confirmation_publication_status_sort" : "by_person_confirmation_publication_status_start", (query) =>
        query
          .eq("personProfileId", personProfileId)
          .eq("confirmationState", "confirmed")
          .eq("eventPublicationState", "published")
          .eq("eventStatus", "scheduled")
          .gte(dateOnlyEventsEnabled() ? "eventSortAt" : "eventStartAt", now),
      )
      .take(EVENT_ASSOCIATION_SCAN_LIMIT),
  ]);
  const participantLinks = [
    ...startedCandidates.filter((link) => (link.eventSortEndAt ?? link.eventEndAt ?? 0) >= now),
    ...upcoming,
  ];
  const events = (
    await Promise.all(participantLinks.map((link) => db.get(link.eventId)))
  )
    .filter((event): event is Doc<"events"> => event !== null)
    .sort((first, second) => compareCurrentFirstEvents(first, second, now));

  return getPublicEventPreviews(db, events, { now, limit, order: "input" });
}
