import assert from "node:assert/strict";
import test from "node:test";
import { spawnSync } from "node:child_process";
import path from "node:path";
import { createDiscoveryController, createDiscoverySessionSeed, type DiscoveryTransport, type DiscoveryQuery } from "../../apps/web/src/lib/discovery/controller";
import type { DiscoveryEventCandidate, DiscoveryEventRequest, DiscoveryEventSignal, DiscoveryProfileSignal } from "../../convex/_homeDiscoveryTypes";
const now = Date.parse("2026-10-28T12:00:00Z");
const context = { now, timeZone: "UTC", rotationKey: "session/day" };
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
    const deliver = () => { if (!request.closed && !(method === "profiles" && state.holdProfiles) && !(method === "events" && state.holdEvents)) request.send(value()); };
    if (synchronous) deliver(); else queueMicrotask(deliver);
    return () => { finish(); request.closed = true; };
  } });
  const state = { holdProfiles: false, holdEvents: false, events: (args: DiscoveryEventRequest) => ({ items: [] as DiscoveryEventCandidate[], cursor: null as string | null, complete: true }), profiles: (ids: string[]): DiscoveryProfileSignal[] => ids.map(id => ({ id, slug: id, displayName: id, profileType: "community", genres: [] } satisfies DiscoveryProfileSignal)), signals: (ids: string[]) => ids.map(signal) };
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
  c.setFavorites(["new"]); c.setContext({ ...context, timeZone: "Asia/Kathmandu" }); await settle();
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
  c.setFavorites(Array.from({ length: 500 }, (_, i) => `favorite-${i}`)); c.setContext(context); await settle();
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
  c.setFavorites(["club"]); c.setContext(context); await settle();
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
  c.setFavorites(["fav-host", "dj"]); c.setContext(context);
  return { h, c };
}

