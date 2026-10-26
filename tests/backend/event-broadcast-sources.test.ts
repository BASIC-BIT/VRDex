import { loadFixtureEvents } from "../fixtures/event-modules";
import { bindVrcdnTestAccount } from "./_eventOutputAccountFixture";
import assert from "node:assert/strict";
import { test } from "node:test";
import { convexTest } from "convex-test";
import { makeFunctionReference } from "convex/server";
import { api } from "../../convex/_generated/api";
import schemaModule from "../../convex/schema";
import { newClerkUserId } from "./_clerkTestIdentity";

const schema = (schemaModule as unknown as { default?: typeof schemaModule }).default ?? schemaModule;
const input = { kind: "twitch", channel: "basic_bit" } as const;
const startAt = Date.UTC(2027, 9, 15, 18);
const sourceMutation = (name: string) => makeFunctionReference<"mutation">(`eventMediaSources:${name}`);
async function fixture() {
  const t = convexTest({ schema, modules: {
    "../../convex/_generated/api.ts": () => import("../../convex/_generated/api"),
    "../../convex/events.ts": loadFixtureEvents,
    "../../convex/eventMediaWorker.ts": () => import("../../convex/eventMediaWorker"),
    "../../convex/eventMediaSources.ts": () => import("../../convex/eventMediaSources"),
  } });
  const subject = newClerkUserId();
  await t.run(async ({ db }) => {
    const now = Date.now();
    const userId = await db.insert("users", { clerkUserId: subject, name: "Owner", emailVerificationTime: now });
    const common = { aliases: [], tags: [], claimState: "unclaimed" as const, publicationState: "published" as const, publicSurfacingState: "public" as const, creationSource: "community" as const, updatedAt: now };
    const club = await db.insert("profiles", { ...common, slug: "club", displayName: "Club", sortName: "club", profileType: "community", community: { categoryTags: [] } });
    await db.insert("profileOwners", { profileId: club, userId, roleKey: "owner", state: "active", grantedAt: now, updatedAt: now });
    for (const slug of ["guest", "other"]) await db.insert("profiles", { ...common, slug, displayName: slug, sortName: slug, profileType: "person", person: { roleTags: [] }, outboundLinks: [{ source: "owner_authored", type: "twitch", label: "Twitch", url: "https://www.twitch.tv/Basic_Bit" }, { source: "owner_authored", type: "vrcdn", label: "VRCDN", url: "vrcdn:alpha" }] });
  });
  const owner = t.withIdentity({ subject, issuer: "test", tokenIdentifier: `test|${subject}`, emailVerified: true });
  const event = await owner.mutation(api.events.createCommunityEvent, { title: "Inputs night", communitySlug: "club", startAt, endAt: startAt + 7200000, timezone: "UTC" });
  return { t, owner, event };
}

test("canonical broadcast inputs normalize provider references and reject fetch endpoints", async () => {
  const { broadcastInputKey, parseBroadcastInputUrl } = await import("../../convex/_eventBroadcastSources");
  assert.equal(broadcastInputKey({ kind: "twitch", channel: "basic_bit" }), "twitch:basic_bit");
  assert.deepEqual(parseBroadcastInputUrl("https://www.twitch.tv/Basic_Bit/"), input);
  assert.deepEqual(parseBroadcastInputUrl("https://panel.vrcdn.live/preview/alpha"), { kind: "vrcdn", streamId: "alpha" });
  for (const value of ["https://twitch.tv/videos", "https://twitch.tv/directory", "https://twitch.tv/basic_bit?token=secret", "https://user@twitch.tv/basic_bit", "https://twitch.tv:444/basic_bit", "https://twitch.tv/basic_bit/videos", "https://evil.test/live.ts", "https://stream.vrcdn.live/live/alpha.mp4"]) assert.throws(() => parseBroadcastInputUrl(value));
});

