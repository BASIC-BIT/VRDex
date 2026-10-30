import assert from "node:assert/strict";
import { it } from "node:test";
import { convexTest } from "convex-test";
import { api } from "../../convex/_generated/api";
import schemaModule from "../../convex/schema";
import type { Doc } from "../../convex/_generated/dataModel";

const schema = (schemaModule as unknown as { default?: typeof schemaModule }).default ?? schemaModule;
const modules = {
  "../../convex/_generated/api.ts": () => import("../../convex/_generated/api"),
  "../../convex/homeDiscovery.ts": () => import("../../convex/homeDiscovery"),
};
const now = Date.UTC(2026, 9, 28, 12);
const day = 86_400_000;
const base = { slug: "club", displayName: "Club", sortName: "club", aliases: [], tags: [], claimState: "unclaimed", creationSource: "self", publicationState: "published", publicSurfacingState: "public", updatedAt: 1 } as const;
const club = { ...base, profileType: "community", community: { categoryTags: [] } } satisfies Omit<Doc<"profiles">, "_id" | "_creationTime">;
const person = { ...base, slug: "dj", displayName: "DJ", profileType: "person", person: { roleTags: [] } } satisfies Omit<Doc<"profiles">, "_id" | "_creationTime">;
const event = { slug: "night", title: "Night", sortTitle: "night", startAt: now + day, eventStatus: "scheduled", publicationState: "published", sourceType: "community", sourceLabel: "Fixture", updatedAt: 1 } satisfies Omit<Doc<"events">, "_id" | "_creationTime">;
const slot = { position: 0, startAt: now + day, displayLabel: "Manual guest", roleLabel: "DJ", sourceType: "community", sourceLabel: "Fixture", confidence: 1, reviewState: "confirmed", updatedAt: 1 } satisfies Omit<Doc<"eventSlots">, "_id" | "_creationTime" | "eventId">;
function setup() { return convexTest({ schema, modules }); }
const request = { now, timeZone: "UTC", band: 0, kind: "timed", direction: "asc" } as const;

it("samplesDistantBandsBeyondDenseNearTermEvents", async () => {
  const t = setup();
  const distant = await t.run(async ({ db }) => {
    const host = await db.insert("profiles", club);
    for (let i = 0; i < 60; i++) await db.insert("events", { ...event, communityProfileId: host, startAt: now + (i + 1) * 3_600_000 });
    await db.insert("events", { ...event, communityProfileId: host, slug: "ongoing", startAt: now - 1, endAt: now + day });
    await db.insert("events", { ...event, communityProfileId: host, slug: "started-open", startAt: now - 1 });
    await db.insert("events", { ...event, communityProfileId: host, slug: "private", publicationState: "draft_private", startAt: now + 121 * day });
    await db.insert("events", { ...event, slug: "no-canonical-host", startAt: now + 122 * day });
    return db.insert("events", { ...event, communityProfileId: host, slug: "distant", startAt: now + 120 * day, posterImageUrl: "javascript:secret" });
  });
  const page = await t.query(api.homeDiscovery.listEvents, { ...request, band: 3 });
  assert.deepEqual(page.items.map(item => item.id), [distant]);
  assert.deepEqual(page.items[0]?.schedule, { kind: "open_end", startAt: now + 120 * day });
  assert.equal(page.items[0]?.href, "/club/events/distant");
  assert.equal(page.items[0]?.posterImageUrl, undefined);
  const near = await t.query(api.homeDiscovery.listEvents, request);
  assert.equal(near.items.length, 12);
  assert.equal(near.complete, false);
  assert.ok(near.items.every(item => item.schedule.kind !== "date_only" && item.schedule.startAt >= now));
});

