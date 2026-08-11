import { ConvexError, v } from "convex/values";

import type { Doc, Id } from "./_generated/dataModel";
import {
  internalMutation,
  internalQuery,
  mutation,
  query,
  type DatabaseReader,
  type DatabaseWriter,
  type MutationCtx,
  type QueryCtx,
} from "./_generated/server";
import {
  isSameAuthSubject,
  subjectHasAnyCommunityCapability,
  subjectHasCommunityCapability,
  type AuthSubject,
} from "./_communityAuthority";
import { requireUser } from "./_identity";
import { requireActiveBrowserSessionSubject } from "./_browserSessionAuthority";
import {
  apiWriteAuditActorKindValidator,
  recordApiWriteAuditEvent,
} from "./_apiWriteAuditEvents";
import {
  findMcpWriteReceipt,
  requireMcpAttributionText,
  type McpEventWriteResult,
  mcpWriteAttributionArgs,
  recordMcpWriteReceipt,
  requireSha256Hex,
} from "./_mcpWriteReceipts";
import { normalizeOAuthClientId } from "./_oauth";
import {
  eventMediaCommandTypeValidator,
  eventMediaPlaybackPlatformValidator,
  eventMediaSessionStatusValidator,
  eventMediaVrcdnRegionValidator,
  eventMediaWorkerArtifactTypeValidator,
  eventMediaWorkerProviderValidator,
  eventMediaWorkerTaskStatusValidator,
  sanitizeEventMediaCommandInput,
  sanitizeEventMediaWorkerArtifactLinks,
  sanitizeEventMediaWorkerSchedule,
  sanitizeVrcdnOperatorOwnedOutputSetup,
} from "./_eventMediaControl";
import {
  normalizeEventDraftUpdateInput,
  preserveOmittedEventDraftFields,
  sanitizeEventDraftInput,
  type EventDraftInput,
  type EventDraftUpdateInput,
  type SanitizedEventDraftInput,
} from "./_eventInputs";
import { findEventOperationSlots } from "./_eventOperations";
import {
  getPublicCommunityHostedEvents,
  getPublicEventBySlug,
  getPublicEventPreviews,
} from "./_eventPublic";
import { findAvailableEventSlug, getEventBySlug, validateEventSlug } from "./_eventSlugs";
import { canReadProfile } from "./_profilePermissions";
import { userOwnsProfile } from "./_profileOwnership";
import { getProfileBySlug, validateProfileSlug } from "./_profileSlugs";
import { createEventSearchDocument, upsertSearchDocument, vocabularyForEvent } from "./_searchDocuments";
import { ensureShortLinkForTarget } from "./_shortLinks";
import { recordVocabularyTerms } from "./_vocabulary";
import { getVrcdnOutputAccount, listPublicVrcdnOutputAccounts } from "./_vrcdnOutputAccounts";
import { getWorldBySlug, validateWorldSlug } from "./_worldSlugs";

const eventMediaLinkType = v.union(
  v.literal("event_page"),
  v.literal("watch"),
  v.literal("stream"),
  v.literal("vrcdn"),
  v.literal("discord"),
  v.literal("ticket"),
  v.literal("other"),
);

const eventMediaLinkPresentation = v.union(v.literal("open"), v.literal("copy"));

const eventMediaPlaybackLinkInput = v.object({
  platform: eventMediaPlaybackPlatformValidator,
  label: v.optional(v.string()),
  url: v.string(),
});

const eventMediaWorkerArtifactLinkInput = v.object({
  type: v.optional(eventMediaWorkerArtifactTypeValidator),
  label: v.optional(v.string()),
  url: v.string(),
});

const eventMediaWorkerHealthInput = v.object({
  outputBitrateKbps: v.optional(v.number()),
  audioPresent: v.optional(v.boolean()),
  droppedSegmentCount: v.optional(v.number()),
  commandFailureCount: v.optional(v.number()),
});

const eventDraftArgs = {
  title: v.string(),
  startAt: v.number(),
  doorsOpenAt: v.optional(v.number()),
  endAt: v.optional(v.number()),
  timezone: v.optional(v.string()),
  communitySlug: v.optional(v.string()),
  summary: v.optional(v.string()),
  notes: v.optional(v.string()),
  sourceLabel: v.optional(v.string()),
  sourceUrl: v.optional(v.string()),
  posterImageUrl: v.optional(v.string()),
  bannerImageUrl: v.optional(v.string()),
  thumbnailImageUrl: v.optional(v.string()),
  watchSurfaceEnabled: v.optional(v.boolean()),
  mediaLinks: v.optional(
    v.array(
      v.object({
        type: eventMediaLinkType,
        label: v.string(),
        url: v.string(),
        presentation: v.optional(eventMediaLinkPresentation),
      }),
    ),
  ),
  participantLinks: v.optional(
    v.array(
      v.object({
        personSlug: v.string(),
        roleLabel: v.optional(v.string()),
        sourceLabel: v.optional(v.string()),
        sourceUrl: v.optional(v.string()),
        notes: v.optional(v.string()),
      }),
    ),
  ),
  slotLinks: v.optional(
    v.array(
      v.object({
        personSlug: v.optional(v.string()),
        displayLabel: v.string(),
        roleLabel: v.optional(v.string()),
        startAt: v.number(),
        endAt: v.optional(v.number()),
        sourceLabel: v.optional(v.string()),
        sourceUrl: v.optional(v.string()),
        notes: v.optional(v.string()),
      }),
    ),
  ),
  worldSlug: v.optional(v.string()),
  preferredSlug: v.optional(v.string()),
};

const eventDraftUpdateArgs = {
  ...eventDraftArgs,
  title: v.optional(v.string()),
  startAt: v.optional(v.number()),
  doorsOpenAt: v.optional(v.union(v.number(), v.null())),
  endAt: v.optional(v.union(v.number(), v.null())),
  timezone: v.optional(v.union(v.string(), v.null())),
  worldSlug: v.optional(v.union(v.string(), v.null())),
  summary: v.optional(v.union(v.string(), v.null())),
  notes: v.optional(v.union(v.string(), v.null())),
  sourceUrl: v.optional(v.union(v.string(), v.null())),
  posterImageUrl: v.optional(v.union(v.string(), v.null())),
  bannerImageUrl: v.optional(v.union(v.string(), v.null())),
  thumbnailImageUrl: v.optional(v.union(v.string(), v.null())),
};

const vrcdnOutputSetupArgs = {
  currentSlug: v.string(),
  key: v.string(),
  label: v.string(),
  outputAccountKey: v.optional(v.string()),
  credentialRef: v.optional(v.string()),
  ingestRegion: v.optional(eventMediaVrcdnRegionValidator),
  playbackLinks: v.optional(v.array(eventMediaPlaybackLinkInput)),
  targetVideoBitrateKbps: v.optional(v.number()),
  keyframeIntervalSeconds: v.optional(v.union(v.literal(1), v.literal(2))),
  audioSampleRateHz: v.optional(v.literal(48000)),
  targetAudioBitrateKbps: v.optional(v.number()),
  sourceConsentAccepted: v.optional(v.boolean()),
  destinationAuthorityAccepted: v.optional(v.boolean()),
  providerRulesAccepted: v.optional(v.boolean()),
  rightsClearedMediaAccepted: v.optional(v.boolean()),
};

const eventMediaWorkerScheduleArgs = {
  currentSlug: v.string(),
  outputKey: v.optional(v.string()),
  scheduledStartAt: v.optional(v.number()),
  readyDeadlineAt: v.optional(v.number()),
  workerRuntime: v.optional(v.string()),
  workerProvider: v.optional(eventMediaWorkerProviderValidator),
  workerTaskDefinitionArn: v.optional(v.string()),
  workerTaskId: v.optional(v.string()),
  workerTaskStatus: v.optional(eventMediaWorkerTaskStatusValidator),
  workerTaskStatusReason: v.optional(v.string()),
  artifactLinks: v.optional(v.array(eventMediaWorkerArtifactLinkInput)),
};

const eventMediaCommandArgs = {
  currentSlug: v.string(),
  type: eventMediaCommandTypeValidator,
  targetSourceKey: v.optional(v.string()),
  targetSceneKey: v.optional(v.string()),
  targetOutputKey: v.optional(v.string()),
  publicFallbackLinks: v.optional(v.array(eventMediaPlaybackLinkInput)),
  note: v.optional(v.string()),
};

const eventMediaWorkerSessionArgs = {
  currentSlug: v.string(),
  sessionId: v.id("eventMediaSessions"),
};

const eventMediaWorkerTaskStatusArgs = {
  ...eventMediaWorkerSessionArgs,
  status: v.optional(eventMediaSessionStatusValidator),
  workerId: v.optional(v.string()),
  workerRuntime: v.optional(v.string()),
  workerProvider: v.optional(eventMediaWorkerProviderValidator),
  workerTaskDefinitionArn: v.optional(v.string()),
  workerTaskId: v.optional(v.string()),
  workerTaskStatus: v.optional(eventMediaWorkerTaskStatusValidator),
  workerTaskStatusReason: v.optional(v.string()),
  leaseExpiresAt: v.optional(v.number()),
  health: v.optional(eventMediaWorkerHealthInput),
  artifactLinks: v.optional(v.array(eventMediaWorkerArtifactLinkInput)),
};

const eventMediaWorkerBridgeArgs = {
  bridgeToken: v.string(),
  workerId: v.string(),
};

const eventMediaWorkerBridgeTaskStatusArgs = {
  ...eventMediaWorkerBridgeArgs,
  sessionId: v.id("eventMediaSessions"),
  commandId: v.optional(v.id("eventMediaCommands")),
  status: v.optional(eventMediaSessionStatusValidator),
  workerRuntime: v.optional(v.string()),
  workerProvider: v.optional(eventMediaWorkerProviderValidator),
  workerTaskDefinitionArn: v.optional(v.string()),
  workerTaskId: v.optional(v.string()),
  workerTaskStatus: v.optional(eventMediaWorkerTaskStatusValidator),
  workerTaskStatusReason: v.optional(v.string()),
  leaseExpiresAt: v.optional(v.number()),
  health: v.optional(eventMediaWorkerHealthInput),
  artifactLinks: v.optional(v.array(eventMediaWorkerArtifactLinkInput)),
};

function boundedLimit(value: number | undefined, fallback: number, max: number): number {
  return Math.max(1, Math.min(value ?? fallback, max));
}

async function requireAuthenticatedSubject(ctx: MutationCtx | QueryCtx) {
  return (await requireActiveBrowserSessionSubject(ctx)).subject;
}

function optionalTrimmedText(input: string | undefined, fieldName: string, maxLength: number): string | undefined {
  if (input === undefined) {
    return undefined;
  }

  const value = input.trim();

  if (value.length === 0) {
    return undefined;
  }

  if (value.length > maxLength) {
    throw new Error(`${fieldName} must be ${maxLength} characters or fewer.`);
  }

  return value;
}

function optionalPositiveTimestamp(input: number | undefined, fieldName: string): number | undefined {
  if (input === undefined) {
    return undefined;
  }

  if (!Number.isInteger(input) || input <= 0) {
    throw new Error(`${fieldName} must be a positive millisecond timestamp.`);
  }

  return input;
}

