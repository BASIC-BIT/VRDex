import { convexTest } from "convex-test";

import { internal } from "../../convex/_generated/api";
import type { Doc, Id } from "../../convex/_generated/dataModel";
import { internalQuery } from "../../convex/_generated/server";
import { loadEventsWithFixtureCapacity } from "./_eventCapacityFixture";
import { bindVrcdnTestAccount } from "./_eventOutputAccountFixture";
import { newClerkUserId } from "./_clerkTestIdentity";

type T = ReturnType<typeof convexTest>;
type Alert = { key: string; subject: string; body: string };
export type SeriesOwner = Awaited<ReturnType<typeof seedSeriesCommunity>>;

export const NOW = Date.parse("2026-10-30T12:00:00Z");

export const seriesModules = {
  "../../convex/_generated/api.ts": () => import("../../convex/_generated/api"),
  "../../convex/events.ts": loadEventsWithFixtureCapacity,
  "../../convex/communityTelemetry.ts": () => import("../../convex/communityTelemetry"),
  "../../convex/profileAssets.ts": () => import("../../convex/profileAssets"),
  "../../convex/search.ts": () => import("../../convex/search"),
  "../../convex/eventSeries.ts": () => import("../../convex/eventSeries"),
  "../../convex/eventSync.ts": () => import("../../convex/eventSync"),
};

export async function loadEventSeriesWithNotifier(sent: Alert[], resolved: string[], listFails = () => false) {
  const eventSeries = await import("../../convex/eventSeries");
  return {
    ...eventSeries,
    listActiveSeriesIds: internalQuery({
      args: {},
      handler: async (ctx) => {
        if (listFails()) throw new Error("listing failed");
        return (await ctx.db.query("eventSeries").collect()).map((series) => series._id);
      },
    }),
    materializeAll: eventSeries.createMaterializeAll({
      notify: async (_ctx, alert) => { sent.push(alert); },
      resolve: async (_ctx, key) => { resolved.push(key); },
    }),
  };
}

export async function seedSeriesCommunity(t: T) {
  return t.run(async (ctx) => {
    const clerkUserId = newClerkUserId();
    const userId = await ctx.db.insert("users", {
      clerkUserId,
      name: "Community Owner",
      email: "owner@example.com",
      emailVerificationTime: Date.now(),
    });
    const profileId = await ctx.db.insert("profiles", {
      slug: "faceless",
      displayName: "The Faceless",
      sortName: "the faceless",
      aliases: [],
      tags: [],
      claimState: "claimed_verified",
      publicationState: "published",
      publicSurfacingState: "public",
      creationSource: "self",
      updatedAt: Date.now(),
      profileType: "community",
      community: { categoryTags: [] },
    });
    bindVrcdnTestAccount(profileId, "vrcdn/main");
    await ctx.db.insert("profileOwners", {
      profileId,
      userId,
      roleKey: "owner",
      state: "active",
      grantedAt: Date.now(),
      updatedAt: Date.now(),
    });
    return {
      profileId,
      userId,
      identity: { subject: clerkUserId, emailVerified: true, issuer: "test", tokenIdentifier: `test|${userId}` },
    };
  });
}

export async function seedUser(t: T, name: string) {
  return t.run(async (ctx) => {
    const clerkUserId = newClerkUserId();
    const userId = await ctx.db.insert("users", {
      clerkUserId,
      name,
      email: `${name.toLowerCase().replace(/\s+/g, "-")}@example.com`,
      emailVerificationTime: Date.now(),
    });
    return {
      userId,
      identity: { subject: clerkUserId, emailVerified: true, issuer: "test", tokenIdentifier: `test|${userId}` },
    };
  });
}

export async function insertSeries(t: T, owner: SeriesOwner, fields: Partial<Doc<"eventSeries">> = {}) {
  return t.run((ctx) =>
    ctx.db.insert("eventSeries", {
      communityProfileId: owner.profileId,
      authorityUserId: owner.userId,
      title: "Harbor Night",
      timezone: "America/New_York",
      rule: { frequency: "weekly", weekday: 5, startTime: "20:00" },
      startsOn: "2026-11-06",
      horizonDays: 60,
      state: "active",
      createdAt: NOW,
      updatedAt: NOW,
      ...fields,
    }),
  );
}

export async function createApiEvent(
  t: T,
  owner: SeriesOwner,
  fields: { title: string; startAt: number } & Record<string, unknown>,
): Promise<{ eventId: Id<"events">; slug: string }> {
  return t.mutation(internal.events.createCommunityEventForApiOwner, {
    actorKind: "personal_api_token",
    ownerUserId: owner.userId,
    communitySlug: "faceless",
    ...fields,
  } as never);
}

export async function occurrenceOrNull(t: T, seriesId: Id<"eventSeries">, date: string) {
  return t.run((ctx) =>
    ctx.db
      .query("events")
      .withIndex("by_seriesId_occurrenceDate", (q) => q.eq("seriesId", seriesId).eq("occurrenceDate", date))
      .unique(),
  );
}

export async function occurrence(t: T, seriesId: Id<"eventSeries">, date: string) {
  const event = await occurrenceOrNull(t, seriesId, date);
  if (event === null) throw new Error(`No occurrence for ${date}.`);
  return event;
}

export async function occurrences(t: T, seriesId: Id<"eventSeries">) {
  return t.run((ctx) =>
    ctx.db.query("events").withIndex("by_seriesId_occurrenceDate", (q) => q.eq("seriesId", seriesId)).collect(),
  );
}

export async function slotsFor(t: T, eventId: Id<"events">) {
  return t.run((ctx) => ctx.db.query("eventSlots").withIndex("by_eventId", (q) => q.eq("eventId", eventId)).collect());
}
