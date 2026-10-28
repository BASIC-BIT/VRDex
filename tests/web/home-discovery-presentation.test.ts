import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import path from "node:path";
import test from "node:test";

test("static discovery cards preserve attribution, sparse evidence and canonical links", () => {
  const result = spawnSync(
    process.execPath,
    [
      "--import",
      "tsx",
      "--input-type=module",
      "-e",
      `
    import assert from 'node:assert/strict';
    import { createRequire } from 'node:module';
    const require = createRequire(import.meta.url);
    require.extensions['.css'] = module => { module.exports = { __esModule: true, default: new Proxy({}, { get: (_, key) => String(key) }) }; };
    const React = require('react');
    const { renderToStaticMarkup } = require('react-dom/server');
    const { HomeDiscoveryView } = require('./src/app/_components/discovery/home-discovery.tsx');
    const { DiscoveryEventCard } = require('./src/app/_components/discovery/discovery-event-card.tsx');
    const { DiscoveryClubCard } = require('./src/app/_components/discovery/discovery-club-card.tsx');
    const preferences = { version: 1, plan: [], favoriteProfileIds: ['favorite'] };
    const event = { id: 'event', slug: 'event', href: '/club/events/event', title: 'ORBIT', host: { id: 'club', slug: 'club', displayName: 'Prism' }, schedule: { kind: 'date_only', eventDate: '2026-12-05' } };
    const person = (id, name, genres = []) => ({ id, slug: id, displayName: name, profileType: 'person', genres });
    const genre = { slug: 'liquid', displayName: 'Liquid DnB', displayLabel: '  Deep liquid  ' };
    const signal = { eventId: 'event', performers: [person('first', 'First'), person('favorite', 'Aurora', [genre]), person('third', 'Third'), person('fourth', 'Fourth')], manualLabels: ['Manual'], coverage: 'partial' };
    const props = { event, signal, preferences, timeZone: 'Pacific/Honolulu', hour12: true, onSelect() {}, onSave() {} };
    const markup = renderToStaticMarkup(React.createElement(DiscoveryEventCard, props));
    assert.match(markup, /href="\\/club\\/events\\/event"/);
    assert.match(markup, /2026-12-05/);
    assert.match(markup.replace(/<[^>]+>/g, ""), /Aurora: Deep liquid/);
    assert.ok(markup.indexOf('>Aurora<') < markup.indexOf('>First<'));
    assert.ok(!markup.includes('>Fourth<'));
    assert.ok(!markup.includes('Manual'));
    const absent = renderToStaticMarkup(React.createElement(DiscoveryEventCard, { ...props, signal: undefined }));
    assert.ok(!absent.includes('Lineup genres'));
    assert.ok(!absent.includes('Liquid DnB'));
    const club = { id: 'club', slug: 'club', displayName: 'Prism', profileType: 'community', genres: [], logoImageUrl: 'https://example.invalid/logo.png' };
    const clubMarkup = renderToStaticMarkup(React.createElement(DiscoveryClubCard, { club, preferences, onFavorite() {} }));
    assert.match(clubMarkup, /href="\\/club"/);
    assert.match(clubMarkup, /logo.png/);
    assert.match(clubMarkup, /contained/);
    assert.ok(!clubMarkup.includes('Liquid DnB'));
    assert.ok(!/upcoming|next event/i.test(clubMarkup));
    const customClub = renderToStaticMarkup(React.createElement(DiscoveryClubCard, { club: { ...club, genres: [genre] }, preferences, onFavorite() {} }));
    assert.match(customClub, /Deep liquid/);
    assert.ok(!customClub.includes('Liquid DnB'));
    const coverage = { events: [{ complete: false }], clubs: [{ complete: false }], signals: [], candidateCount: 0, favoriteCount: 0 };
    const base = { snapshot: { kind: 'available', events: [], clubs: [], eventSignals: [], favoriteProfiles: [], coverage, refreshing: false }, preferences, timeZone: 'UTC', hour12: false, onSelect() {}, onSave() {}, onFavorite() {}, retry() {} };
    const partial = renderToStaticMarkup(React.createElement(HomeDiscoveryView, base));
    assert.match(partial, /href="\\/discovery"/);
    assert.ok(!/No events|No clubs/.test(partial));
    const complete = renderToStaticMarkup(React.createElement(HomeDiscoveryView, { ...base, snapshot: { ...base.snapshot, coverage: { ...coverage, events: [{ complete: true }], clubs: [{ complete: true }] } } }));
    assert.match(complete, /No events/); assert.match(complete, /No clubs/);
    for (const snapshot of [{ kind: 'loading' }, { kind: 'error', error: Error('secret') }]) {
      const state = renderToStaticMarkup(React.createElement(HomeDiscoveryView, { ...base, snapshot }));
      assert.match(state, /href="\\/discovery"/);
      assert.ok(!/No events|No clubs|secret/.test(state));
    }
  `,
    ],
    { cwd: path.resolve("apps/web"), encoding: "utf8" },
  );
  assert.equal(result.status, 0, result.stderr || result.stdout);
});