function requireEventMediaBridgeToken(input: string) {
  const expected = process.env.VRDEX_EVENT_MEDIA_BRIDGE_TOKEN?.trim();

  if (expected === undefined || expected.length === 0) {
    throw new Error("Event media bridge token is not configured.");
  }

  let mismatch = input.length === expected.length ? 0 : 1;
  const length = Math.max(input.length, expected.length);

  for (let index = 0; index < length; index += 1) {
    mismatch |= (input.charCodeAt(index) || 0) ^ (expected.charCodeAt(index) || 0);
  }

  if (mismatch !== 0) {
    throw new Error("Event media bridge token is invalid.");
  }
}

function requireBridgeWorkerId(input: string): string {
  const workerId = optionalTrimmedText(input, "Worker id", 128);

  if (workerId === undefined) {
    throw new Error("Worker id is required.");
  }

  return workerId;
}

async function getPublishedCommunityBySlug(
  db: DatabaseReader,
  slug: string | undefined,
): Promise<Doc<"profiles"> | undefined> {
  if (slug === undefined) {
    return undefined;
  }

  const validation = validateProfileSlug(slug);
  if (!validation.ok) {
    throw new Error("Community slug is invalid.");
  }

  const profile = await getProfileBySlug(db, validation.slug);

  if (profile === null || profile.profileType !== "community") {
    throw new Error("Community profile was not found.");
  }

  if (!canReadProfile("public", profile)) {
    throw new Error("Community profile must be published before events can be linked.");
  }

  return profile;
}

async function getPublishedWorldBySlug(
  db: DatabaseReader,
  slug: string | undefined,
) {
  if (slug === undefined) {
    return undefined;
  }

  const validation = validateWorldSlug(slug);
  if (!validation.ok) {
    throw new Error("World slug is invalid.");
  }

  const world = await getWorldBySlug(db, validation.slug);

  if (world === null || world.publicationState !== "published") {
    throw new Error("World profile was not found or is not published.");
  }

  return world;
}

async function getPublishedPersonBySlug(db: DatabaseReader, slug: string) {
  const validation = validateProfileSlug(slug);
  if (!validation.ok) {
    throw new Error(`Person profile slug "${slug}" is invalid.`);
  }

  const profile = await getProfileBySlug(db, validation.slug);

  if (profile === null || profile.profileType !== "person") {
    throw new Error(`Person profile "${slug}" was not found.`);
  }

  if (!canReadProfile("public", profile)) {
    throw new Error(`Person profile "${slug}" must be published before event association.`);
  }

  return profile;
}

async function canUpdateEvent(
  db: DatabaseReader,
  event: Doc<"events">,
  subject: AuthSubject,
  userId?: Id<"users"> | null,
): Promise<boolean> {
  if (isSameAuthSubject(event.submitter, subject)) {
    return true;
  }

  if (event.communityProfileId === undefined) {
    return false;
  }

  if (
    userId !== undefined &&
    userId !== null &&
    await userOwnsProfile(db, event.communityProfileId, userId)
  ) {
    return true;
  }

  return subjectHasCommunityCapability(db, event.communityProfileId, subject, "manage_events");
}

async function canManageEventMedia(
  db: DatabaseReader,
  event: Doc<"events">,
  subject: AuthSubject,
  userId?: Id<"users"> | null,
): Promise<boolean> {
  if (isSameAuthSubject(event.submitter, subject)) {
    return true;
  }

  if (event.communityProfileId === undefined) {
    return false;
  }

  if (
    userId !== undefined &&
    userId !== null &&
    await userOwnsProfile(db, event.communityProfileId, userId)
  ) {
    return true;
  }

  return subjectHasCommunityCapability(db, event.communityProfileId, subject, "manage_event_media");
}

async function canViewEventOperations(
  db: DatabaseReader,
  event: Doc<"events">,
  subject: AuthSubject,
  userId?: Id<"users"> | null,
): Promise<boolean> {
  if (isSameAuthSubject(event.submitter, subject)) {
    return true;
  }

  if (event.communityProfileId === undefined) {
    return false;
  }

  if (
    userId !== undefined &&
    userId !== null &&
    await userOwnsProfile(db, event.communityProfileId, userId)
  ) {
    return true;
  }

  return subjectHasAnyCommunityCapability(db, event.communityProfileId, subject, [
    "view_event_operations",
    "manage_events",
    "manage_event_media",
  ]);
}

async function replaceEventWorldLink(
  db: DatabaseWriter,
  eventId: Id<"events">,
  startAt: number,
  world: Doc<"worlds"> | undefined,
  now: number,
) {
  const existing = await db
    .query("eventWorlds")
    .withIndex("by_eventId", (query) => query.eq("eventId", eventId))
    .take(20);

  await Promise.all(existing.map((association) => db.delete(association._id)));

  if (world === undefined) {
    return;
  }

  await db.insert("eventWorlds", {
    eventId,
    worldId: world._id,
    eventStartAt: startAt,
    sourceType: "community",
    confidence: 1,
    confirmationState: "confirmed",
    confirmedAt: now,
    updatedAt: now,
  });
}

async function replaceEventParticipants(
  db: DatabaseWriter,
  eventId: Id<"events">,
  startAt: number,
  participants: ReturnType<typeof sanitizeEventDraftInput>["participantLinks"],
  now: number,
) {
  const existing = await db
    .query("eventParticipants")
    .withIndex("by_eventId", (query) => query.eq("eventId", eventId))
    .collect();

  await Promise.all(existing.map((participant) => db.delete(participant._id)));

  for (const participant of participants) {
    const profile = await getPublishedPersonBySlug(db, participant.personSlug);

    await db.insert("eventParticipants", {
      eventId,
      personProfileId: profile._id,
      eventStartAt: startAt,
      roleLabel: participant.roleLabel,
      sourceType: "community",
      sourceLabel: participant.sourceLabel,
      ...optionalValue("sourceUrl", participant.sourceUrl),
      confirmationState: "confirmed",
      confirmedAt: now,
      ...optionalValue("notes", participant.notes),
      updatedAt: now,
    });
  }
}

async function replaceEventSlots(
  db: DatabaseWriter,
  eventId: Id<"events">,
  eventStartAt: number,
  slots: ReturnType<typeof sanitizeEventDraftInput>["slotLinks"],
  now: number,
) {
  const existing = await db
    .query("eventSlots")
    .withIndex("by_eventId", (query) => query.eq("eventId", eventId))
    .collect();

  await Promise.all(existing.map((slot) => db.delete(slot._id)));

  for (const slot of slots) {
    const profile = slot.personSlug === undefined ? undefined : await getPublishedPersonBySlug(db, slot.personSlug);

    await db.insert("eventSlots", {
      eventId,
      eventStartAt,
      position: slot.position,
      startAt: slot.startAt,
      ...optionalValue("endAt", slot.endAt),
      ...optionalValue("personProfileId", profile?._id),
      displayLabel: slot.displayLabel,
      roleLabel: slot.roleLabel,
      sourceType: "community",
      sourceLabel: slot.sourceLabel,
      ...optionalValue("sourceUrl", slot.sourceUrl),
      confidence: 1,
      reviewState: "confirmed",
      ...optionalValue("notes", slot.notes),
      createdAt: now,
      updatedAt: now,
    });
  }
}

function participantLinksWithSlotPerformers(input: ReturnType<typeof sanitizeEventDraftInput>) {
  const links = [...input.participantLinks];
  const seenSlugs = new Set(links.map((link) => link.personSlug.toLowerCase()));

  for (const slot of input.slotLinks) {
    if (slot.personSlug === undefined) {
      continue;
    }

    const key = slot.personSlug.toLowerCase();
    if (seenSlugs.has(key)) {
      continue;
    }

    seenSlugs.add(key);
    links.push({
      personSlug: slot.personSlug,
      roleLabel: slot.roleLabel,
      sourceLabel: slot.sourceLabel,
      ...(slot.sourceUrl ? { sourceUrl: slot.sourceUrl } : {}),
      ...(slot.notes ? { notes: slot.notes } : {}),
    });
  }

  return links;
}

async function syncPreservedEventAssociationStartAt(
  db: DatabaseWriter,
  eventId: Id<"events">,
  startAt: number,
  now: number,
  options: {
    preserveParticipants: boolean;
    preserveSlots: boolean;
    preserveWorld: boolean;
  },
) {
  const [worlds, participants, slots] = await Promise.all([
    options.preserveWorld
      ? db.query("eventWorlds").withIndex("by_eventId", (query) => query.eq("eventId", eventId)).collect()
      : Promise.resolve([]),
    options.preserveParticipants
      ? db.query("eventParticipants").withIndex("by_eventId", (query) => query.eq("eventId", eventId)).collect()
      : Promise.resolve([]),
    options.preserveSlots
      ? db.query("eventSlots").withIndex("by_eventId", (query) => query.eq("eventId", eventId)).collect()
      : Promise.resolve([]),
  ]);

  await Promise.all([
    ...worlds.map((association) => db.patch(association._id, { eventStartAt: startAt, updatedAt: now })),
    ...participants.map((participant) => db.patch(participant._id, { eventStartAt: startAt, updatedAt: now })),
    ...slots.map((slot) => db.patch(slot._id, { eventStartAt: startAt, updatedAt: now })),
  ]);
}

async function eventParticipantRoleLabels(db: DatabaseReader, eventId: Id<"events">) {
  const participants = await db
    .query("eventParticipants")
    .withIndex("by_eventId", (query) => query.eq("eventId", eventId))
    .filter((query) => query.eq(query.field("confirmationState"), "confirmed"))
    .collect();

  return participants.map((participant) => participant.roleLabel);
}

async function linkedPublishedEventWorld(db: DatabaseReader, eventId: Id<"events">) {
  const association = await db
    .query("eventWorlds")
    .withIndex("by_eventId", (query) => query.eq("eventId", eventId))
    .filter((query) => query.eq(query.field("confirmationState"), "confirmed"))
    .first();
  const world = association === null ? null : await db.get(association.worldId);

  return world?.publicationState === "published" ? world : undefined;
}

function suppliedEventDraftFields(input: EventDraftUpdateInput) {
  const fields = new Set<keyof EventDraftInput>();

  for (const field of Object.keys(eventDraftArgs) as Array<keyof EventDraftInput>) {
    if (Object.prototype.hasOwnProperty.call(input, field)) {
      fields.add(field);
    }
  }

  return fields;
}

function optionalValue<T>(key: string, value: T | undefined): Record<string, T> {
  return value === undefined ? {} : { [key]: value };
}

function toApiManagedEventSummary(event: Doc<"events">, community: Doc<"profiles"> | undefined) {
  return {
    id: event._id,
    slug: event.slug,
    title: event.title,
    startAt: event.startAt,
    doorsOpenAt: event.doorsOpenAt,
    endAt: event.endAt,
    timezone: event.timezone,
    communityProfileId: event.communityProfileId,
    communitySlug: community?.slug,
    communityName: community?.displayName ?? event.communityName,
    summary: event.summary,
    sourceType: event.sourceType,
    sourceLabel: event.sourceLabel,
    publicationState: event.publicationState,
    watchSurfaceEnabled: event.watchSurfaceEnabled ?? false,
    createdAt: event.createdAt,
    publishedAt: event.publishedAt,
    updatedAt: event.updatedAt,
  };
}

function apiOwnerAuthSubject(ownerUserId: Id<"users">): AuthSubject {
  return {
    tokenIdentifier: `api:user:${ownerUserId}`,
    issuer: "vrdex-api",
    subject: ownerUserId,
    displayName: "VRDex API",
  };
}

