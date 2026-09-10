// convex/localFixtures.ts
//
// Seeds a local anonymous deployment with the fake dataset in
// _localFixtures.ts. Mirrors hostedSmokeFixtures.ensurePublicSearchFixture:
// lookup by slug, insert or patch, refuse slugs owned by non-fixture records,
// write search documents, one audit row per created profile. Gated to
// loopback deployments so it can never run against a hosted backend.
import type { Doc, Id } from "./_generated/dataModel";
import { internalMutation, type MutationCtx } from "./_generated/server";
import { findSlugOwner } from "./_globalSlugs";
import { requireLocalDeployment } from "./_localDeployment";
import {
  LOCAL_FIXTURE_MARKER,
  localCommunityFixture,
  localEventFixtures,
  localPersonFixtures,
  localWorldFixture,
  type LocalCommunityFixture,
  type LocalPersonFixture,
} from "./_localFixtures";
import { queueProfileLinkDestinations } from "./_profileLinkDestinationCache";
import {
  reindexEventSearchDocument,
  reindexProfileSearchDocument,
  reindexWorldSearchDocument,
} from "./_searchDocuments";

type Counters = { created: number; updated: number };

function sortName(displayName: string): string {
  return displayName.toLowerCase();
}

async function ensureProfile(
  ctx: MutationCtx,
  fixture: LocalPersonFixture | LocalCommunityFixture,
  now: number,
  counters: Counters,
): Promise<Doc<"profiles">> {
  const existing = await ctx.db
    .query("profiles")
    .withIndex("by_slug", (q) => q.eq("slug", fixture.slug))
    .unique();

  const shared = {
    slug: fixture.slug,
    displayName: fixture.displayName,
    sortName: sortName(fixture.displayName),
    aliases: fixture.aliases,
    ...(fixture.searchAliases ? { searchAliases: fixture.searchAliases } : {}),
    tags: fixture.tags,
    ...(fixture.genres ? { genres: fixture.genres } : {}),
    ...(fixture.headline ? { headline: fixture.headline } : {}),
    ...(fixture.bio ? { bio: fixture.bio } : {}),
    ...(fixture.about ? { about: fixture.about } : {}),
    ...(fixture.region ? { region: fixture.region } : {}),
    ...(fixture.timezone ? { timezone: fixture.timezone } : {}),
    outboundLinks: fixture.outboundLinks,
    claimState: "unclaimed" as const,
    publicationState: "published" as const,
    publicSurfacingState: "public" as const,
    publicSurfacingUpdatedAt: now,
    publicSurfacingReason: LOCAL_FIXTURE_MARKER,
    creationSource: "moderator" as const,
    publishedAt: now,
    updatedAt: now,
  };
  const fields =
    fixture.profileType === "person"
      ? { ...shared, profileType: "person" as const, person: fixture.person }
      : { ...shared, profileType: "community" as const, community: fixture.community };

  let profileId: Id<"profiles">;

  if (existing === null) {
    const owner = await findSlugOwner(ctx.db, fixture.slug);

    if (owner !== null) {
      throw new Error(`Local fixture slug ${fixture.slug} is owned by a ${owner.kind}.`);
    }

    profileId = await ctx.db.insert("profiles", fields);
    counters.created += 1;
    await ctx.db.insert("profileAuditEvents", {
      profileId,
      action: "local_fixture_created",
      sourceType: "moderator",
      note: "Fake profile created by the local fixture seed.",
      createdAt: now,
    });
  } else {
    if (existing.publicSurfacingReason !== LOCAL_FIXTURE_MARKER) {
      throw new Error(`Local fixture slug ${fixture.slug} is owned by a non-fixture profile.`);
    }

    profileId = existing._id;
    await ctx.db.patch(profileId, fields);
    counters.updated += 1;
  }

  const profile = await ctx.db.get(profileId);

  if (profile === null) {
    throw new Error(`Local fixture profile ${fixture.slug} could not be loaded.`);
  }

  await queueProfileLinkDestinations(ctx, profile, now, { previousProfile: existing ?? undefined });
  await reindexProfileSearchDocument(ctx.db, profile, now);

  return profile;
}

async function ensureWorld(
  ctx: MutationCtx,
  profilesBySlug: Map<string, Doc<"profiles">>,
  now: number,
  counters: Counters,
): Promise<Doc<"worlds">> {
  const fixture = localWorldFixture;
  const existing = await ctx.db
    .query("worlds")
    .withIndex("by_slug", (q) => q.eq("slug", fixture.slug))
    .unique();

  const fields = {
    slug: fixture.slug,
    displayName: fixture.displayName,
    sortName: sortName(fixture.displayName),
    tags: fixture.tags,
    summary: fixture.summary,
    description: fixture.description,
    vrchatWorldId: fixture.vrchatWorldId,
    canonicalVrchatWorldUrl: fixture.canonicalVrchatWorldUrl,
    sourceUrl: fixture.sourceUrl,
    visibilityStatus: fixture.visibilityStatus,
    platformCompatibility: fixture.platformCompatibility,
    media: [],
    creatorAttributions: fixture.creatorAttributions.map((attribution) => ({
      ...attribution,
      profileId: profilesBySlug.get(attribution.profileSlug)?._id,
    })),
    outboundLinks: fixture.outboundLinks,
    publicationState: fixture.publicationState,
    creationSource: "moderator" as const,
    sourceAttribution: {
      sourceType: "moderator" as const,
      label: LOCAL_FIXTURE_MARKER,
      confirmedAt: now,
    },
    publishedAt: now,
    updatedAt: now,
  };

  let worldId: Id<"worlds">;

  if (existing === null) {
    const owner = await findSlugOwner(ctx.db, fixture.slug);

    if (owner !== null) {
      throw new Error(`Local fixture slug ${fixture.slug} is owned by a ${owner.kind}.`);
    }

    worldId = await ctx.db.insert("worlds", fields);
    counters.created += 1;
  } else {
    if (existing.sourceAttribution?.label !== LOCAL_FIXTURE_MARKER) {
      throw new Error(`Local fixture slug ${fixture.slug} is owned by a non-fixture world.`);
    }

    worldId = existing._id;
    await ctx.db.patch(worldId, fields);
    counters.updated += 1;
  }

  // Credits: replace the fixture world's rows wholesale so re-runs converge.
  const credits = await ctx.db
    .query("worldProfileCredits")
    .withIndex("by_worldId", (q) => q.eq("worldId", worldId))
    .collect();

  for (const credit of credits) {
    await ctx.db.delete(credit._id);
  }

  for (const attribution of fixture.creatorAttributions) {
    await ctx.db.insert("worldProfileCredits", {
      worldId,
      profileSlug: attribution.profileSlug,
      profileType: attribution.profileType,
      role: attribution.role,
      sourceLabel: attribution.sourceLabel,
      updatedAt: now,
    });
  }

  const world = await ctx.db.get(worldId);

  if (world === null) {
    throw new Error("Local fixture world could not be loaded.");
  }

  await reindexWorldSearchDocument(ctx.db, world, now);

  return world;
}