test("resolution preserves explicit and legacy choices and never falls through unavailable inputs", async () => {
  const { resolveBroadcastInput } = await import("../../convex/_eventBroadcastSources");
  const alpha = { kind: "vrcdn", streamId: "alpha" } as const;
  const beta = { kind: "vrcdn", streamId: "beta" } as const;
  const choices = [alpha, beta, input].map(input => ({ input, key: `${input.kind}:${"channel" in input ? input.channel : input.streamId}`, label: "Input" }));
  assert.deepEqual(resolveBroadcastInput({ choices, explicitInput: input, legacySelectedStreamId: "alpha" }), input);
  assert.equal(resolveBroadcastInput({ choices }), undefined);
  assert.deepEqual(resolveBroadcastInput({ choices: choices.slice(2) }), input);
  assert.deepEqual(resolveBroadcastInput({ choices, legacySelectedStreamId: "alpha" }), alpha);
  assert.equal(resolveBroadcastInput({ choices: choices.slice(2), legacySelectedStreamId: "alpha" }), undefined);
  assert.equal(resolveBroadcastInput({ choices: choices.slice(0, 2), explicitInput: input }), undefined);
  assert.deepEqual(resolveBroadcastInput({ choices: [choices[0]!, choices[2]!] }), alpha);
});

for (const path of ["lineup", "slotLinks"] as const) test(`${path} persists broadcast input separately, preserves omission, resets null, and clears performer changes`, async () => {
  const { t, owner, event } = await fixture();
  const save = async (personSlug: string, selection: object = {}) => {
    const snapshot = await owner.query(api.events.getEditableBySlug, { slug: event.slug });
    const row = { personSlug, startAt, endAt: startAt + 3600000, ...selection };
    await owner.mutation(api.events.updateCommunityEvent, { currentSlug: event.slug, communitySlug: "club", timezone: "UTC", preservedSlotAssociationIds: snapshot!.preservedSlotAssociationIds,
      ...(path === "lineup" ? { lineup: [{ ...row, clientKey: "guest", position: 0, performerLabel: "Guest" }] } : { slotLinks: [{ ...row, displayLabel: "Guest" }] }) });
    return (await t.run(ctx => ctx.db.query("eventSlots").withIndex("by_eventId", q => q.eq("eventId", event.eventId)).unique()))!;
  };
  let stored = await save("guest", { broadcastInput: input, selectedStreamId: "alpha" });
  assert.deepEqual(stored.broadcastInput, input);
  assert.equal(stored.selectedStreamId, "alpha");
  assert.deepEqual((await save("guest")).broadcastInput, input);
  const editable = await owner.query(api.events.getEditableBySlug, { slug: event.slug });
  assert.deepEqual(editable!.slots[0]!.broadcastInput, input);
  assert.equal(editable!.slots[0]!.broadcastInputChoices.length, 2);
  assert.equal((await save("guest", { broadcastInput: null })).broadcastInput, undefined);
  await save("guest", { broadcastInput: input });
  assert.equal((await save("other")).broadcastInput, undefined);
});

test("custom source mutations enforce media authority, preserve revisions and audit disabled records without sessions", async () => {
  const { t, owner, event } = await fixture();
  const args = { currentSlug: event.slug, label: "Guest", url: "https://twitch.tv/Basic_Bit" };
  await assert.rejects(t.mutation(sourceMutation("create"), args), /authenticat|signed/i);
  const created = await owner.mutation(sourceMutation("create"), args);
  assert.equal(created.revision, 1);
  let original = await t.run(ctx => ctx.db.get(created.sourceId));
  assert.deepEqual(original!.input, input);
  assert.equal(original!.publicUrl, "https://www.twitch.tv/basic_bit");
  await owner.mutation(sourceMutation("rename"), { currentSlug: event.slug, sourceId: created.sourceId, label: "Renamed" });
  original = await t.run(ctx => ctx.db.get(created.sourceId));
  assert.equal(original!.label, "Renamed");
  assert.equal(original!.revision, 1);
  const replacement = await owner.mutation(sourceMutation("replace"), { ...args, sourceId: created.sourceId, url: "vrcdn:alpha" });
  assert.notEqual(replacement.sourceId, created.sourceId);
  assert.equal(replacement.revision, 2);
  assert.deepEqual(await t.run(ctx => ctx.db.get(created.sourceId)), original);
  for (const name of ["rename", "replace", "remove"]) await assert.rejects(t.mutation(sourceMutation(name), { currentSlug: event.slug, sourceId: replacement.sourceId, ...(name === "remove" ? {} : { label: "X" }), ...(name === "replace" ? { url: "vrcdn:beta" } : {}) }), /authenticat|signed/i);
  await owner.mutation(sourceMutation("remove"), { currentSlug: event.slug, sourceId: replacement.sourceId });
  assert.equal((await t.run(ctx => ctx.db.get(replacement.sourceId)))!.state, "disabled");
  assert.equal((await t.run(ctx => ctx.db.query("eventMediaSessions").collect())).length, 0);
  assert.equal((await t.run(ctx => ctx.db.query("eventMediaOutputs").collect())).length, 0);
  const audit = await t.run(ctx => ctx.db.query("eventMediaAuditEvents").collect());
  assert.ok(audit.some(row => row.action === "source_removed" && row.sourceId === replacement.sourceId));
});

