import assert from "node:assert/strict";
import { after, before, describe, it } from "node:test";

import { convexTest } from "convex-test";

import { api, internal } from "../../convex/_generated/api";
import schemaModule from "../../convex/schema";
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

const modules = {
  "../../convex/_generated/api.ts": () => import("../../convex/_generated/api"),
  "../../convex/localFixtures.ts": () => import("../../convex/localFixtures"),
  "../../convex/profiles.ts": () => import("../../convex/profiles"),
  "../../convex/worlds.ts": () => import("../../convex/worlds"),
  "../../convex/events.ts": () => import("../../convex/events"),
  "../../convex/search.ts": () => import("../../convex/search"),
};
const schema =
  (schemaModule as unknown as { default?: typeof schemaModule }).default ?? schemaModule;

describe("local fixture seed", () => {
  let previousCloudUrl: string | undefined;
  before(() => {
    previousCloudUrl = process.env.CONVEX_CLOUD_URL;
    process.env.CONVEX_CLOUD_URL = "http://127.0.0.1:3210";
  });
  after(() => {
    if (previousCloudUrl === undefined) delete process.env.CONVEX_CLOUD_URL;
    else process.env.CONVEX_CLOUD_URL = previousCloudUrl;
  });

  async function countTables(t: ReturnType<typeof convexTest>) {
    return t.run(async (ctx) => ({
      profiles: (await ctx.db.query("profiles").collect()).length,
      worlds: (await ctx.db.query("worlds").collect()).length,
      events: (await ctx.db.query("events").collect()).length,
      eventWorlds: (await ctx.db.query("eventWorlds").collect()).length,
      eventParticipants: (await ctx.db.query("eventParticipants").collect()).length,
      worldProfileCredits: (await ctx.db.query("worldProfileCredits").collect()).length,
      searchDocuments: (await ctx.db.query("searchDocuments").collect()).length,
    }));
  }

  it("seeds every fixture and is idempotent", async () => {
    const t = convexTest({ schema, modules });
    const first = await t.mutation(internal.localFixtures.ensureAll, {});
    assert.equal(first.profiles, 13);
    assert.equal(first.worlds, 1);
    assert.equal(first.events, 2);
    assert.equal(first.created, 16);
    const afterFirst = await countTables(t);
    assert.equal(afterFirst.profiles, 13);
    assert.equal(afterFirst.worlds, 1);
    assert.equal(afterFirst.events, 2);
    assert.equal(afterFirst.eventWorlds, 2);
    assert.equal(afterFirst.eventParticipants, 2);
    assert.equal(afterFirst.worldProfileCredits, 2);
    assert.equal(afterFirst.searchDocuments, 16);

    const second = await t.mutation(internal.localFixtures.ensureAll, {});
    assert.equal(second.created, 0);
    assert.equal(second.updated, 16);
    assert.deepEqual(await countTables(t), afterFirst);
  });

  it("makes the fixtures publicly visible", async () => {
    const t = convexTest({ schema, modules });
    await t.mutation(internal.localFixtures.ensureAll, {});

    const person = await t.query(api.profiles.getPublicBySlug, { slug: "playwright-dj-aurora" });
    assert.equal(person?.displayName, "DJ Aurora");

    const world = await t.query(api.worlds.getPublicBySlug, {
      slug: "playwright-neon-harbor",
      now: Date.now(),
    });
    assert.equal(world?.displayName, "Neon Harbor");

    const upcoming = await t.query(api.events.listPublicUpcoming, { now: Date.now(), limit: 8 });
    assert.ok(
      upcoming.some(
        (event: { slug?: string }) => event.slug === "playwright-afterglow-harbor-sessions",
      ),
    );

    // Per-entity pages can read a fixture that discovery never surfaces, so this
    // asserts the search projection the home page actually queries.
    const discovery = await t.query(api.search.listDiscovery, { now: Date.now() });
    assert.ok(discovery.people.some((result) => result.slug === "playwright-dj-aurora"));
    assert.ok(discovery.worlds.some((result) => result.slug === "playwright-neon-harbor"));
    assert.ok(
      discovery.upcomingEvents.some(
        (result) => result.slug === "playwright-afterglow-harbor-sessions",
      ),
    );

    // The seed writes search documents through the reindex helpers, so a seeded
    // genre must also land in `vocabularyTerms` with a real usage count.
    const genreTerms = await t.run(async (ctx) =>
      (await ctx.db.query("vocabularyTerms").collect()).filter(
        (term) => term.scope === "profile_genre" && term.key === "drum_and_bass",
      ),
    );
    assert.equal(genreTerms.length, 1);
    assert.ok(genreTerms[0].usageCount >= 1, `usageCount was ${genreTerms[0].usageCount}`);
  });

  it("refuses to run against a non-local deployment", async () => {
    const t = convexTest({ schema, modules });
    process.env.CONVEX_CLOUD_URL = "https://scrupulous-corgi-247.convex.cloud";
    try {
      await assert.rejects(
        () => t.mutation(internal.localFixtures.ensureAll, {}),
        /Local fixtures only run on a local deployment/,
      );
    } finally {
      process.env.CONVEX_CLOUD_URL = "http://127.0.0.1:3210";
    }
  });
});
