import assert from "node:assert/strict";
import { it } from "node:test";
import { convexTest } from "convex-test";
import { makeFunctionReference } from "convex/server";
import { api } from "../../convex/_generated/api";
import schemaModule from "../../convex/schema";
import { newClerkUserId } from "./_clerkTestIdentity";
const schema = (schemaModule as unknown as {
    default?: typeof schemaModule;
}).default ?? schemaModule;
const worker = (name: string) => makeFunctionReference<"mutation">(`eventMediaWorker:${name}`);
const modules = {
    "../../convex/_generated/api.ts": () => import("../../convex/_generated/api"),
    "../../convex/events.ts": () => import("../../convex/events"),
    "../../convex/eventMediaWorker.ts": () => import("../../convex/eventMediaWorker"),
};
const bridgeToken = "worker-test-only-credential";
process.env.VRDEX_EVENT_MEDIA_BRIDGE_TOKEN = bridgeToken;
async function fixture() {
    const t = convexTest({ schema, modules });
    const subject = newClerkUserId();
    await t.run(async ({ db }) => {
        const now = Date.now();
        const userId = await db.insert("users", { clerkUserId: subject, name: "Owner", email: "owner@example.test", emailVerificationTime: now });
        const profileId = await db.insert("profiles", { slug: "club", displayName: "Club", sortName: "club", aliases: [], tags: [], claimState: "claimed_verified", publicationState: "published", publicSurfacingState: "public", creationSource: "self", updatedAt: now, profileType: "community", community: { categoryTags: [] } });
        await db.insert("profileOwners", { profileId, userId, roleKey: "owner", state: "active", grantedAt: now, updatedAt: now });
    });
    const owner = t.withIdentity({ subject, emailVerified: true, issuer: "test", tokenIdentifier: `test|${subject}` });
    const event = await owner.mutation(api.events.createCommunityEvent, { title: "Worker event", communitySlug: "club", startAt: Date.now() + 600000, timezone: "UTC" });
    const output = await owner.mutation(api.events.configureVrcdnOutput, { currentSlug: event.slug, key: "main", label: "Main", credentialRef: "event-media/vrcdn/main", sourceConsentAccepted: true, destinationAuthorityAccepted: true, providerRulesAccepted: true, rightsClearedMediaAccepted: true, playbackLinks: [{ platform: "browser", url: "https://example.test/watch" }] });
    const scheduled = await owner.mutation(api.events.scheduleEventMediaWorker, { currentSlug: event.slug });
    // Make the scheduled start eligible without replacing Convex's clock.
    await t.run(async (ctx) => {
        await ctx.db.patch(scheduled.sessionId, { scheduledStartAt: Date.now() - 1000 });
        if (scheduled.startCommandId)
            await ctx.db.patch(scheduled.startCommandId, { availableAt: Date.now() - 1000 });
    });
    const args = { bridgeToken, eventId: event.eventId, sessionId: scheduled.sessionId, workerId: "worker-a", epoch: 0 };
    return { t, owner, event, output, scheduled, args };
}
it("refresh supplies authoritative slots and expires removed sources without extending authority", async () => {
    const { t, args, event, output } = await fixture();
    const ids = await t.run(async ({ db }) => {
        const slot = await db.insert("eventSlots", { eventId: event.eventId, position: 0, startAt: Date.now() - 1000, displayLabel: "DJ", roleLabel: "DJ", sourceType: "manual", sourceLabel: "Owner", confidence: 1, reviewState: "confirmed", updatedAt: Date.now() });
        const source = await db.insert("eventMediaSources", { programId: output.programId, eventId: event.eventId, key: "dj", position: 0, type: "vrcdn_link", purpose: "program", state: "ready", label: "DJ", eventSlotId: slot, publicUrl: "https://stream.vrcdn.live/live/dj.live.ts", createdAt: Date.now(), updatedAt: Date.now() });
        return { slot, source };
    });
    const lease = await t.mutation(worker("acquireSession"), args);
    assert.equal(typeof lease.serverNow, "number");
    assert.ok(lease.configuration.sessionDeadline > lease.serverNow);
    const request = { ...args, epoch: lease.epoch };
    const fresh = await t.mutation(worker("refreshConfiguration"), request);
    assert.equal(fresh.configuration.slots[0].slotKey, ids.slot);
    assert.equal(fresh.configuration.slots[0].sourceId, ids.source);
    await t.run(({ db }) => db.patch(ids.source, { state: "disabled" }));
    const revoked = await t.mutation(worker("refreshConfiguration"), request);
    assert.equal(revoked.configuration.slots[0].available, false);
    assert.equal((await t.run(({ db }) => db.get(args.sessionId)))?.leaseExpiresAt, lease.expiresAt);
});
it("autonomous observations are fenced and cannot claim live without actual encoded output", async () => {
    const { t, args } = await fixture();
    const lease = await t.mutation(worker("acquireSession"), args);
    const request = { ...args, epoch: lease.epoch };
    await assert.rejects(t.mutation(worker("observeProgram"), { ...request, state: "live", outputMs: 0, publishing: false }), /progress|publish/i);
    assert.equal((await t.mutation(worker("observeProgram"), { ...request, state: "hold", outputMs: 200, publishing: true })).accepted, true);
    await t.run(({ db }) => db.patch(args.sessionId, { leaseExpiresAt: Date.now() - 1 }));
    assert.equal((await t.mutation(worker("observeProgram"), { ...request, state: "hold", outputMs: 300, publishing: true })).accepted, false);
});
import { createEventWorker } from "../../workers/restream/event-worker.mjs";
function runtimeFixture(options: Record<string, unknown> = {}) {
    let now = 0, encoded = 0, renderedSlotKey: string | undefined, renderedSourceId: string | undefined;
    let fenced = 0, selections = 0, ackCount = 0, holds = 0;
    let commands: any[] = [];
    const config: any = { sessionDeadline: 1000000, mode: "automatic", policy: {}, sources: [{ id: "a", eventSlotId: "slot-a", publicUrl: "https://stream.vrcdn.live/live/a.live.ts", type: "vrcdn_link" }], slots: [{ slotKey: "slot-a", sourceId: "a", startAt: 0, available: true }], outputs: [{ id: "out" }], outputId: "out" };
    const observations = new Map<string, any>();
    const renderer = { start: async () => { }, stop: async () => { }, subscribe: () => () => { }, reconcileSources: async () => { }, getInputs: () => [...observations.values()].map(o => ({ source: o, getObservation: () => ({ ...o, observedAt: typeof options.observationClock === "function" ? options.observationClock() : o.observedAt }) })), selectSource: (slot: string) => { selections++; return true; }, hold: () => { holds++; }, getState: () => ({ running: true, outputMs: encoded, renderedSlotKey, renderedSourceId }) };
    const control = async (name: string, args: any) => {
        if (name === "acquireSession" || name === "renewSession")
            return { granted: true, epoch: 1, serverNow: 0, expiresAt: 30000, renewAfterMs: 10000, configuration: config };
        if (name === "refreshConfiguration")
            return { granted: true, serverNow: now, configuration: config };
        if (name === "claimCommands")
            return { granted: true, commands };
        if (name === "acknowledgeCommand") {
            ackCount++;
            commands = [];
            return { accepted: true };
        }
        return { accepted: true };
    };
    const worker = createEventWorker({ identity: { eventId: "e", sessionId: "s", workerId: "unique", epoch: 0 }, control: (name: string, args: any) => typeof options.controlFilter === "function" ? options.controlFilter(name, args, control) : control(name, args), clock: () => now, renderer, resolveSource: async (s: any) => s.publicUrl, checkEnabled: async () => true, outputs: { start: async () => { }, enqueue: () => { }, getState: () => ({ publishing: true }), stopNow: () => { fenced++; }, stop: async () => { } }, ...options });
    return { worker, config, observations, advance: (n: number) => { now = n; }, encoded: () => { encoded = 100; renderedSlotKey = "slot-a"; renderedSourceId = "a"; }, command: (type = "switch_source", sequence = 1) => { commands = [{ _id: `c${sequence}`, sequence, commandType: type, targetSourceId: "a" }]; }, counts: () => ({ fenced, selections, ackCount, holds }) };
}
it("worker only acknowledges encoded slot and source, then ignores command replay", async () => {
    const f = runtimeFixture();
    await f.worker.start();
    f.command();
    await f.worker.tick();
    assert.equal(f.counts().ackCount, 0);
    f.encoded();
    await f.worker.tick();
    assert.equal(f.counts().ackCount, 1);
    f.command();
    await f.worker.tick();
    assert.equal(f.counts().selections, 1);
});
it("independent monotonic watchdog fences publication despite pending request and wall clock skew", async () => {
    const f = runtimeFixture();
    await f.worker.start();
    f.advance(30000);
    f.worker.watchdog();
    assert.equal(f.counts().fenced, 1);
    assert.equal(f.worker.getState().stopped, true);
});
it("kill switch failure fences output and no sender fails closed", async () => {
    const f = runtimeFixture({ checkEnabled: async () => { throw Error("unavailable"); } });
    await assert.rejects(f.worker.start());
    assert.equal(f.counts().fenced, 1);
    const missing = runtimeFixture({ outputs: undefined });
    await assert.rejects(missing.worker.start(), /sender/i);
});
it("refresh revocation holds current and removes decoder", async () => {
    const f = runtimeFixture();
    await f.worker.start();
    f.command();
    f.encoded();
    await f.worker.tick();
    f.config.slots[0].available = false;
    f.config.sources = [];
    await f.worker.tick();
    assert.equal(f.worker.getState().current?.available, false);
});
import { validateSourceEndpoint, isPublicIPv4 } from "../../workers/restream/source-relay.mjs";
it("source boundary refuses metadata, local networks, arbitrary hosts, credentials and unsupported Twitch", () => {
    for (const url of ['http://169.254.169.254/latest', 'https://127.0.0.1/feed', 'file:///etc/passwd', 'https://twitch.tv/dj', 'https://evil.test/a', 'https://user:secret@stream.vrcdn.live/live/dj.live.ts'])
        assert.throws(() => validateSourceEndpoint(url));
    assert.equal(validateSourceEndpoint('https://stream.vrcdn.live/live/dj.live.ts').hostname, 'stream.vrcdn.live');
    for (const ip of ['127.0.0.1', '10.0.0.1', '169.254.169.254', '172.16.0.1', '192.168.1.1', '0.0.0.0', '100.64.0.1', '::1'])
        assert.equal(isPublicIPv4(ip), false);
    assert.equal(isPublicIPv4('8.8.8.8'), true);
});
it("policy requires media permission and silence calibration, and automatic command retains sequence", async () => {
    const { t, owner, event, args } = await fixture();
    const configure = makeFunctionReference<"mutation">('events:configureEventBroadcastPolicy');
    await assert.rejects(t.mutation(configure, { currentSlug: event.slug, policy: { maxOverrunMs: 1000 } }), /authenticat|signed/i);
    await assert.rejects(owner.mutation(configure, { currentSlug: event.slug, policy: { silence: { thresholdDb: -45, durationMs: 3000 } } }), /calibrat/i);
    await owner.mutation(configure, { currentSlug: event.slug, policy: { maxOverrunMs: 1000 } });
    const lease = await t.mutation(worker('acquireSession'), args);
    assert.equal(lease.configuration.policy.maxOverrunMs, 1000);
    const command = await owner.mutation(api.events.queueEventMediaCommand, { currentSlug: event.slug, type: 'set_automatic_mode' as never });
    assert.equal(command.status, 'queued');
});
it("transactional dispatch admission is idempotent and enforces global cap", async () => {
    const { t, args } = await fixture();
    process.env.VRDEX_EVENT_BROADCAST_MAX_CONCURRENT = '1';
    const admit = { bridgeToken, eventId: args.eventId, sessionId: args.sessionId, dispatchId: 'dispatch-a' };
    assert.equal((await t.mutation(worker('admitDispatch'), admit)).granted, true);
    assert.equal((await t.mutation(worker('admitDispatch'), admit)).granted, true);
    assert.equal((await t.mutation(worker('admitDispatch'), { ...admit, dispatchId: 'dispatch-b' })).granted, false);
    const other = await t.run(async ({ db }) => { const old = (await db.get(args.sessionId))!; const { _id, _creationTime, ...row } = old; return db.insert('eventMediaSessions', { ...row, dispatchId: undefined }); });
    assert.equal((await t.mutation(worker('admitDispatch'), { ...admit, sessionId: other, dispatchId: 'other' })).granted, false);
    delete process.env.VRDEX_EVENT_BROADCAST_MAX_CONCURRENT;
});
it("hold current retains encoded source while slate holds and automatic resumes", async () => {
    const f = runtimeFixture();
    await f.worker.start();
    f.command();
    f.encoded();
    await f.worker.tick();
    const before = f.counts().holds;
    f.command('hold_current', 2);
    await f.worker.tick();
    assert.equal(f.counts().holds, before);
    assert.equal(f.worker.getState().mode, 'manual');
    f.command('set_automatic_mode', 3);
    await f.worker.tick();
    assert.equal(f.worker.getState().mode, 'automatic');
    f.command('switch_hold', 4);
    await f.worker.tick();
    assert.ok(f.counts().holds > before);
    assert.equal(f.worker.getState().mode, 'hold');
});
it("maximum session duration fences even while the calendar and lease continue", async () => {
    const f = runtimeFixture({ maxSessionMs: 500 });
    await f.worker.start();
    f.advance(500);
    f.worker.watchdog();
    assert.equal(f.counts().fenced, 1);
});
it("initial slot prepares then switches only from decoded readiness at its start", async () => {
    const f = runtimeFixture();
    f.config.slots[0].startAt = 1000;
    await f.worker.start();
    await f.worker.tick();
    assert.equal(f.counts().selections, 0);
    f.observations.set('slot-a', { slotKey: 'slot-a', sourceId: 'a', ready: true, progressing: true, observedAt: 0 });
    await f.worker.tick();
    assert.equal(f.counts().selections, 0);
    f.advance(1000);
    f.observations.get('slot-a').observedAt = 1000;
    await f.worker.tick();
    assert.equal(f.worker.getState().current?.slotKey, 'slot-a');
});
it("output factory receives authorized configuration only after lease acquisition", async () => {
    let received: any;
    const f = runtimeFixture({ outputs: undefined, createOutputs: ({ configuration }: any) => { received = configuration; return { start: async () => { }, enqueue: () => { }, getState: () => ({ publishing: true }), stopNow: () => { }, stop: async () => { } }; } });
    await f.worker.start();
    assert.equal(received.outputId, 'out');
    await f.worker.stop();
});
it("watchdog does not wait for a blocked refresh or decoder shutdown", async () => {
    let release: (value: any) => void = () => { };
    const f = runtimeFixture({ controlFilter: (name: string, args: any, base: any) => name === 'refreshConfiguration' ? new Promise(resolve => { release = resolve; }) : base(name, args) });
    await f.worker.start();
    const tick = f.worker.tick();
    await new Promise(resolve => setImmediate(resolve));
    f.advance(30000);
    f.worker.watchdog();
    assert.equal(f.counts().fenced, 1);
    release({ granted: false });
    await tick;
    assert.equal(f.worker.getState().stopped, true);
});
it("samples observation time after reading advancing decoder observations", async () => {
    let now = 100;
    const f = runtimeFixture({ clock: () => now++, observationClock: () => now++ });
    await f.worker.start();
    f.observations.set('slot-a', { slotKey: 'slot-a', sourceId: 'a', ready: true, progressing: true });
    await f.worker.tick();
    assert.equal(f.worker.getState().current?.slotKey, 'slot-a');
});
it("authorized performer refresh preserves repeated slots and removes revoked public links", async () => {
    const { t, args, event } = await fixture();
    const person = await t.run(async ({ db }) => {
        const id = await db.insert('profiles', { slug: 'repeat-dj', displayName: 'DJ', sortName: 'dj', aliases: [], tags: [], claimState: 'unclaimed', publicationState: 'published', publicSurfacingState: 'public', creationSource: 'community', updatedAt: Date.now(), profileType: 'person', person: { roleTags: [] }, outboundLinks: [{ type: 'other', label: 'Stream', source: 'owner_authored', url: 'vrcdn:alpha' }] });
        for (let position = 0; position < 2; position++)
            await db.insert('eventSlots', { eventId: event.eventId, position, startAt: Date.now() + position * 60000, personProfileId: id, selectedStreamId: 'alpha', displayLabel: 'DJ', roleLabel: 'DJ', sourceType: 'manual', sourceLabel: 'Owner', confidence: 1, reviewState: 'confirmed', updatedAt: Date.now() });
        return id;
    });
    const lease = await t.mutation(worker('acquireSession'), args);
    assert.equal(lease.configuration.slots.length, 2);
    assert.notEqual(lease.configuration.slots[0].slotKey, lease.configuration.slots[1].slotKey);
    assert.notEqual(lease.configuration.slots[0].sourceId, lease.configuration.slots[1].sourceId);
    assert.ok(lease.configuration.slots.every((s: any) => s.available));
    await t.run(({ db }) => db.patch(person, { outboundLinks: [] }));
    const refresh = await t.mutation(worker('refreshConfiguration'), { ...args, epoch: lease.epoch });
    assert.ok(refresh.configuration.slots.every((s: any) => !s.available));
    assert.equal(refresh.configuration.sources.length, 0);
});
it("same source ID with a changed URL cannot acknowledge the old encoded input", async () => {
    const f = runtimeFixture();
    await f.worker.start();
    f.command();
    await f.worker.tick();
    f.config.sources[0].publicUrl = 'https://stream.vrcdn.live/live/replacement.live.ts';
    f.encoded();
    await f.worker.tick();
    assert.equal(f.counts().ackCount, 0);
});
it("changing or revoking selected destination fences the old sender", async () => {
    const f = runtimeFixture();
    await f.worker.start();
    f.config.outputId = 'different';
    await f.worker.tick();
    assert.equal(f.counts().fenced, 1);
});
it("stopping a still-authorized worker reports terminal error after fencing publication", async () => {
    const states: string[] = [];
    const f = runtimeFixture({ controlFilter: (name: string, args: any, base: any) => {
            if (name === 'observeProgram')
                states.push(args.state);
            return base(name, args);
        } });
    await f.worker.start();
    await f.worker.stop();
    assert.equal(f.counts().fenced, 1);
    assert.ok(states.includes('error'));
});
it("manual source selection supports an authorized source without an authored slot", async () => {
    const f = runtimeFixture();
    f.config.slots = [];
    await f.worker.start();
    f.command();
    await f.worker.tick();
    assert.equal(f.worker.getState().current?.sourceId, 'a');
    assert.equal(f.worker.getState().mode, 'manual');
    await f.worker.tick();
    assert.equal(f.worker.getState().current?.available, true);
});
it("replacement runtime restores acknowledged manual source without a schedule slot", async () => {
    const f = runtimeFixture();
    f.config.slots = [];
    f.config.mode = 'manual';
    f.config.currentSourceId = 'a';
    await f.worker.start();
    assert.equal(f.worker.getState().current?.sourceId, 'a');
    assert.equal(f.worker.getState().mode, 'manual');
});
