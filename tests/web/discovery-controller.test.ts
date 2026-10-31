import assert from "node:assert/strict";
import test from "node:test";
import { spawnSync } from "node:child_process";
import path from "node:path";
import { createDiscoveryController, createDiscoverySessionSeed, type DiscoveryTransport, type DiscoveryQuery } from "../../apps/web/src/lib/discovery/controller";
import type { DiscoveryEventCandidate, DiscoveryEventRequest, DiscoveryEventSignal, DiscoveryProfileSignal } from "../../convex/_homeDiscoveryTypes";
const now = Date.parse("2026-10-28T12:00:00Z");
const context = { now, timeZone: "UTC", favoriteProfileIds: [] as string[], rotationKey: "session/day" };
const event = (id: string): DiscoveryEventCandidate => ({ id, slug: id, href: `/events/${id}`, title: id, host: { id: `host-${id}`, slug: id, displayName: id }, schedule: { kind: "open_end", startAt: now + 86400000 } });
const signal = (eventId: string): DiscoveryEventSignal => ({ eventId, performers: [], manualLabels: [], coverage: "complete" });
function harness(synchronous = false) {
  let active = 0, peak = 0;
  const requests: { method: string; args: unknown; send(value: unknown): void; fail(): void; closed: boolean }[] = [];
  const query = <T>(method: string, args: unknown, value: () => T): DiscoveryQuery<T> => ({ subscribe(next, error) {
    active++; peak = Math.max(active, peak);
    let pending = true;
    const finish = () => { if (pending) { active--; pending = false; } };
    const request = { method, args, closed: false, send(data: unknown) { finish(); next(data as T); }, fail() { finish(); error(new Error("offline")); } };
    requests.push(request);
    const deliver = () => { if (!request.closed) request.send(value()); };
    if (synchronous) deliver(); else queueMicrotask(deliver);
    return () => { finish(); request.closed = true; };
  } });
  const state = { events: (args: DiscoveryEventRequest) => ({ items: [] as DiscoveryEventCandidate[], cursor: null as string | null, complete: true }), profiles: (ids: string[]): DiscoveryProfileSignal[] => ids.map(id => ({ id, slug: id, displayName: id, profileType: "community", genres: [] } satisfies DiscoveryProfileSignal)), signals: (ids: string[]) => ids.map(signal) };
  const transport: DiscoveryTransport = {
    listEvents: args => query("events", args, () => state.events(args)),
    listClubs: args => query("clubs", args, () => ({ items: [], cursor: null, complete: true })),
    eventSignals: args => query("signals", args, () => ({ items: state.signals(args.eventIds) })),
    profileSignals: args => query("profiles", args, () => ({ items: state.profiles(args.profileIds) })),
  };
  return { transport, requests, state, peak: () => peak };
}
async function settle() { for (let i = 0; i < 100; i++) await Promise.resolve(); }