test("public broadcast choices keep the existing VRCDN-only stream contract", async () => {
  const { t } = await fixture();
  const choices = await t.query(makeFunctionReference<"query">("events:getPersonBroadcastInputChoices"), { personSlug: "guest" });
  assert.deepEqual(choices.map((choice: { key: string }) => choice.key), ["vrcdn:alpha", "twitch:basic_bit"]);
  const legacy = await t.query(api.events.getPersonStreamChoices, { slug: "guest" });
  assert.deepEqual(legacy.map(choice => choice.streamId), ["alpha"]);
});

test("hidden explicit inputs are retained but unavailable, and new hidden selections are rejected", async () => {
  const { t, owner, event } = await fixture();
  const row = { clientKey: "guest", position: 0, performerLabel: "Guest", personSlug: "guest", startAt, broadcastInput: input };
  await owner.mutation(api.events.updateCommunityEvent, { currentSlug: event.slug, communitySlug: "club", lineup: [row] });
  const snapshot = await owner.query(api.events.getEditableBySlug, { slug: event.slug });
  await t.run(async ctx => {
    const profile = await ctx.db.query("profiles").withIndex("by_slug", q => q.eq("slug", "guest")).unique();
    await ctx.db.patch(profile!._id, { outboundLinks: [] });
  });
  await owner.mutation(api.events.updateCommunityEvent, { currentSlug: event.slug, communitySlug: "club", lineup: [{ ...row, broadcastInput: undefined }], preservedSlotAssociationIds: snapshot!.preservedSlotAssociationIds });
  const editable = await owner.query(api.events.getEditableBySlug, { slug: event.slug });
  assert.deepEqual(editable!.slots[0]!.broadcastInput, input);
  assert.deepEqual(editable!.slots[0]!.broadcastInputChoices, []);
  const { resolveBroadcastInput } = await import("../../convex/_eventBroadcastSources");
  assert.equal(resolveBroadcastInput({ choices: editable!.slots[0]!.broadcastInputChoices, explicitInput: editable!.slots[0]!.broadcastInput }), undefined);
  await assert.rejects(owner.mutation(api.events.updateCommunityEvent, { currentSlug: event.slug, communitySlug: "club", lineup: [{ ...row, clientKey: "new" }] }), /public inputs/);
});

test("custom source removal retains scope checks and is idempotent without an active session", async () => {
  const { t, owner, event } = await fixture();
  const created = await owner.mutation(sourceMutation("create"), { currentSlug: event.slug, label: "Guest", url: "vrcdn:alpha" });
  const source = (await t.run(ctx => ctx.db.get(created.sourceId)))!;
  const other = await owner.mutation(api.events.createCommunityEvent, { title: "Other night", communitySlug: "club", startAt, timezone: "UTC" });
  await assert.rejects(owner.mutation(sourceMutation("remove"), { currentSlug: other.slug, sourceId: source._id }), /not found/);
  await t.run(ctx => ctx.db.patch(source.programId, { currentSourceId: source._id, state: "live" }));
  await owner.mutation(sourceMutation("remove"), { currentSlug: event.slug, sourceId: source._id });
  await t.run(async ctx => {
    await ctx.db.patch(source.programId, { currentSourceId: undefined, state: "draft" });
    await ctx.db.insert("eventMediaCommands", { programId: source.programId, eventId: event.eventId, commandType: "switch_source", status: "queued", actorSurface: "web", targetSourceId: source._id, publicFallbackLinks: [], createdAt: Date.now(), updatedAt: Date.now() });
  });
  await owner.mutation(sourceMutation("remove"), { currentSlug: event.slug, sourceId: source._id });
  assert.equal((await t.run(ctx => ctx.db.get(source._id)))!.state, "disabled");
  const outsiderSubject = newClerkUserId();
  await t.run(ctx => ctx.db.insert("users", { clerkUserId: outsiderSubject, name: "Outsider", emailVerificationTime: Date.now() }));
  const outsider = t.withIdentity({ subject: outsiderSubject, issuer: "test", tokenIdentifier: `test|${outsiderSubject}`, emailVerified: true });
  await assert.rejects(outsider.mutation(sourceMutation("create"), { currentSlug: event.slug, label: "Unauthorized", url: "vrcdn:alpha" }), /permission/);
});

