import assert from "node:assert/strict";
import { describe, it } from "node:test";

import type { Doc } from "../../convex/_generated/dataModel";
import { isValidVrchatWorldId, toCanonicalVrchatWorldUrl } from "../../convex/_worldIds";
import { toPublicWorld } from "../../convex/_worldPublic";
import {
  createWorldSlugBase,
  createWorldSlugCandidate,
  normalizeWorldSlugInput,
  toWorldSlug,
  validateWorldSlug,
  WORLD_SLUG_MAX_LENGTH,
} from "../../convex/_worldSlugs";

describe("world slug helpers", () => {
  it("normalizes world names into strict ASCII slug candidates", () => {
    assert.equal(normalizeWorldSlugInput(" Neon Harbor & Friends!! "), "neon-harbor-and-friends");
  });

  it("validates canonical world slug rules", () => {
    assert.deepEqual(validateWorldSlug("neon-harbor"), {
      ok: true,
      slug: "neon-harbor",
    });
    assert.deepEqual(validateWorldSlug("Neon-Harbor"), {
      ok: false,
      reason: "invalid_format",
    });
    assert.deepEqual(validateWorldSlug("worlds"), {
      ok: false,
      reason: "reserved",
    });
  });

  it("turns freeform input into a valid world slug result", () => {
    assert.deepEqual(toWorldSlug("Neon Harbor"), {
      ok: true,
      slug: "neon-harbor",
    });
  });

  it("generates safe bases and retry candidates", () => {
    assert.equal(createWorldSlugBase("vr"), "vr-world");
    assert.equal(createWorldSlugBase("worlds"), "worlds-world");
    assert.equal(createWorldSlugBase("!!!"), "world-page");

    const base = "a".repeat(WORLD_SLUG_MAX_LENGTH);
    const candidate = createWorldSlugCandidate(base, 12);

    assert.equal(candidate.length, WORLD_SLUG_MAX_LENGTH);
    assert.equal(candidate.endsWith("-12"), true);
  });
});

describe("VRChat world id helpers", () => {
  it("accepts VRChat world ids and derives canonical URLs", () => {
    const worldId = "wrld_00000000-0000-4000-8000-000000000001";

    assert.equal(isValidVrchatWorldId(worldId), true);
    assert.equal(
      toCanonicalVrchatWorldUrl(worldId),
      "https://vrchat.com/home/world/wrld_00000000-0000-4000-8000-000000000001",
    );
  });

  it("rejects invalid world ids", () => {
    assert.equal(isValidVrchatWorldId("world_00000000-0000-4000-8000-000000000001"), false);
    assert.equal(toCanonicalVrchatWorldUrl("wrld_not-a-uuid"), null);
  });
});

describe("public world projection", () => {
  it("omits raw source and profile ids while preserving public attribution", () => {
    const world = {
      slug: "neon-harbor",
      displayName: "Neon Harbor",
      sortName: "neon harbor",
      tags: ["Club world"],
      summary: "A VRChat venue.",
      vrchatWorldId: "wrld_00000000-0000-4000-8000-000000000001",
      canonicalVrchatWorldUrl:
        "https://vrchat.com/home/world/wrld_00000000-0000-4000-8000-000000000001",
      sourceUrl: "http://example.invalid/source",
      visibilityStatus: "public",
      platformCompatibility: ["pc"],
      heroImageUrl: "http://example.invalid/hero.png",
      media: [
        {
          kind: "image",
          url: "https://example.invalid/screenshot.png",
        },
        {
          kind: "image",
          url: "http://example.invalid/unsafe.png",
        },
      ],
      creatorAttributions: [
        {
          role: "world_author",
          displayName: "Afterglow Social",
          profileId: "profile123",
          profileSlug: "afterglow-social",
          profileType: "community",
          sourceLabel: "Owner-authored",
        },
      ],
      outboundLinks: [
        {
          type: "gumroad",
          label: "Prefab pack",
          url: "https://example.invalid/prefab",
          source: "owner_authored",
        },
        {
          type: "other",
          label: "Unsafe link",
          url: "http://example.invalid/unsafe",
          source: "reviewed",
        },
      ],
      publicationState: "published",
      creationSource: "self",
      sourceAttribution: {
        sourceType: "owner",
        label: "Owner-authored metadata",
        url: "https://example.invalid/source",
        submittedAt: 1,
        confirmedAt: 2,
      },
      publishedAt: 1,
      updatedAt: 2,
    } as Doc<"worlds">;

    const publicWorld = toPublicWorld(world);

    assert.equal("creationSource" in publicWorld, false);
    assert.equal("sourceAttribution" in publicWorld, false);
    assert.equal("profileId" in publicWorld.creatorAttributions[0], false);
    assert.equal(publicWorld.creatorAttributions[0]?.profileSlug, "afterglow-social");
    assert.equal(publicWorld.source?.label, "Owner-authored metadata");
    assert.equal(publicWorld.source?.confirmedAt, 2);
    assert.equal("sourceUrl" in publicWorld, false);
    assert.equal("heroImageUrl" in publicWorld, false);
    assert.equal(publicWorld.media.length, 1);
    assert.equal(publicWorld.outboundLinks.length, 1);
  });
});
