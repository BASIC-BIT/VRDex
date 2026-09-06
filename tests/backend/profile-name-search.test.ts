import assert from "node:assert/strict";
import { it } from "node:test";
import { convexTest } from "convex-test";
import schemaModule from "../../convex/schema";
import { searchPublicDocuments } from "../../convex/_publicSearch";
import { createProfileSearchDocument, toPublicSearchResult, sortSearchResults } from "../../convex/_searchDocuments";
import { profileNameMatchRank, profileNameSearchFields } from "../../convex/_profileNameSearch";
import type { Doc } from "../../convex/_generated/dataModel";

const schema = (schemaModule as unknown as { default?: typeof schemaModule }).default ?? schemaModule;
const modules = {
  "../../convex/_generated/api.ts": () => import("../../convex/_generated/api"),
  "../../convex/search.ts": () => import("../../convex/search"),
  "../../convex/profiles.ts": () => import("../../convex/profiles"),
};

async function fixture(names: string[]) {
  const t = convexTest({ schema, modules });
  await t.run(async (ctx) => {
    for (const [index, name] of names.entries()) {
      const id = await ctx.db.insert("profiles", {
        profileType: "person", slug: `person-${index}`, displayName: name,
        sortName: name.toLowerCase(), aliases: [], tags: [], person: { roleTags: [] },
        claimState: index === 0 ? "unclaimed" : "claimed_verified", creationSource: "import",
        publicationState: "published", publicSurfacingState: "public", updatedAt: index,
      });
      await ctx.db.insert("searchDocuments", createProfileSearchDocument((await ctx.db.get(id))!));
    }
  });
  return t;
}

async function titles(t: Awaited<ReturnType<typeof fixture>>, query: string) {
  return (await t.run((ctx) => searchPublicDocuments(ctx, { query }, { defaultLimit: 20, maxLimit: 20 })))
    .map((result) => result.title);
}

it("finds an interior name substring and the Outland1sh spelling through public search", async () => {
  const t = convexTest({ schema, modules });
  await t.run(async (ctx) => {
    const id = await ctx.db.insert("profiles", {
      profileType: "person", slug: "outlandish", displayName: "Outlandish",
      sortName: "outlandish", aliases: [], tags: [], person: { roleTags: [] },
      claimState: "unclaimed", creationSource: "import", publicationState: "published",
      publicSurfacingState: "public", updatedAt: 1,
    });
    await ctx.db.insert("searchDocuments", createProfileSearchDocument((await ctx.db.get(id))!));
  });
  for (const query of ["land", "Outland1sh"]) {
    const results = await t.run((ctx) => searchPublicDocuments(ctx, { query }, { defaultLimit: 10, maxLimit: 20 }));
    assert.deepEqual(results.map((result) => result.slug), ["outlandish"], query);
  }
});

it("ranks literal exact, prefix, and substring ahead of corresponding stylized matches", async () => {
  const t = await fixture(["Basic", "Basic Beats", "DJ Basic", "B4S1C", "B4S1C Beats", "DJ B4S1C"]);
  assert.deepEqual(await titles(t, "Basic"), ["Basic", "Basic Beats", "DJ Basic", "B4S1C", "B4S1C Beats", "DJ B4S1C"]);
  assert.equal((await titles(t, "B4S1C"))[0], "B4S1C");
});

it("handles digit ambiguity without conflating ordinary i/l or expanding numeric queries", async () => {
  const t = await fixture(["Lily", "Iily", "L1ly", "Deadmau5", "Deadmaus", "101", "lol", "703"]);
  assert.deepEqual(await titles(t, "Lily"), ["Lily", "L1ly"]);
  assert.deepEqual(await titles(t, "L1ly"), ["L1ly", "Lily"]);
  assert.deepEqual(await titles(t, "Deadmaus"), ["Deadmaus", "Deadmau5"]);
  assert.deepEqual(await titles(t, "101"), ["101"]);
  assert.deepEqual(await titles(t, "747"), []);
  assert.equal(profileNameMatchRank(["outlandish"], "outlndish"), 0);
  assert.equal(profileNameMatchRank(["basic"], "asi"), 4);
  assert.equal(profileNameMatchRank(["basic"], "as"), 0);
  assert.equal(profileNameMatchRank(["basic"], "451"), 0);
});

it("indexes public aliases and handles punctuation, accents and long suffixes", async () => {
  const t = await fixture(["DJ Aurora", "abcdefghijklmnopqrstuvwxyzauroralongerthanthirtytwo", "Mélodique"]);
  await t.run(async (ctx) => {
    const profile = (await ctx.db.query("profiles").collect())[0];
    await ctx.db.patch(profile._id, { aliases: ["Northern Lights"], searchAliases: ["AuroraLegacy"] });
    const updated = (await ctx.db.get(profile._id))!;
    const document = (await ctx.db.query("searchDocuments").withIndex("by_profileId", q => q.eq("profileId", profile._id)).unique())!;
    await ctx.db.patch(document._id, createProfileSearchDocument(updated));
  });
  for (const query of ["thern", "auroraleg", "dj-aurora", "DJ Aurora"]) {
    assert.ok((await titles(t, query)).includes("DJ Aurora"), query);
  }
  assert.deepEqual(await titles(t, "melod"), ["Mélodique"]);
  assert.deepEqual(await titles(t, "defghijklmnopqrstuvwxyzauroralongerthanthirtytwo"), ["abcdefghijklmnopqrstuvwxyzauroralongerthanthirtytwo"]);
});