async function requireApiOwnedPublishedCommunity(
  db: DatabaseReader,
  communitySlug: string | undefined,
  ownerUserId: Id<"users">,
) {
  if (communitySlug === undefined) {
    throw new Error("Community slug is required for API event creation.");
  }

  const community = await getPublishedCommunityBySlug(db, communitySlug);

  if (community === undefined || !(await userOwnsProfile(db, community._id, ownerUserId))) {
    throw new Error("You do not have permission to create events for this community.");
  }

  return community;
}

async function createCommunityEventForApiOwnerRecord(
  db: DatabaseWriter,
  args: EventDraftInput & { ownerUserId: Id<"users"> },
) {
  const input = sanitizeEventDraftInput(args);
  const community = await requireApiOwnedPublishedCommunity(db, input.communitySlug, args.ownerUserId);
  const world = await getPublishedWorldBySlug(db, input.worldSlug);
  const result = await insertCommunityEventRecord(db, {
    input,
    community,
    world,
    submitter: apiOwnerAuthSubject(args.ownerUserId),
  });

  return { community, result };
}

async function updateCommunityEventForApiOwnerRecord(
  db: DatabaseWriter,
  args: EventDraftUpdateInput & {
    currentSlug: string;
    ownerUserId: Id<"users">;
  },
) {
  const validation = validateEventSlug(args.currentSlug);

  if (!validation.ok) {
    throw new Error("Current event slug is invalid.");
  }

  const event = await getEventBySlug(db, validation.slug);

  if (event === null) {
    throw new Error("Event was not found.");
  }

  const communityProfileId = event.communityProfileId;

  if (
    communityProfileId === undefined ||
    !(await userOwnsProfile(db, communityProfileId, args.ownerUserId))
  ) {
    throw new Error("You do not have permission to update this event.");
  }

  const currentCommunity = await db.get(communityProfileId);

  if (currentCommunity === null) {
    throw new Error("Event community was not found.");
  }

  const updateFields = suppliedEventDraftFields(args);
  const clearsTimezone =
    args.timezone === null ||
    (typeof args.timezone === "string" && args.timezone.trim().length === 0);
  if (clearsTimezone && !updateFields.has("slotLinks")) {
    const preservedSlot = await db
      .query("eventSlots")
      .withIndex("by_eventId_startAt", (query) => query.eq("eventId", event._id))
      .first();

    if (preservedSlot !== null) {
      throw new Error("Time zone cannot be cleared while event slots are preserved.");
    }
  }

  const normalizedUpdate = normalizeEventDraftUpdateInput(args);
  const input = sanitizeEventDraftInput(
    preserveOmittedEventDraftFields(normalizedUpdate, {
      title: event.title,
      startAt: event.startAt,
      communitySlug: currentCommunity.slug,
      doorsOpenAt: event.doorsOpenAt,
      endAt: event.endAt,
      timezone: event.timezone,
      summary: event.summary,
      notes: event.notes,
      sourceLabel: event.sourceLabel,
      sourceUrl: event.sourceUrl,
      posterImageUrl: event.posterImageUrl,
      bannerImageUrl: event.bannerImageUrl,
      thumbnailImageUrl: event.thumbnailImageUrl,
      watchSurfaceEnabled: event.watchSurfaceEnabled ?? false,
      mediaLinks: event.mediaLinks ?? [],
    }),
  );
  const community = await requireApiOwnedPublishedCommunity(db, input.communitySlug, args.ownerUserId);
  const world = updateFields.has("worldSlug")
    ? await getPublishedWorldBySlug(db, input.worldSlug)
    : await linkedPublishedEventWorld(db, event._id);
  const result = await updateCommunityEventRecord(db, { event, input, community, world, updateFields });

  return { community, event, result };
}

export const listCommunityManagedEventsForApiOwner = internalQuery({
  args: {
    ownerUserId: v.id("users"),
    limit: v.optional(v.number()),
  },
  handler: async (ctx, args) => {
    const limit = boundedLimit(args.limit, 50, 100);
    const owners = await ctx.db
      .query("profileOwners")
      .withIndex("by_userId_state", (index) => index.eq("userId", args.ownerUserId).eq("state", "active"))
      .collect();
    const profiles = await Promise.all(owners.map((owner) => ctx.db.get(owner.profileId)));
    const communities = profiles.filter(
      (profile): profile is Doc<"profiles"> => profile !== null && profile.profileType === "community",
    );
    const records: Array<{ event: Doc<"events">; community: Doc<"profiles"> }> = [];
    const seenEventIds = new Set<Doc<"events">["_id"]>();

    for (const community of communities) {
      const events = await ctx.db
        .query("events")
        .withIndex("by_communityProfileId_startAt", (index) => index.eq("communityProfileId", community._id))
        .order("desc")
        .take(limit);

      for (const event of events) {
        if (seenEventIds.has(event._id)) {
          continue;
        }

        seenEventIds.add(event._id);
        records.push({ event, community });
      }
    }

    return records
      .sort((first, second) => second.event.startAt - first.event.startAt || second.event.updatedAt - first.event.updatedAt)
      .slice(0, limit)
      .map(({ community, event }) => toApiManagedEventSummary(event, community));
  },
});

async function insertCommunityEventRecord(
  db: DatabaseWriter,
  options: {
    input: SanitizedEventDraftInput;
    community?: Doc<"profiles">;
    world?: Doc<"worlds">;
    submitter: AuthSubject;
  },
) {
  const { community, input, submitter, world } = options;
  const now = Date.now();
  const slug = await findAvailableEventSlug(db, {
    title: input.title,
    startAt: input.startAt,
    preferredSlug: input.preferredSlug,
  });
  const eventId = await db.insert("events", {
    slug,
    title: input.title,
    sortTitle: input.sortTitle,
    startAt: input.startAt,
    ...optionalValue("doorsOpenAt", input.doorsOpenAt),
    ...optionalValue("endAt", input.endAt),
    ...optionalValue("timezone", input.timezone),
    ...optionalValue("communityProfileId", community?._id),
    ...optionalValue("communityName", community?.displayName),
    ...optionalValue("summary", input.summary),
    ...optionalValue("notes", input.notes),
    ...optionalValue("posterImageUrl", input.posterImageUrl),
    ...optionalValue("bannerImageUrl", input.bannerImageUrl),
    ...optionalValue("thumbnailImageUrl", input.thumbnailImageUrl),
    watchSurfaceEnabled: input.watchSurfaceEnabled,
    mediaLinks: input.mediaLinks,
    sourceType: "community",
    sourceLabel: input.sourceLabel,
    ...optionalValue("sourceUrl", input.sourceUrl),
    submitter,
    publicationState: "published",
    publishedAt: now,
    createdAt: now,
    updatedAt: now,
  });
  const shortLink = await ensureShortLinkForTarget(
    db,
    { targetType: "event", targetId: eventId },
    now,
  );

  await replaceEventWorldLink(db, eventId, input.startAt, world, now);
  await replaceEventSlots(db, eventId, input.startAt, input.slotLinks, now);
  const participantLinks = participantLinksWithSlotPerformers(input);
  await replaceEventParticipants(db, eventId, input.startAt, participantLinks, now);

  const event = await db.get(eventId);
  if (event !== null) {
    const roleLabels = participantLinks.map((participant) => participant.roleLabel);
    await Promise.all([
      upsertSearchDocument(
        db,
        createEventSearchDocument(event, { community, world, roleLabels }),
      ),
      recordVocabularyTerms(db, vocabularyForEvent(event, roleLabels), now),
    ]);
  }

  return {
    eventId,
    slug,
    eventPath: `/e/${slug}`,
    shortLinkCode: shortLink.code,
    shortLinkPath: shortLink.shortLinkPath,
  };
}

async function updateCommunityEventRecord(
  db: DatabaseWriter,
  options: {
    event: Doc<"events">;
    input: SanitizedEventDraftInput;
    community?: Doc<"profiles">;
    world?: Doc<"worlds">;
    updateFields?: ReadonlySet<keyof EventDraftInput>;
  },
) {
  const { community, event, input, updateFields, world } = options;
  const now = Date.now();
  const shouldUpdate = (field: keyof EventDraftInput) => updateFields === undefined || updateFields.has(field);
  const slug = await findAvailableEventSlug(
    db,
    {
      title: input.title,
      startAt: input.startAt,
      preferredSlug: input.preferredSlug ?? event.slug,
    },
    { excludingEventId: event._id },
  );

  await db.patch(event._id, {
    slug,
    title: input.title,
    sortTitle: input.sortTitle,
    startAt: input.startAt,
    ...(shouldUpdate("doorsOpenAt") ? { doorsOpenAt: input.doorsOpenAt } : {}),
    ...(shouldUpdate("endAt") ? { endAt: input.endAt } : {}),
    ...(shouldUpdate("timezone") ? { timezone: input.timezone } : {}),
    communityProfileId: community?._id,
    communityName: community?.displayName,
    ...(shouldUpdate("summary") ? { summary: input.summary } : {}),
    ...(shouldUpdate("notes") ? { notes: input.notes } : {}),
    ...(shouldUpdate("posterImageUrl") ? { posterImageUrl: input.posterImageUrl } : {}),
    ...(shouldUpdate("bannerImageUrl") ? { bannerImageUrl: input.bannerImageUrl } : {}),
    ...(shouldUpdate("thumbnailImageUrl") ? { thumbnailImageUrl: input.thumbnailImageUrl } : {}),
    ...(shouldUpdate("watchSurfaceEnabled") ? { watchSurfaceEnabled: input.watchSurfaceEnabled } : {}),
    ...(shouldUpdate("mediaLinks") ? { mediaLinks: input.mediaLinks } : {}),
    ...(shouldUpdate("sourceLabel") ? { sourceLabel: input.sourceLabel } : {}),
    ...(shouldUpdate("sourceUrl") ? { sourceUrl: input.sourceUrl } : {}),
    updatedAt: now,
  });

  const replaceWorld = shouldUpdate("worldSlug");
  const replaceSlots = shouldUpdate("slotLinks");
  const replaceParticipants = shouldUpdate("participantLinks");

  if (replaceWorld) {
    await replaceEventWorldLink(db, event._id, input.startAt, world, now);
  }

  if (replaceSlots) {
    await replaceEventSlots(db, event._id, input.startAt, input.slotLinks, now);
  }

  if (replaceParticipants) {
    const participantLinks = participantLinksWithSlotPerformers(input);
    await replaceEventParticipants(db, event._id, input.startAt, participantLinks, now);
  }

  if (event.startAt !== input.startAt) {
    await syncPreservedEventAssociationStartAt(db, event._id, input.startAt, now, {
      preserveParticipants: !replaceParticipants,
      preserveSlots: !replaceSlots,
      preserveWorld: !replaceWorld,
    });
  }

  const updatedEvent = await db.get(event._id);
  if (updatedEvent !== null) {
    const roleLabels = await eventParticipantRoleLabels(db, event._id);
    await Promise.all([
      upsertSearchDocument(
        db,
        createEventSearchDocument(updatedEvent, { community, world, roleLabels }),
      ),
      recordVocabularyTerms(db, vocabularyForEvent(updatedEvent, roleLabels), now),
    ]);
  }

  return {
    eventId: event._id,
    slug,
    eventPath: `/e/${slug}`,
  };
}