test("worker configuration derives canonical inputs, positive revisions and public URLs including legacy source rows", async () => {
  const { t, owner, event } = await fixture();
  const club = await t.run(ctx => ctx.db.query("profiles").withIndex("by_slug", q => q.eq("slug", "club")).unique());
  bindVrcdnTestAccount(club!._id, "event-media/vrcdn/main");
  const output = await owner.mutation(api.events.configureVrcdnOutput, { currentSlug: event.slug, key: "main", label: "Main", credentialRef: "event-media/vrcdn/main", sourceConsentAccepted: true, destinationAuthorityAccepted: true, providerRulesAccepted: true, rightsClearedMediaAccepted: true, playbackLinks: [{ platform: "browser", url: "https://example.test/watch" }] });
  await owner.mutation(api.events.updateCommunityEvent, { currentSlug: event.slug, communitySlug: "club", lineup: [{ clientKey: "guest", position: 0, performerLabel: "Guest", personSlug: "guest", startAt, broadcastInput: input }] });
  const legacyId = await t.run(ctx => ctx.db.insert("eventMediaSources", { programId: output.programId, eventId: event.eventId, key: "legacy", position: 1, type: "vrcdn_link", purpose: "program", state: "ready", label: "Legacy", publicUrl: "https://vrcdn.live/legacy", createdAt: Date.now(), updatedAt: Date.now() }));
  const scheduled = await owner.mutation(api.events.scheduleEventMediaWorker, { currentSlug: event.slug });
  await t.run(ctx => ctx.db.patch(scheduled.sessionId, { scheduledStartAt: Date.now() - 1000 }));
  process.env.VRDEX_EVENT_MEDIA_BRIDGE_TOKEN = "sources-test-bridge";
  const lease = await t.mutation(makeFunctionReference<"mutation">("eventMediaWorker:acquireSession"), { protocolVersion:2, bridgeToken: "sources-test-bridge", eventId: event.eventId, sessionId: scheduled.sessionId, workerId: "sources-worker", epoch: 0 });
  assert.equal(lease.granted, true);
  const sources = lease.configuration.sources;
  const projected = sources.find((source: { eventSlotId?: string }) => source.eventSlotId !== undefined);
  assert.deepEqual(projected.input, input);
  assert.equal(projected.publicUrl, "https://www.twitch.tv/basic_bit");
  assert.equal(projected.revision, 1);
  assert.equal(projected.eventId, event.eventId);
  const legacy = sources.find((source: { id: string }) => source.id === legacyId);
  assert.deepEqual(legacy.input, { kind: "vrcdn", streamId: "legacy" });
  assert.equal(legacy.publicUrl, "https://stream.vrcdn.live/live/legacy.live.ts");
  assert.equal(legacy.revision, 1);
  const status = await owner.query(api.events.getEventMediaControlStatus, { currentSlug: event.slug });
  const statusLegacy = status.sources.find(source => source.sourceId === legacyId)!;
  assert.deepEqual(statusLegacy.input, legacy.input);
  assert.equal(statusLegacy.publicUrl, legacy.publicUrl);
  const again = await t.mutation(makeFunctionReference<"mutation">("eventMediaWorker:refreshConfiguration"), { protocolVersion:2, bridgeToken: "sources-test-bridge", eventId: event.eventId, sessionId: scheduled.sessionId, workerId: "sources-worker", epoch: lease.epoch });
  assert.equal(again.configuration.sources.find((source: { id: string }) => source.id === projected.id).revision, 1);
});

test("legacy API slot writes preserve omitted broadcast choices without browser snapshot IDs", async () => {
  const { t, owner, event } = await fixture();
  const row = { displayLabel: "Guest", personSlug: "guest", startAt };
  const base = { currentSlug: event.slug, communitySlug: "club", timezone: "UTC" };
  await owner.mutation(api.events.updateCommunityEvent, { ...base, slotLinks: [{ ...row, broadcastInput: input }] });
  await owner.mutation(api.events.updateCommunityEvent, { ...base, slotLinks: [row] });
  const slots = await t.run(ctx => ctx.db.query("eventSlots").withIndex("by_eventId", q => q.eq("eventId", event.eventId)).collect());
  assert.deepEqual(slots[0]!.broadcastInput, input);
});