test("samplesAllBandsBeforeFinalSelection", async () => {
  const h = harness(); h.state.events = args => ({ items: args.band === 3 ? [event("distant")] : [], cursor: null, complete: true });
  const c = createDiscoveryController({ transport: h.transport, concurrency: 3 });
  c.setContext(context); await settle();
  const s = c.getSnapshot(); assert.equal(s.kind, "available");
  if (s.kind === "available") { assert.equal(s.events[0]?.id, "distant"); assert.equal(s.coverage.events.length, 16); }
  assert.deepEqual(new Set(h.requests.filter(x => x.method === "events").map(x => (x.args as DiscoveryEventRequest).band)), new Set([0, 1, 2, 3])); c.dispose();
});
test("boundsContinuationsAndConcurrency", async () => {
  const h = harness(); h.state.events = args => ({ items: args.cursor === "2" ? Array.from({ length: 12 }, (_, i) => event(`${args.band}-${args.kind}-${args.direction}-${i}`)) : [], cursor: args.cursor ? "2" : "1", complete: false });
  const c = createDiscoveryController({ transport: h.transport, concurrency: 3 }); c.setContext(context); await settle();
  const s = c.getSnapshot(); assert.equal(s.kind, "available");
  assert.ok(h.peak() <= 3); assert.equal(h.requests.filter(x => x.method === "events").length, 48);
  if (s.kind === "available") { assert.equal(s.coverage.candidateCount, 32); assert.ok(s.coverage.events.every(x => x.pages === 3 && !x.complete)); }
  c.dispose(); assert.ok(h.requests.every(x => x.closed));
});
test("rejectsOldContextResponses", async () => {
  const h = harness(); const c = createDiscoveryController({ transport: h.transport, concurrency: 3 });
  c.setContext(context); const old = h.requests[0];
  c.setContext({ ...context, timeZone: "Asia/Kathmandu", favoriteProfileIds: ["new"] }); await settle();
  old?.send({ items: [event("obsolete")], cursor: null, complete: true }); await settle();
  const s = c.getSnapshot(); assert.equal(s.kind, "available"); if (s.kind === "available") assert.equal(s.events.length, 0);
  c.dispose(); const disposed = c.getSnapshot(); old?.send({ items: [event("obsolete")], cursor: null, complete: true }); await settle(); assert.equal(c.getSnapshot(), disposed);
});
test("keepsFailureDistinctFromEmpty", async () => {
  const h = harness(); const c = createDiscoveryController({ transport: h.transport, concurrency: 3 }); c.setContext(context);
  h.requests[0]?.fail(); await settle(); assert.equal(c.getSnapshot().kind, "error");
  c.retry(); await settle(); assert.equal(c.getSnapshot().kind, "available"); c.dispose();
});
test("resolvesAllFavoriteBatches", async () => {
  const h = harness(); const c = createDiscoveryController({ transport: h.transport, concurrency: 3 });
  c.setContext({ ...context, favoriteProfileIds: Array.from({ length: 500 }, (_, i) => `favorite-${i}`) }); await settle();
  const batches = h.requests.filter(x => x.method === "profiles").map(x => (x.args as { profileIds: string[] }).profileIds);
  assert.equal(batches.length, 10); assert.ok(batches.every(x => x.length === 50)); assert.equal(new Set(batches.flat()).size, 500);
  const s = c.getSnapshot(); assert.equal(s.kind, "available"); if (s.kind === "available") { assert.equal(s.favoriteProfiles.length, 500); assert.equal(s.clubs.length, 2); } c.dispose();
});
test("revalidatesSuppressedCardsOnRefresh", async () => {
  const h = harness(); h.state.events = () => ({ items: [event("public")], cursor: null, complete: true });
  const c = createDiscoveryController({ transport: h.transport, concurrency: 3 }); c.setContext(context); await settle();
  assert.equal(c.getSnapshot().kind, "available"); h.state.signals = () => [];
  h.requests.find(x => x.method === "signals")?.send({ items: [] });
  const invalidated = c.getSnapshot(); assert.ok(invalidated.kind !== "available" || invalidated.events.length === 0);
  await settle(); const s = c.getSnapshot(); assert.equal(s.kind, "available"); if (s.kind === "available") assert.equal(s.events.length, 0);
  c.refresh(); h.requests.filter(x => !x.closed)[0]?.fail(); await settle(); assert.equal(c.getSnapshot().kind, "error"); c.dispose();
});