it("continuesPastHiddenHostsWithinBudget", async () => {
  const t = setup();
  const publicId = await t.run(async ({ db }) => {
    const hidden = await db.insert("profiles", { ...club, slug: "hidden", displayName: "SECRET", publicSurfacingState: "suppressed" });
    for (let i = 0; i < 24; i++) await db.insert("events", { ...event, communityProfileId: hidden });
    const host = await db.insert("profiles", club);
    return db.insert("events", { ...event, communityProfileId: host });
  });
  let cursor: string | undefined;
  const ids: string[] = [];
  for (let i = 0; i < 3; i++) {
    const page = await t.query(api.homeDiscovery.listEvents, { ...request, ...(cursor ? { cursor } : {}) });
    if (i < 2) { assert.deepEqual(page.items, []); assert.equal(page.complete, false); }
    assert.ok(!JSON.stringify(page).includes("SECRET"));
    ids.push(...page.items.map(item => item.id));
    cursor = page.cursor ?? undefined;
  }
  assert.deepEqual(ids, [publicId]);
});

it("scopesCursorToBandZoneDirectionAndKind", async () => {
  const t = setup();
  await t.run(async ({ db }) => {
    const host = await db.insert("profiles", club);
    for (let i = 0; i < 13; i++) await db.insert("events", { ...event, communityProfileId: host });
    for (let i = 0; i < 13; i++) await db.insert("profiles", { ...club, slug: `club-${i}` });
  });
  const { cursor } = await t.query(api.homeDiscovery.listEvents, request);
  assert.ok(cursor);
  for (const changed of [{ band: 1 }, { timeZone: "Asia/Kathmandu" }, { direction: "desc" }, { kind: "date_only" }, { now: now + 1 } ] as const) {
    await assert.rejects(t.query(api.homeDiscovery.listEvents, { ...request, ...changed, cursor }), /cursor/i);
  }
  const clubs = await t.query(api.homeDiscovery.listClubs, { direction: "asc" });
  assert.ok(clubs.cursor);
  await assert.rejects(t.query(api.homeDiscovery.listClubs, { direction: "desc", cursor: clubs.cursor }), /cursor/i);
  await assert.rejects(t.query(api.homeDiscovery.listEvents, { ...request, timeZone: "Invalid/Zone" }), /timezone/i);
  await assert.rejects(t.query(api.homeDiscovery.listEvents, { ...request, now: NaN }), /time/i);
});

it("includesClubsWithoutEvents", async () => {
  const t = setup();
  const id = await t.run(async ({ db }) => {
    await db.insert("profiles", person);
    await db.insert("profiles", { ...club, publicationState: "draft_private" });
    await db.insert("profiles", { ...club, publicSurfacingState: "suppressed" });
    return db.insert("profiles", { ...club, genres: [{ source: "owner_selected", confidence: "high", explicit: true, slug: "club-house", displayName: "House" }], avatarImageUrl: "https://example.com/logo.png", bannerImageUrl: "https://example.com/banner.png" });
  });
  const page = await t.query(api.homeDiscovery.listClubs, { direction: "desc" });
  assert.deepEqual(page.items.map(item => item.id), [id]);
  assert.deepEqual(page.items[0]?.genres, [{ slug: "club-house", displayName: "House" }]);
  assert.equal(page.items[0]?.profileType, "community");
  assert.equal(page.complete, true);
});

