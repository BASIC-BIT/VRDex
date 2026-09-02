import assert from "node:assert/strict";
import { describe, it } from "node:test";

import type { Doc } from "../../convex/_generated/dataModel";
import { toPublicEventShareCard } from "../../convex/_eventShareCard";

const community = {
  _id: "community-id",
  slug: "afterglow-social",
  displayName: "Afterglow Social",
  profileType: "community",
} as unknown as Doc<"profiles">;

const event = {
  slug: "7m2kp9q",
  title: "Afterglow Harbor Sessions",
  startAt: Date.UTC(2026, 5, 14, 22, 0, 0),
  endAt: Date.UTC(2026, 5, 15, 1, 0, 0),
  timezone: "America/New_York",
  communityProfileId: community._id,
  summary: "Late-night harbor club session.",
  notes: "Private manager note that must never be projected.",
  posterImageUrl: "https://media.example.test/poster.png",
  bannerImageUrl: "https://media.example.test/banner.png",
  thumbnailImageUrl: "https://media.example.test/thumbnail.png",
  eventStatus: "scheduled",
  publicationState: "published",
} as unknown as Doc<"events">;

describe("public event share-card projection", () => {
  it("projects only public card fields and prefers poster artwork", () => {
    const projected = toPublicEventShareCard(event, community);

    assert.deepEqual(projected, {
      slug: "7m2kp9q",
      communitySlug: "afterglow-social",
      communityName: "Afterglow Social",
      title: "Afterglow Harbor Sessions",
      startAt: event.startAt,
      endAt: event.endAt,
      timezone: "America/New_York",
      status: "scheduled",
      summary: "Late-night harbor club session.",
      artworkImageUrl: "https://media.example.test/poster.png",
    });
    assert.equal(Object.hasOwn(projected!, "notes"), false);
  });

  it("falls through safe artwork fields and preserves cancellation", () => {
    const projected = toPublicEventShareCard(
      {
        ...event,
        eventStatus: "cancelled",
        posterImageUrl: "http://unsafe.example.test/poster.png",
      } as Doc<"events">,
      community,
    );

    assert.equal(projected?.status, "cancelled");
    assert.equal(projected?.artworkImageUrl, "https://media.example.test/banner.png");
  });

  it("rejects drafts, missing codes, mismatched communities, and non-community owners", () => {
    assert.equal(
      toPublicEventShareCard({ ...event, publicationState: "draft_private" } as Doc<"events">, community),
      null,
    );
    assert.equal(toPublicEventShareCard({ ...event, slug: undefined } as Doc<"events">, community), null);
    assert.equal(
      toPublicEventShareCard({ ...event, communityProfileId: "other" } as Doc<"events">, community),
      null,
    );
    assert.equal(
      toPublicEventShareCard(event, { ...community, profileType: "person" } as Doc<"profiles">),
      null,
    );
  });
});
