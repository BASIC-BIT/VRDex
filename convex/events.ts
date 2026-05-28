import { v } from "convex/values";

import type { Doc, Id } from "./_generated/dataModel";
import { mutation, query, type DatabaseReader, type DatabaseWriter, type MutationCtx } from "./_generated/server";
import {
  isSameAuthSubject,
  subjectHasCommunityCapability,
  toAuthSubject,
  type AuthSubject,
} from "./_communityAuthority";
import { sanitizeEventDraftInput } from "./_eventInputs";
import { getPublicCommunityHostedEvents, getPublicEventBySlug } from "./_eventPublic";
import { findAvailableEventSlug, getEventBySlug, validateEventSlug } from "./_eventSlugs";
import { canReadProfile } from "./_profilePermissions";
import { getProfileBySlug, validateProfileSlug } from "./_profileSlugs";
import { createEventSearchDocument, upsertSearchDocument, vocabularyForEvent } from "./_searchDocuments";
import { recordVocabularyTerms } from "./_vocabulary";
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

const eventDraftArgs = {
  title: v.string(),
  startAt: v.number(),
  endAt: v.optional(v.number()),
  timezone: v.optional(v.string()),
  communitySlug: v.optional(v.string()),
  summary: v.optional(v.string()),
  notes: v.optional(v.string()),
  sourceLabel: v.optional(v.string()),
  sourceUrl: v.optional(v.string()),
  posterImageUrl: v.optional(v.string()),
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
  worldSlug: v.optional(v.string()),
  preferredSlug: v.optional(v.string()),
};

async function requireAuthenticatedSubject(ctx: MutationCtx) {
  const identity = await ctx.auth.getUserIdentity();

  if (identity === null || typeof identity !== "object") {
    throw new Error("Event changes require a signed-in user.");
  }

  return toAuthSubject(
    identity as {
      tokenIdentifier: string;
      issuer: string;
      subject: string;
      name?: string;
    },
  );
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
): Promise<boolean> {
  if (isSameAuthSubject(event.submitter, subject)) {
    return true;
  }

  if (event.communityProfileId === undefined) {
    return false;
  }

  return subjectHasCommunityCapability(db, event.communityProfileId, subject, "manage_events");
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
    .take(100);

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

function optionalValue<T>(key: string, value: T | undefined): Record<string, T> {
  return value === undefined ? {} : { [key]: value };
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

export const createCommunityEvent = mutation({
  args: eventDraftArgs,
  handler: async (ctx, args) => {
    const subject = await requireAuthenticatedSubject(ctx);
    const input = sanitizeEventDraftInput(args);
    const community = await getPublishedCommunityBySlug(ctx.db, input.communitySlug);
    const world = await getPublishedWorldBySlug(ctx.db, input.worldSlug);
    const now = Date.now();
    const slug = await findAvailableEventSlug(ctx.db, {
      title: input.title,
      startAt: input.startAt,
      preferredSlug: input.preferredSlug,
    });
    const eventId = await ctx.db.insert("events", {
      slug,
      title: input.title,
      sortTitle: input.sortTitle,
      startAt: input.startAt,
      ...optionalValue("endAt", input.endAt),
      ...optionalValue("timezone", input.timezone),
      ...optionalValue("communityProfileId", community?._id),
      ...optionalValue("communityName", community?.displayName),
      ...optionalValue("summary", input.summary),
      ...optionalValue("notes", input.notes),
      ...optionalValue("posterImageUrl", input.posterImageUrl),
      mediaLinks: input.mediaLinks,
      sourceType: "community",
      sourceLabel: input.sourceLabel,
      ...optionalValue("sourceUrl", input.sourceUrl),
      submitter: subject,
      publicationState: "published",
      publishedAt: now,
      createdAt: now,
      updatedAt: now,
    });

    await replaceEventWorldLink(ctx.db, eventId, input.startAt, world, now);
    await replaceEventParticipants(ctx.db, eventId, input.startAt, input.participantLinks, now);

    const event = await ctx.db.get(eventId);
    if (event !== null) {
      const roleLabels = input.participantLinks.map((participant) => participant.roleLabel);
      await Promise.all([
        upsertSearchDocument(
          ctx.db,
          createEventSearchDocument(event, { community, world, roleLabels }),
        ),
        recordVocabularyTerms(ctx.db, vocabularyForEvent(event, roleLabels), now),
      ]);
    }

    return {
      eventId,
      slug,
      eventPath: `/e/${slug}`,
    };
  },
});

export const updateCommunityEvent = mutation({
  args: {
    currentSlug: v.string(),
    ...eventDraftArgs,
  },
  handler: async (ctx, args) => {
    const subject = await requireAuthenticatedSubject(ctx);
    const validation = validateEventSlug(args.currentSlug);

    if (!validation.ok) {
      throw new Error("Current event slug is invalid.");
    }

    const event = await getEventBySlug(ctx.db, validation.slug);

    if (event === null) {
      throw new Error("Event was not found.");
    }

    const isSubmitter = isSameAuthSubject(event.submitter, subject);

    if (!(await canUpdateEvent(ctx.db, event, subject))) {
      throw new Error("You do not have permission to update this event.");
    }

    const input = sanitizeEventDraftInput(args);
    const community = await getPublishedCommunityBySlug(ctx.db, input.communitySlug);

    if (!isSubmitter && community?._id !== event.communityProfileId) {
      throw new Error("You do not have permission to move this event to another community.");
    }

    const world = await getPublishedWorldBySlug(ctx.db, input.worldSlug);
    const now = Date.now();
    const slug = await findAvailableEventSlug(
      ctx.db,
      {
        title: input.title,
        startAt: input.startAt,
        preferredSlug: input.preferredSlug ?? event.slug,
      },
      { excludingEventId: event._id },
    );

    await ctx.db.patch(event._id, {
      slug,
      title: input.title,
      sortTitle: input.sortTitle,
      startAt: input.startAt,
      endAt: input.endAt,
      timezone: input.timezone,
      communityProfileId: community?._id,
      communityName: community?.displayName,
      summary: input.summary,
      notes: input.notes,
      posterImageUrl: input.posterImageUrl,
      mediaLinks: input.mediaLinks,
      sourceLabel: input.sourceLabel,
      sourceUrl: input.sourceUrl,
      updatedAt: now,
    });

    await replaceEventWorldLink(ctx.db, event._id, input.startAt, world, now);
    await replaceEventParticipants(ctx.db, event._id, input.startAt, input.participantLinks, now);

    const updatedEvent = await ctx.db.get(event._id);
    if (updatedEvent !== null) {
      const roleLabels = input.participantLinks.map((participant) => participant.roleLabel);
      await Promise.all([
        upsertSearchDocument(
          ctx.db,
          createEventSearchDocument(updatedEvent, { community, world, roleLabels }),
        ),
        recordVocabularyTerms(ctx.db, vocabularyForEvent(updatedEvent, roleLabels), now),
      ]);
    }

    return {
      eventId: event._id,
      slug,
      eventPath: `/e/${slug}`,
    };
  },
});