it("projectsOnlyCurrentPublicGenreAssignments", async () => {
  const t = setup();
  const ids = await t.run(async ({ db }) => {
    const host = await db.insert("profiles", club);
    const eventId = await db.insert("events", { ...event, communityProfileId: host });
    const first = await db.insert("profiles", { ...person, genres: [{ source: "owner_selected", confidence: "high", explicit: true, slug: "first-house", displayName: "House", displayLabel: "First House", featured: true }] });
    const second = await db.insert("profiles", { ...person, slug: "second", genres: [{ source: "owner_selected", confidence: "high", explicit: true, slug: "second-house", displayName: "House" }] });
    const hiddenGenre = await db.insert("profiles", { ...person, slug: "private-genre", genres: [{ source: "owner_selected", confidence: "high", explicit: true, slug: "SECRET", displayName: "SECRET" }], fieldVisibility: { genres: "unlisted" } });
    const hidden = await db.insert("profiles", { ...person, slug: "suppressed", displayName: "SECRET", publicSurfacingState: "suppressed" });
    for (const [position, id] of [first, second, hiddenGenre, hidden].entries()) await db.insert("eventLineupEntries", { eventId, clientKey: `${position}`, position, performerLabel: "Authored", personProfileId: id, updatedAt: 1 });
    return { host, eventId, first, second, hiddenGenre, hidden };
  });
  const result = await t.query(api.homeDiscovery.eventSignals, { eventIds: [ids.eventId, ids.eventId, "invalid"] });
  assert.equal(result.items.length, 1);
  assert.equal(result.items[0]?.coverage, "complete");
  assert.deepEqual(result.items[0]?.performers.map(p => [p.id, p.genres]), [
    [ids.first, [{ slug: "first-house", displayName: "House", displayLabel: "First House", featured: true }]],
    [ids.second, [{ slug: "second-house", displayName: "House" }]], [ids.hiddenGenre, []],
  ]);
  assert.ok(!JSON.stringify(result).includes("SECRET"));
  const favorites = await t.query(api.homeDiscovery.profileSignals, { profileIds: [ids.first, ids.first, ids.host, ids.hidden, "invalid"] });
  assert.deepEqual(favorites.items.map(p => p.id), [ids.first, ids.host]);
  await t.run(async ({ db }) => { await db.patch(ids.first, { fieldVisibility: { genres: "private" } }); await db.patch(ids.host, { publicSurfacingState: "suppressed" }); });
  assert.deepEqual((await t.query(api.homeDiscovery.profileSignals, { profileIds: [ids.first, ids.host] })).items.map(p => p.genres), [[]]);
  assert.deepEqual(await t.query(api.homeDiscovery.eventSignals, { eventIds: [ids.eventId] }), { items: [] });
  assert.deepEqual((await t.query(api.homeDiscovery.listEvents, request)).items, []);
});

it("boundsRosterReadsAndReportsPartial", async () => {
  const t = setup();
  const ids = await t.run(async ({ db }) => {
    const host = await db.insert("profiles", club);
    const eventId = await db.insert("events", { ...event, communityProfileId: host });
    const first = await db.insert("profiles", person);
    const outside = await db.insert("profiles", { ...person, slug: "favorite-outside-sample" });
    const photographer = await db.insert("profiles", { ...person, slug: "photographer" });
    for (let i = 0; i < 20; i++) {
      await db.insert("eventSlots", { ...slot, eventId, position: i, startAt: now + day + i, ...(i === 19 ? { personProfileId: outside } : i === 0 ? { personProfileId: first } : {}) });
      await db.insert("eventLineupEntries", { eventId, clientKey: `${i}`, position: i, performerLabel: `Guest ${i}`, ...(i === 0 ? { personProfileId: first } : {}), updatedAt: 1 });
      await db.insert("eventParticipants", { eventId, personProfileId: photographer, eventPublicationState: "published", eventStatus: "scheduled", confirmationState: "confirmed", roleLabel: "Photographer", sourceType: "community", sourceLabel: "Fixture", updatedAt: 1 });
    }
    return { eventId, first, outside, photographer };
  });
  const result = (await t.query(api.homeDiscovery.eventSignals, { eventIds: [ids.eventId] })).items[0];
  assert.ok(result);
  assert.equal(result.coverage, "partial");
  assert.deepEqual(result.performers.map(p => p.id), [ids.first]);
  assert.equal(result.manualLabels.length, 14);
  assert.ok(!JSON.stringify(result).includes("Guest 8"));
  assert.ok(!JSON.stringify(result).includes(ids.outside));
  assert.ok(!JSON.stringify(result).includes(ids.photographer));
});

