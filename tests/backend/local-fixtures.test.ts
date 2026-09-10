import assert from "node:assert/strict";
import { describe, it } from "node:test";

import {
  LOCAL_FIXTURE_SLUG_PREFIX,
  allLocalFixtureSlugs,
  allLocalFixtureUrls,
  localCommunityFixture,
  localEventFixtures,
  localPersonFixtures,
  localWorldFixture,
} from "../../convex/_localFixtures";

const now = Date.UTC(2026, 8, 10, 12, 0, 0);

describe("local fixture data", () => {
  it("has the expected record counts", () => {
    assert.equal(localPersonFixtures.length, 12);
    assert.equal(localEventFixtures(now).length, 2);
    assert.equal(localCommunityFixture.profileType, "community");
    assert.equal(localWorldFixture.publicationState, "published");
  });

  it("keeps every slug under the playwright- prefix and unique", () => {
    const slugs = allLocalFixtureSlugs(now);
    assert.equal(new Set(slugs).size, slugs.length);
    for (const slug of slugs) {
      assert.ok(slug.startsWith(LOCAL_FIXTURE_SLUG_PREFIX), slug);
      assert.notEqual(slug, "basicbit");
    }
  });

  it("keeps every URL on an .invalid host", () => {
    const urls = allLocalFixtureUrls(now);
    assert.ok(urls.length > 20);
    for (const url of urls) {
      assert.ok(new URL(url).hostname.endsWith(".invalid"), url);
    }
  });

  it("puts one event ahead of now and one behind", () => {
    const [upcoming, past] = localEventFixtures(now);
    assert.ok(upcoming.startAt > now);
    assert.ok((past.endAt ?? past.startAt) < now);
  });
});