test("untimed lineup selections survive canonical editor readback and timed conversion", async () => {
  const { owner, event } = await fixture();
  const row = { clientKey: "guest", position: 0, performerLabel: "Guest", personSlug: "guest" };
  const base = { currentSlug: event.slug, communitySlug: "club" };
  await owner.mutation(api.events.updateCommunityEvent, { ...base, lineup: [{ ...row, broadcastInput: input }] });
  const editable = await owner.query(api.events.getEditableBySlug, { slug: event.slug });
  assert.deepEqual(editable!.lineup[0]!.broadcastInput, input);
  assert.equal(editable!.lineup[0]!.broadcastInputChoices.length, 2);
  await owner.mutation(api.events.updateCommunityEvent, { ...base, lineup: [{ ...row, startAt }] });
  const timed = await owner.query(api.events.getEditableBySlug, { slug: event.slug });
  assert.deepEqual(timed!.slots[0]!.broadcastInput, input);
});


test("inactive removal permits the last observed source after its program ended", async () => {
  const { t, owner, event } = await fixture();
  const created = await owner.mutation(sourceMutation("create"), { currentSlug: event.slug, label: "Guest", url: "vrcdn:alpha" });
  const source = (await t.run(ctx => ctx.db.get(created.sourceId)))!;
  await t.run(ctx => ctx.db.patch(source.programId, { currentSourceId: source._id, state: "ended" }));
  await owner.mutation(sourceMutation("remove"), { currentSlug: event.slug, sourceId: source._id });
  assert.equal((await t.run(ctx => ctx.db.get(source._id)))!.state, "disabled");
});

