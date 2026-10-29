import assert from "node:assert/strict";
import test from "node:test";
import type { DiscoveryEventCandidate, DiscoveryEventSignal, DiscoveryProfileSignal } from "../../convex/_homeDiscoveryTypes";
import { discoveryEventGenres, selectDiscovery } from "../../apps/web/src/lib/discovery/recommendations";
import { discoveryRotationKey } from "../../apps/web/src/lib/discovery/rotation";

const genre = (slug: string, displayName = slug) => ({ slug, displayName });
const person = (id: string, slugs: string[] = []): DiscoveryProfileSignal => ({ id, slug: id, displayName: id, profileType: "person", genres: slugs.map((slug) => genre(slug)) });
const club = (id: string, slugs: string[] = []): DiscoveryProfileSignal => ({ ...person(id, slugs), profileType: "community" });
const event = (id: string, host = id, eventDate = "2026-10-29"): DiscoveryEventCandidate => ({ id, slug: id, href: `/events/${id}`, title: id, host: { id: host, slug: host, displayName: host }, schedule: { kind: "date_only", eventDate } });
const signal = (eventId: string, performers: DiscoveryProfileSignal[] = [], coverage: DiscoveryEventSignal["coverage"] = "complete"): DiscoveryEventSignal => ({ eventId, performers, coverage, manualLabels: [] });
const rotationKey = discoveryRotationKey({ seed: "session-a", localDate: "2026-10-28" });
const select = (input: Partial<Parameters<typeof selectDiscovery>[0]> = {}) => selectDiscovery({ events: [], eventSignals: [], clubs: [], favoriteProfiles: [], favoriteProfileIds: [], rotationKey, ...input });
const ids = (items: { id: string }[]) => items.map(({ id }) => id);

test("blendsFamiliarAndUnfamiliar", () => {
  const favorite = person("favorite", ["house"]);
  const result = select({ events: [event("plain"), event("familiar"), event("discovery"), event("host-favorite", "club")], eventSignals: [signal("familiar", [favorite]), signal("discovery", [person("new", ["house"])]), signal("plain"), signal("host-favorite")], favoriteProfiles: [favorite], favoriteProfileIds: ["favorite", "club"], clubs: [club("club"), club("new-club", ["house"]), club("plain-club")] });
  assert.deepEqual(ids(result.events), ["familiar", "discovery"]);
  assert.deepEqual(ids(result.clubs), ["club", "new-club"]);
});

test("usesExactPublicGenreIdentity", () => {
  const favorite = { ...person("favorite"), genres: [genre("house", "Shared label"), genre("house", "Shared label")] };
  const wrong = { ...person("wrong"), genres: [genre("other-house", "Shared label")] };
  assert.deepEqual(ids(select({ events: [event("connected"), event("wrong"), event("exact")], eventSignals: [signal("connected", [favorite]), signal("wrong", [wrong]), signal("exact", [person("new", ["house"])])], favoriteProfileIds: ["favorite", "hidden"], favoriteProfiles: [favorite, favorite, person("not-favorite", ["other-house"])] }).events), ["connected", "exact"]);
});

test("reachesPastNextWeekWithoutTimePenalty", () => {
  const favorite = person("favorite", ["techno"]);
  const input = { events: [event("near"), event("far", "far", "2030-01-01"), event("familiar")], eventSignals: [signal("near"), signal("far", [person("new", ["techno"])]), signal("familiar", [favorite])], favoriteProfiles: [favorite], favoriteProfileIds: [favorite.id] };
  assert.deepEqual(ids(select(input).events), ["familiar", "far"]);
  assert.deepEqual(ids(select({ ...input, events: input.events.map((item) => ({ ...item, posterImageUrl: item.id === "near" ? "https://example.com/wide.jpg" : undefined })) }).events), ["familiar", "far"]);
});

test("prefersDifferentHosts", () => {
  const favorite = person("favorite", ["house"]);
  assert.deepEqual(ids(select({ events: [event("familiar", "same"), event("same-host", "same"), event("other-host", "other")], eventSignals: [signal("familiar", [favorite]), signal("same-host", [person("new", ["house"])]), signal("other-host")], favoriteProfileIds: [favorite.id], favoriteProfiles: [favorite] }).events), ["familiar", "other-host"]);
});

test("fillsSparseCategoriesWithoutDuplicates", () => {
  const only = event("only");
  assert.deepEqual(ids(select({ events: [only, only], clubs: [club("only"), club("only")] }).events), ["only"]);
  assert.deepEqual(ids(select({ clubs: [club("only"), club("only")] }).clubs), ["only"]);
  assert.equal(select({ events: [event("a"), event("b"), event("c")], favoriteProfileIds: ["a", "b", "c"] }).events.length, 2);
  assert.deepEqual(select(), { events: [], clubs: [] });
});

test("coldStartHasStableVariety", () => {
  const events = Array.from({ length: 12 }, (_, index) => event(`event-${index}`));
  const input = { events, eventSignals: events.map(({ id }) => signal(id)), clubs: Array.from({ length: 12 }, (_, index) => club(`club-${index}`)) };
  const result = select(input);
  assert.deepEqual(select({ ...input, events: [...events].reverse(), clubs: [...input.clubs].reverse() }), result);
  assert.deepEqual(ids(result.events), ["event-10", "event-0"]);
  assert.deepEqual(ids(result.clubs), ["club-1", "club-4"]);
  assert.notDeepEqual(select({ ...input, rotationKey: discoveryRotationKey({ seed: "session-b", localDate: "2026-10-28" }) }), result);
  assert.notDeepEqual(select({ ...input, rotationKey: discoveryRotationKey({ seed: "session-a", localDate: "2026-10-29" }) }), result);
});