test("expiryStillRefillsWithoutNewReads", async () => {
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


test("favoriteChangeKeepsCandidatesAndCards", async () => {
  const h = harness(); h.state.events = () => ({ items: [event("public")], cursor: null, complete: true });
  const c = createDiscoveryController({ transport: h.transport, concurrency: 3 });
  c.setContext(context); await settle();
  const before = h.requests.filter(r => r.method !== "profiles").length;
  c.setFavorites(["new-favorite"]);
  const pending = c.getSnapshot(); assert.equal(pending.kind, "available");
  if (pending.kind === "available") assert.equal(pending.events[0]?.id, "public");
  await settle();
  assert.equal(h.requests.filter(r => r.method !== "profiles").length, before);
  const ready = c.getSnapshot(); assert.equal(ready.kind, "available");
  if (ready.kind === "available") { assert.deepEqual(ready.eligibleEventIds, ["public"]); assert.deepEqual(ready.favoriteProfiles.map(p => p.id), ["new-favorite"]); }
  c.dispose();
});
test("rapidFavoritesIgnoreStaleReplies", async () => {
  const h = harness(); const c = createDiscoveryController({ transport: h.transport, concurrency: 3 });
  c.setContext(context); await settle();
  c.setFavorites(["old"]); const old = h.requests.find(r => r.method === "profiles");
  c.setFavorites(["new"]); await settle();
  old?.send({ items: h.state.profiles(["old"]) }); old?.fail(); await settle();
  const ready = c.getSnapshot(); assert.equal(ready.kind, "available");
  if (ready.kind === "available") assert.deepEqual(ready.favoriteProfiles.map(p => p.id), ["new"]);
  c.setFavorites([]); await settle();
  const empty = c.getSnapshot(); if (empty.kind === "available") assert.deepEqual(empty.favoriteProfiles, []);
  c.dispose();
});
test("revocationClearsRetainedContent", async () => {
  const h = harness(); h.state.events = () => ({ items: [event("public")], cursor: null, complete: true });
  const c = createDiscoveryController({ transport: h.transport, concurrency: 3 });
  c.setContext(context); await settle(); c.setFavorites(["club"]);
  h.state.signals = () => []; h.requests.find(r => r.method === "signals")?.send({ items: [] });
  assert.equal(c.getSnapshot().kind, "loading"); await settle();
  const ready = c.getSnapshot(); if (ready.kind === "available") { assert.deepEqual(ready.events, []); assert.deepEqual(ready.eligibleEventIds, []); }
  c.dispose();
});

test("favoriteAndTimerRefreshRetainTheWatchedPoolUntilCommit", async () => {
  const h = harness(); h.state.events = () => ({ items: [event("public")], cursor: null, complete: true });
  const c = createDiscoveryController({ transport: h.transport, concurrency: 3 });
  c.setContext(context); await settle();
  assert.equal(h.requests.filter(r => r.method === "profiles").length, 0);
  const watched = h.requests.find(r => r.method === "signals");
  c.setFavorites(["club"]); c.refresh();
  assert.equal(watched?.closed, false);
  h.state.signals = () => []; watched?.send({ items: [] });
  assert.equal(c.getSnapshot().kind, "loading"); await settle();
  const snapshot = c.getSnapshot(); assert.equal(snapshot.kind, "available");
  if (snapshot.kind === "available") assert.deepEqual(snapshot.events, []);
  assert.ok(h.peak() <= 3); c.dispose();
});
test("timerRefreshCanRecoverAnErroredFavoriteGeneration", async () => {
  const h = harness(); const c = createDiscoveryController({ transport: h.transport, concurrency: 3 });
  c.setContext(context); await settle(); c.setFavorites(["club"]);
  h.requests.find(r => r.method === "profiles")?.fail(); await settle();
  assert.equal(c.getSnapshot().kind, "error");
  c.refresh(); await settle();
  const snapshot = c.getSnapshot(); assert.equal(snapshot.kind, "available");
  if (snapshot.kind === "available") assert.deepEqual(snapshot.favoriteProfiles.map(p => p.id), ["club"]);
  c.dispose();
});

test("outsideSampleFocusedClubPinsOnlyOneExistingBatchUntilBlur", async () => {
  const h = harness(); const c = createDiscoveryController({ transport: h.transport, concurrency: 3 });
  c.setFavorites(Array.from({ length: 100 }, (_, i) => `club-${i}`)); c.setContext(context); await settle();
  const initial = c.getSnapshot(); assert.equal(initial.kind, "available");
  if (initial.kind !== "available") return;
  const focused = initial.clubs[0]!.id;
  c.setFocusedClub(focused); const before = h.requests.length;
  c.setFavorites([]); await settle();
  const ranked = c.getSnapshot(); assert.equal(ranked.kind, "available");
  if (ranked.kind === "available") { assert.deepEqual(ranked.clubs, []); assert.deepEqual(ranked.eligibleClubIds, [focused]); }
  assert.equal(h.requests.length, before);
  assert.equal(h.requests.filter(r => r.method === "profiles" && !r.closed).length, 1);
  c.setFavorites(["new"]); await settle();
  assert.equal(h.requests.filter(r => r.method === "profiles" && !r.closed).length, 2);
  c.setFocusedClub(null);
  assert.equal(h.requests.filter(r => r.method === "profiles" && !r.closed).length, 1);
  const blurred = c.getSnapshot(); if (blurred.kind === "available") assert.deepEqual(blurred.eligibleClubIds, ["new"]);
  c.dispose(); assert.ok(h.requests.every(r => r.closed));
});
test("pinnedOutsideSampleClubStillClearsOnPublicRevocationOrError", async () => {
  for (const failure of [false, true]) {
    const h = harness(); const c = createDiscoveryController({ transport: h.transport, concurrency: 3 });
    c.setFavorites(["club"]); c.setContext(context); await settle();
    const watch = h.requests.find(r => r.method === "profiles");
    c.setFocusedClub("club"); c.setFavorites([]); await settle();
    assert.equal(watch?.closed, false);
    if (failure) watch?.fail(); else watch?.send({ items: [] });
    assert.equal(c.getSnapshot().kind, failure ? "error" : "loading");
    assert.equal(watch?.closed, true); await settle();
    const snapshot = c.getSnapshot(); if (snapshot.kind === "available") assert.deepEqual(snapshot.eligibleClubIds, []);
    c.dispose();
  }
});
test("pinnedClubIsReleasedForContextChangesAndDisposal", async () => {
  for (const dispose of [false, true]) {
    const h = harness(); const c = createDiscoveryController({ transport: h.transport, concurrency: 3 });
    c.setFavorites(["club"]); c.setContext(context); await settle();
    const watch = h.requests.find(r => r.method === "profiles");
    c.setFocusedClub("club"); c.setFavorites([]); await settle();
    if (dispose) c.dispose(); else c.setContext({ ...context, timeZone: "Asia/Kathmandu" });
    assert.equal(watch?.closed, true); await settle();
    watch?.send({ items: h.state.profiles(["club"]) }); await settle();
    const snapshot = c.getSnapshot(); if (snapshot.kind === "available") assert.deepEqual(snapshot.eligibleClubIds, []);
    c.dispose();
  }
});

test("blurDuringPendingFavoritesKeepsTheNormalRetainedSourceUntilReady", async () => {
  const h = harness(); const c = createDiscoveryController({ transport: h.transport, concurrency: 3 });
  c.setFavorites(["club"]); c.setContext(context); await settle();
  const watch = h.requests.find(r => r.method === "profiles");
  c.setFocusedClub("club"); c.setFavorites(["next"]); c.setFocusedClub(null);
  assert.equal(watch?.closed, false);
  await settle(); assert.equal(watch?.closed, true); c.dispose();
});


async function heldFavoriteRefresh(nextEvents: DiscoveryEventCandidate[] = []) {
  const h = harness(); h.state.events = () => ({ items: [event("public")], cursor: null, complete: true });
  const c = createDiscoveryController({ transport: h.transport, concurrency: 3 });
  c.setContext(context); await settle();
  const original = h.requests.find(r => r.method === "signals")!;
  h.state.holdProfiles = true; c.setFavorites(["pending"]);
  const favorite = h.requests.find(r => r.method === "profiles")!;
  h.state.events = () => ({ items: nextEvents, cursor: null, complete: true });
  c.refresh(); await settle();
  return { h, c, original, favorite };
}

test("completedCandidateSampleDepartureKeepsDisplayedSourceUntilFavoriteCommit", async () => {
  const { h, c, original, favorite } = await heldFavoriteRefresh();
  const waiting = c.getSnapshot(); assert.equal(waiting.kind, "available");
  if (waiting.kind === "available") { assert.deepEqual(waiting.events.map(e => e.id), ["public"]); assert.deepEqual(waiting.eligibleEventIds, ["public"]); }
  assert.equal(original.closed, false, "ordinary sample departure must not retire the displayed source");
  favorite.send({ items: h.state.profiles(["pending"]) }); await settle();
  const replacement = c.getSnapshot(); assert.equal(replacement.kind, "available");
  if (replacement.kind === "available") { assert.deepEqual(replacement.events, []); assert.deepEqual(replacement.eligibleEventIds, []); }
  assert.equal(original.closed, true);
  original.send({ items: [signal("public")] }); original.fail(); await settle(); assert.equal(c.getSnapshot(), replacement);
  c.dispose(); assert.ok(h.requests.every(r => r.closed));
});

test("explicitPublicSignalRejectionClearsEligibilityBeforeHeldFavoritesResolve", async () => {
  const h = harness(); h.state.events = () => ({ items: [event("public"), event("kept")], cursor: null, complete: true });
  const c = createDiscoveryController({ transport: h.transport, concurrency: 3 }); c.setContext(context); await settle();
  h.state.holdProfiles = true; c.setFavorites(["pending"]);
  h.state.signals = ids => ids.filter(id => id !== "public").map(signal); c.refresh(); await settle();
  const waiting = c.getSnapshot(); assert.equal(waiting.kind, "available");
  if (waiting.kind === "available") { assert.deepEqual(waiting.events.map(e => e.id), ["kept"]); assert.deepEqual(waiting.eligibleEventIds, ["kept"]); }
  const projected = c.getSnapshotAt(now + 60000); if (projected.kind === "available") assert.deepEqual(projected.events.map(e => e.id), ["kept"]);
  c.dispose(); assert.ok(h.requests.every(r => r.closed));
});

test("lateRetainedRevocationAndErrorStillClearAfterCandidateCompletion", async () => {
  for (const failure of [false, true]) {
    const { h, c, original } = await heldFavoriteRefresh();
    if (failure) original.fail(); else original.send({ items: [] });
    assert.equal(c.getSnapshot().kind, failure ? "error" : "loading");
    assert.equal(original.closed, true); c.dispose(); assert.ok(h.requests.every(r => r.closed));
  }
});

test("minuteExpiryRemainsIndependentOfHeldFavoritesAfterCandidateCompletion", async () => {
  const { h, c, original } = await heldFavoriteRefresh();
  const before = h.requests.length;
  const expired = c.getSnapshotAt(now + 2 * 86400000); assert.equal(expired.kind, "available");
  if (expired.kind === "available") { assert.deepEqual(expired.events, []); assert.deepEqual(expired.eligibleEventIds, []); }
  assert.equal(h.requests.length, before); assert.equal(original.closed, false);
  c.dispose(); assert.ok(h.requests.every(r => r.closed));
});

test("repeatedCandidateCompletionRetainsOnlyTheCommittedSourceAndLatestPool", async () => {
  const { h, c, original, favorite } = await heldFavoriteRefresh([event("intermediate")]);
  const intermediate = h.requests.filter(r => r.method === "signals").at(-1)!;
  h.state.events = () => ({ items: [event("latest")], cursor: null, complete: true }); c.refresh(); await settle();
  assert.equal(original.closed, false); assert.equal(intermediate.closed, true);
  favorite.send({ items: h.state.profiles(["pending"]) }); await settle();
  const snapshot = c.getSnapshot(); assert.equal(snapshot.kind, "available");
  if (snapshot.kind === "available") assert.deepEqual(snapshot.events.map(e => e.id), ["latest"]);
  assert.equal(original.closed, true); assert.ok(h.peak() <= 3);
  c.dispose(); assert.ok(h.requests.every(r => r.closed));
});

test("heldFavoriteCandidateCompletionSourcesCloseOnContextChangeOrDispose", async () => {
  for (const dispose of [false, true]) {
    const { h, c, original, favorite } = await heldFavoriteRefresh([event("new")]);
    assert.equal(original.closed, false);
    if (dispose) c.dispose(); else c.setContext({ ...context, timeZone: "Asia/Kathmandu" });
    assert.equal(original.closed, true); assert.equal(favorite.closed, true);
    original.send({ items: [signal("public")] }); favorite.send({ items: h.state.profiles(["pending"]) }); await settle();
    assert.equal(c.getSnapshot().kind, "loading"); c.dispose(); assert.ok(h.requests.every(r => r.closed));
  }
});

test("focusedEventSampleDeparturePinsOneTrustedGenerationUntilBlur", async () => {
  const h = harness(); h.state.events = () => ({ items: [event("public")], cursor: null, complete: true });
  const c = createDiscoveryController({ transport: h.transport, concurrency: 3 }); c.setContext(context); await settle();
  const original = h.requests.find(r => r.method === "signals")!;
  c.setFocusedEvent("public"); h.state.events = () => ({ items: [event("new")], cursor: null, complete: true }); c.refresh(); await settle();
  const replacement = c.getSnapshot(); assert.equal(replacement.kind, "available");
  if (replacement.kind === "available") { assert.deepEqual(replacement.events.map(e => e.id), ["new"]); assert.deepEqual(new Set(replacement.eligibleEventIds), new Set(["new", "public"])); }
  assert.equal(original.closed, false);
  assert.equal(h.requests.filter(r => !r.closed).length, 38);
  const firstReplacement = h.requests.filter(r => r.method === "signals").at(-1)!;
  h.state.events = () => ({ items: [event("latest")], cursor: null, complete: true }); c.refresh(); await settle();
  assert.equal(original.closed, false); assert.equal(firstReplacement.closed, true);
  assert.equal(h.requests.filter(r => !r.closed).length, 38);
  const registrations = h.requests.length; c.setFocusedEvent(null);
  assert.equal(original.closed, true); assert.equal(h.requests.length, registrations);
  assert.equal(h.requests.filter(r => !r.closed).length, 19);
  const blurred = c.getSnapshot(); if (blurred.kind === "available") assert.deepEqual(blurred.eligibleEventIds, ["latest"]);
  c.dispose(); assert.ok(h.requests.every(r => r.closed));
});

test("focusedCandidatePinStillClearsOnRejectionRevocationErrorExpiryAndDisposal", async () => {
  for (const reason of ["rejection", "revocation", "error", "expiry", "dispose", "context", "reappearance"] as const) {
    const h = harness(); h.state.events = () => ({ items: [event("public")], cursor: null, complete: true });
    const c = createDiscoveryController({ transport: h.transport, concurrency: 3 }); c.setContext(context); await settle();
    const original = h.requests.find(r => r.method === "signals")!;
    c.setFocusedEvent("public"); h.state.events = () => ({ items: [], cursor: null, complete: true }); c.refresh(); await settle();
    assert.equal(original.closed, false);
    if (reason === "revocation") { original.send({ items: [] }); assert.equal(c.getSnapshot().kind, "loading"); }
    else if (reason === "error") { original.fail(); assert.equal(c.getSnapshot().kind, "error"); }
    else if (reason === "expiry") { const snapshot = c.getSnapshotAt(now + 2 * 86400000); if (snapshot.kind === "available") assert.deepEqual(snapshot.eligibleEventIds, []); }
    else if (reason === "context") c.setContext({ ...context, timeZone: "Asia/Kathmandu" });
    else if (reason === "dispose") c.dispose();
    else {
      h.state.events = () => ({ items: [event("public")], cursor: null, complete: true });
      h.state.signals = ids => reason === "rejection" ? [] : ids.map(signal);
      h.state.holdProfiles = reason === "rejection"; if (reason === "rejection") c.setFavorites(["pending"]);
      c.refresh(); await settle();
      const snapshot = c.getSnapshot(); if (snapshot.kind === "available") assert.deepEqual(snapshot.eligibleEventIds, reason === "rejection" ? [] : ["public"]);
    }
    assert.equal(original.closed, true, reason); c.dispose(); assert.ok(h.requests.every(r => r.closed));
  }
});


test("heldFavoriteCompletionTransfersDisplayedSourceToFocusedPinWithoutNewReads", async () => {
  const { h, c, original, favorite } = await heldFavoriteRefresh([event("new")]);
  c.setFocusedEvent("public"); const registrations = h.requests.length;
  favorite.send({ items: h.state.profiles(["pending"]) }); await settle();
  const ready = c.getSnapshot(); assert.equal(ready.kind, "available");
  if (ready.kind === "available") { assert.deepEqual(ready.events.map(event => event.id), ["new"]); assert.deepEqual(new Set(ready.eligibleEventIds), new Set(["new", "public"])); }
  assert.equal(original.closed, false); assert.equal(h.requests.length, registrations);
  c.setFocusedEvent("new"); assert.equal(original.closed, true);
  c.dispose(); assert.ok(h.requests.every(request => request.closed));
});


test("favoritesResolvingDuringNextCandidateRefreshCannotCommitTheStoppedIntermediatePool", async () => {
  const { h, c, original, favorite } = await heldFavoriteRefresh([event("intermediate")]);
  const intermediate = h.requests.filter(request => request.method === "signals").at(-1)!;
  h.state.holdEvents = true; c.refresh(); await settle();
  favorite.send({ items: h.state.profiles(["pending"]) }); await settle();
  const waiting = c.getSnapshot(); assert.equal(waiting.kind, "available");
  if (waiting.kind === "available") assert.deepEqual(waiting.events.map(event => event.id), ["public"]);
  assert.equal(intermediate.closed, true); assert.equal(original.closed, false);
  assert.ok(h.peak() <= 3); c.dispose(); assert.ok(h.requests.every(request => request.closed));
});