it("rejectsOversizedSignalBatches", async () => {
  const t = setup();
  await assert.rejects(t.query(api.homeDiscovery.eventSignals, { eventIds: Array.from({ length: 5 }, (_, i) => `invalid-${i}`) }), /many|maximum|limit/i);
  await assert.rejects(t.query(api.homeDiscovery.profileSignals, { profileIds: Array.from({ length: 51 }, (_, i) => `invalid-${i}`) }), /many|maximum|limit/i);
  assert.deepEqual(await t.query(api.homeDiscovery.profileSignals, { profileIds: Array(100).fill("invalid") }), { items: [] });
});

it("keepsAuthoredTodayAcrossLocalMidnightAndDstAndHonorsFlag", async () => {
  const t = setup();
  await t.run(async ({ db }) => {
    const host = await db.insert("profiles", club);
    for (const date of ["2026-10-31", "2026-11-01", "2026-11-02", "2026-11-08"]) await db.insert("events", { ...event, slug: date, communityProfileId: host, startAt: undefined, scheduleKind: "date_only", eventDate: date });
  });
  const oldFlag = process.env.EVENT_DATE_ONLY_ENABLED;
  try {
    process.env.EVENT_DATE_ONLY_ENABLED = "true";
    for (const instant of [Date.UTC(2026, 10, 1, 4, 30), Date.UTC(2026, 10, 1, 6, 30)]) {
      const page = await t.query(api.homeDiscovery.listEvents, { ...request, now: instant, timeZone: "America/New_York", kind: "date_only" });
      assert.deepEqual(page.items.map(item => item.slug), ["2026-11-01", "2026-11-02"]);
      assert.deepEqual(page.items[0]?.schedule, { kind: "date_only", eventDate: "2026-11-01" });
    }
    process.env.EVENT_DATE_ONLY_ENABLED = "false";
    assert.deepEqual((await t.query(api.homeDiscovery.listEvents, { ...request, kind: "date_only" })).items, []);
  } finally { if (oldFlag === undefined) delete process.env.EVENT_DATE_ONLY_ENABLED; else process.env.EVENT_DATE_ONLY_ENABLED = oldFlag; }
});

