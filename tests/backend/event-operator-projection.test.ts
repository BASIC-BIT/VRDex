import assert from "node:assert/strict";
import { it } from "node:test";
import { convexTest } from "convex-test";
import { api } from "../../convex/_generated/api";
import schemaModule from "../../convex/schema";
// All data and authority are in-memory; no worker, listener or provider call.
const schema =
  (schemaModule as unknown as { default?: typeof schemaModule }).default ??
  schemaModule;
it("authorized source projection derives editability from server-owned lineage, including legacy profileProjection", async () => {
  const t = convexTest({
    schema,
    modules: {
      "../../convex/_generated/api.ts": () =>
        import("../../convex/_generated/api"),
      "../../convex/events.ts": () => import("../../convex/events"),
      "../../convex/eventMediaSources.ts": () =>
        import("../../convex/eventMediaSources"),
    },
  });
  const detachedSourceId = await t.run(async ({ db }) => {
    const now = Date.now();
    const user = await db.insert("users", {
      clerkUserId: "operator-fixture",
      name: "Owner",
    });
    const club = await db.insert("profiles", {
      slug: "club",
      displayName: "Club",
      sortName: "club",
      aliases: [],
      tags: [],
      claimState: "claimed_verified",
      publicationState: "published",
      publicSurfacingState: "public",
      creationSource: "self",
      updatedAt: now,
      profileType: "community",
      community: { categoryTags: [] },
    });
    await db.insert("profileOwners", {
      profileId: club,
      userId: user,
      roleKey: "owner",
      state: "active",
      grantedAt: now,
      updatedAt: now,
    });
    const eventId = await db.insert("events", {
      slug: "show",
      title: "Show",
      sortTitle: "show",
      communityProfileId: club,
      startAt: now,
      timezone: "UTC",
      sourceType: "community",
      sourceLabel: "Fixture",
      eventStatus: "scheduled",
      publicationState: "draft_private",
      createdAt: now,
      updatedAt: now,
    });
    const programId = await db.insert("eventMediaPrograms", {
      eventId,
      state: "ready",
      publicLinks: [],
      directFallbackLinks: [],
      createdAt: now,
      updatedAt: now,
    });
    await db.insert("eventMediaSources", {
      eventId,
      programId,
      key: "source-0",
      position: 0,
      type: "twitch_watch",
      purpose: "program",
      state: "ready",
      label: "Source 0",
      input: { kind: "twitch", channel: "fixture" },
      publicUrl: "https://www.twitch.tv/fixture",
      profileProjection: false,
      createdAt: now,
      updatedAt: now,
    });
    // The legacy marker alone does not make this detached row available.
    const detachedSourceId = await db.insert("eventMediaSources", {
      eventId,
      programId,
      key: "source-1",
      position: 1,
      type: "twitch_watch",
      purpose: "program",
      state: "ready",
      label: "Source 1",
      input: { kind: "twitch", channel: "fixture" },
      publicUrl: "https://www.twitch.tv/fixture",
      profileProjection: true,
      createdAt: now,
      updatedAt: now,
    });
    const personProfileId = await db.insert("profiles", {
      slug: "performer",
      displayName: "Performer",
      sortName: "performer",
      aliases: [],
      tags: [],
      claimState: "claimed_verified",
      publicationState: "published",
      publicSurfacingState: "public",
      creationSource: "self",
      updatedAt: now,
      profileType: "person",
      person: { roleTags: [] },
      outboundLinks: [
        {
          source: "owner_authored",
          type: "twitch",
          label: "Twitch",
          url: "https://www.twitch.tv/fixture",
        },
      ],
    });
    const eventSlotId = await db.insert("eventSlots", {
      eventId,
      personProfileId,
      position: 0,
      startAt: now,
      displayLabel: "Performer",
      roleLabel: "DJ",
      sourceType: "community",
      sourceLabel: "Fixture",
      confidence: 1,
      reviewState: "confirmed",
      broadcastInput: { kind: "twitch", channel: "fixture" },
      updatedAt: now,
    });
    await db.insert("eventMediaSources", {
      eventId,
      programId,
      eventSlotId,
      sourceProfileId: personProfileId,
      key: `slot-${eventSlotId}`,
      position: 2,
      type: "twitch_watch",
      purpose: "program",
      state: "ready",
      label: "Available projection",
      input: { kind: "twitch", channel: "fixture" },
      publicUrl: "https://www.twitch.tv/fixture",
      profileProjection: true,
      createdAt: now,
      updatedAt: now,
    });
    return detachedSourceId;
  });
  const owner = t.withIdentity({
    subject: "operator-fixture",
    issuer: "test",
    tokenIdentifier: "test|operator-fixture",
  });
  const status = await owner.query(api.events.getEventMediaControlStatus, {
    currentSlug: "show",
  });
  assert.equal(
    status.sources.some((source) => source.sourceId === detachedSourceId),
    false,
  );
  assert.deepEqual(
    status.sources.map((source) => ({
      label: source.label,
      editable: source.editable,
    })),
    [
      { label: "Source 0", editable: true },
      { label: "Available projection", editable: false },
    ],
  );
  await assert.rejects(
    t.query(api.events.getEventMediaControlStatus, { currentSlug: "show" }),
  );
  await assert.rejects(
    owner.mutation(api.eventMediaSources.rename, {
      currentSlug: "show",
      sourceId: detachedSourceId,
      label: "Renamed legacy source",
    }),
    { message: "Only custom event sources can be edited." },
  );
});