test("keepsCardsStableDuringSameDayRefreshAndReplacesPublicMetadata", async () => {
  const h = harness(); h.state.events = () => ({ items: [event("public")], cursor: null, complete: true });
  const c = createDiscoveryController({ transport: h.transport, concurrency: 3 }); c.setContext(context); await settle();
  c.setContext({ ...context, now: now + 300000 });
  const refreshing = c.getSnapshot(); assert.equal(refreshing.kind, "available"); if (refreshing.kind === "available") { assert.equal(refreshing.events[0]?.id, "public"); assert.equal(refreshing.refreshing, true); }
  await settle(); c.dispose();
});
test("marksCallerTruncatedCompletePagesPartial", async () => {
  const h = harness(); h.state.events = () => ({ items: [event("a"), event("b"), event("c")], cursor: null, complete: true });
  const c = createDiscoveryController({ transport: h.transport, concurrency: 3 }); c.setContext(context); await settle();
  const s = c.getSnapshot(); assert.equal(s.kind, "available"); if (s.kind === "available") assert.ok(s.coverage.events.every(x => !x.complete)); c.dispose();
});
test("replacesFavoritePublicSignalsIncludingRemovals", async () => {
  const h = harness(); const c = createDiscoveryController({ transport: h.transport, concurrency: 3 });
  c.setContext({ ...context, favoriteProfileIds: ["club"] }); await settle();
  h.state.profiles = () => []; h.requests.find(x => x.method === "profiles")?.send({ items: [] }); await settle();
  const s = c.getSnapshot(); assert.equal(s.kind, "available"); if (s.kind === "available") { assert.deepEqual(s.favoriteProfiles, []); assert.deepEqual(s.clubs, []); } c.dispose();
});

test("sessionRotationSurvivesRemountAndBlockedStorage", () => {
  const values = new Map<string, string>(); let generated = 0;
  const options = { storage: () => ({ getItem: (key: string) => values.get(key) ?? null, setItem: (key: string, value: string) => { values.set(key, value); } }), createSeed: () => `seed-${++generated}` };
  const first = createDiscoverySessionSeed(options); assert.equal(first(), "seed-1"); assert.equal(first(), "seed-1");
  assert.equal(createDiscoverySessionSeed(options)(), "seed-1"); assert.equal(generated, 1);
  const blocked = createDiscoverySessionSeed({ storage: () => { throw new Error("blocked"); }, createSeed: () => "fallback" });
  assert.equal(blocked(), "fallback"); assert.equal(blocked(), "fallback");
});
test("actualNowExpiresTimedStartsAndKeepsAuthoredDatesInViewerZone", async () => {
  const h = harness(); h.state.events = () => ({ items: [{ ...event("timed"), schedule: { kind: "open_end", startAt: now + 1000 } }, { ...event("date"), schedule: { kind: "date_only", eventDate: "2026-10-28" } }], cursor: null, complete: true });
  const c = createDiscoveryController({ transport: h.transport, concurrency: 3 }); c.setContext({ ...context, timeZone: "Asia/Kathmandu" }); await settle();
  const expired = c.getSnapshotAt(now + 60000);
  assert.equal(expired.kind, "available"); if (expired.kind === "available") assert.deepEqual(expired.events.map(x => x.id), ["date"]);
  const tomorrow = c.getSnapshotAt(Date.parse("2026-10-28T18:15:00Z"));
  if (tomorrow.kind === "available") assert.equal(tomorrow.events.length, 0); c.dispose();
});
test("retainedWatcherInvalidatesCardsDuringPendingRefresh", async () => {
  const h = harness(); h.state.events = () => ({ items: [event("public")], cursor: null, complete: true });
  const c = createDiscoveryController({ transport: h.transport, concurrency: 3 }); c.setContext(context); await settle();
  const old = h.requests.find(x => x.method === "signals"); c.refresh();
  assert.equal(old?.closed, false);
  h.state.signals = () => []; old?.send({ items: [] });
  assert.equal(c.getSnapshot().kind, "loading"); await settle();
  const s = c.getSnapshot(); if (s.kind === "available") assert.equal(s.events.length, 0);
  assert.equal(old?.closed, true); c.dispose(); assert.ok(h.requests.every(x => x.closed));
});