it("usesBoundedUploadedClubArtworkAndCurrentPrivacy", async () => {
  const t = setup();
  const ids = await t.run(async ({ db }) => {
    const profileId = await db.insert("profiles", { ...club, outboundLinks: [{ type: "discord", label: "Discord", url: "https://discord.gg/public", source: "owner_authored" }] });
    const assetBase = { profileId, storageKey: "PRIVATE-STORAGE", mimeType: "image/png", byteSize: 12, visibility: "public", source: "owner_authored", uploadedBy: { tokenIdentifier: "fixture", issuer: "fixture", subject: "fixture" }, uploadedAt: 1, state: "active", updatedAt: 1 } as const;
    const logo = await db.insert("profileAssets", assetBase);
    const avatar = await db.insert("profileAssets", assetBase);
    const banner = await db.insert("profileAssets", assetBase);
    for (const [placement, assetId] of [["primary_logo", logo], ["profile_image", avatar], ["banner", banner]] as const) {
      await db.insert("profileAssetPlacements", { profileId, assetId, placement, position: 0, state: "active", updatedAt: 1 });
      for (let i = 1; i <= 30; i++) {
        const extra = await db.insert("profileAssets", assetBase);
        await db.insert("profileAssetPlacements", { profileId, assetId: extra, placement, position: i, state: "active", updatedAt: 1 });
      }
    }
    await db.insert("profileAssetDisplayPreferences", { profileId, compactDisplay: "logo", updatedAt: 1 });
    await db.insert("profileLinkDestinations", { key: "discord_guild:public", locator: "public", provider: "discord", kind: "discord_guild", status: "resolved", entityId: "guild", artworkSourceUrl: "https://example.com/auto.png", observedAt: 1 });
    return { profileId, logo, avatar, banner };
  });
  const image = (assetId: string) => `/api/v0/profiles/club/assets/${assetId}/file`;
  const first = (await t.query(api.homeDiscovery.listClubs, { direction: "asc" })).items[0];
  assert.equal(first?.profileType, "community");
  assert.ok(first?.profileType === "community");
  assert.equal(first.imageUrl, image(ids.logo));
  assert.equal(first.logoImageUrl, image(ids.logo));
  assert.equal(first.bannerImageUrl, image(ids.banner));
  assert.ok(!JSON.stringify(first).includes("PRIVATE-STORAGE"));
  await t.run(async ({ db }) => {
    const { getPublicProfileCompactImages } = await import("../../convex/_profileAssets");
    const profile = await db.get(ids.profileId);
    assert.ok(profile);
    let assetReads = 0;
    const trackedDb = new Proxy(db, { get(target, property, receiver) {
      if (property === "get") return (id: typeof ids.logo) => { assetReads++; return target.get(id); };
      if (property === "query") return (table: Parameters<typeof db.query>[0]) => {
        assert.notEqual(table, "profileAssets", "Artwork must read selected asset IDs, never scan the asset collection");
        return target.query(table);
      };
      return Reflect.get(target, property, receiver);
    } });
    await getPublicProfileCompactImages(trackedDb, profile);
    assert.equal(assetReads, 3);
  });
  for (const patch of [{ visibility: "private" }, { visibility: "public", moderatorSuppressedAt: 1 }, { moderatorSuppressedAt: undefined, state: "deleted" }] as const) {
    await t.run(({ db }) => db.patch(ids.logo, patch));
    const result = (await t.query(api.homeDiscovery.profileSignals, { profileIds: [ids.profileId] })).items[0];
    assert.ok(result?.profileType === "community");
    assert.equal(result.logoImageUrl, undefined);
    assert.equal(result.imageUrl, image(ids.avatar));
  }
  await t.run(async ({ db }) => {
    await db.patch(ids.avatar, { visibility: "private" });
    await db.patch(ids.profileId, { fieldVisibility: { mediaKit: "unlisted", bannerImageUrl: "private" } });
  });
  const hidden = (await t.query(api.homeDiscovery.profileSignals, { profileIds: [ids.profileId] })).items[0];
  assert.ok(hidden?.profileType === "community");
  assert.equal(hidden.logoImageUrl, undefined);
  assert.equal(hidden.bannerImageUrl, undefined);
  assert.equal(hidden.imageUrl, undefined, "Private authored artwork prevents an automatic replacement");
});

it("placesTimedBandEdgesOnViewerDatesWithNoPastOrUpperCutoff", async () => {
  const t = setup();
  const localNow = Date.UTC(2026, 9, 28, 18, 16); // Kathmandu is already October 29.
  await t.run(async ({ db }) => {
    const host = await db.insert("profiles", club);
    for (const [slug, startAt] of [
      ["past", localNow - 1], ["now", localNow],
      ["end-six", Date.UTC(2026, 10, 4, 18, 14, 59, 999)],
      ["day-seven", Date.UTC(2026, 10, 4, 18, 15)],
      ["day-thirty", Date.UTC(2026, 10, 27, 18, 15)],
      ["day-ninety", Date.UTC(2027, 0, 26, 18, 15)],
      ["very-distant", Date.UTC(2045, 0, 1)],
    ] as const) await db.insert("events", { ...event, communityProfileId: host, slug, startAt });
  });
  for (const [band, expected] of [[0, ["now", "end-six"]], [1, ["day-seven"]], [2, ["day-thirty"]], [3, ["day-ninety", "very-distant"]]] as const) {
    const page = await t.query(api.homeDiscovery.listEvents, { ...request, now: localNow, timeZone: "Asia/Kathmandu", band });
    assert.deepEqual(page.items.map(item => item.slug), expected);
    const reverse = await t.query(api.homeDiscovery.listEvents, { ...request, now: localNow, timeZone: "Asia/Kathmandu", band, direction: "desc" });
    assert.deepEqual(reverse.items.map(item => item.slug), [...expected].reverse());
  }
});