async function getOrCreateEventMediaProgram(
  db: DatabaseWriter,
  event: Doc<"events">,
  now: number,
): Promise<Id<"eventMediaPrograms">> {
  const program = await db
    .query("eventMediaPrograms")
    .withIndex("by_eventId_updatedAt", (query) => query.eq("eventId", event._id))
    .order("desc")
    .first();

  if (program !== null) {
    return program._id;
  }

  return db.insert("eventMediaPrograms", {
    eventId: event._id,
    ...optionalValue("communityProfileId", event.communityProfileId),
    state: "draft",
    publicLinks: [],
    directFallbackLinks: [],
    createdAt: now,
    updatedAt: now,
  });
}

async function getLatestEventMediaProgram(
  db: DatabaseReader,
  eventId: Id<"events">,
): Promise<Doc<"eventMediaPrograms"> | null> {
  return db
    .query("eventMediaPrograms")
    .withIndex("by_eventId_updatedAt", (query) => query.eq("eventId", eventId))
    .order("desc")
    .first();
}

async function getEditableEventBySlug(
  ctx: MutationCtx | QueryCtx,
  currentSlug: string,
  subject: AuthSubject,
): Promise<{ event: Doc<"events">; slug: string }> {
  const validation = validateEventSlug(currentSlug);

  if (!validation.ok) {
    throw new Error("Current event slug is invalid.");
  }

  const event = await getEventBySlug(ctx.db, validation.slug);

  if (event === null) {
    throw new Error("Event was not found.");
  }

  if (!(await canUpdateEvent(ctx.db, event, subject, (await requireUser(ctx)).userId))) {
    throw new Error("You do not have permission to update this event.");
  }

  return { event, slug: validation.slug };
}

async function getMediaManageableEventBySlug(
  ctx: MutationCtx | QueryCtx,
  currentSlug: string,
  subject: AuthSubject,
): Promise<{ event: Doc<"events">; slug: string }> {
  const validation = validateEventSlug(currentSlug);

  if (!validation.ok) {
    throw new Error("Current event slug is invalid.");
  }

  const event = await getEventBySlug(ctx.db, validation.slug);

  if (event === null) {
    throw new Error("Event was not found.");
  }

  if (!(await canManageEventMedia(ctx.db, event, subject, (await requireUser(ctx)).userId))) {
    throw new Error("You do not have permission to control event media.");
  }

  return { event, slug: validation.slug };
}

async function getOperationsReadableEventBySlug(
  ctx: QueryCtx,
  currentSlug: string,
  subject: AuthSubject,
): Promise<{ event: Doc<"events">; slug: string }> {
  const validation = validateEventSlug(currentSlug);

  if (!validation.ok) {
    throw new Error("Current event slug is invalid.");
  }

  const event = await getEventBySlug(ctx.db, validation.slug);

  if (event === null) {
    throw new Error("Event was not found.");
  }

  if (!(await canViewEventOperations(ctx.db, event, subject, (await requireUser(ctx)).userId))) {
    throw new Error("You do not have permission to view event operations.");
  }

  return { event, slug: validation.slug };
}

async function getReadyEventMediaOutput(
  db: DatabaseReader,
  program: Doc<"eventMediaPrograms">,
  outputKey: string | undefined,
): Promise<Doc<"eventMediaOutputs">> {
  const output =
    outputKey === undefined
      ? program.currentOutputId === undefined
        ? null
        : await db.get(program.currentOutputId)
      : await db
          .query("eventMediaOutputs")
          .withIndex("by_programId_key", (query) => query.eq("programId", program._id).eq("key", outputKey))
          .unique();

  if (output === null || output.eventId !== program.eventId || output.state !== "ready") {
    throw new Error("A ready event media output is required before scheduling a worker.");
  }

  return output;
}

async function getWritableEventMediaSession(
  db: DatabaseReader,
  program: Doc<"eventMediaPrograms">,
  sessionId: Id<"eventMediaSessions">,
): Promise<Doc<"eventMediaSessions">> {
  const session = await db.get(sessionId);

  if (session === null || session.programId !== program._id || session.eventId !== program.eventId) {
    throw new Error("Event media worker session was not found.");
  }

  return session;
}

async function getOpenEventMediaSession(
  db: DatabaseReader,
  programId: Id<"eventMediaPrograms">,
): Promise<Doc<"eventMediaSessions"> | null> {
  const sessions = await db
    .query("eventMediaSessions")
    .withIndex("by_programId_status", (query) => query.eq("programId", programId))
    .take(50);
  const openStatuses = new Set(["scheduled", "starting", "live", "hold", "fallback", "stopping"]);

  return sessions
    .filter((session) => openStatuses.has(session.status))
    .sort((first, second) => second.updatedAt - first.updatedAt)[0] ?? null;
}

async function recordEventMediaAuditEvent(
  db: DatabaseWriter,
  input: {
    programId: Id<"eventMediaPrograms">;
    eventId: Id<"events">;
    sessionId?: Id<"eventMediaSessions">;
    commandId?: Id<"eventMediaCommands">;
    outputId?: Id<"eventMediaOutputs">;
    sourceId?: Id<"eventMediaSources">;
    actor?: AuthSubject;
    actorSurface?: "web" | "discord" | "worker" | "system";
    action: string;
    publicSummary?: string;
    privateSummary?: string;
    createdAt: number;
  },
) {
  await db.insert("eventMediaAuditEvents", {
    programId: input.programId,
    eventId: input.eventId,
    ...(input.sessionId === undefined ? {} : { sessionId: input.sessionId }),
    ...(input.commandId === undefined ? {} : { commandId: input.commandId }),
    ...(input.sourceId === undefined ? {} : { sourceId: input.sourceId }),
    ...(input.outputId === undefined ? {} : { outputId: input.outputId }),
    ...(input.actor === undefined ? {} : { actor: input.actor }),
    actorSurface: input.actorSurface ?? "web",
    action: input.action,
    ...(input.publicSummary === undefined ? {} : { publicSummary: input.publicSummary }),
    ...(input.privateSummary === undefined ? {} : { privateSummary: input.privateSummary }),
    createdAt: input.createdAt,
  });
}

function sourceStatusSummary(sources: Doc<"eventMediaSources">[]) {
  return sources.reduce(
    (summary, source) => ({
      ...summary,
      [source.state]: (summary[source.state] ?? 0) + 1,
    }),
    {} as Partial<Record<Doc<"eventMediaSources">["state"], number>>,
  );
}

function commandStatusSummary(commands: Doc<"eventMediaCommands">[]) {
  return commands.reduce(
    (summary, command) => ({
      ...summary,
      [command.status]: (summary[command.status] ?? 0) + 1,
    }),
    {} as Partial<Record<Doc<"eventMediaCommands">["status"], number>>,
  );
}

async function resolveEventMediaCommandTargets(
  db: DatabaseReader,
  program: Doc<"eventMediaPrograms">,
  command: ReturnType<typeof sanitizeEventMediaCommandInput>,
) {
  const [source, scene, output] = await Promise.all([
    command.targetSourceKey === undefined
      ? Promise.resolve(null)
      : db
          .query("eventMediaSources")
          .withIndex("by_programId_key", (query) =>
            query.eq("programId", program._id).eq("key", command.targetSourceKey ?? ""),
          )
          .unique(),
    command.targetSceneKey === undefined
      ? Promise.resolve(null)
      : db
          .query("eventMediaScenes")
          .withIndex("by_programId_key", (query) =>
            query.eq("programId", program._id).eq("key", command.targetSceneKey ?? ""),
          )
          .unique(),
    command.targetOutputKey === undefined
      ? Promise.resolve(null)
      : db
          .query("eventMediaOutputs")
          .withIndex("by_programId_key", (query) =>
            query.eq("programId", program._id).eq("key", command.targetOutputKey ?? ""),
          )
          .unique(),
  ]);

  if (command.targetSourceKey !== undefined && source === null) {
    throw new Error("Event media source was not found.");
  }

  if (command.targetSceneKey !== undefined && scene === null) {
    throw new Error("Event media scene was not found.");
  }

  if (command.targetOutputKey !== undefined && output === null) {
    throw new Error("Event media output was not found.");
  }

  return { source, scene, output };
}

async function insertEventMediaCommand(
  db: DatabaseWriter,
  input: {
    program: Doc<"eventMediaPrograms">;
    commandType: "start_program" | "stop_program";
    sessionId: Id<"eventMediaSessions">;
    outputId?: Id<"eventMediaOutputs">;
    actor: AuthSubject;
    idempotencyKey: string;
    note?: string;
    now: number;
  },
): Promise<Id<"eventMediaCommands">> {
  return db.insert("eventMediaCommands", {
    programId: input.program._id,
    eventId: input.program.eventId,
    sessionId: input.sessionId,
    commandType: input.commandType,
    status: "queued",
    actor: input.actor,
    actorSurface: "web",
    ...(input.outputId === undefined ? {} : { targetOutputId: input.outputId }),
    publicFallbackLinks: [],
    ...(input.note === undefined ? {} : { note: input.note }),
    idempotencyKey: input.idempotencyKey,
    createdAt: input.now,
    updatedAt: input.now,
  });
}

async function settleEventMediaSessionCommands(
  db: DatabaseWriter,
  input: {
    sessionId: Id<"eventMediaSessions">;
    commandTypes: Array<"start_program" | "stop_program">;
    status: "succeeded" | "failed" | "cancelled";
    errorSummary?: string;
    now: number;
  },
) {
  const pendingStatuses: Array<"queued" | "claimed"> = ["queued", "claimed"];
  const pendingCommands = await Promise.all(
    pendingStatuses.map((status) =>
      db
        .query("eventMediaCommands")
        .withIndex("by_sessionId_status_createdAt", (query) => query.eq("sessionId", input.sessionId).eq("status", status))
        .take(50),
    ),
  );
  const targetTypes = new Set(input.commandTypes);

  await Promise.all(
    pendingCommands
      .flat()
      .filter((command) => targetTypes.has(command.commandType as "start_program" | "stop_program"))
      .map((command) =>
        db.patch(command._id, {
          status: input.status,
          ...(input.errorSummary === undefined ? {} : { errorSummary: input.errorSummary }),
          completedAt: input.now,
          updatedAt: input.now,
        }),
      ),
  );
}

function workerSessionStatus(session: Doc<"eventMediaSessions">) {
  return {
    sessionId: session._id,
    status: session.status,
    ...(session.outputId === undefined ? {} : { outputId: session.outputId }),
    ...(session.workerId === undefined ? {} : { workerId: session.workerId }),
    ...(session.workerRuntime === undefined ? {} : { workerRuntime: session.workerRuntime }),
    ...(session.workerProvider === undefined ? {} : { workerProvider: session.workerProvider }),
    ...(session.workerTaskDefinitionArn === undefined ? {} : { workerTaskDefinitionArn: session.workerTaskDefinitionArn }),
    ...(session.workerTaskId === undefined ? {} : { workerTaskId: session.workerTaskId }),
    ...(session.workerTaskStatus === undefined ? {} : { workerTaskStatus: session.workerTaskStatus }),
    ...(session.workerTaskStatusReason === undefined ? {} : { workerTaskStatusReason: session.workerTaskStatusReason }),
    artifactLinks: session.artifactLinks ?? [],
    ...(session.leaseExpiresAt === undefined ? {} : { leaseExpiresAt: session.leaseExpiresAt }),
    ...(session.readyDeadlineAt === undefined ? {} : { readyDeadlineAt: session.readyDeadlineAt }),
    ...(session.scheduledStartAt === undefined ? {} : { scheduledStartAt: session.scheduledStartAt }),
    ...(session.startedAt === undefined ? {} : { startedAt: session.startedAt }),
    ...(session.stopRequestedAt === undefined ? {} : { stopRequestedAt: session.stopRequestedAt }),
    ...(session.stoppedAt === undefined ? {} : { stoppedAt: session.stoppedAt }),
    ...(session.health === undefined ? {} : { health: session.health }),
    updatedAt: session.updatedAt,
  };
}

