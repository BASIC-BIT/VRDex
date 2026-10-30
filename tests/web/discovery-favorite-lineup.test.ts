import assert from "node:assert/strict";
import { it } from "node:test";
import type { FavoriteLineupArgs, FavoriteLineupResult } from "../../convex/_homeDiscoveryTypes";
import type { DiscoveryQuery } from "../../apps/web/src/lib/discovery/controller";

const load = () => import("../../apps/web/src/lib/discovery/favorite-lineup");
const identity = (id: string) => ({ id, slug: id, displayName: id });
const favorites = Array.from({ length: 500 }, (_, i) => `favorite-${String(i).padStart(3, "0")}`);
function harness() {
  let pending = 0, peak = 0;
  const calls: { args: FavoriteLineupArgs; closed: boolean; send(value?: FavoriteLineupResult): void; fail(): void }[] = [];
  const transport = { favoriteLineup(args: FavoriteLineupArgs): DiscoveryQuery<FavoriteLineupResult> {
    return { subscribe(next, error) {
      pending++; peak = Math.max(peak, pending);
      let first = true;
      const finish = () => { if (first) { first = false; pending--; } };
      const call = { args, closed: false,
        send(value = { items: args.eventIds.map(eventId => ({ eventId, performers: args.favoriteProfileIds.map(identity) })) }) { finish(); next(value); },
        fail() { finish(); error(new Error("offline")); } };
      calls.push(call);
      return () => { finish(); call.closed = true; };
    } };
  } };
  return { transport, calls, peak: () => peak };
}
async function settle() { for (let i = 0; i < 30; i++) await Promise.resolve(); }
async function complete(h: ReturnType<typeof harness>, start = 0) {
  for (let i = start; i < h.calls.length; i++) { h.calls[i]!.send(); await settle(); }
}

it("aggregatesAllTwentyBatchesForFiveHundredFavorites", async () => {
  const { createFavoriteLineupController } = await load();
  const h = harness(), c = createFavoriteLineupController({ transport: h.transport });
  c.setContext({ eventIds: ["event", "second"], favoriteProfileIds: favorites });
  assert.equal(h.calls.length, 3);
  await complete(h);
  assert.equal(h.calls.length, 20);
  assert.ok(h.calls.every(call => call.args.favoriteProfileIds.length <= 25 && call.args.eventIds.length <= 2));
  assert.equal(h.peak(), 3);
  const s = c.getSnapshot(); assert.equal(s.kind, "available");
  if (s.kind === "available") for (const item of s.items) assert.deepEqual(item.performers.map(person => person.id), favorites);
  if (s.kind === "available") assert.deepEqual(s.items.map(item => item.eventId), ["event", "second"]);
  c.dispose(); assert.ok(h.calls.every(call => call.closed));
});

it("doesNotPublishAnArbitraryPartialSubset", async () => {
  const { createFavoriteLineupController } = await load();
  const h = harness(), c = createFavoriteLineupController({ transport: h.transport });
  const published: string[] = [];
  const unsubscribe = c.subscribe(() => published.push(c.getSnapshot().kind));
  c.setContext({ eventIds: ["event"], favoriteProfileIds: favorites });
  for (let i = 0; i < 19; i++) { h.calls[i]!.send(); await settle(); assert.equal(c.getSnapshot().kind, "loading"); }
  assert.ok(!published.includes("available"));
  h.calls[19]!.send(); await settle(); assert.equal(c.getSnapshot().kind, "available");
  unsubscribe(); c.dispose();
});

it("ignoresObsoleteResponses", async () => {
  const { createFavoriteLineupController } = await load();
  const h = harness(), c = createFavoriteLineupController({ transport: h.transport });
  c.setContext({ eventIds: ["old"], favoriteProfileIds: favorites });
  const obsolete = h.calls.slice();
  c.setContext({ eventIds: ["new"], favoriteProfileIds: ["new-favorite"] });
  assert.ok(obsolete.every(call => call.closed));
  obsolete.forEach(call => { call.send(); call.fail(); });
  await complete(h, obsolete.length);
  const s = c.getSnapshot(); assert.equal(s.kind, "available");
  if (s.kind === "available") assert.deepEqual(s.items, [{ eventId: "new", performers: [identity("new-favorite")] }]);
  assert.equal(h.calls.length, 4, "Cancelled generations must not launch queued batches");
  c.dispose(); const disposed = c.getSnapshot(); h.calls[3]!.send(); assert.equal(c.getSnapshot(), disposed);
});