it("acceptsOnlyConfirmedExplicitDjParticipantEvidence", async () => {
  const t = setup();
  const ids = await t.run(async ({ db }) => {
    const host = await db.insert("profiles", club);
    const eventId = await db.insert("events", { ...event, communityProfileId: host });
    const dj = await db.insert("profiles", person);
    const other = await db.insert("profiles", { ...person, slug: "other" });
    for (const [personProfileId, roleLabel, confirmationState] of [[other, "Host", "confirmed"], [other, "DJ", "unconfirmed"], [dj, "DJ", "confirmed"]] as const) {
      await db.insert("eventParticipants", { eventId, personProfileId, eventPublicationState: "published", eventStatus: "scheduled", roleLabel, confirmationState, sourceType: "community", sourceLabel: "Fixture", updatedAt: 1 });
    }
    return { eventId, dj };
  });
  const result = await t.query(api.homeDiscovery.eventSignals, { eventIds: [ids.eventId] });
  assert.deepEqual(result.items[0]?.performers.map(item => item.id), [ids.dj]);
  assert.equal(result.items[0]?.coverage, "complete");
});

it("findsFavoriteBeyondOldPrefix", async () => {
  const t = setup();
  const ids = await t.run(async ({ db }) => {
    const host = await db.insert("profiles", club);
    const eventId = await db.insert("events", { ...event, communityProfileId: host });
    const lateFavoriteId = await db.insert("profiles", person);
    for (let i = 0; i <= 80; i++) {
      await db.insert("eventSlots", { ...slot, eventId, position: i, startAt: now + day + i,
        ...(i === 80 ? { personProfileId: lateFavoriteId } : {}) });
    }
    return { eventId, lateFavoriteId };
  });
  const result = await t.query(api.homeDiscovery.favoriteLineup, { eventIds: [ids.eventId], favoriteProfileIds: [ids.lateFavoriteId] });
  assert.deepEqual(result.items[0]?.performers.map(person => person.id), [ids.lateFavoriteId]);
  assert.deepEqual(Object.keys(result.items[0]!.performers[0]!).sort(), ["displayName", "id", "slug"]);
});

it("deduplicatesRosterSources", async () => {
  const t = setup();
  const ids = await t.run(async ({ db }) => {
    const host = await db.insert("profiles", club);
    const eventId = await db.insert("events", { ...event, communityProfileId: host });
    const favorite = await db.insert("profiles", person);
    const photographer = await db.insert("profiles", { ...person, slug: "photographer" });
    const unconfirmed = await db.insert("profiles", { ...person, slug: "unconfirmed" });
    await db.insert("eventSlots", { ...slot, eventId, personProfileId: favorite });
    await db.insert("eventLineupEntries", { eventId, clientKey: "favorite", position: 0, performerLabel: "Guest", personProfileId: favorite, updatedAt: 1 });
    for (const [personProfileId, confirmationState] of [[favorite, "confirmed"], [photographer, "confirmed"], [unconfirmed, "unconfirmed"]] as const) {
      await db.insert("eventParticipants", { eventId, personProfileId, eventPublicationState: "published", eventStatus: "scheduled", confirmationState, roleLabel: "Photographer", sourceType: "community", sourceLabel: "Fixture", updatedAt: 1 });
    }
    return { eventId, favorite, photographer, unconfirmed };
  });
  const result = await t.query(api.homeDiscovery.favoriteLineup, { eventIds: [ids.eventId, ids.eventId], favoriteProfileIds: [ids.favorite, ids.favorite, ids.photographer, ids.unconfirmed] });
  assert.equal(result.items.length, 1);
  assert.deepEqual(result.items[0]?.performers.map(person => person.id), [ids.favorite, ids.photographer]);
});