function workerCommandOutput(output: Doc<"eventMediaOutputs"> | null) {
  if (output === null) {
    return undefined;
  }

  return {
    outputId: output._id,
    key: output.key,
    type: output.type,
    state: output.state,
    label: output.label,
    playbackLinks: output.playbackLinks,
    ...(output.credential?.secretRef === undefined ? {} : { credentialRef: output.credential.secretRef }),
  };
}

function isWorkerCommandType(commandType: Doc<"eventMediaCommands">["commandType"]): commandType is "start_program" | "stop_program" {
  return commandType === "start_program" || commandType === "stop_program";
}

async function createWorkerBridgeCommandPayload(
  db: DatabaseReader,
  command: Doc<"eventMediaCommands">,
) {
  if (command.sessionId === undefined || !isWorkerCommandType(command.commandType)) {
    return null;
  }

  const session = await db.get(command.sessionId);

  if (session === null) {
    return null;
  }

  const [program, output] = await Promise.all([
    db.get(session.programId),
    session.outputId === undefined ? Promise.resolve(null) : db.get(session.outputId),
  ]);

  if (program === null) {
    return null;
  }

  return {
    commandId: command._id,
    commandType: command.commandType,
    createdAt: command.createdAt,
    ...(command.targetOutputId === undefined ? {} : { targetOutputId: command.targetOutputId }),
    eventId: command.eventId,
    program: {
      programId: program._id,
      state: program.state,
      publicLinks: program.publicLinks,
    },
    session: workerSessionStatus(session),
    ...(workerCommandOutput(output) === undefined ? {} : { output: workerCommandOutput(output) }),
  };
}

async function applyBridgeWorkerTaskStatus(
  db: DatabaseWriter,
  input: {
    workerId: string;
    session: Doc<"eventMediaSessions">;
    program: Doc<"eventMediaPrograms">;
    commandId?: Id<"eventMediaCommands">;
    status?: Doc<"eventMediaSessions">["status"];
    workerRuntime?: string;
    workerProvider?: "aws_ecs";
    workerTaskDefinitionArn?: string;
    workerTaskId?: string;
    workerTaskStatus?: "queued" | "starting" | "running" | "stopping" | "stopped" | "failed";
    workerTaskStatusReason?: string;
    leaseExpiresAt?: number;
    health?: {
      outputBitrateKbps?: number;
      audioPresent?: boolean;
      droppedSegmentCount?: number;
      commandFailureCount?: number;
    };
    artifactLinks?: ReturnType<typeof sanitizeEventMediaWorkerArtifactLinks>;
    now: number;
  },
) {
  const status = input.status ?? input.session.status;
  const shouldSetStartedAt =
    input.session.startedAt === undefined && ["starting", "live", "hold", "fallback"].includes(status);
  const shouldSetStoppedAt = input.session.stoppedAt === undefined && ["ended", "error"].includes(status);

  await db.patch(input.session._id, {
    status,
    workerId: input.workerId,
    ...(input.workerRuntime === undefined ? {} : { workerRuntime: input.workerRuntime }),
    ...(input.workerProvider === undefined ? {} : { workerProvider: input.workerProvider }),
    ...(input.workerTaskDefinitionArn === undefined ? {} : { workerTaskDefinitionArn: input.workerTaskDefinitionArn }),
    ...(input.workerTaskId === undefined ? {} : { workerTaskId: input.workerTaskId }),
    ...(input.workerTaskStatus === undefined ? {} : { workerTaskStatus: input.workerTaskStatus }),
    ...(input.workerTaskStatusReason === undefined ? {} : { workerTaskStatusReason: input.workerTaskStatusReason }),
    ...(input.leaseExpiresAt === undefined ? {} : { leaseExpiresAt: input.leaseExpiresAt }),
    ...(input.artifactLinks === undefined ? {} : { artifactLinks: input.artifactLinks }),
    ...(input.health === undefined
      ? {}
      : {
          health: {
            lastHeartbeatAt: input.now,
            ...(input.health.outputBitrateKbps === undefined ? {} : { outputBitrateKbps: input.health.outputBitrateKbps }),
            ...(input.health.audioPresent === undefined ? {} : { audioPresent: input.health.audioPresent }),
            ...(input.health.droppedSegmentCount === undefined ? {} : { droppedSegmentCount: input.health.droppedSegmentCount }),
            ...(input.health.commandFailureCount === undefined ? {} : { commandFailureCount: input.health.commandFailureCount }),
          },
        }),
    ...(shouldSetStartedAt ? { startedAt: input.now } : {}),
    ...(shouldSetStoppedAt ? { stoppedAt: input.now } : {}),
    updatedAt: input.now,
  });

  if (
    status === "starting" ||
    status === "live" ||
    status === "hold" ||
    status === "fallback" ||
    status === "stopping" ||
    status === "ended" ||
    status === "error"
  ) {
    await db.patch(input.program._id, {
      state: status,
      activeSessionId: ["ended", "error"].includes(status) ? undefined : input.session._id,
      updatedAt: input.now,
    });
  }

  if (status === "live" && input.session.outputId !== undefined) {
    const output = await db.get(input.session.outputId);

    if (output !== null) {
      await Promise.all([
        db.patch(output._id, { state: "active", updatedAt: input.now }),
        db.patch(input.program._id, { currentOutputId: output._id, publicLinks: output.playbackLinks, updatedAt: input.now }),
        settleEventMediaSessionCommands(db, {
          sessionId: input.session._id,
          commandTypes: ["start_program"],
          status: "succeeded",
          now: input.now,
        }),
      ]);
    }
  }

  if (["ended", "error"].includes(status) && input.session.outputId !== undefined) {
    const output = await db.get(input.session.outputId);

    if (output !== null && output.state === "active") {
      await db.patch(output._id, { state: "ready", updatedAt: input.now });
    }
  }

  if (["ended", "error"].includes(status)) {
    await settleEventMediaSessionCommands(db, {
      sessionId: input.session._id,
      commandTypes: ["start_program", "stop_program"],
      status: status === "error" ? "failed" : "succeeded",
      ...(status === "error" ? { errorSummary: input.workerTaskStatusReason ?? "Worker ended with an error." } : {}),
      now: input.now,
    });
  }

  if (input.commandId !== undefined) {
    const command = await db.get(input.commandId);

    if (command !== null && command.status === "claimed" && status === "stopping") {
      await db.patch(command._id, { status: "succeeded", completedAt: input.now, updatedAt: input.now });
    }
  }
}

export const getPublicBySlug = query({
  args: {
    slug: v.string(),
  },
  handler: async (ctx, args) => {
    const validation = validateEventSlug(args.slug);

    if (!validation.ok) {
      return null;
    }

    return getPublicEventBySlug(ctx.db, await getEventBySlug(ctx.db, validation.slug));
  },
});

export const listPublicUpcoming = query({
  args: {
    now: v.number(),
    limit: v.optional(v.number()),
  },
  handler: async (ctx, args) => {
    const limit = boundedLimit(args.limit, 8, 24);
    const events = await ctx.db
      .query("events")
      .withIndex("by_publicationState_startAt", (index) =>
        index.eq("publicationState", "published").gte("startAt", args.now),
      )
      .take(limit);

    return await getPublicEventPreviews(ctx.db, events, { now: args.now, limit });
  },
});

export const listHostedByCommunitySlug = query({
  args: {
    communitySlug: v.string(),
    now: v.number(),
    limit: v.optional(v.number()),
  },
  handler: async (ctx, args) => {
    const validation = validateProfileSlug(args.communitySlug);

    if (!validation.ok) {
      return [];
    }

    const community = await getProfileBySlug(ctx.db, validation.slug);

    if (
      community === null ||
      community.profileType !== "community" ||
      !canReadProfile("public", community)
    ) {
      return [];
    }

    return getPublicCommunityHostedEvents(ctx.db, community._id, args.now, args.limit);
  },
});

export const listVrcdnOutputAccounts = query({
  args: {},
  handler: () => listPublicVrcdnOutputAccounts(),
});

export const getEventMediaControlStatus = query({
  args: {
    currentSlug: v.string(),
    now: v.optional(v.number()),
  },
  handler: async (ctx, args) => {
    const subject = await requireAuthenticatedSubject(ctx);
    const { event, slug } = await getOperationsReadableEventBySlug(ctx, args.currentSlug, subject);
    const program = await getLatestEventMediaProgram(ctx.db, event._id);
    const slots = await ctx.db
      .query("eventSlots")
      .withIndex("by_eventId_startAt", (query) => query.eq("eventId", event._id))
      .take(100);
    const slotState = findEventOperationSlots(slots, args.now ?? Date.now());

    if (program === null) {
      return {
        eventId: event._id,
        eventPath: `/e/${slug}`,
        program: null,
        sources: [],
        outputs: [],
        sessions: [],
        commands: [],
        queuedCommandCount: 0,
        operationReadiness: {
          hasMediaProgram: false,
          readyOutputCount: 0,
          activeOutputCount: 0,
          sourceStates: {},
          commandStates: {},
          openSessionCount: 0,
        },
        ...slotState,
      };
    }

    const [sources, outputs, sessions, commands, queuedCommands] = await Promise.all([
      ctx.db
        .query("eventMediaSources")
        .withIndex("by_programId_position", (query) => query.eq("programId", program._id))
        .take(100),
      ctx.db
        .query("eventMediaOutputs")
        .withIndex("by_programId_key", (query) => query.eq("programId", program._id))
        .take(50),
      ctx.db
        .query("eventMediaSessions")
        .withIndex("by_programId_status", (query) => query.eq("programId", program._id))
        .take(50),
      ctx.db
        .query("eventMediaCommands")
        .withIndex("by_eventId_createdAt", (query) => query.eq("eventId", event._id))
        .order("desc")
        .take(50),
      ctx.db
        .query("eventMediaCommands")
        .withIndex("by_programId_status_createdAt", (query) => query.eq("programId", program._id).eq("status", "queued"))
        .take(100),
    ]);
    const programCommands = commands.filter((command) => command.programId === program._id);

    return {
      eventId: event._id,
      eventPath: `/e/${slug}`,
      program: {
        programId: program._id,
        state: program.state,
        ...(program.currentOutputId === undefined ? {} : { currentOutputId: program.currentOutputId }),
        ...(program.activeSessionId === undefined ? {} : { activeSessionId: program.activeSessionId }),
        publicLinkCount: program.publicLinks.length,
        directFallbackLinkCount: program.directFallbackLinks.length,
        updatedAt: program.updatedAt,
      },
      sources: sources
        .sort((first, second) => first.position - second.position || first.key.localeCompare(second.key))
        .map((source) => ({
          sourceId: source._id,
          key: source.key,
          position: source.position,
          type: source.type,
          purpose: source.purpose,
          state: source.state,
          label: source.label,
          ...(source.eventSlotId === undefined ? {} : { eventSlotId: source.eventSlotId }),
          ...(source.sourceProfileId === undefined ? {} : { sourceProfileId: source.sourceProfileId }),
          hasPublicUrl: source.publicUrl !== undefined,
          hasPrivateConfig: source.privateConfigRef !== undefined,
          updatedAt: source.updatedAt,
        })),
      outputs: outputs
        .sort((first, second) => first.key.localeCompare(second.key))
        .map((output) => ({
          outputId: output._id,
          key: output.key,
          type: output.type,
          state: output.state,
          label: output.label,
          hasCredential: output.credential !== undefined,
          playbackLinkCount: output.playbackLinks.length,
          updatedAt: output.updatedAt,
        })),
      sessions: sessions.sort((first, second) => second.updatedAt - first.updatedAt).map(workerSessionStatus),
      commands: programCommands.map((command) => ({
        commandId: command._id,
        commandType: command.commandType,
        status: command.status,
        actorSurface: command.actorSurface,
        ...(command.actor?.displayName === undefined ? {} : { actorDisplayName: command.actor.displayName }),
        ...(command.targetSourceId === undefined ? {} : { targetSourceId: command.targetSourceId }),
        ...(command.targetSourceKey === undefined ? {} : { targetSourceKey: command.targetSourceKey }),
        ...(command.targetSceneId === undefined ? {} : { targetSceneId: command.targetSceneId }),
        ...(command.targetSceneKey === undefined ? {} : { targetSceneKey: command.targetSceneKey }),
        ...(command.targetOutputId === undefined ? {} : { targetOutputId: command.targetOutputId }),
        ...(command.targetOutputKey === undefined ? {} : { targetOutputKey: command.targetOutputKey }),
        fallbackLinkCount: command.publicFallbackLinks.length,
        ...(command.note === undefined ? {} : { note: command.note }),
        ...(command.errorSummary === undefined ? {} : { errorSummary: command.errorSummary }),
        createdAt: command.createdAt,
        updatedAt: command.updatedAt,
      })),
      queuedCommandCount: queuedCommands.length,
      operationReadiness: {
        hasMediaProgram: true,
        readyOutputCount: outputs.filter((output) => output.state === "ready").length,
        activeOutputCount: outputs.filter((output) => output.state === "active").length,
        sourceStates: sourceStatusSummary(sources),
        commandStates: commandStatusSummary(programCommands),
        openSessionCount: sessions.filter((session) => ["scheduled", "starting", "live", "hold", "fallback", "stopping"].includes(session.status))
          .length,
      },
      ...slotState,
    };
  },
});