test("deployment-owned endpoint descriptors reach the guarded relay without invented provider identities", async () => {
  const { createSourceRelay, validateSourceEndpoint } = await import("../../workers/restream/source-relay.mjs");
  const { t, owner, event } = await fixture();
  const club = await t.run(ctx => ctx.db.query("profiles").withIndex("by_slug", q => q.eq("slug", "club")).unique());
  bindVrcdnTestAccount(club!._id, "event-media/vrcdn/main");
  const output = await owner.mutation(api.events.configureVrcdnOutput, { currentSlug: event.slug, key: "main", label: "Main", credentialRef: "event-media/vrcdn/main", sourceConsentAccepted: true, destinationAuthorityAccepted: true, providerRulesAccepted: true, rightsClearedMediaAccepted: true, playbackLinks: [{ platform: "browser", url: "https://example.test/watch" }] });
  const records = await t.run(async ctx => {
    const rows = [];
    for (const [position, type] of (["rtmp_source", "vrcdn_link"] as const).entries()) {
      for (const bound of [true, false]) {
        const key = `${type}-${bound ? "slot" : "manual"}`;
        const publicUrl = `https://operator.example.test/${key}.ts?variant=host`;
        const eventSlotId = bound ? await ctx.db.insert("eventSlots", { eventId: event.eventId, position, startAt: startAt + position * 3600000, displayLabel: key, roleLabel: "DJ", sourceType: "manual", sourceLabel: "Operator", confidence: 1, reviewState: "confirmed", updatedAt: Date.now() }) : undefined;
        const sourceId = await ctx.db.insert("eventMediaSources", { programId: output.programId, eventId: event.eventId, eventSlotId, key, position, type, purpose: "program", state: "ready", label: key, publicUrl, privateConfigRef: `operator/${key}`, createdAt: Date.now(), updatedAt: Date.now() });
        rows.push({ sourceId, eventSlotId, publicUrl, type, privateConfigRef: `operator/${key}` });
      }
    }
    return rows;
  });
  const scheduled = await owner.mutation(api.events.scheduleEventMediaWorker, { currentSlug: event.slug });
  await t.run(ctx => ctx.db.patch(scheduled.sessionId, { scheduledStartAt: Date.now() - 1000 }));
  process.env.VRDEX_EVENT_MEDIA_BRIDGE_TOKEN = "sources-test-bridge";
  const lease = await t.mutation(makeFunctionReference<"mutation">("eventMediaWorker:acquireSession"), { protocolVersion:2, bridgeToken: "sources-test-bridge", eventId: event.eventId, sessionId: scheduled.sessionId, workerId: "sources-worker", epoch: 0 });
  assert.equal(lease.configuration.sources.length, records.length);
  const relay = await createSourceRelay({ operatorEndpoints: records.map(row => row.publicUrl) });
  const unauthorized = await createSourceRelay();
  let privateRequests = 0;
  const privateDns = await createSourceRelay({ operatorEndpoints: records.map(row => row.publicUrl), resolveAddresses: async () => [{ address: "127.0.0.1", family: 4 }], requestSource: () => { privateRequests++; throw new Error("Private address must not be fetched"); } });
  try {
    for (const row of records) {
      const source = lease.configuration.sources.find((source: { id: string }) => source.id === row.sourceId);
      assert.ok(source);
      assert.equal(source.type, row.type);
      assert.equal(source.input, undefined);
      assert.equal(source.publicUrl, row.publicUrl);
      assert.equal(source.privateConfigRef, row.privateConfigRef);
      assert.equal(source.eventSlotId, row.eventSlotId);
      if (row.eventSlotId) assert.equal(lease.configuration.slots.find((slot: { slotKey: string }) => slot.slotKey === row.eventSlotId).available, true);
      assert.match(relay.resolveSource(source), /^http:\/\/127\.0\.0\.1:/);
      assert.throws(() => unauthorized.resolveSource(source), /not authorized/);
      assert.throws(() => validateSourceEndpoint(`${source.publicUrl}&extra=1`, records.map(row => row.publicUrl)), /not authorized/);
    }
    const source = lease.configuration.sources[0];
    assert.equal((await fetch(privateDns.resolveSource(source))).status, 502);
    assert.equal(privateRequests, 0);
    assert.throws(() => validateSourceEndpoint("https://127.0.0.1/source.ts", ["https://127.0.0.1/source.ts"]), /not public/);
    await assert.rejects(owner.mutation(sourceMutation("create"), { currentSlug: event.slug, label: "Not public input", url: source.publicUrl }), /canonical/);
    const canonical = await owner.mutation(sourceMutation("create"), { currentSlug: event.slug, label: "Canonical", url: "vrcdn:alpha" });
    await assert.rejects(owner.mutation(sourceMutation("replace"), { currentSlug: event.slug, sourceId: canonical.sourceId, label: "Not public input", url: source.publicUrl }), /canonical/);
  } finally { relay.stop(); unauthorized.stop(); privateDns.stop(); }
});

test("operational source readback excludes disabled audit history before bounding usable rows", async () => {
  const { t, owner, event } = await fixture();
  for (let index = 0; index < 105; index++) {
    const created = await owner.mutation(sourceMutation("create"), { currentSlug: event.slug, label: `Past ${index}`, url: "vrcdn:alpha" });
    await owner.mutation(sourceMutation("remove"), { currentSlug: event.slug, sourceId: created.sourceId });
  }
  const current = await owner.mutation(sourceMutation("create"), { currentSlug: event.slug, label: "Current", url: "https://twitch.tv/basic_bit" });
  const status = await owner.query(api.events.getEventMediaControlStatus, { currentSlug: event.slug });
  assert.deepEqual(status.sources.map(source => source.sourceId), [current.sourceId]);
  assert.equal(status.sources[0]!.state, "ready");
  const history = await t.run(ctx => ctx.db.query("eventMediaSources").withIndex("by_eventId_state", q => q.eq("eventId", event.eventId).eq("state", "disabled")).collect());
  assert.equal(history.length, 105);
  assert.equal((await t.run(ctx => ctx.db.query("eventMediaAuditEvents").collect())).filter(row => row.action === "source_removed").length, 105);
});

