import assert from "node:assert/strict";
import { describe, it } from "node:test";

import {
  DEFAULT_SHARE_DESCRIPTION,
  profileInitials,
  profileShareDescription,
  profileShareMetadata,
  profileShareNameFontSize,
  profileShareTrustNote,
} from "../../apps/web/src/lib/profile-share-card";
import { publicSiteUrl } from "../../apps/web/src/lib/public-site-url";
import { inlineableProfileShareAssetUrl } from "../../apps/web/src/lib/profile-share-media";

function withEnvironment(
  values: Record<string, string | undefined>,
  run: () => void,
): void {
  const previous = Object.fromEntries(
    Object.keys(values).map((key) => [key, process.env[key]]),
  );

  try {
    for (const [key, value] of Object.entries(values)) {
      if (value === undefined) delete process.env[key];
      else process.env[key] = value;
    }
    run();
  } finally {
    for (const [key, value] of Object.entries(previous)) {
      if (value === undefined) delete process.env[key];
      else process.env[key] = value;
    }
  }
}

describe("profile share metadata", () => {
  it("uses the canonical root slug and approved profile title format", () => {
    const metadata = profileShareMetadata({
      profileType: "person",
      slug: "dj-aurora",
      displayName: "DJ Aurora",
      trustLabel: "claimed_verified",
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
    assert.equal(profileInitials("🎧 Aurora"), "🎧A");
    assert.equal(profileInitials("   "), "VR");
  });

  it("uses existing public trust wording only for unclaimed profiles", () => {
    assert.equal(profileShareTrustNote({ trustLabel: "community_submitted" }), "Community submitted");
    assert.equal(profileShareTrustNote({ trustLabel: "unclaimed" }), "Unclaimed");
    assert.equal(profileShareTrustNote({ trustLabel: "claimed_unverified" }), undefined);
    assert.equal(profileShareTrustNote({ trustLabel: "claimed_verified" }), undefined);
  });

  it("does not split Unicode characters when truncating a summary", () => {
    const summary = `${"A".repeat(198)}🎧BC`;
    const description = profileShareDescription({ summary });

    assert.equal(description, `${"A".repeat(198)}🎧…`);
    assert.equal(description.includes("�"), false);
  });

  it("scales valid maximum-length names into the generated image", () => {
    assert.equal(profileShareNameFontSize("A".repeat(80)), 28);
    assert.equal(profileShareNameFontSize("A".repeat(50)), 36);
    assert.equal(profileShareNameFontSize("DJ Aurora"), 76);
  });

  it("lets self-hosted production override the BASIC BIT origin", () => {
    withEnvironment(
      {
        VRDEX_PUBLIC_SITE_URL: "https://profiles.example.test",
        VERCEL_ENV: "production",
        VERCEL_URL: "vrdex-fork.vercel.app",
        SITE_URL: "https://legacy.example.test",
      },
      () => assert.equal(publicSiteUrl().href, "https://profiles.example.test/"),
    );
  });

  it("keeps official production and preview origins deterministic", () => {
    withEnvironment(
      {
        VRDEX_PUBLIC_SITE_URL: undefined,
        VERCEL_ENV: "production",
        VERCEL_URL: "ignored.vercel.app",
        SITE_URL: "https://ignored.example.test",
      },
      () => assert.equal(publicSiteUrl().href, "https://vrdex.net/"),
    );

    withEnvironment(
      {
        VRDEX_PUBLIC_SITE_URL: undefined,
        VRDEX_DEPLOYMENT_ENV: undefined,
        VERCEL_ENV: "preview",
        VERCEL_URL: "preview-vrdex.vercel.app",
        SITE_URL: "https://ignored.example.test",
      },
      () => assert.equal(publicSiteUrl().href, "https://preview-vrdex.vercel.app/"),
    );
  });

  it("keeps staging metadata on its stable custom domain", () => {
    withEnvironment(
      {
        VRDEX_PUBLIC_SITE_URL: undefined,
        VRDEX_DEPLOYMENT_ENV: "staging",
        VERCEL_ENV: "preview",
        VERCEL_URL: "changing-deployment.vercel.app",
      },
      () => assert.equal(publicSiteUrl().href, "https://staging.vrdex.net/"),
    );
  });

  it("inlines only known same-origin profile asset routes", () => {
    const siteUrl = new URL("https://profiles.example.test");

    assert.equal(
      inlineableProfileShareAssetUrl(
        "/api/v0/profiles/dj-aurora/assets/asset-123/file",
        siteUrl,
      )?.href,
      "https://profiles.example.test/api/v0/profiles/dj-aurora/assets/asset-123/file",
    );
    assert.equal(
      inlineableProfileShareAssetUrl("/api/e2e/fixture-assets/avatar", siteUrl)?.href,
      "https://profiles.example.test/api/e2e/fixture-assets/avatar",
    );
    assert.equal(inlineableProfileShareAssetUrl("/dj-aurora/opengraph-image", siteUrl), null);
    assert.equal(
      inlineableProfileShareAssetUrl(
        "https://images.example.test/api/v0/profiles/dj-aurora/assets/asset-123/file",
        siteUrl,
      ),
      null,
    );
  });
});