export const queueEventMediaCommand = mutation({
  args: eventMediaCommandArgs,
  handler: async (ctx, args) => {
    const subject = await requireAuthenticatedSubject(ctx);
    const { event, slug } = await getMediaManageableEventBySlug(ctx, args.currentSlug, subject);
    const program = await getLatestEventMediaProgram(ctx.db, event._id);

    if (program === null) {
      throw new Error("Event media program was not found.");
    }

    const command = sanitizeEventMediaCommandInput(args);

    if (command.type === "start_program" || command.type === "stop_program") {
      throw new Error("Use the worker lifecycle mutations for start_program and stop_program commands.");
    }

    const targets = await resolveEventMediaCommandTargets(ctx.db, program, command);
    const now = Date.now();
    const commandId = await ctx.db.insert("eventMediaCommands", {
      programId: program._id,
      eventId: event._id,
      commandType: command.type,
      status: "queued",
      actor: subject,
      actorSurface: "web",
      ...(targets.source === null ? {} : { targetSourceId: targets.source._id }),
      ...(command.targetSourceKey === undefined ? {} : { targetSourceKey: command.targetSourceKey }),
      ...(targets.scene === null ? {} : { targetSceneId: targets.scene._id }),
      ...(command.targetSceneKey === undefined ? {} : { targetSceneKey: command.targetSceneKey }),
      ...(targets.output === null ? {} : { targetOutputId: targets.output._id }),
      ...(command.targetOutputKey === undefined ? {} : { targetOutputKey: command.targetOutputKey }),
      publicFallbackLinks: command.publicFallbackLinks,
      ...(command.note === undefined ? {} : { note: command.note }),
      createdAt: now,
      updatedAt: now,
    });

    await recordEventMediaAuditEvent(ctx.db, {
      programId: program._id,
      eventId: event._id,
      commandId,
      ...(targets.source === null ? {} : { sourceId: targets.source._id }),
      ...(targets.output === null ? {} : { outputId: targets.output._id }),
      actor: subject,
      action: "media_command_queued",
      publicSummary: `Event media command queued: ${command.type}.`,
      ...(command.note === undefined ? {} : { privateSummary: command.note }),
      createdAt: now,
    });

    return {
      eventId: event._id,
      eventPath: `/e/${slug}`,
      programId: program._id,
      commandId,
      status: "queued" as const,
      commandType: command.type,
    };
  },
});

export const claimEventMediaWorkerCommand = mutation({
  args: eventMediaWorkerBridgeArgs,
  handler: async (ctx, args) => {
    requireEventMediaBridgeToken(args.bridgeToken);
    const workerId = requireBridgeWorkerId(args.workerId);
    const now = Date.now();
    const queuedCommands = await ctx.db
      .query("eventMediaCommands")
      .withIndex("by_status_createdAt", (query) => query.eq("status", "queued"))
      .take(50);

    for (const command of queuedCommands) {
      if (!isWorkerCommandType(command.commandType) || command.sessionId === undefined) {
        continue;
      }

      const payload = await createWorkerBridgeCommandPayload(ctx.db, command);

      if (payload === null) {
        await ctx.db.patch(command._id, {
          status: "failed",
          errorSummary: "Worker command references missing media-control records.",
          completedAt: now,
          updatedAt: now,
        });
        continue;
      }

      await ctx.db.patch(command._id, {
        status: "claimed",
        claimedByWorkerId: workerId,
        claimedAt: now,
        updatedAt: now,
      });

      return payload;
    }

    return null;
  },
});

export const listEventMediaWorkerBridgeSessions = query({
  args: eventMediaWorkerBridgeArgs,
  handler: async (ctx, args) => {
    requireEventMediaBridgeToken(args.bridgeToken);
    const workerId = requireBridgeWorkerId(args.workerId);
    const statuses: Array<"scheduled" | "starting" | "live" | "hold" | "fallback" | "stopping"> = [
      "scheduled",
      "starting",
      "live",
      "hold",
      "fallback",
      "stopping",
    ];
    const sessionGroups = await Promise.all(
      statuses.map((status) =>
        ctx.db
          .query("eventMediaSessions")
          .withIndex("by_status_updatedAt", (query) => query.eq("status", status))
          .take(50),
      ),
    );

    return sessionGroups
      .flat()
      .filter((session) => session.workerId === workerId && session.workerProvider === "aws_ecs" && session.workerTaskId !== undefined)
      .sort((first, second) => second.updatedAt - first.updatedAt)
      .map(workerSessionStatus);
  },
});

export const recordEventMediaWorkerBridgeTaskStatus = mutation({
  args: eventMediaWorkerBridgeTaskStatusArgs,
  handler: async (ctx, args) => {
    requireEventMediaBridgeToken(args.bridgeToken);
    const workerId = requireBridgeWorkerId(args.workerId);
    const session = await ctx.db.get(args.sessionId);

    if (session === null) {
      throw new Error("Event media worker session was not found.");
    }

    const program = await ctx.db.get(session.programId);

    if (program === null) {
      throw new Error("Event media program was not found.");
    }

    const now = Date.now();
    const workerRuntime = optionalTrimmedText(args.workerRuntime, "Worker runtime", 80);
    const workerTaskDefinitionArn = optionalTrimmedText(args.workerTaskDefinitionArn, "Worker task definition ARN", 512);
    const workerTaskId = optionalTrimmedText(args.workerTaskId, "Worker task id", 512);
    const workerTaskStatusReason = optionalTrimmedText(args.workerTaskStatusReason, "Worker task status reason", 500);
    const leaseExpiresAt = optionalPositiveTimestamp(args.leaseExpiresAt, "Worker lease expiration");
    const artifactLinks = args.artifactLinks === undefined ? undefined : sanitizeEventMediaWorkerArtifactLinks(args.artifactLinks);

    await applyBridgeWorkerTaskStatus(ctx.db, {
      workerId,
      session,
      program,
      ...(args.commandId === undefined ? {} : { commandId: args.commandId }),
      ...(args.status === undefined ? {} : { status: args.status }),
      ...(workerRuntime === undefined ? {} : { workerRuntime }),
      ...(args.workerProvider === undefined ? {} : { workerProvider: args.workerProvider }),
      ...(workerTaskDefinitionArn === undefined ? {} : { workerTaskDefinitionArn }),
      ...(workerTaskId === undefined ? {} : { workerTaskId }),
      ...(args.workerTaskStatus === undefined ? {} : { workerTaskStatus: args.workerTaskStatus }),
      ...(workerTaskStatusReason === undefined ? {} : { workerTaskStatusReason }),
      ...(leaseExpiresAt === undefined ? {} : { leaseExpiresAt }),
      ...(args.health === undefined ? {} : { health: args.health }),
      ...(artifactLinks === undefined ? {} : { artifactLinks }),
      now,
    });

    await recordEventMediaAuditEvent(ctx.db, {
      programId: program._id,
      eventId: session.eventId,
      sessionId: session._id,
      ...(session.outputId === undefined ? {} : { outputId: session.outputId }),
      ...(args.commandId === undefined ? {} : { commandId: args.commandId }),
      actorSurface: "worker",
      action: "worker_bridge_status_recorded",
      publicSummary: `Event media worker status is ${args.status ?? session.status}.`,
      ...(args.workerTaskStatus === undefined ? {} : { privateSummary: `Worker task status is ${args.workerTaskStatus}.` }),
      createdAt: now,
    });

    const updatedSession = await ctx.db.get(session._id);

    return updatedSession === null ? workerSessionStatus(session) : workerSessionStatus(updatedSession);
  },
});

export const createCommunityEvent = mutation({
  args: eventDraftArgs,
  handler: async (ctx, args) => {
    const subject = await requireAuthenticatedSubject(ctx);
    const input = sanitizeEventDraftInput(args);
    const community = await getPublishedCommunityBySlug(ctx.db, input.communitySlug);
    const world = await getPublishedWorldBySlug(ctx.db, input.worldSlug);

    return await insertCommunityEventRecord(ctx.db, { input, community, world, submitter: subject });
  },
});

export const createCommunityEventForApiOwner = internalMutation({
  args: {
    actorKind: apiWriteAuditActorKindValidator,
    ownerUserId: v.id("users"),
    ...eventDraftArgs,
  },
  handler: async (ctx, args) => {
    const { community, result } = await createCommunityEventForApiOwnerRecord(
      ctx.db,
      args,
    );
    await recordApiWriteAuditEvent(ctx.db, {
      action: "event_created",
      actorKind: args.actorKind,
      ownerUserId: args.ownerUserId,
      resourceType: "event",
      routeClass: "public_write",
      targetEventId: result.eventId,
      ...(community === undefined ? {} : { targetProfileId: community._id }),
      now: Date.now(),
    });

    return result;
  },
});