async function detachedProjectionFixture() {
  const context = await fixture();
  const { t, owner, event } = context;
  const current = await owner.mutation(sourceMutation("create"), { currentSlug: event.slug, label: "Current", url: "vrcdn:alpha" });
  const source = await t.run(async ({ db }) => {
    const source = await db.get(current.sourceId);
    assert.ok(source);
    const profile = await db.query("profiles").withIndex("by_slug", q => q.eq("slug", "guest")).unique();
    assert.ok(profile);
    // Preexisting history exceeds both the 65-row count and 100-row status bounds.
    for (let position = 0; position < 105; position++) {
      const slotId = await db.insert("eventSlots", { eventId: event.eventId, position, startAt, personProfileId: profile._id, displayLabel: "Past", roleLabel: "DJ", sourceType: "community", sourceLabel: "Fixture", confidence: 1, reviewState: "confirmed", updatedAt: Date.now() });
      await db.insert("eventMediaSources", { programId: source.programId, eventId: event.eventId, eventSlotId: slotId, sourceProfileId: profile._id, ...(position % 2 === 0 ? { profileProjection: true } : {}), key: `slot-${slotId}`, position, type: "vrcdn_link", purpose: "program", state: "ready", label: "Past", publicUrl: "https://stream.vrcdn.live/live/alpha.live.ts", createdAt: Date.now(), updatedAt: Date.now() });
      await db.delete(slotId);
    }
    await db.patch(source._id, { position: 200, state: "live" });
    await db.patch(source.programId, { state: "live", currentSourceId: source._id });
    return (await db.get(source._id))!;
  });
  return { ...context, current, source };
}

test("detached projections beyond operational bounds do not block create or replace the observed source", async () => {
  const { t, owner, event, current, source } = await detachedProjectionFixture();
  const created = await owner.mutation(sourceMutation("create"), { currentSlug: event.slug, label: "Added", url: "https://twitch.tv/Basic_Bit" });
  const replacement = await owner.mutation(sourceMutation("replace"), { currentSlug: event.slug, sourceId: current.sourceId, label: "Replacement", url: "vrcdn:beta" });
  assert.equal(replacement.revision, 2);
  assert.notEqual(replacement.sourceId, source._id);
  assert.deepEqual(await t.run(ctx => ctx.db.get(source._id)), source);
  assert.equal((await t.run(ctx => ctx.db.get(source.programId)))!.currentSourceId, source._id);
  assert.deepEqual((await t.run(ctx => ctx.db.get(created.sourceId)))!.input, input);
  const audit = await t.run(ctx => ctx.db.query("eventMediaAuditEvents").collect());
  assert.ok(audit.some(row => row.action === "source_replaced" && row.sourceId === replacement.sourceId));
  assert.equal((await t.run(ctx => ctx.db.query("eventMediaSources").collect())).length, 108);
});

test("detached projections beyond operational bounds cannot hide current status sources", async () => {
  const { t, owner, event, source } = await detachedProjectionFixture();
  // Put the live row in the same state index as the older ghosts.
  await t.run(ctx => ctx.db.patch(source._id, { state: "ready" }));
  const status = await owner.query(api.events.getEventMediaControlStatus, { currentSlug: event.slug });
  assert.deepEqual(status.sources.map(row => row.sourceId), [source._id]);
  assert.equal(status.sources[0]!.hasPublicUrl, true);
  assert.deepEqual(status.operationReadiness.sourceStates, { ready: 1 });
});

test("detached history still leaves the 64 usable source limit enforced for create and replace", async () => {
  const { t, owner, event, source } = await detachedProjectionFixture();
  await t.run(async ({ db }) => {
    for (let index = 0; index < 63; index++) await db.insert("eventMediaSources", { programId: source.programId, eventId: event.eventId, key: `usable-${index}`, position: 201 + index, type: "vrcdn_link", purpose: "program", state: "ready", label: "Usable", publicUrl: "https://stream.vrcdn.live/live/alpha.live.ts", createdAt: Date.now(), updatedAt: Date.now() });
  });
  const args = { currentSlug: event.slug, label: "Over limit", url: "vrcdn:beta" };
  await assert.rejects(owner.mutation(sourceMutation("create"), args), /source limit/);
  await assert.rejects(owner.mutation(sourceMutation("replace"), { ...args, sourceId: source._id }), /source limit/);
  const status = await owner.query(api.events.getEventMediaControlStatus, { currentSlug: event.slug });
  assert.equal(status.sources.length, 64);
  assert.deepEqual(await t.run(ctx => ctx.db.get(source._id)), source);
});

