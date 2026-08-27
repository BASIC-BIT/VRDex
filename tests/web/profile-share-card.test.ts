import assert from "node:assert/strict";
import { describe, it } from "node:test";

import {
  DEFAULT_SHARE_DESCRIPTION,
  profileInitials,
  profileShareDescription,
  profileShareMetadata,
} from "../../apps/web/src/lib/profile-share-card";

describe("profile share metadata", () => {
  it("uses the canonical root slug and approved profile title format", () => {
    const metadata = profileShareMetadata({
      profileType: "person",
      slug: "dj-aurora",
      displayName: "DJ Aurora",
      summary: "Melodic house sets for late-night VRChat floors.",
    });

    assert.equal(metadata.title, "DJ Aurora | VRDex");
    assert.equal(metadata.description, "Melodic house sets for late-night VRChat floors.");
    assert.equal(metadata.alternates?.canonical, "/dj-aurora");
    assert.equal(metadata.openGraph?.url, "/dj-aurora");
    assert.equal(metadata.openGraph?.title, "DJ Aurora | VRDex");
    assert.equal(metadata.twitter?.card, "summary_large_image");
  });

  it("falls back to existing VRDex copy and bounds long summaries", () => {
    assert.equal(profileShareDescription({}), DEFAULT_SHARE_DESCRIPTION);

    const description = profileShareDescription({ summary: `  ${"word ".repeat(60)}  ` });
    assert.equal(description.length, 200);
    assert.equal(description.endsWith("…"), true);
    assert.equal(description.includes("  "), false);
  });

  it("builds restrained initials when no public image is available", () => {
    assert.equal(profileInitials("DJ Aurora"), "DA");
    assert.equal(profileInitials("BASICBIT"), "B");
    assert.equal(profileInitials("   "), "VR");
  });
});