export const createCommunityEventForMcpOwner = internalMutation({
  args: {
    ...mcpWriteAttributionArgs,
    ...eventDraftArgs,
  },
  handler: async (ctx, args) => {
    const oauthClientId = normalizeOAuthClientId(args.oauthClientId);
    const oauthTokenId = requireMcpAttributionText(args.oauthTokenId, "OAuth token id", 256);
    const requestId = requireMcpAttributionText(args.requestId, "Request id", 256);
    const idempotencyKeyHash = requireSha256Hex(args.idempotencyKeyHash, "Idempotency key hash");
    const requestFingerprint = requireSha256Hex(args.requestFingerprint, "Request fingerprint");
    const toolName = "vrdex_event_create" as const;
    const existing = await findMcpWriteReceipt(ctx.db, {
      ownerUserId: args.ownerUserId,
      oauthClientId,
      toolName,
      idempotencyKeyHash,
      requestFingerprint,
    });

    if (existing !== null) {
      return existing.result as McpEventWriteResult;
    }

    let community: Doc<"profiles">;
    let result: McpEventWriteResult;

    try {
      ({ community, result } = await createCommunityEventForApiOwnerRecord(
        ctx.db,
        args,
      ));
    } catch {
      throw new ConvexError({ code: "MCP_WRITE_DENIED" });
    }
    const now = Date.now();
    await recordApiWriteAuditEvent(ctx.db, {
      action: "event_created",
      actorKind: "user_delegated_oauth",
      ownerUserId: args.ownerUserId,
      resourceType: "event",
      routeClass: "authenticated_mcp_write",
      targetEventId: result.eventId,
      targetProfileId: community._id,
      oauthClientId,
      oauthTokenId,
      requestId,
      mcpToolName: toolName,
      idempotencyKeyHash,
      now,
    });
    await recordMcpWriteReceipt(ctx.db, {
      ownerUserId: args.ownerUserId,
      oauthClientId,
      toolName,
      idempotencyKeyHash,
      requestFingerprint,
      result,
      now,
    });

    return result;
  },
});

export const updateCommunityEventForApiOwner = internalMutation({
  args: {
    actorKind: apiWriteAuditActorKindValidator,
    ownerUserId: v.id("users"),
    currentSlug: v.string(),
    ...eventDraftUpdateArgs,
  },
  handler: async (ctx, args) => {
    const { community, event, result } = await updateCommunityEventForApiOwnerRecord(
      ctx.db,
      args,
    );
    await recordApiWriteAuditEvent(ctx.db, {
      action: "event_updated",
      actorKind: args.actorKind,
      ownerUserId: args.ownerUserId,
      resourceType: "event",
      routeClass: "public_write",
      targetEventId: event._id,
      ...(community === undefined ? {} : { targetProfileId: community._id }),
      now: Date.now(),
    });

    return result;
  },
});

export const updateCommunityEventForMcpOwner = internalMutation({
  args: {
    ...mcpWriteAttributionArgs,
    currentSlug: v.string(),
    ...eventDraftUpdateArgs,
  },
  handler: async (ctx, args) => {
    const oauthClientId = normalizeOAuthClientId(args.oauthClientId);
    const oauthTokenId = requireMcpAttributionText(args.oauthTokenId, "OAuth token id", 256);
    const requestId = requireMcpAttributionText(args.requestId, "Request id", 256);
    const idempotencyKeyHash = requireSha256Hex(args.idempotencyKeyHash, "Idempotency key hash");
    const requestFingerprint = requireSha256Hex(args.requestFingerprint, "Request fingerprint");
    const toolName = "vrdex_event_update" as const;
    const existing = await findMcpWriteReceipt(ctx.db, {
      ownerUserId: args.ownerUserId,
      oauthClientId,
      toolName,
      idempotencyKeyHash,
      requestFingerprint,
    });

    if (existing !== null) {
      return existing.result as McpEventWriteResult;
    }

    let community: Doc<"profiles">;
    let event: Doc<"events">;
    let result: McpEventWriteResult;

    try {
      ({ community, event, result } = await updateCommunityEventForApiOwnerRecord(
        ctx.db,
        args,
      ));
    } catch {
      throw new ConvexError({ code: "MCP_WRITE_DENIED" });
    }
    const now = Date.now();
    await recordApiWriteAuditEvent(ctx.db, {
      action: "event_updated",
      actorKind: "user_delegated_oauth",
      ownerUserId: args.ownerUserId,
      resourceType: "event",
      routeClass: "authenticated_mcp_write",
      targetEventId: event._id,
      targetProfileId: community._id,
      oauthClientId,
      oauthTokenId,
      requestId,
      mcpToolName: toolName,
      idempotencyKeyHash,
      now,
    });
    await recordMcpWriteReceipt(ctx.db, {
      ownerUserId: args.ownerUserId,
      oauthClientId,
      toolName,
      idempotencyKeyHash,
      requestFingerprint,
      result,
      now,
    });

    return result;
  },
});

export const updateCommunityEvent = mutation({
  args: {
    currentSlug: v.string(),
    ...eventDraftArgs,
  },
  handler: async (ctx, args) => {
    const subject = await requireAuthenticatedSubject(ctx);
    const { userId } = await requireUser(ctx);
    const validation = validateEventSlug(args.currentSlug);

    if (!validation.ok) {
      throw new Error("Current event slug is invalid.");
    }

    const event = await getEventBySlug(ctx.db, validation.slug);

    if (event === null) {
      throw new Error("Event was not found.");
    }

    const isSubmitter = isSameAuthSubject(event.submitter, subject);

    if (!(await canUpdateEvent(ctx.db, event, subject, userId))) {
      throw new Error("You do not have permission to update this event.");
    }

    const input = sanitizeEventDraftInput(args);
    const community = await getPublishedCommunityBySlug(ctx.db, input.communitySlug);

    if (!isSubmitter && community?._id !== event.communityProfileId) {
      throw new Error("You do not have permission to move this event to another community.");
    }

    const world = await getPublishedWorldBySlug(ctx.db, input.worldSlug);

    return await updateCommunityEventRecord(ctx.db, { event, input, community, world });
  },
});

export const configureVrcdnOutput = mutation({
  args: vrcdnOutputSetupArgs,
  handler: async (ctx, args) => {
    const subject = await requireAuthenticatedSubject(ctx);
    const { event, slug } = await getMediaManageableEventBySlug(ctx, args.currentSlug, subject);

    const account = args.outputAccountKey === undefined ? undefined : getVrcdnOutputAccount(args.outputAccountKey);

    if (args.outputAccountKey !== undefined && account === undefined) {
      throw new Error("Output account is not configured.");
    }

    const output = sanitizeVrcdnOperatorOwnedOutputSetup({
      ...args,
      credentialRef: account?.credentialRef ?? args.credentialRef,
      playbackLinks: args.playbackLinks ?? account?.playbackLinks,
    });
    const now = Date.now();
    const programId = await getOrCreateEventMediaProgram(ctx.db, event, now);
    const existingOutput = await ctx.db
      .query("eventMediaOutputs")
      .withIndex("by_programId_key", (query) => query.eq("programId", programId).eq("key", output.key))
      .unique();
    const credential =
      output.credential === undefined
        ? undefined
        : {
            ...output.credential,
            authorizedAt: now,
            authorizedBy: subject,
          };
    const outputRecord = {
      programId,
      eventId: event._id,
      key: output.key,
      type: output.type,
      accountModel: output.accountModel,
      state: output.state,
      label: output.label,
      ...(credential === undefined ? {} : { credential }),
      vrcdnSetup: output.vrcdnSetup,
      compliance: output.compliance,
      playbackLinks: output.playbackLinks,
      updatedAt: now,
    };
    const outputId =
      existingOutput === null
        ? await ctx.db.insert("eventMediaOutputs", { ...outputRecord, createdAt: now })
        : existingOutput._id;

    if (existingOutput !== null) {
      await ctx.db.patch(existingOutput._id, outputRecord);
    }

    await ctx.db.patch(programId, {
      state: output.state,
      currentOutputId: output.state === "ready" ? outputId : undefined,
      publicLinks: output.state === "ready" ? output.playbackLinks : [],
      updatedAt: now,
    });

    return {
      eventId: event._id,
      eventPath: `/e/${slug}`,
      programId,
      outputId,
      state: output.state,
      publicLinkCount: output.state === "ready" ? output.playbackLinks.length : 0,
    };
  },
});

export const scheduleEventMediaWorker = mutation({
  args: eventMediaWorkerScheduleArgs,
  handler: async (ctx, args) => {
    const subject = await requireAuthenticatedSubject(ctx);
    const { event, slug } = await getMediaManageableEventBySlug(ctx, args.currentSlug, subject);
    const program = await getLatestEventMediaProgram(ctx.db, event._id);

    if (program === null) {
      throw new Error("Configure a ready event media output before scheduling a worker.");
    }

    const outputKey = optionalTrimmedText(args.outputKey, "Output key", 64)?.toLowerCase();
    const output = await getReadyEventMediaOutput(ctx.db, program, outputKey);
    const schedule = sanitizeEventMediaWorkerSchedule({
      eventStartAt: event.startAt,
      scheduledStartAt: args.scheduledStartAt,
      readyDeadlineAt: args.readyDeadlineAt,
    });
    const now = Date.now();
    const workerRuntime = optionalTrimmedText(args.workerRuntime, "Worker runtime", 80);
    const workerTaskDefinitionArn = optionalTrimmedText(args.workerTaskDefinitionArn, "Worker task definition ARN", 512);
    const workerTaskId = optionalTrimmedText(args.workerTaskId, "Worker task id", 512);
    const workerTaskStatusReason = optionalTrimmedText(args.workerTaskStatusReason, "Worker task status reason", 500);
    const artifactLinks = sanitizeEventMediaWorkerArtifactLinks(args.artifactLinks);
    const openSession = await getOpenEventMediaSession(ctx.db, program._id);

    if (openSession !== null && openSession.status !== "scheduled") {
      throw new Error("An event media worker session is already active for this event.");
    }

    const sessionRecord = {
      programId: program._id,
      eventId: event._id,
      outputId: output._id,
      status: "scheduled" as const,
      ...(workerRuntime === undefined ? {} : { workerRuntime }),
      workerProvider: args.workerProvider ?? "aws_ecs",
      ...(workerTaskDefinitionArn === undefined ? {} : { workerTaskDefinitionArn }),
      ...(workerTaskId === undefined ? {} : { workerTaskId }),
      workerTaskStatus: args.workerTaskStatus ?? "queued",
      ...(workerTaskStatusReason === undefined ? {} : { workerTaskStatusReason }),
      artifactLinks,
      scheduledStartAt: schedule.scheduledStartAt,
      readyDeadlineAt: schedule.readyDeadlineAt,
      updatedAt: now,
    };
    const sessionId =
      openSession === null
        ? await ctx.db.insert("eventMediaSessions", { ...sessionRecord, createdAt: now })
        : openSession._id;

    if (openSession !== null) {
      await ctx.db.patch(openSession._id, sessionRecord);
    }

    const startCommandId =
      openSession === null
        ? await insertEventMediaCommand(ctx.db, {
            program,
            commandType: "start_program",
            sessionId,
            outputId: output._id,
            actor: subject,
            idempotencyKey: `start:${sessionId}`,
            note: "Start the event media worker at the scheduled start time.",
            now,
          })
        : undefined;

    await ctx.db.patch(program._id, {
      state: "ready",
      currentOutputId: output._id,
      activeSessionId: sessionId,
      publicLinks: output.playbackLinks,
      updatedAt: now,
    });

    await recordEventMediaAuditEvent(ctx.db, {
      programId: program._id,
      eventId: event._id,
      sessionId,
      ...(startCommandId === undefined ? {} : { commandId: startCommandId }),
      outputId: output._id,
      actor: subject,
      action: "worker_scheduled",
      publicSummary: "Event media worker scheduled.",
      privateSummary: `Scheduled start ${schedule.scheduledStartAt}; ready deadline ${schedule.readyDeadlineAt}.`,
      createdAt: now,
    });

    return {
      eventId: event._id,
      eventPath: `/e/${slug}`,
      programId: program._id,
      outputId: output._id,
      sessionId,
      status: "scheduled" as const,
      workerTaskStatus: sessionRecord.workerTaskStatus,
      scheduledStartAt: schedule.scheduledStartAt,
      readyDeadlineAt: schedule.readyDeadlineAt,
      ...(startCommandId === undefined ? {} : { startCommandId }),
    };
  },
});

