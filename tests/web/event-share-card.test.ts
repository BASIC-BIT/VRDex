import assert from "node:assert/strict";
import { describe, it } from "node:test";

import {
  eventShareDescription,
  eventShareMetadata,
  eventShareRevision,
  eventShareSchedule,
  eventShareTitleFontSize,
} from "../../apps/web/src/lib/event-share-card";
import { DEFAULT_SHARE_DESCRIPTION } from "../../apps/web/src/lib/profile-share-card";
import { eventShareArtworkSource } from "../../apps/web/src/lib/server/event-share-media";
import type { PublicEventShareCard } from "../../convex/_eventShareCard";

const card: PublicEventShareCard = {
  slug: "7m2kp9q",
  communitySlug: "afterglow-social",
  communityName: "Afterglow Social",
  title: "Afterglow Harbor Sessions",
  startAt: Date.UTC(2026, 5, 14, 22, 0, 0),
  timezone: "America/New_York",
  status: "scheduled",
  summary: "Late-night harbor club session.",
  artworkImageUrl: "https://media.example.test/poster.png",
};

describe("event share metadata", () => {
  it("uses the canonical community event route and revisioned image", () => {
    const metadata = eventShareMetadata(card);

    assert.equal(metadata.title, "Afterglow Harbor Sessions | VRDex");
    assert.equal(metadata.description, card.summary);
    assert.equal(metadata.alternates?.canonical, "/afterglow-social/events/7m2kp9q");
    assert.equal(metadata.openGraph?.url, "/afterglow-social/events/7m2kp9q");
    assert.equal(metadata.twitter?.card, "summary_large_image");

    const images = metadata.openGraph?.images;
    assert.ok(Array.isArray(images));
    assert.match(String(images[0]?.url), /\/opengraph-image\?revision=[0-9a-f]{16}$/);
  });

  it("bounds summaries and reuses the approved fallback", () => {
    assert.equal(eventShareDescription({}), DEFAULT_SHARE_DESCRIPTION);

    const description = eventShareDescription({ summary: `  ${"word ".repeat(60)}  ` });
    assert.equal(Array.from(description).length, 200);
    assert.equal(description.endsWith("…"), true);
    assert.equal(description.includes("  "), false);
  });

  it("changes the image revision when public card content changes", () => {
    assert.notEqual(eventShareRevision(card), eventShareRevision({ ...card, title: "Updated" }));
    assert.equal(eventShareRevision(card), eventShareRevision({ ...card }));
  });

  it("formats the authored timezone and falls back safely for invalid zones", () => {
    assert.match(eventShareSchedule(card), /Jun 14, 2026/);
    assert.match(eventShareSchedule(card), /EDT/);
    assert.match(eventShareSchedule({ startAt: card.startAt, timezone: "not-a-zone" }), /UTC/);
  });

  it("scales long titles into the generated image", () => {
    assert.equal(eventShareTitleFontSize("A".repeat(81)), 38);
    assert.equal(eventShareTitleFontSize("A".repeat(59)), 46);
    assert.equal(eventShareTitleFontSize("A".repeat(39)), 56);
    assert.equal(eventShareTitleFontSize("Afterglow"), 68);
  });
});

describe("event share artwork source", () => {
  const siteUrl = new URL("https://vrdex.example.test");

  it("permits the deterministic same-origin fixture and HTTPS artwork", () => {
    assert.equal(
      eventShareArtworkSource("/api/e2e/fixture-assets/event-poster", siteUrl)?.kind,
      "fixture",
    );
    assert.equal(
      eventShareArtworkSource("https://media.example.test/event-poster.png", siteUrl)?.kind,
      "remote",
    );
  });

  it("rejects insecure and arbitrary same-origin paths", () => {
    assert.equal(eventShareArtworkSource("http://media.example.test/poster.png", siteUrl), null);
    assert.equal(
      eventShareArtworkSource(
        "https://user:secret@vrdex.example.test/api/e2e/fixture-assets/event-poster",
        siteUrl,
      ),
      null,
    );
    assert.equal(eventShareArtworkSource("/afterglow-social", siteUrl), null);
  });
});