async function ensureEvents(
  ctx: MutationCtx,
  profilesBySlug: Map<string, Doc<"profiles">>,
  world: Doc<"worlds">,
  now: number,
  counters: Counters,
): Promise<number> {
  let count = 0;

  for (const fixture of localEventFixtures(now)) {
    const community = profilesBySlug.get(fixture.communitySlug);

    if (community === undefined) {
      throw new Error(`Local fixture event ${fixture.slug} references missing community.`);
    }

    const existing = await ctx.db
      .query("events")
      .withIndex("by_slug", (q) => q.eq("slug", fixture.slug))
      .unique();

    const fields = {
      slug: fixture.slug,
      title: fixture.title,
      sortTitle: sortName(fixture.title),
      startAt: fixture.startAt,
      doorsOpenAt: fixture.doorsOpenAt,
      endAt: fixture.endAt,
      timezone: fixture.timezone,
      communityProfileId: community._id,
      communityName: community.displayName,
      summary: fixture.summary,
      watchSurfaceEnabled: fixture.watchSurfaceEnabled,
      mediaLinks: fixture.mediaLinks,
      sourceType: "manual" as const,
      sourceLabel: fixture.sourceLabel,
      sourceUrl: fixture.sourceUrl,
      eventStatus: "scheduled" as const,
      publicationState: "published" as const,
      publishedAt: now,
      createdAt: existing?.createdAt ?? now,
      updatedAt: now,
    };

    let eventId: Id<"events">;

    if (existing === null) {
      eventId = await ctx.db.insert("events", fields);
      counters.created += 1;
    } else {
      if (existing.sourceLabel !== fixture.sourceLabel) {
        throw new Error(`Local fixture slug ${fixture.slug} is owned by a non-fixture event.`);
      }

      eventId = existing._id;
      await ctx.db.patch(eventId, fields);
      counters.updated += 1;
    }

    const joinFields = {
      eventId,
      eventStartAt: fixture.startAt,
      eventEndAt: fixture.endAt,
      eventPublicationState: "published" as const,
      eventStatus: "scheduled" as const,
      sourceType: "manual" as const,
      confirmationState: "confirmed" as const,
      confirmedAt: now,
      updatedAt: now,
    };

    for (const row of await ctx.db
      .query("eventWorlds")
      .withIndex("by_eventId", (q) => q.eq("eventId", eventId))
      .collect()) {
      await ctx.db.delete(row._id);
    }

    await ctx.db.insert("eventWorlds", { ...joinFields, worldId: world._id, confidence: 1 });

    for (const row of await ctx.db
      .query("eventParticipants")
      .withIndex("by_eventId", (q) => q.eq("eventId", eventId))
      .collect()) {
      await ctx.db.delete(row._id);
    }

    for (const performerSlug of fixture.performerSlugs) {
      const performer = profilesBySlug.get(performerSlug);

      if (performer === undefined) {
        throw new Error(`Local fixture event ${fixture.slug} references missing performer.`);
      }

      await ctx.db.insert("eventParticipants", {
        ...joinFields,
        personProfileId: performer._id,
        roleLabel: "Performer",
        sourceLabel: "Afterglow lineup",
      });
    }

    const event = await ctx.db.get(eventId);

    if (event === null) {
      throw new Error("Local fixture event could not be loaded.");
    }

    await reindexEventSearchDocument(
      ctx.db,
      event,
      { community, world, roleLabels: ["Performer"] },
      now,
    );
    count += 1;
  }

  return count;
}

export const ensureAll = internalMutation({
  args: {},
  handler: async (ctx) => {
    requireLocalDeployment();

    const now = Date.now();
    const counters: Counters = { created: 0, updated: 0 };
    const profilesBySlug = new Map<string, Doc<"profiles">>();

    for (const fixture of [...localPersonFixtures, localCommunityFixture]) {
      profilesBySlug.set(fixture.slug, await ensureProfile(ctx, fixture, now, counters));
    }

    const world = await ensureWorld(ctx, profilesBySlug, now, counters);
    const events = await ensureEvents(ctx, profilesBySlug, world, now, counters);

    return { profiles: profilesBySlug.size, worlds: 1, events, ...counters };
  },
});