export const recordEventMediaWorkerTaskStatus = mutation({
  args: eventMediaWorkerTaskStatusArgs,
  handler: async (ctx, args) => {
    const subject = await requireAuthenticatedSubject(ctx);
    const { event, slug } = await getMediaManageableEventBySlug(ctx, args.currentSlug, subject);
    const program = await getLatestEventMediaProgram(ctx.db, event._id);

    if (program === null) {
      throw new Error("Event media program was not found.");
    }

    const session = await getWritableEventMediaSession(ctx.db, program, args.sessionId);
    const now = Date.now();
    const status = args.status ?? session.status;
    const workerId = optionalTrimmedText(args.workerId, "Worker id", 128);
    const workerRuntime = optionalTrimmedText(args.workerRuntime, "Worker runtime", 80);
    const workerTaskDefinitionArn = optionalTrimmedText(args.workerTaskDefinitionArn, "Worker task definition ARN", 512);
    const workerTaskId = optionalTrimmedText(args.workerTaskId, "Worker task id", 512);
    const workerTaskStatusReason = optionalTrimmedText(args.workerTaskStatusReason, "Worker task status reason", 500);
    const leaseExpiresAt = optionalPositiveTimestamp(args.leaseExpiresAt, "Worker lease expiration");
    const artifactLinks = args.artifactLinks === undefined ? undefined : sanitizeEventMediaWorkerArtifactLinks(args.artifactLinks);
    const shouldSetStartedAt =
      session.startedAt === undefined && ["starting", "live", "hold", "fallback"].includes(status);
    const shouldSetStoppedAt = session.stoppedAt === undefined && ["ended", "error"].includes(status);

    await ctx.db.patch(session._id, {
      status,
      ...(workerId === undefined ? {} : { workerId }),
      ...(workerRuntime === undefined ? {} : { workerRuntime }),
      ...(args.workerProvider === undefined ? {} : { workerProvider: args.workerProvider }),
      ...(workerTaskDefinitionArn === undefined ? {} : { workerTaskDefinitionArn }),
      ...(workerTaskId === undefined ? {} : { workerTaskId }),
      ...(args.workerTaskStatus === undefined ? {} : { workerTaskStatus: args.workerTaskStatus }),
      ...(workerTaskStatusReason === undefined ? {} : { workerTaskStatusReason }),
      ...(leaseExpiresAt === undefined ? {} : { leaseExpiresAt }),
      ...(artifactLinks === undefined ? {} : { artifactLinks }),
      ...(args.health === undefined
        ? {}
        : {
            health: {
              lastHeartbeatAt: now,
              ...(args.health.outputBitrateKbps === undefined ? {} : { outputBitrateKbps: args.health.outputBitrateKbps }),
              ...(args.health.audioPresent === undefined ? {} : { audioPresent: args.health.audioPresent }),
              ...(args.health.droppedSegmentCount === undefined
                ? {}
                : { droppedSegmentCount: args.health.droppedSegmentCount }),
              ...(args.health.commandFailureCount === undefined
                ? {}
                : { commandFailureCount: args.health.commandFailureCount }),
            },
          }),
      ...(shouldSetStartedAt ? { startedAt: now } : {}),
      ...(shouldSetStoppedAt ? { stoppedAt: now } : {}),
      updatedAt: now,
    });

    if (
      status === "starting" ||
      status === "live" ||
      status === "hold" ||
      status === "fallback" ||
      status === "stopping" ||
      status === "ended" ||
      status === "error"
    ) {
      await ctx.db.patch(program._id, {
        state: status,
        activeSessionId: ["ended", "error"].includes(status) ? undefined : session._id,
        updatedAt: now,
      });
    }

    if (status === "live" && session.outputId !== undefined) {
      const output = await ctx.db.get(session.outputId);

      if (output !== null) {
        await Promise.all([
          ctx.db.patch(output._id, { state: "active", updatedAt: now }),
          ctx.db.patch(program._id, { currentOutputId: output._id, publicLinks: output.playbackLinks, updatedAt: now }),
          settleEventMediaSessionCommands(ctx.db, {
            sessionId: session._id,
            commandTypes: ["start_program"],
            status: "succeeded",
            now,
          }),
        ]);
      }
    }

    if (["ended", "error"].includes(status) && session.outputId !== undefined) {
      const output = await ctx.db.get(session.outputId);

      if (output !== null && output.state === "active") {
        await ctx.db.patch(output._id, { state: "ready", updatedAt: now });
      }
    }

    if (["ended", "error"].includes(status)) {
      await settleEventMediaSessionCommands(ctx.db, {
        sessionId: session._id,
        commandTypes: ["start_program", "stop_program"],
        status: status === "error" ? "failed" : "succeeded",
        ...(status === "error" ? { errorSummary: workerTaskStatusReason ?? "Worker ended with an error." } : {}),
        now,
      });
    }

    await recordEventMediaAuditEvent(ctx.db, {
      programId: program._id,
      eventId: event._id,
      sessionId: session._id,
      ...(session.outputId === undefined ? {} : { outputId: session.outputId }),
      actor: subject,
      action: "worker_status_recorded",
      publicSummary: `Event media worker status is ${status}.`,
      ...(args.workerTaskStatus === undefined ? {} : { privateSummary: `Worker task status is ${args.workerTaskStatus}.` }),
      createdAt: now,
    });

    const updatedSession = await ctx.db.get(session._id);

    return {
      eventId: event._id,
      eventPath: `/e/${slug}`,
      programId: program._id,
      session: updatedSession === null ? workerSessionStatus(session) : workerSessionStatus(updatedSession),
    };
  },
});

export const stopEventMediaWorker = mutation({
  args: eventMediaWorkerSessionArgs,
  handler: async (ctx, args) => {
    const subject = await requireAuthenticatedSubject(ctx);
    const { event, slug } = await getMediaManageableEventBySlug(ctx, args.currentSlug, subject);
    const program = await getLatestEventMediaProgram(ctx.db, event._id);

    if (program === null) {
      throw new Error("Event media program was not found.");
    }

    const session = await getWritableEventMediaSession(ctx.db, program, args.sessionId);
    const now = Date.now();

    if (["ended", "error"].includes(session.status)) {
      throw new Error("Event media worker session has already ended.");
    }

    await ctx.db.patch(session._id, {
      status: "stopping",
      workerTaskStatus: session.workerTaskStatus === "failed" ? "failed" : "stopping",
      stopRequestedAt: now,
      updatedAt: now,
    });
    await ctx.db.patch(program._id, { state: "stopping", activeSessionId: session._id, updatedAt: now });
    const stopCommandId = await insertEventMediaCommand(ctx.db, {
      program,
      commandType: "stop_program",
      sessionId: session._id,
      outputId: session.outputId,
      actor: subject,
      idempotencyKey: `stop:${session._id}:${now}`,
      note: "Stop the event media worker.",
      now,
    });

    await recordEventMediaAuditEvent(ctx.db, {
      programId: program._id,
      eventId: event._id,
      sessionId: session._id,
      commandId: stopCommandId,
      ...(session.outputId === undefined ? {} : { outputId: session.outputId }),
      actor: subject,
      action: "worker_stop_requested",
      publicSummary: "Event media worker stop requested.",
      createdAt: now,
    });

    return {
      eventId: event._id,
      eventPath: `/e/${slug}`,
      programId: program._id,
      sessionId: session._id,
      status: "stopping" as const,
      stopCommandId,
    };
  },
});

export const markEventMediaWorkerEnded = mutation({
  args: {
    ...eventMediaWorkerSessionArgs,
    status: v.optional(v.union(v.literal("ended"), v.literal("error"))),
    workerTaskStatusReason: v.optional(v.string()),
    artifactLinks: v.optional(v.array(eventMediaWorkerArtifactLinkInput)),
  },
  handler: async (ctx, args) => {
    const subject = await requireAuthenticatedSubject(ctx);
    const { event, slug } = await getMediaManageableEventBySlug(ctx, args.currentSlug, subject);
    const program = await getLatestEventMediaProgram(ctx.db, event._id);

    if (program === null) {
      throw new Error("Event media program was not found.");
    }

    const session = await getWritableEventMediaSession(ctx.db, program, args.sessionId);
    const now = Date.now();
    const status = args.status ?? "ended";
    const workerTaskStatusReason = optionalTrimmedText(args.workerTaskStatusReason, "Worker task status reason", 500);
    const artifactLinks = args.artifactLinks === undefined ? undefined : sanitizeEventMediaWorkerArtifactLinks(args.artifactLinks);

    await ctx.db.patch(session._id, {
      status,
      workerTaskStatus: status === "error" ? "failed" : "stopped",
      ...(workerTaskStatusReason === undefined ? {} : { workerTaskStatusReason }),
      ...(artifactLinks === undefined ? {} : { artifactLinks }),
      stoppedAt: now,
      updatedAt: now,
    });
    await ctx.db.patch(program._id, {
      state: status,
      activeSessionId: undefined,
      updatedAt: now,
    });

    if (session.outputId !== undefined) {
      const output = await ctx.db.get(session.outputId);

      if (output !== null && output.state === "active") {
        await ctx.db.patch(output._id, { state: "ready", updatedAt: now });
      }
    }

    await settleEventMediaSessionCommands(ctx.db, {
      sessionId: session._id,
      commandTypes: ["start_program", "stop_program"],
      status: status === "error" ? "failed" : "succeeded",
      ...(status === "error" ? { errorSummary: workerTaskStatusReason ?? "Worker ended with an error." } : {}),
      now,
    });

    await recordEventMediaAuditEvent(ctx.db, {
      programId: program._id,
      eventId: event._id,
      sessionId: session._id,
      ...(session.outputId === undefined ? {} : { outputId: session.outputId }),
      actor: subject,
      action: status === "error" ? "worker_failed" : "worker_ended",
      publicSummary: status === "error" ? "Event media worker ended with an error." : "Event media worker ended.",
      ...(workerTaskStatusReason === undefined ? {} : { privateSummary: workerTaskStatusReason }),
      createdAt: now,
    });

    return {
      eventId: event._id,
      eventPath: `/e/${slug}`,
      programId: program._id,
      sessionId: session._id,
      status,
    };
  },
});