it("removesRevokedMatches", async () => {
  const { createFavoriteLineupController } = await load();
  const h = harness(), c = createFavoriteLineupController({ transport: h.transport });
  c.setContext({ eventIds: ["event"], favoriteProfileIds: favorites.slice(0, 50) });
  await complete(h); assert.equal(c.getSnapshot().kind, "available");
  h.calls[0]!.send({ items: [{ eventId: "event", performers: [] }] });
  assert.equal(c.getSnapshot().kind, "loading", "Changed public results clear all previously trusted matches immediately");
  assert.ok(h.calls.slice(0, 2).every(call => call.closed));
  h.calls[2]!.send({ items: [{ eventId: "event", performers: [] }] });
  await settle(); assert.equal(c.getSnapshot().kind, "loading");
  h.calls[3]!.send(); await settle();
  const s = c.getSnapshot(); assert.equal(s.kind, "available");
  if (s.kind === "available") assert.deepEqual(s.items[0]?.performers.map(person => person.id), favorites.slice(25, 50));
  c.dispose();
});

it("omitsEventRevokedInAnyBatch", async () => {
  const { createFavoriteLineupController } = await load();
  const h = harness(), c = createFavoriteLineupController({ transport: h.transport });
  c.setContext({ eventIds: ["event"], favoriteProfileIds: favorites.slice(0, 50) });
  h.calls[0]!.send({ items: [] }); h.calls[1]!.send(); await settle();
  assert.deepEqual(c.getSnapshot(), { kind: "available", items: [] }); c.dispose();
});

it("skipsEmptyFavorites", async () => {
  const { createFavoriteLineupController } = await load();
  const h = harness(), c = createFavoriteLineupController({ transport: h.transport });
  c.setContext({ eventIds: ["event"], favoriteProfileIds: [] });
  assert.deepEqual(c.getSnapshot(), { kind: "available", items: [] });
  c.setContext({ eventIds: [], favoriteProfileIds: favorites });
  assert.equal(h.calls.length, 0); c.dispose();
});

it("clearsErrorsAndRetriesWithoutPublishingOldMatches", async () => {
  const { createFavoriteLineupController } = await load();
  const h = harness(), c = createFavoriteLineupController({ transport: h.transport });
  c.setContext({ eventIds: ["event"], favoriteProfileIds: ["person"] });
  await complete(h); h.calls[0]!.fail(); await settle();
  assert.equal(c.getSnapshot().kind, "error"); assert.ok(h.calls[0]!.closed);
  c.retry(); assert.equal(c.getSnapshot().kind, "loading");
  await complete(h, 1); assert.equal(c.getSnapshot().kind, "available"); c.dispose();
});

it("boundsContextAndDeduplicatesEquivalentMembership", async () => {
  const { createFavoriteLineupController } = await load();
  const h = harness(), c = createFavoriteLineupController({ transport: h.transport });
  assert.throws(() => c.setContext({ eventIds: ["a", "b", "c"], favoriteProfileIds: [] }), /limit|many|maximum/i);
  assert.throws(() => c.setContext({ eventIds: ["a"], favoriteProfileIds: [...favorites, "extra"] }), /limit|many|maximum/i);
  c.setContext({ eventIds: ["a", "a"], favoriteProfileIds: ["b", "a", "a"] });
  c.setContext({ eventIds: ["a"], favoriteProfileIds: ["a", "b"] });
  await complete(h); assert.equal(h.calls.length, 1);
  assert.deepEqual(h.calls[0]!.args, { eventIds: ["a"], favoriteProfileIds: ["a", "b"] }); c.dispose();
});

it("acceptsSynchronousCacheValuesAndClosesSynchronousFailures", async () => {
  const { createFavoriteLineupController } = await load();
  let stops = 0;
  const c = createFavoriteLineupController({ transport: { favoriteLineup: args => ({ subscribe(next) {
    next({ items: args.eventIds.map(eventId => ({ eventId, performers: args.favoriteProfileIds.map(identity) })) });
    return () => { stops++; };
  } }) } });
  c.setContext({ eventIds: ["event"], favoriteProfileIds: favorites }); await settle();
  const s = c.getSnapshot(); assert.equal(s.kind, "available");
  if (s.kind === "available") assert.equal(s.items[0]?.performers.length, 500);
  c.dispose(); assert.equal(stops, 20);
  const failed = createFavoriteLineupController({ transport: { favoriteLineup: () => ({ subscribe(_next, error) {
    error(new Error("offline")); return () => { stops++; };
  } }) } });
  failed.setContext({ eventIds: ["event"], favoriteProfileIds: ["person"] }); await settle();
  assert.equal(failed.getSnapshot().kind, "error"); assert.equal(stops, 21); failed.dispose();
});