it("does not index non-public aliases or expand genres and bios into name matches", () => {
  const profile = {
    _id: "profile", profileType: "person", slug: "aurora", displayName: "Aurora",
    aliases: ["SecretAlias"], fieldVisibility: { aliases: "unlisted" },
    tags: ["Drum and Bass"], bio: "Underground specialist", person: { roleTags: [] },
    claimState: "unclaimed", creationSource: "import", publicationState: "published",
    publicSurfacingState: "public", updatedAt: 1,
  } as unknown as Doc<"profiles">;
  const document = createProfileSearchDocument(profile);
  for (const query of ["secretalias", "ground", "bass"]) {
    assert.equal(profileNameMatchRank(document.searchNames!, query), 0);
  }
});

it("rechecks live surfacing state and honors entity and profile filters", async () => {
  const t = await fixture(["Outlandish"]);
  await t.run(async (ctx) => {
    assert.deepEqual(await searchPublicDocuments(ctx, { query: "land", entityType: "world" }, { defaultLimit: 20, maxLimit: 20 }), []);
    assert.deepEqual(await searchPublicDocuments(ctx, { query: "land", profileType: "community" }, { defaultLimit: 20, maxLimit: 20 }), []);
    const profile = (await ctx.db.query("profiles").collect())[0];
    await ctx.db.patch(profile._id, { publicSurfacingState: "suppressed" });
  });
  assert.deepEqual(await titles(t, "land"), []);
});

it("bounds index size and keeps every generated term within Convex's 32-byte limit", () => {
  const fields = profileNameSearchFields(Array.from({ length: 100 }, (_, i) => `${i}${"界abcdef".repeat(100)}`));
  assert.ok(fields.nameSearchText.length < 17_000);
  assert.ok(fields.nameSearchText.split(" ").every(term => Buffer.byteLength(term) <= 32));
  assert.equal(fields.searchNames.length, 100);
});

it("preserves exact world and event matches ahead of partial profile names", () => {
  const base = {
    publicState: "public", slug: "aurora", title: "Aurora", routePath: "/aurora",
    searchText: "Aurora", exactTokens: ["aurora"], vocabularyKeys: [], trustRank: 20,
    featuredRank: 20, updatedAt: 1,
  };
  const results = [
    { ...base, entityType: "profile", slug: "dj-aurora", title: "DJ Aurora", exactTokens: ["dj aurora"], searchNames: ["djaurora"] },
    { ...base, entityType: "world" },
    { ...base, entityType: "event" },
  ].map(document => toPublicSearchResult(document as Doc<"searchDocuments">, "Aurora"));
  assert.deepEqual(sortSearchResults(results).map(result => result.entityType), ["event", "world", "profile"]);
});

it("preserves exact aliases beyond the additional name index budget", () => {
  const profile = {
    _id: "profile", profileType: "person", slug: "long-aliases", displayName: "Performer",
    aliases: [...Array.from({ length: 8 }, (_, i) => `${i}${"alias".repeat(16)}`), "Aurora"],
    tags: [], person: { roleTags: [] }, claimState: "unclaimed", creationSource: "import",
    publicationState: "published", publicSurfacingState: "public", updatedAt: 1,
  } as unknown as Doc<"profiles">;
  const exact = createProfileSearchDocument(profile) as Doc<"searchDocuments">;
  const partial = createProfileSearchDocument({ ...profile, slug: "dj-aurora", displayName: "DJ Aurora", aliases: [] }) as Doc<"searchDocuments">;
  assert.equal(sortSearchResults([exact, partial].map(document => toPublicSearchResult(document, "Aurora")))[0].slug, "long-aliases");
});

it("ranks an exact identity ahead of an unrelated profile with the same genre", () => {
  const profile = {
    _id: "profile", profileType: "person", slug: "house", displayName: "House",
    aliases: [], tags: [], person: { roleTags: [] }, claimState: "unclaimed", creationSource: "import",
    publicationState: "published", publicSurfacingState: "public", updatedAt: 1,
  } as unknown as Doc<"profiles">;
  const exact = createProfileSearchDocument(profile) as Doc<"searchDocuments">;
  const tagged = createProfileSearchDocument({ ...profile, slug: "unrelated", displayName: "Unrelated DJ", tags: ["House"] }) as Doc<"searchDocuments">;
  assert.equal(sortSearchResults([exact, tagged].map(document => toPublicSearchResult(document, "House")))[0].slug, "house");
});

it("requires all words for keyword results instead of returning unrelated Lost profiles", async () => {
  const t = await fixture(["Lost K20", "Lost Ambitions", "Lost Melody"]);
  assert.deepEqual(await titles(t, "Lost K20"), ["Lost K20"]);
  assert.deepEqual(await titles(t, "Lost K21"), []);
});