test("doesNotInferCommunityGenresFromLineups", () => {
  const favorite = person("favorite", ["house"]);
  const clubs = [club("host"), club("own-genres", ["house"]), club("plain")];
  assert.equal(select({ events: [event("lineup", "host")], eventSignals: [signal("lineup", [favorite])], clubs, favoriteProfileIds: [favorite.id], favoriteProfiles: [favorite] }).clubs[0]?.id, "own-genres");
  assert.deepEqual(clubs[0]?.genres, []);
});

test("partial unmatched evidence stays unknown while positive partial matches are familiar", () => {
  const favorite = person("favorite", ["house"]);
  assert.deepEqual(ids(select({ events: [event("partial-positive"), event("unknown"), event("complete-new")], eventSignals: [signal("partial-positive", [favorite], "partial"), signal("unknown", [person("new", ["house"])], "partial"), signal("complete-new")], favoriteProfileIds: [favorite.id], favoriteProfiles: [favorite] }).events), ["partial-positive", "complete-new"]);
  assert.equal(select({ events: [event("unknown")], eventSignals: [], favoriteProfileIds: [favorite.id] }).events.length, 1);
});

test("deduplicates profile weights and candidate slugs while preserving performer provenance", () => {
  const a = person("a", ["house", "house"]);
  const b = person("b", ["house"]);
  const c = person("c", ["techno"]);
  assert.equal(select({ clubs: [club("house", ["house", "house"]), club("techno", ["techno"])], favoriteProfileIds: ["a", "b", "c"], favoriteProfiles: [a, a, b, c] }).clubs[0]?.id, "house");
  assert.deepEqual(discoveryEventGenres(signal("e", [a, a, b])), [
    { performer: { id: "a", slug: "a", displayName: "a" }, genres: [genre("house")] },
    { performer: { id: "b", slug: "b", displayName: "b" }, genres: [genre("house")] },
  ]);
});

test("does not mutate readonly inputs or disclose favorite metadata without public signals", () => {
  const input = { events: [event("a"), event("b")], eventSignals: [signal("a"), signal("b")], clubs: [club("a"), club("b")], favoriteProfiles: [], favoriteProfileIds: ["hidden"], rotationKey };
  const before = structuredClone(input);
  for (const values of [input.events, input.eventSignals, input.clubs, input.favoriteProfiles, input.favoriteProfileIds]) Object.freeze(values);
  selectDiscovery(input);
  assert.deepEqual(input, before);
  assert.deepEqual(discoveryEventGenres(undefined), []);
});

test("ranks familiar events by unique favorite DJs then favorite host before affinity", () => {
  const a = person("a", ["house"]);
  const b = person("b");
  const input = { favoriteProfileIds: ["a", "b", "favorite-host"], favoriteProfiles: [a, b], events: [event("one", "favorite-host"), event("two"), event("new")], eventSignals: [signal("one", [a, a]), signal("two", [a, b]), signal("new")] };
  assert.deepEqual(ids(select(input).events), ["two", "new"]);
  assert.deepEqual(ids(select({ ...input, eventSignals: [signal("one", [b]), signal("two", [a]), signal("new")] }).events), ["one", "new"]);
});

test("each unique favorite contributes once per exact slug and each candidate slug scores once", () => {
  const a = person("a", ["house", "house"]);
  const b = person("b", ["techno"]);
  const c = person("c", ["techno"]);
  const result = select({ events: [event("familiar"), event("house"), event("techno")], eventSignals: [signal("familiar", [a]), signal("house", [person("new-house", ["house", "house", "house"])]), signal("techno", [person("new-techno", ["techno"])])], favoriteProfiles: [a, a, a, b, c], favoriteProfileIds: ["a", "a", "b", "c"] });
  assert.deepEqual(ids(result.events), ["familiar", "techno"]);
});

test("manual labels and unpublished favorite metadata supply no genre affinity", () => {
  const result = select({ events: [event("familiar"), event("manual"), event("public")], eventSignals: [signal("familiar", [person("favorite")]), { ...signal("manual"), manualLabels: ["favorite", "house"] }, signal("public", [person("new", ["house"])])], favoriteProfileIds: ["favorite", "hidden"], favoriteProfiles: [person("favorite", ["house"])] });
  assert.deepEqual(ids(result.events), ["familiar", "public"]);
  assert.deepEqual(discoveryEventGenres({ ...signal("manual"), manualLabels: ["house"] }), []);
});

test("fills both slots from familiar-only and unknown-only pools", () => {
  const events = [event("a", "favorite-host"), event("b", "other-favorite")];
  assert.equal(select({ events, favoriteProfileIds: ["favorite-host", "other-favorite"] }).events.length, 2);
  assert.equal(select({ events }).events.length, 2);
  assert.equal(select({ clubs: [club("a"), club("b")], favoriteProfileIds: ["a", "b"] }).clubs.length, 2);
});

test("preserves the familiar/new blend when only the new candidate shares a host", () => {
  const favorite = person("favorite");
  const result = select({ events: [event("familiar", "shared"), event("other-familiar", "other"), event("new", "shared")], eventSignals: [signal("familiar", [favorite, person("second-favorite")]), signal("other-familiar", [favorite]), signal("new")], favoriteProfileIds: ["favorite", "second-favorite"] });
  assert.deepEqual(ids(result.events), ["familiar", "new"]);
});