test("lineup removal excludes its ready projection while preserving source history and manual operator sources", async () => {
  const { t, owner, event } = await fixture();
  const current = await owner.mutation(sourceMutation("create"), { currentSlug: event.slug, label: "Current", url: "vrcdn:alpha" });
  await owner.mutation(api.events.updateCommunityEvent, { currentSlug: event.slug, communitySlug: "club", lineup: [{ clientKey: "guest", position: 0, performerLabel: "Guest", personSlug: "guest", startAt, broadcastInput: input }] });
  const records = await t.run(async ({ db }) => {
    const source = await db.get(current.sourceId);
    const slot = await db.query("eventSlots").withIndex("by_eventId", q => q.eq("eventId", event.eventId)).unique();
    assert.ok(source && slot);
    const fields = { programId: source.programId, eventId: event.eventId, eventSlotId: slot._id, sourceProfileId: slot.personProfileId, position: 1, type: "twitch_watch" as const, purpose: "program" as const, state: "ready" as const, label: "Guest", publicUrl: "https://www.twitch.tv/basic_bit", createdAt: Date.now(), updatedAt: Date.now() };
    const projectedId = await db.insert("eventMediaSources", { ...fields, key: `slot-${slot._id}`, profileProjection: true });
    const manualId = await db.insert("eventMediaSources", { ...fields, key: "operator-input", type: "rtmp_source", publicUrl: "https://operator.example.test/live.ts" });
    return { projected: await db.get(projectedId), manualId, slotId: slot._id };
  });
  const before = await owner.query(api.events.getEventMediaControlStatus, { currentSlug: event.slug });
  assert.equal(before.sources.length, 3);
  await owner.mutation(api.events.updateCommunityEvent, { currentSlug: event.slug, communitySlug: "club", lineup: [] });
  assert.equal(await t.run(ctx => ctx.db.get(records.slotId)), null);
  const after = await owner.query(api.events.getEventMediaControlStatus, { currentSlug: event.slug });
  assert.deepEqual(after.sources.map(row => row.sourceId), [current.sourceId, records.manualId]);
  assert.ok(records.projected);
  assert.deepEqual(await t.run(ctx => ctx.db.get(records.projected!._id)), records.projected);
  assert.equal((await t.run(ctx => ctx.db.query("eventMediaSessions").collect())).length, 0);
});

for (const unavailable of ["flagged", "detached", "private profile", "removed input", "changed selection", "wrong event"] as const) test(`operational sources exclude a projection with ${unavailable} availability`, async () => {
  const { t, owner, event } = await fixture();
  const current = await owner.mutation(sourceMutation("create"), { currentSlug: event.slug, label: "Current", url: "vrcdn:alpha" });
  await owner.mutation(api.events.updateCommunityEvent, { currentSlug: event.slug, communitySlug: "club", lineup: [{ clientKey: "guest", position: 0, performerLabel: "Guest", personSlug: "guest", startAt, broadcastInput: input }] });
  await t.run(async ({ db }) => {
    const source = await db.get(current.sourceId);
    const slot = await db.query("eventSlots").withIndex("by_eventId", q => q.eq("eventId", event.eventId)).unique();
    assert.ok(source && slot?.personProfileId);
    await db.insert("eventMediaSources", { programId: source.programId, eventId: event.eventId, eventSlotId: unavailable === "detached" ? undefined : slot._id, sourceProfileId: slot.personProfileId, profileProjection: true, projectionAvailable: unavailable !== "flagged", key: `slot-${slot._id}`, position: -1, type: "twitch_watch", purpose: "program", state: "ready", label: "Unavailable", publicUrl: "https://www.twitch.tv/basic_bit", createdAt: Date.now(), updatedAt: Date.now() });
    if (unavailable === "private profile") await db.patch(slot.personProfileId, { publicationState: "draft_private" });
    if (unavailable === "removed input") await db.patch(slot.personProfileId, { outboundLinks: [] });
    if (unavailable === "changed selection") await db.patch(slot._id, { broadcastInput: { kind: "vrcdn", streamId: "alpha" } });
    if (unavailable === "wrong event") {
      const original = await db.get(event.eventId);
      assert.ok(original);
      const { _id, _creationTime, ...fields } = original;
      const otherEventId = await db.insert("events", { ...fields, slug: "other-event" });
      await db.patch(slot._id, { eventId: otherEventId });
    }
  });
  const status = await owner.query(api.events.getEventMediaControlStatus, { currentSlug: event.slug });
  assert.deepEqual(status.sources.map(row => row.sourceId), [current.sourceId]);
});
