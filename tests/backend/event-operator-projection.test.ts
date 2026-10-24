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
    },
  });
  await t.run(async ({ db }) => {
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
    for (const [index, projection] of [false, true].entries())
      await db.insert("eventMediaSources", {
        eventId,
        programId,
        key: `source-${index}`,
        position: index,
        type: "twitch_watch",
        purpose: "program",
        state: "ready",
        label: `Source ${index}`,
        input: { kind: "twitch", channel: "fixture" },
        publicUrl: "https://www.twitch.tv/fixture",
        profileProjection: projection,
        createdAt: now,
        updatedAt: now,
      });
  });
  const owner = t.withIdentity({
    subject: "operator-fixture",
    issuer: "test",
    tokenIdentifier: "test|operator-fixture",
  });
  const status = await owner.query(api.events.getEventMediaControlStatus, {
    currentSlug: "show",
  });
  assert.deepEqual(
    status.sources.map((source) => ({
      label: source.label,
      editable: source.editable,
    })),
    [
      { label: "Source 0", editable: true },
      { label: "Source 1", editable: false },
    ],
  );
  await assert.rejects(
    t.query(api.events.getEventMediaControlStatus, { currentSlug: "show" }),
  );
});