test("homeRuntimeBootsWithoutBrowserReadsAndRestoresTheRelevantHeading", () => {
  const result = spawnSync(process.execPath, ["--import", "tsx", "--input-type=module", "-e", `
    import assert from 'node:assert/strict';
    import { createRequire } from 'node:module';
    const require = createRequire(import.meta.url);
    require.extensions['.css'] = module => { module.exports = {}; };
    const React = require('react');
    const { renderToStaticMarkup } = require('react-dom/server');
    const { HomeBrowseProvider, useHomeBrowse, restoreHomeFocus } = require('./src/app/_components/home-browse-provider.tsx');
    const { HomeSchedule } = require('./src/app/_components/timeline/home-schedule.tsx');
    Object.defineProperty(globalThis, 'window', { configurable: true, get() { throw new Error('browser read during SSR'); } });
    function Consumer() {
      const state = useHomeBrowse();
      assert.equal(state.kind, 'booting'); assert.equal(state.timeZone, null); assert.equal(state.hour12, null); assert.equal(state.selection, null);
      return React.createElement('span', null, 'booting');
    }
    assert.equal(renderToStaticMarkup(React.createElement(HomeBrowseProvider, null, React.createElement(Consumer))), '<span>booting</span>');
    const standalone = renderToStaticMarkup(React.createElement(HomeSchedule));
    assert.match(standalone, /data-home-schedule/); assert.match(standalone, /Loading events/);
    const focused = [];
    const target = id => ({ isConnected: true, focus: options => focused.push([id, options]) });
    const card = target('card'); const heading = target('discover-heading');
    globalThis.document = { getElementById: id => id === 'discover-heading' ? heading : target('schedule-heading') };
    restoreHomeFocus(card, 'discover-heading');
    card.isConnected = false;
    restoreHomeFocus(card, 'discover-heading');
    assert.deepEqual(focused, [['card', { preventScroll: true }], ['discover-heading', { preventScroll: true }]]);
  `], { cwd: path.resolve("apps/web"), encoding: "utf8" });
  assert.equal(result.status, 0, result.stderr || result.stdout);
});

test("acceptsSynchronousCachedEmissionsAndDisposesEveryWatch", async () => {
  const h = harness(true); h.state.events = () => ({ items: [event("cached")], cursor: null, complete: true });
  const c = createDiscoveryController({ transport: h.transport, concurrency: 3 }); c.setContext(context); await settle();
  const s = c.getSnapshot(); assert.equal(s.kind, "available"); if (s.kind === "available") assert.equal(s.events[0]?.id, "cached");
  assert.ok(h.peak() <= 3); c.dispose(); assert.ok(h.requests.every(x => x.closed));
});
test("synchronousSubscriptionFailureCleansUpItsLateRegisteredStop", async () => {
  const h = harness(); let stopped = 0;
  const c = createDiscoveryController({ transport: { ...h.transport, listEvents: () => ({ subscribe(next, error) {
    error(new Error("cached failure"));
    next({ items: [event("obsolete")], cursor: null, complete: true });
    return () => { stopped++; };
  } }) }, concurrency: 3 });
  c.setContext(context); await settle(); assert.equal(c.getSnapshot().kind, "error"); assert.equal(stopped, 1); c.dispose();
});

function expiryHarness() {
  const h = harness();
  const familiar = (id: string, startAt: number): DiscoveryEventCandidate => ({ ...event(id), host: { id: "fav-host", slug: "fav-host", displayName: "Favorite club" }, schedule: { kind: "open_end", startAt } });
  const soon = [familiar("familiar-soon", now + 1000), { ...event("new-soon"), schedule: { kind: "open_end", startAt: now + 90000 } } satisfies DiscoveryEventCandidate];
  const later = [familiar("familiar-later", now + 8 * 86400000), { ...event("new-later"), schedule: { kind: "date_only", eventDate: "2026-11-06" } } satisfies DiscoveryEventCandidate];
  const dj: DiscoveryProfileSignal = { id: "dj", slug: "dj", displayName: "Favorite DJ", profileType: "person", genres: [{ slug: "house", displayName: "House" }] };
  h.state.events = args => ({ items: args.kind === "timed" && args.band === 0 ? soon : args.kind === "timed" && args.band === 1 ? [later[0]] : args.kind === "date_only" && args.band === 1 ? [later[1]] : [], cursor: null, complete: true });
  h.state.profiles = () => [dj];
  h.state.signals = ids => ids.map(id => ({ ...signal(id), performers: id === "familiar-soon" ? [dj] : id === "new-soon" ? [{ ...dj, id: "new-dj", slug: "new-dj" }] : [] }));
  const c = createDiscoveryController({ transport: h.transport, concurrency: 3 });
  c.setContext({ ...context, favoriteProfileIds: ["fav-host", "dj"] });
  return { h, c };
}