it("omitsPrivatePeopleAndEvents", async () => {
  const t = setup();
  const ids = await t.run(async ({ db }) => {
    const host = await db.insert("profiles", club);
    const eventId = await db.insert("events", { ...event, communityProfileId: host });
    const privateEvent = await db.insert("events", { ...event, communityProfileId: host, publicationState: "draft_private" });
    const favorite = await db.insert("profiles", person);
    const hidden = await db.insert("profiles", { ...person, publicSurfacingState: "suppressed", displayName: "SECRET" });
    const privatePerson = await db.insert("profiles", { ...person, publicationState: "draft_private", displayName: "SECRET" });
    for (const e of [eventId, privateEvent]) for (const personProfileId of [favorite, hidden, privatePerson, host]) {
      await db.insert("eventSlots", { ...slot, eventId: e, personProfileId });
    }
    return { host, eventId, privateEvent, favorite, hidden, privatePerson };
  });
  const args = { eventIds: [ids.eventId, ids.privateEvent], favoriteProfileIds: [ids.favorite, ids.hidden, ids.privatePerson, ids.host, "invalid"] };
  const result = await t.query(api.homeDiscovery.favoriteLineup, args);
  assert.deepEqual(result.items.map(item => [item.eventId, item.performers.map(person => person.id)]), [[ids.eventId, [ids.favorite]]]);
  assert.ok(!JSON.stringify(result).includes("SECRET"));
  await t.run(({ db }) => db.patch(ids.favorite, { publicSurfacingState: "opted_out" }));
  assert.deepEqual((await t.query(api.homeDiscovery.favoriteLineup, args)).items[0]?.performers, []);
  await t.run(({ db }) => db.patch(ids.host, { publicSurfacingState: "suppressed" }));
  assert.deepEqual(await t.query(api.homeDiscovery.favoriteLineup, args), { items: [] });
  assert.deepEqual(await t.query(api.homeDiscovery.favoriteLineup, { ...args, eventIds: ["invalid"] }), { items: [] });
});

it("dateOnlyMatchesPublicRosterSemantics", async () => {
  const t = setup();
  const ids = await t.run(async ({ db }) => {
    const host = await db.insert("profiles", club);
    const eventId = await db.insert("events", { ...event, communityProfileId: host, startAt: undefined, scheduleKind: "date_only", eventDate: "2026-10-30" });
    const slotPerson = await db.insert("profiles", person);
    const lineupPerson = await db.insert("profiles", { ...person, slug: "lineup" });
    const participant = await db.insert("profiles", { ...person, slug: "participant" });
    await db.insert("eventSlots", { ...slot, eventId, personProfileId: slotPerson });
    await db.insert("eventLineupEntries", { eventId, clientKey: "lineup", position: 0, performerLabel: "Host", roleLabel: "Host", personProfileId: lineupPerson, updatedAt: 1 });
    await db.insert("eventParticipants", { eventId, personProfileId: participant, eventPublicationState: "published", eventStatus: "scheduled", confirmationState: "confirmed", roleLabel: "Host", sourceType: "community", sourceLabel: "Fixture", updatedAt: 1 });
    return { eventId, slotPerson, lineupPerson, participant };
  });
  const args = { eventIds: [ids.eventId], favoriteProfileIds: [ids.slotPerson, ids.lineupPerson, ids.participant] };
  assert.deepEqual((await t.query(api.homeDiscovery.favoriteLineup, args)).items[0]?.performers.map(person => person.id), [ids.lineupPerson, ids.participant]);
});

it("rejectsOversizedFavoriteMembershipBatches", async () => {
  const t = setup();
  await assert.rejects(t.query(api.homeDiscovery.favoriteLineup, { eventIds: Array(3).fill("same"), favoriteProfileIds: [] }), /many|maximum|limit/i);
  await assert.rejects(t.query(api.homeDiscovery.favoriteLineup, { eventIds: [], favoriteProfileIds: Array(26).fill("same") }), /many|maximum|limit/i);
  assert.deepEqual(await t.query(api.homeDiscovery.favoriteLineup, { eventIds: ["invalid", "invalid"], favoriteProfileIds: Array(25).fill("invalid") }), { items: [] });
});