test("minuteExpiryRefillsOneThenBothWinnersFromTheInspectedPoolWithoutRequests", async () => {
  const { h, c } = expiryHarness(); await settle();
  const initial = c.getSnapshot(); assert.equal(initial.kind, "available");
  if (initial.kind === "available") { assert.deepEqual(initial.events.map(x => x.id), ["familiar-soon", "new-soon"]); assert.equal(initial.coverage.candidateCount, 4); assert.ok(initial.coverage.events.every(x => x.complete)); }
  const requests = h.requests.length;
  const one = c.getSnapshotAt(now + 60000);
  assert.equal(one.kind, "available"); if (one.kind === "available") assert.deepEqual(one.events.map(x => x.id), ["familiar-later", "new-soon"]);
  const both = c.getSnapshotAt(now + 120000);
  assert.equal(both.kind, "available"); if (both.kind === "available") { assert.deepEqual(both.events.map(x => x.id), ["familiar-later", "new-later"]); assert.equal(both.coverage, initial.kind === "available" ? initial.coverage : undefined); }
  assert.equal(h.requests.length, requests); c.dispose();
});

test("pendingRefreshUsesTheRetainedPoolUntilAReactiveChangeOrErrorInvalidatesIt", async () => {
  const { h, c } = expiryHarness(); await settle();
  const old = h.requests.find(x => x.method === "signals");
  c.refresh();
  const during = c.getSnapshotAt(now + 120000);
  assert.equal(during.kind, "available"); if (during.kind === "available") { assert.equal(during.refreshing, true); assert.deepEqual(during.events.map(x => x.id), ["familiar-later", "new-later"]); }
  h.state.signals = () => []; old?.send({ items: [] });
  assert.equal(c.getSnapshotAt(now + 120000).kind, "loading"); await settle();
  const removed = c.getSnapshotAt(now + 120000);
  assert.equal(removed.kind, "available"); if (removed.kind === "available") assert.deepEqual(removed.events, []);
  old?.send({ items: [signal("familiar-later"), signal("new-later")] }); await settle();
  assert.deepEqual(c.getSnapshotAt(now + 120000), removed);
  c.refresh(); h.requests.find(x => !x.closed)?.fail(); await settle();
  assert.equal(c.getSnapshotAt(now + 120000).kind, "error"); c.dispose();
});

test("contextReplacementAndDisposalCannotProjectTheObsoletePool", async () => {
  const { h, c } = expiryHarness(); await settle();
  const old = h.requests.find(x => x.method === "signals");
  h.state.events = () => ({ items: [], cursor: null, complete: true });
  c.setContext({ ...context, timeZone: "Asia/Kathmandu" });
  assert.equal(c.getSnapshotAt(now + 120000).kind, "loading");
  old?.send({ items: [signal("familiar-later")] }); await settle();
  const current = c.getSnapshotAt(now + 120000);
  assert.equal(current.kind, "available"); if (current.kind === "available") assert.equal(current.events.length, 0);
  c.dispose(); old?.send({ items: [signal("familiar-later")] });
  assert.equal(c.getSnapshotAt(now + 120000).kind, "loading");
});

test("expiryRetainsCompleteOrPartialCoverageForTheRealEmptyState", async () => {
  for (const partial of [false, true]) {
    const h = harness();
    const expired = (id: string): DiscoveryEventCandidate => ({ ...event(id), schedule: { kind: "timed", startAt: now + 1000, endAt: now + 60000 } });
    h.state.events = () => ({ items: partial ? [expired("a"), expired("b"), event("uninspected")] : [expired("a")], cursor: null, complete: true });
    const c = createDiscoveryController({ transport: h.transport, concurrency: 3 }); c.setContext(context); await settle();
    const snapshot = c.getSnapshotAt(now + 60000);
    assert.equal(snapshot.kind, "available"); if (snapshot.kind === "available") { assert.equal(snapshot.events.length, 0); assert.equal(snapshot.coverage.events.every(x => x.complete), !partial); }
    c.dispose();
  }
});
