import { bindVrcdnTestAccount } from "./_eventOutputAccountFixture";
import assert from "node:assert/strict";
import { it } from "node:test";
import { convexTest } from "convex-test";
import { makeFunctionReference, getFunctionName } from "convex/server";
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
    bindVrcdnTestAccount(profileId, "event-media/vrcdn/main");
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
    let fenced = 0, selections = 0, ackCount = 0, holds = 0, prepared = 0;
    let commands: any[] = [];
    const config: any = { sessionDeadline: 1000000, mode: "automatic", policy: {}, sources: [{ id: "a", eventSlotId: "slot-a", publicUrl: "https://stream.vrcdn.live/live/a.live.ts", type: "vrcdn_link" }], slots: [{ slotKey: "slot-a", sourceId: "a", startAt: 0, available: true }], outputs: [{ id: "out" }], outputId: "out" };
    const observations = new Map<string, any>();
    const renderer = { start: async () => { }, stop: async () => { }, subscribe: () => () => { }, reconcileSources: async (sources: any[]) => { prepared += sources.length; }, getInputs: () => [...observations.values()].map(o => ({ source: o, getObservation: () => ({ ...o, observedAt: typeof options.observationClock === "function" ? options.observationClock() : o.observedAt }) })), selectSource: (slot: string) => { selections++; return true; }, hold: () => { holds++; }, getState: () => ({ running: true, outputMs: encoded, renderedSlotKey, renderedSourceId }) };
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
    return { worker, config, observations, advance: (n: number) => { now = n; }, encoded: (slot: string | undefined = "slot-a") => { encoded += 100; renderedSlotKey = slot; renderedSourceId = slot ? "a" : undefined; }, slate: () => { encoded += 100; renderedSlotKey = undefined; renderedSourceId = undefined; }, command: (type = "switch_source", sequence = 1) => { commands = [{ _id: `c${sequence}`, sequence, commandType: type, targetSourceId: "a" }]; }, counts: () => ({ fenced, selections, ackCount, holds, prepared }) };
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
    assert.equal(f.worker.getState().mode, 'automatic');
    f.slate(); await f.worker.tick();
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
    assert.equal(f.worker.getState().current, undefined);
    assert.equal(f.counts().ackCount, 0);
    f.encoded('manual-a'); await f.worker.tick();
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
it('I1 response latency cannot advance preparation or promotion before server boundaries', async () => {
    let f: ReturnType<typeof runtimeFixture>;
    let backendNow = 900, receipt = 950;
    f = runtimeFixture({ controlFilter: async (name: string, args: any, base: any) => {
            if (name === 'refreshConfiguration') {
                f.advance(receipt);
                return { granted: true, serverNow: backendNow, configuration: f.config };
            }
            return base(name, args);
        } });
    f.config.slots[0].startAt = 1000;
    await f.worker.start();
    f.advance(800);
    f.observations.set('slot-a', { slotKey: 'slot-a', sourceId: 'a', ready: true, progressing: true, observedAt: 950 });
    await f.worker.tick();
    assert.equal(f.counts().selections, 0);
    backendNow = 1000;
    receipt = 1050;
    await f.worker.tick();
    assert.equal(f.counts().selections, 1);
});
async function projectedSourceFixture() {
    const f = await fixture();
    const ids = await f.t.run(async ({ db }) => {
        const person = await db.insert('profiles', { slug: 'projected', displayName: 'DJ', sortName: 'dj', aliases: [], tags: [], claimState: 'unclaimed', publicationState: 'published', publicSurfacingState: 'public', creationSource: 'community', updatedAt: Date.now(), profileType: 'person', person: { roleTags: [] }, outboundLinks: [{ type: 'other', label: 'Stream', source: 'owner_authored', url: 'vrcdn:alpha' }] });
        const slot = await db.insert('eventSlots', { eventId: f.event.eventId, position: 0, startAt: Date.now(), personProfileId: person, displayLabel: 'DJ', roleLabel: 'DJ', sourceType: 'manual', sourceLabel: 'Owner', confidence: 1, reviewState: 'confirmed', updatedAt: Date.now() });
        return { person, slot };
    });
    const lease = await f.t.mutation(worker('acquireSession'), f.args);
    return { ...f, ...ids, request: { ...f.args, epoch: lease.epoch }, sourceId: lease.configuration.slots[0].sourceId };
}
it('I2 detaching performer invalidates projected source even when the old profile changes later', async () => {
    const f = await projectedSourceFixture();
    await f.t.run(({ db }) => db.patch(f.slot, { personProfileId: undefined }));
    let refreshed = await f.t.mutation(worker('refreshConfiguration'), f.request);
    assert.equal(refreshed.configuration.slots[0].available, false);
    assert.equal(refreshed.configuration.sources.length, 0);
    await f.t.run(({ db }) => db.patch(f.person, { outboundLinks: [], fieldVisibility: { outboundLinks: 'private' } }));
    refreshed = await f.t.mutation(worker('refreshConfiguration'), f.request);
    assert.equal(refreshed.configuration.slots[0].available, false);
    assert.equal(refreshed.configuration.sources.length, 0);
});
it('I3 profile refresh preserves explicit disable independently of transient availability', async () => {
    const f = await projectedSourceFixture();
    await f.t.run(({ db }) => db.patch(f.sourceId, { state: 'disabled' }));
    const refreshed = await f.t.mutation(worker('refreshConfiguration'), f.request);
    assert.equal(refreshed.configuration.slots[0].available, false);
    assert.equal((await f.t.run(({ db }) => db.get(f.sourceId)))?.state, 'disabled');
});
it('I4 terminal media retains capacity and bridge reconciliation until process stop is confirmed', async () => {
    const f = await fixture();
    await f.t.mutation(worker('admitDispatch'), { bridgeToken, eventId: f.event.eventId, sessionId: f.args.sessionId, dispatchId: 'first' });
    await f.t.mutation(worker('recordDispatchedTask'), { bridgeToken, sessionId: f.args.sessionId, dispatchId: 'first', taskArn: 'task-first', taskDefinitionArn: 'definition-first' });
    const lease = await f.t.mutation(worker('acquireSession'), f.args);
    await f.t.mutation(worker('observeProgram'), { ...f.args, epoch: lease.epoch, state: 'error', outputMs: 10, publishing: false });
    const second = await f.t.run(async ({ db }) => { const old = (await db.get(f.args.sessionId))!; const { _id, _creationTime, ...row } = old; const id = await db.insert('eventMediaSessions', { ...row, status: 'scheduled', dispatchId: undefined, workerTaskId: undefined, workerTaskDefinitionArn: undefined, workerTaskStatus: undefined, epoch: undefined }); await db.patch(old.programId, { activeSessionId: id }); return id; });
    const admission = { bridgeToken, eventId: f.event.eventId, sessionId: second, dispatchId: 'second' };
    assert.equal((await f.t.mutation(worker('admitDispatch'), admission)).granted, false);
    let sessions = await f.t.query(api.events.listEventMediaWorkerBridgeSessions, { bridgeToken, workerId: 'bridge' });
    assert.ok(sessions.some((s: any) => s.sessionId === f.args.sessionId));
    await f.t.mutation(worker('recordProcessStatus'), { bridgeToken, sessionId: f.args.sessionId, taskArn: 'task-first', stopped: true });
    assert.equal((await f.t.mutation(worker('admitDispatch'), admission)).granted, true);
});
it('I1 network latency cannot prepare earlier than the two-minute window', async () => {
    let f: ReturnType<typeof runtimeFixture>;
    f = runtimeFixture({ controlFilter: async (name: string, args: any, base: any) => {
            if (name === 'refreshConfiguration') {
                f.advance(950);
                return { granted: true, serverNow: 900, configuration: f.config };
            }
            return base(name, args);
        } });
    f.config.slots[0].startAt = 121000;
    await f.worker.start();
    f.advance(800);
    await f.worker.tick();
    assert.equal(f.counts().prepared, 0);
});
it('I3 transient link loss restores availability without clearing an explicit disable', async () => {
    const f = await projectedSourceFixture();
    await f.t.run(({ db }) => db.patch(f.person, { outboundLinks: [] }));
    let refreshed = await f.t.mutation(worker('refreshConfiguration'), f.request);
    assert.equal(refreshed.configuration.slots[0].available, false);
    await f.t.run(({ db }) => db.patch(f.person, { outboundLinks: [{ type: 'other', label: 'Stream', source: 'owner_authored', url: 'vrcdn:alpha' }] }));
    refreshed = await f.t.mutation(worker('refreshConfiguration'), f.request);
    assert.equal(refreshed.configuration.slots[0].available, true);
    await f.t.run(({ db }) => db.patch(f.sourceId, { state: 'disabled' }));
    refreshed = await f.t.mutation(worker('refreshConfiguration'), f.request);
    assert.equal(refreshed.configuration.slots[0].available, false);
});
import { refreshSessions } from '../../scripts/event-media-ecs-bridge.mjs';
it('I4 bridge reconciles terminal tasks and retries task-definition cleanup after failure', async () => {
    const f = await fixture();
    await f.t.mutation(worker('admitDispatch'), { bridgeToken, eventId: f.event.eventId, sessionId: f.args.sessionId, dispatchId: 'cleanup' });
    await f.t.mutation(worker('recordDispatchedTask'), { bridgeToken, sessionId: f.args.sessionId, dispatchId: 'cleanup', taskArn: 'task-cleanup', taskDefinitionArn: 'definition-cleanup' });
    await f.t.run(({ db }) => db.patch(f.args.sessionId, { status: 'error' }));
    const client = { query: (ref: any, args: any) => f.t.query(ref, args), mutation: (ref: any, args: any) => f.t.mutation(ref, args) };
    const config = { bridgeToken, workerId: 'bridge', cluster: 'local-test' };
    let attempts = 0;
    const runAws = async (_config: any, args: string[]) => {
        if (args[1] === 'describe-tasks')
            return { tasks: [{ taskArn: 'task-cleanup', lastStatus: 'STOPPED' }] };
        assert.equal(args[1], 'deregister-task-definition');
        if (++attempts === 1)
            throw Error('transient cleanup failure');
        return {};
    };
    await refreshSessions(client, config, runAws);
    let sessions = await f.t.query(api.events.listEventMediaWorkerBridgeSessions, { bridgeToken, workerId: 'bridge' });
    assert.ok(sessions.some((s: any) => s.sessionId === f.args.sessionId));
    await refreshSessions(client, config, runAws);
    assert.equal(attempts, 2);
    sessions = await f.t.query(api.events.listEventMediaWorkerBridgeSessions, { bridgeToken, workerId: 'bridge' });
    assert.equal(sessions.length, 0);
    assert.equal((await f.t.mutation(worker('recordProcessStatus'), { bridgeToken, sessionId: f.args.sessionId, taskArn: 'task-cleanup', stopped: false })).accepted, false);
});
it('I4 ambiguous terminal launch remains visible and reserved without a task ARN', async () => {
    const f = await fixture();
    await f.t.mutation(worker('admitDispatch'), { bridgeToken, eventId: f.event.eventId, sessionId: f.args.sessionId, dispatchId: 'ambiguous' });
    await f.t.run(({ db }) => db.patch(f.args.sessionId, { status: 'error' }));
    const sessions = await f.t.query(api.events.listEventMediaWorkerBridgeSessions, { bridgeToken, workerId: 'bridge' });
    assert.equal(sessions[0].dispatchId, 'ambiguous');
    assert.equal(sessions[0].workerTaskId, undefined);
    assert.equal(sessions[0].workerTaskStatus, 'starting');
});
it('I2 detached projection does not replace a separately authored manual input', async () => {
    const f = await projectedSourceFixture();
    const manual = await f.t.run(async ({ db }) => { await db.patch(f.slot, { personProfileId: undefined }); return db.insert('eventMediaSources', { programId: f.output.programId, eventId: f.event.eventId, key: 'operator-input', position: 2, type: 'vrcdn_link', purpose: 'program', state: 'ready', label: 'Manual', eventSlotId: f.slot, sourceProfileId: f.person, publicUrl: 'https://stream.vrcdn.live/live/manual.live.ts', createdAt: Date.now(), updatedAt: Date.now() }); });
    const refreshed = await f.t.mutation(worker('refreshConfiguration'), f.request);
    assert.equal(refreshed.configuration.slots[0].sourceId, manual);
    assert.equal(refreshed.configuration.slots[0].available, true);
    assert.equal((await f.t.mutation(worker('observeProgram'), { ...f.request, state: 'live', outputMs: 10, publishing: true, sourceId: f.sourceId })).accepted, false);
});
it('I4 legacy task reservations without process status stay discoverable', async () => {
    const f = await fixture();
    await f.t.run(({ db }) => db.patch(f.args.sessionId, { status: 'error', dispatchId: 'legacy-ambiguous', workerTaskId: 'legacy-task', workerProvider: 'aws_ecs', workerTaskStatus: undefined }));
    const sessions = await f.t.query(api.events.listEventMediaWorkerBridgeSessions, { bridgeToken, workerId: 'bridge' });
    assert.equal(sessions[0]?.workerTaskId, 'legacy-task');
});
import { claimAndProcess } from '../../scripts/event-media-ecs-bridge.mjs';
async function admittedBeforeAcquisition() {
    const f = await fixture();
    await f.t.mutation(worker('admitDispatch'), { bridgeToken, eventId: f.event.eventId, sessionId: f.args.sessionId, dispatchId: 'managed' });
    await f.t.mutation(worker('recordDispatchedTask'), { bridgeToken, sessionId: f.args.sessionId, dispatchId: 'managed', taskArn: 'managed-task', taskDefinitionArn: 'managed-definition' });
    await f.t.run(async ({ db }) => { if (f.scheduled.startCommandId)
        await db.patch(f.scheduled.startCommandId, { status: 'succeeded' }); });
    const client = { query: (ref: any, args: any) => f.t.query(ref, args), mutation: (ref: any, args: any) => f.t.mutation(ref, args) };
    return { ...f, client, config: { bridgeToken, workerId: 'bridge', cluster: 'local-test', redactValues: [] } };
}
async function assertReservedUntilConfirmed(f: Awaited<ReturnType<typeof admittedBeforeAcquisition>>) {
    assert.equal((await f.t.mutation(worker('completeTaskCleanup'), { bridgeToken, sessionId: f.args.sessionId, taskArn: 'managed-task' })).accepted, false);
    assert.equal((await f.t.run(({ db }) => db.get(f.args.sessionId)))?.dispatchStopConfirmedAt, undefined);
    const second = await f.t.run(async ({ db }) => { const id = await db.insert('eventMediaSessions', { programId: f.output.programId, eventId: f.event.eventId, status: 'scheduled', createdAt: Date.now(), updatedAt: Date.now() }); await db.patch(f.output.programId, { activeSessionId: id }); return id; });
    const admission = { bridgeToken, eventId: f.event.eventId, sessionId: second, dispatchId: 'replacement' };
    assert.equal((await f.t.mutation(worker('admitDispatch'), admission)).granted, false);
    const sessions = await f.t.query(api.events.listEventMediaWorkerBridgeSessions, { bridgeToken, workerId: 'bridge' });
    assert.ok(sessions.some((s: any) => s.sessionId === f.args.sessionId));
    await refreshSessions(f.client, f.config, async (_config: any, args: string[]) => args[1] === 'describe-tasks' ? { tasks: [{ taskArn: 'managed-task', lastStatus: 'STOPPED' }] } : {});
    assert.equal(typeof (await f.t.run(({ db }) => db.get(f.args.sessionId)))?.dispatchStopConfirmedAt, 'number');
    assert.equal((await f.t.mutation(worker('admitDispatch'), admission)).granted, true);
}
it('I4 pre-epoch StopTask failure retains reservation and discovery until DescribeTasks confirms stop', async () => {
    const f = await admittedBeforeAcquisition();
    await f.owner.mutation(api.events.stopEventMediaWorker, { currentSlug: f.event.slug, sessionId: f.args.sessionId });
    let attempted = false;
    await claimAndProcess(f.client, f.config, async (_config: any, args: string[]) => { assert.equal(args[1], 'stop-task'); attempted = true; throw Error('simulated AWS timeout'); });
    assert.ok(attempted);
    assert.equal((await f.t.run(({ db }) => db.get(f.args.sessionId)))?.epoch, undefined);
    await assertReservedUntilConfirmed(f);
});
it('I4 manual media closure cannot release a running admitted task', async () => {
    const f = await admittedBeforeAcquisition();
    await f.owner.mutation(api.events.markEventMediaWorkerEnded, { currentSlug: f.event.slug, sessionId: f.args.sessionId, status: 'ended' });
    assert.equal((await f.t.run(({ db }) => db.get(f.args.sessionId)))?.status, 'ended');
    await assertReservedUntilConfirmed(f);
});
it('I4 legacy failure status cannot authorize managed reservation release or cleanup', async () => {
    const f = await admittedBeforeAcquisition();
    await f.t.mutation(api.events.recordEventMediaWorkerBridgeTaskStatus, { bridgeToken, workerId: 'bridge', sessionId: f.args.sessionId, status: 'error', workerTaskStatus: 'failed' });
    assert.equal((await f.t.run(({ db }) => db.get(f.args.sessionId)))?.workerTaskStatus, 'failed');
    await assertReservedUntilConfirmed(f);
});
it('I4 late task registration survives manual closure before the ARN was recorded', async () => {
    const f = await fixture();
    await f.t.mutation(worker('admitDispatch'), { bridgeToken, eventId: f.event.eventId, sessionId: f.args.sessionId, dispatchId: 'late-registration' });
    await f.owner.mutation(api.events.markEventMediaWorkerEnded, { currentSlug: f.event.slug, sessionId: f.args.sessionId });
    assert.equal((await f.t.mutation(worker('recordDispatchedTask'), { bridgeToken, sessionId: f.args.sessionId, dispatchId: 'late-registration', taskArn: 'late-task', taskDefinitionArn: 'late-definition' })).accepted, true);
    const sessions = await f.t.query(api.events.listEventMediaWorkerBridgeSessions, { bridgeToken, workerId: 'bridge' });
    assert.equal(sessions[0].workerTaskId, 'late-task');
    assert.equal(sessions[0].dispatchStopConfirmedAt, undefined);
});
it("kill-switch authority refresh tolerates a delayed poll without extending its ten-second hard deadline", async () => {
    let reads = 0;
    const f = runtimeFixture({ checkEnabled: async () => { reads++; return true; } });
    await f.worker.start();
    f.advance(8000); await f.worker.tick();
    // The next poll is delayed beyond the original ten-second deadline. A fresh
    // successful check before that deadline should have renewed kill-switch authority.
    f.advance(10500); f.worker.watchdog();
    assert.equal(f.worker.getState().stopped, false);
    assert.equal(reads, 2);
    // No more successful checks: the independent watchdog must still fence at 10s.
    f.advance(18000); f.worker.watchdog();
    assert.equal(f.worker.getState().stopped, true);
    assert.equal(f.counts().fenced, 1);
});
it('current decoder recovers while its unready successor is being prepared', async () => {
    const f = runtimeFixture();
    f.config.currentSourceId = 'a';
    f.config.slots[0].endAt = 10000;
    f.config.sources.push({ id: 'b', eventSlotId: 'slot-b', publicUrl: 'https://stream.vrcdn.live/live/b.live.ts', type: 'vrcdn_link' });
    f.config.slots.push({ slotKey: 'slot-b', sourceId: 'b', startAt: 10000, available: true });
    f.observations.set('a', { sourceId: 'a', slotKey: 'slot-a', ready: true, progressing: true, observedAt: 0, audioLevelDb: -24 });
    await f.worker.start();
    await f.worker.tick();
    assert.equal(f.counts().selections, 1, 'healthy current must be restored while next decoder prepares');
    assert.equal(f.worker.getState().current?.sourceId, 'a');
    assert.equal(f.counts().ackCount, 0, 'preparation does not acknowledge a new slot');
    await f.worker.stop();
});


it('F1 explicit capacity denial terminates the claimed start and permits a fresh operator retry', async () => {
    const f = await fixture();
    const occupied = await f.t.run(({ db }) => db.insert('eventMediaSessions', { programId: f.output.programId, eventId: f.event.eventId, status: 'starting', dispatchId: 'occupied', workerTaskId: 'occupied-task', workerTaskStatus: 'running', createdAt: Date.now(), updatedAt: Date.now() }));
    const client = { mutation: (ref: any, args: any) => f.t.mutation(ref, args) };
    const config = { bridgeToken, workerId: 'bridge', redactValues: [] };
    await claimAndProcess(client, config);
    assert.equal((await f.t.run(({db}) => db.get(f.args.sessionId)))?.status, 'error');
    assert.equal((await f.t.run(({db}) => db.get(f.scheduled.startCommandId!)))?.status, 'failed');
    assert.equal((await f.t.run(({db}) => db.get(occupied)))?.dispatchStopConfirmedAt, undefined);
    await f.t.mutation(worker('recordProcessStatus'), { bridgeToken, sessionId: occupied, taskArn: 'occupied-task', stopped: true });
    const retry = await f.owner.mutation(api.events.scheduleEventMediaWorker, { currentSlug: f.event.slug });
    assert.notEqual(retry.sessionId, f.args.sessionId);
    assert.equal((await f.t.mutation(worker('admitDispatch'), { bridgeToken, eventId: f.event.eventId, sessionId: retry.sessionId, dispatchId: 'retry' })).granted, true);
});
for (const admitted of [false, true]) it(`F1 unknown admission response retains the claimed start (reserved=${admitted})`, async () => {
    const f = await fixture();
    const { getFunctionName } = await import('convex/server');
    const client = { mutation: async (ref: any, args: any) => {
        if (getFunctionName(ref) === 'eventMediaWorker:admitDispatch') {
            if (admitted) await f.t.mutation(ref, args);
            throw Error('response lost');
        }
        return f.t.mutation(ref, args);
    } };
    await claimAndProcess(client, { bridgeToken, workerId: 'bridge', redactValues: [] });
    assert.equal((await f.t.run(({db}) => db.get(f.scheduled.startCommandId!)))?.status, 'claimed');
    await assert.rejects(f.owner.mutation(api.events.scheduleEventMediaWorker, { currentSlug: f.event.slug }), /in progress/);
    assert.equal(await claimAndProcess(client, { bridgeToken, workerId: 'bridge', redactValues: [] }), false);
    const session = await f.t.run(({db}) => db.get(f.args.sessionId));
    assert.equal(Boolean(session?.dispatchId), admitted);
    assert.equal(session?.dispatchStopConfirmedAt, undefined);
});

for (const failure of ['run-task', 'registration-response']) it(`F1 admitted ${failure} failure retains reservation and cannot start twice`, async () => {
    const f = await fixture();
    const { mkdtemp, writeFile, chmod, rm } = await import('node:fs/promises');
    const { tmpdir } = await import('node:os');
    const { join } = await import('node:path');
    const { getFunctionName } = await import('convex/server');
    const dir = await mkdtemp(join(tmpdir(), 'pr377-aws-fixture-'));
    const cli = join(dir, 'aws');
    await writeFile(cli, `#!${process.execPath}
const command = process.argv[3];
if (command === 'register-task-definition') console.log(JSON.stringify({taskDefinition:{taskDefinitionArn:'definition'}}));
else if (command === 'run-task') {
  if (${JSON.stringify(failure)} === 'run-task') process.exit(1);
  console.log(JSON.stringify({tasks:[{taskArn:'task'}]}));
} else process.exit(2);
`);
    await chmod(cli, 0o700);
    const client = { mutation: async (ref: any, args: any) => {
        const result = await f.t.mutation(ref, args);
        if (getFunctionName(ref) === 'eventMediaWorker:recordDispatchedTask') throw Error('registration response lost');
        return result;
    } };
    const config = { bridgeToken, workerId: 'bridge', redactValues: [], awsCommand: cli, secretRefMap: {'event-media/vrcdn/main':'test-secret'}, baseEnvironment: {}, subnets: [], securityGroups: [] };
    try {
        await claimAndProcess(client, config);
        const session = await f.t.run(({db}) => db.get(f.args.sessionId));
        assert.ok(session?.dispatchId);
        assert.equal(session.dispatchStopConfirmedAt, undefined);
        assert.equal(session.workerTaskId, failure === 'registration-response' ? 'task' : undefined);
        assert.equal((await f.t.run(({db}) => db.get(f.scheduled.startCommandId!)))?.status, 'claimed');
        await assert.rejects(f.owner.mutation(api.events.scheduleEventMediaWorker, { currentSlug: f.event.slug }), /in progress/);
        assert.equal(await claimAndProcess(client, config), false);
    } finally { await rm(dir, {recursive:true, force:true}); }
});
for (const response of [{}, {granted: undefined}, {granted: 'yes'}, null]) it(`F1 malformed admission ${JSON.stringify(response)} retains claimed start`, async () => {
    const f = await fixture();
    const { getFunctionName } = await import('convex/server');
    const client = { mutation: async (ref: any, args: any) => getFunctionName(ref) === 'eventMediaWorker:admitDispatch' ? response : f.t.mutation(ref, args) };
    await claimAndProcess(client, { bridgeToken, workerId: 'bridge', redactValues: [] });
    assert.equal((await f.t.run(({db}) => db.get(f.scheduled.startCommandId!)))?.status, 'claimed');
    await assert.rejects(f.owner.mutation(api.events.scheduleEventMediaWorker, { currentSlug: f.event.slug }), /in progress/);
    assert.equal(await claimAndProcess(client, { bridgeToken, workerId: 'bridge', redactValues: [] }), false);
});

it('R2F2 detached projections do not hide authored and manual sources on acquisition or refresh', async () => {
  const {t,args,event,output} = await fixture();
  const ids = await t.run(async ({db}) => {
    const now=Date.now();
    const slotData={eventId:event.eventId,position:0,startAt:now-1000,displayLabel:'DJ',roleLabel:'DJ',sourceType:'manual' as const,sourceLabel:'Owner',confidence:1,reviewState:'confirmed' as const,updatedAt:now};
    const stale=await db.insert('eventSlots',slotData);
    for(let i=0;i<100;i++) await db.insert('eventMediaSources',{programId:output.programId,eventId:event.eventId,key:`stale-${i}`,position:i,type:'vrcdn_link',purpose:'program',state:'ready',label:'Detached',eventSlotId:stale,profileProjection:true,projectionAvailable:true,publicUrl:'https://stream.vrcdn.live/live/stale.live.ts',createdAt:now,updatedAt:now});
    await db.delete(stale);
    const slot=await db.insert('eventSlots',slotData);
    const source=await db.insert('eventMediaSources',{programId:output.programId,eventId:event.eventId,key:'authored',position:101,type:'vrcdn_link',purpose:'program',state:'ready',label:'DJ',eventSlotId:slot,publicUrl:'https://stream.vrcdn.live/live/dj.live.ts',createdAt:now,updatedAt:now});
    const manual=await db.insert('eventMediaSources',{programId:output.programId,eventId:event.eventId,key:'manual',position:102,type:'vrcdn_link',purpose:'program',state:'ready',label:'Manual',publicUrl:'https://stream.vrcdn.live/live/manual.live.ts',createdAt:now,updatedAt:now});
    return {slot,source,manual};
  });
  const lease=await t.mutation(worker('acquireSession'),args);
  const request={...args,epoch:lease.epoch};
  for(const config of [lease.configuration,(await t.mutation(worker('refreshConfiguration'),request)).configuration]) {
    assert.deepEqual(new Set(config.sources.map((s:any)=>s.id)),new Set([ids.source,ids.manual]));
    assert.equal(config.slots[0].sourceId,ids.source);
    assert.equal(config.slots[0].available,true);
  }
  await t.run(({db})=>db.patch(ids.source,{state:'disabled'}));
  const revoked=await t.mutation(worker('refreshConfiguration'),request);
  assert.equal(revoked.configuration.slots[0].available,false);
  assert.deepEqual(revoked.configuration.sources.map((s:any)=>s.id),[ids.manual]);
  await t.run(async ({db})=>{
    const source=await db.get(ids.manual); assert(source);
    const {_id,_creationTime,...record}=source;
    for(let i=0;i<64;i++) await db.insert('eventMediaSources',{...record,key:`manual-${i}`,position:200+i});
  });
  await assert.rejects(t.mutation(worker('refreshConfiguration'),request),/worker limits/);
});

it('R2F3 primary invalid setup fences without further renewal, optional invalid setup stays isolated', async () => {
  for(const primaryInvalid of [true,false]) {
    let renewals=0,stops=0;
    const f=runtimeFixture({outputs:{start:async()=>{},stopNow:()=>{stops++;},stop:async()=>{},enqueue:()=>{},getState:()=>({publishing:!primaryInvalid,destinations:[{outputId:'out',status:primaryInvalid?'invalid_setup':'publishing'},{outputId:'optional',status:'invalid_setup'}]})},controlFilter:(name:string,args:any,next:any)=>{if(name==='renewSession')renewals++;return next(name,args);}});
    await f.worker.start().catch(()=>{});
    f.encoded(); await f.worker.tick();
    assert.equal(f.worker.getState().stopped,primaryInvalid);
    f.advance(6000);await f.worker.tick();f.advance(11000);await f.worker.tick();
    assert.equal(renewals,primaryInvalid?0:1);
    assert.equal(stops,primaryInvalid?1:0);
    await f.worker.stop();
  }
});
it('R2F3 primary startup deadline fences even without a claimed start command, transient startup recovers',async()=>{
  for(const recover of [false,true]) {
    let publishing=false,stops=0;
    const f=runtimeFixture({outputs:{start:async()=>{},stopNow:()=>{stops++;},stop:async()=>{},enqueue:()=>{},getState:()=>({publishing})}});
    await f.worker.start();
    for(const now of [5000,10000,14000,16000]) {f.advance(now);if(recover&&now===14000){publishing=true;f.encoded();}await f.worker.tick();}
    assert.equal(f.worker.getState().stopped,!recover);assert.equal(stops,recover?0:1);await f.worker.stop();
  }
});

it('R2F1 rejected ordinary output save preserves the active worker configuration and publication', async () => {
  const f=await fixture();
  const save=()=>f.owner.mutation(api.events.configureVrcdnOutput,{currentSlug:f.event.slug,key:'main',label:'Main',credentialRef:'event-media/vrcdn/main',sourceConsentAccepted:true,destinationAuthorityAccepted:true,providerRulesAccepted:true,rightsClearedMediaAccepted:true,playbackLinks:[{platform:'browser',url:'https://example.test/watch'}]});
  await assert.rejects(save(),/session/); // Pending, before any dispatch reservation.
  const controller=createEventWorker({identity:f.args,control:(method:string,request:Record<string,unknown>)=>f.t.mutation(worker(method),request),
    renderer:{start:async()=>{},stop:async()=>{},subscribe:()=>()=>{},reconcileSources:async()=>{},getInputs:()=>[],hold:()=>{},getState:()=>({running:true,outputMs:1000})},
    outputs:{start:async()=>{},stop:async()=>{},stopNow:()=>{},enqueue:()=>{},getState:()=>({publishing:true})},resolveSource:async()=>undefined,checkEnabled:async()=>true});
  try {
    await controller.start();await controller.tick();
    const before=await f.t.run(({db})=>db.get(f.output.outputId));
    await assert.rejects(save(),/session/);
    await controller.tick();
    assert.equal(controller.getState().stopped,false);
    assert.equal((await f.t.run(({db})=>db.get(f.args.sessionId)))?.status,'hold');
    assert.deepEqual(await f.t.run(({db})=>db.get(f.output.outputId)),before);
  } finally {await controller.stop();}
});

it('R2F1 confirmed task STOPPED unlocks configuration even after a late failure diagnostic', async()=>{
  const f=await admittedBeforeAcquisition();
  const status=()=>f.owner.query(api.events.getEventMediaControlStatus,{currentSlug:f.event.slug});
  const diagnoseFailure=()=>f.t.mutation(api.events.recordEventMediaWorkerBridgeTaskStatus,{bridgeToken,workerId:'bridge',sessionId:f.args.sessionId,status:'error',workerTaskStatus:'failed'});
  await diagnoseFailure();
  assert.equal((await status()).outputConfigurationLocked,true);
  await refreshSessions(f.client,f.config,async(_config:any,args:string[])=>args[1]==='describe-tasks'?{tasks:[{taskArn:'managed-task',lastStatus:'STOPPED',containers:[{exitCode:1}]}]}:{});
  const stopped=await f.t.run(({db})=>db.get(f.args.sessionId));
  assert.equal(typeof stopped?.dispatchStopConfirmedAt,'number');
  assert.equal((await status()).outputConfigurationLocked,false);
  // A delayed legacy diagnostic may retain the nonzero-exit label after the
  // authoritative process-stop observation; it must not revive the reservation.
  await diagnoseFailure();
  assert.equal((await f.t.run(({db})=>db.get(f.args.sessionId)))?.workerTaskStatus,'failed');
  assert.equal((await status()).outputConfigurationLocked,false);
  await f.owner.mutation(api.events.configureVrcdnOutput,{currentSlug:f.event.slug,key:'main',label:'Main',credentialRef:'event-media/vrcdn/main',sourceConsentAccepted:true,destinationAuthorityAccepted:true,providerRulesAccepted:true,rightsClearedMediaAccepted:true,playbackLinks:[{platform:'browser',url:'https://example.test/watch'}]});
});

for (const finish of ['observation','process','stop-ack'] as const) it(`R3F1 ${finish} settles session intent without releasing live task capacity`,async()=>{
  const f=await admittedBeforeAcquisition();
  await f.t.run(({db})=>db.patch(f.scheduled.startCommandId!,{status:'queued'}));
  const lease=await f.t.mutation(worker('acquireSession'),f.args), request={...f.args,epoch:lease.epoch};
  if(finish==='stop-ack') {
    await f.t.mutation(worker('claimCommands'),request);
    await f.t.mutation(worker('acknowledgeCommand'),{...request,commandId:f.scheduled.startCommandId!,sequence:1,outcome:'succeeded',observedState:'hold'});
    await f.owner.mutation(api.events.stopEventMediaWorker,{currentSlug:f.event.slug,sessionId:f.args.sessionId});
  }
  await f.owner.mutation(api.events.queueEventMediaCommand,{currentSlug:f.event.slug,type:'hold_current'});
  await f.t.mutation(worker('claimCommands'),request);
  await f.owner.mutation(api.events.queueEventMediaCommand,{currentSlug:f.event.slug,type:'switch_hold'});
  const pendingBefore=(await f.owner.query(api.events.getEventMediaControlStatus,{currentSlug:f.event.slug})).commands;
  assert(pendingBefore.some(c=>c.status==='claimed'));assert(pendingBefore.some(c=>c.status==='queued'));
  if(finish==='observation') {
    assert.equal((await f.t.mutation(worker('observeProgram'),{...request,epoch:lease.epoch-1,state:'error',outputMs:0,publishing:false})).accepted,false);
    assert((await f.owner.query(api.events.getEventMediaControlStatus,{currentSlug:f.event.slug})).commands.some(c=>c.status==='claimed'));
    await f.t.mutation(worker('observeProgram'),{...request,state:'error',outputMs:0,publishing:false});
  } else if(finish==='stop-ack') {
    const stop=pendingBefore.find(c=>c.commandType==='stop_program')!;
    await f.t.mutation(worker('acknowledgeCommand'),{...request,commandId:stop.commandId,sequence:2,outcome:'succeeded',observedState:'ended'});
  } else {
    await refreshSessions(f.client,f.config,async(_config:any,args:string[])=>args[1]==='describe-tasks'?{tasks:[{taskArn:'managed-task',lastStatus:'STOPPED',containers:[{exitCode:1}]}]}:{});
  }
  const status=await f.owner.query(api.events.getEventMediaControlStatus,{currentSlug:f.event.slug});
  assert.equal(status.commands.some(c=>['queued','claimed'].includes(c.status)),false);
  const rows=await f.t.run(({db})=>db.query('eventMediaCommands').withIndex('by_sessionId_sequence',q=>q.eq('sessionId',f.args.sessionId)).collect());
  assert(rows.every(row=>row.completedAt!==undefined));
  if(finish!=='process') {
    assert.equal((await f.t.run(({db})=>db.get(f.args.sessionId)))?.dispatchStopConfirmedAt,undefined);
    const retry=await f.owner.mutation(api.events.scheduleEventMediaWorker,{currentSlug:f.event.slug,startImmediately:true});
    const admission={bridgeToken,eventId:f.event.eventId,sessionId:retry.sessionId,dispatchId:'retry'};
    assert.equal((await f.t.mutation(worker('admitDispatch'),admission)).granted,false);
    await refreshSessions(f.client,f.config,async(_config:any,args:string[])=>args[1]==='describe-tasks'?{tasks:[{taskArn:'managed-task',lastStatus:'STOPPED',containers:[{exitCode:1}]}]}:{});
    assert.equal((await f.t.mutation(worker('admitDispatch'),admission)).granted,true);
  }
  const settled=await f.t.run(({db})=>db.query('eventMediaCommands').withIndex('by_sessionId_sequence',q=>q.eq('sessionId',f.args.sessionId)).collect());
  await f.t.mutation(worker('recordProcessStatus'),{bridgeToken,sessionId:f.args.sessionId,taskArn:'managed-task',stopped:true});
  assert.deepEqual(await f.t.run(({db})=>db.query('eventMediaCommands').withIndex('by_sessionId_sequence',q=>q.eq('sessionId',f.args.sessionId)).collect()),settled);
});

for(const scenario of [
  {name:'gap',at:150,end:100,next:200,expected:undefined},
  {name:'exact explicit end',at:100,end:100,next:200,expected:undefined},
  {name:'after final end',at:250,end:100,expected:undefined},
  {name:'later current slot',at:200,end:100,next:200,expected:'slot-b'},
  {name:'implicit end at next boundary',at:200,next:200,expected:'slot-b'},
  {name:'unbounded final slot',at:250,expected:'slot-a'},
] as const) it(`R3F3 fresh and replacement automatic startup uses interval: ${scenario.name}`,async()=>{
  for(const remembered of [false,true]) {
    const f=runtimeFixture();
    f.config.slots=[{slotKey:'slot-a',sourceId:'a',startAt:0,endAt:'end' in scenario?scenario.end:undefined,available:true},...('next' in scenario?[{slotKey:'slot-b',sourceId:'b',startAt:scenario.next,available:true}]:[])];
    f.config.sources.push({id:'b',publicUrl:'https://stream.vrcdn.live/live/b.live.ts'});
    if(remembered)f.config.currentSourceId='a';
    await f.worker.start();f.encoded();f.advance(scenario.at);
    for(const slot of f.config.slots) f.observations.set(slot.slotKey,{...slot,observedAt:scenario.at,ready:true,progressing:true});
    await f.worker.tick();
    assert.equal(f.worker.getState().current?.slotKey,scenario.expected);
    if(!scenario.expected)assert.equal(f.counts().selections,0);
    await f.worker.stop();
  }
});
it('R3F3 an already selected healthy set can overrun its explicit end',async()=>{
  const f=runtimeFixture();f.config.slots[0].endAt=100;
  await f.worker.start();f.encoded();f.observations.set('slot-a',{slotKey:'slot-a',sourceId:'a',observedAt:0,ready:true,progressing:true});await f.worker.tick();
  assert.equal(f.worker.getState().current?.slotKey,'slot-a');f.advance(200);f.observations.get('slot-a').observedAt=200;await f.worker.tick();
  assert.equal(f.worker.getState().current?.slotKey,'slot-a');await f.worker.stop();
});

it('R4F4 repeated profile projections stay byte-identical until stream or permission changes', async () => {
    const f = await projectedSourceFixture();
    const row = () => f.t.run(({db}) => db.get(f.sourceId));
    const refresh = () => f.t.mutation(worker('refreshConfiguration'), f.request);
    let before = await row();
    await new Promise(resolve => setTimeout(resolve, 5));
    await refresh(); await refresh();
    assert.deepEqual(await row(), before);
    for (const patch of [{outboundLinks:[{type:'other' as const,label:'Stream',source:'owner_authored' as const,url:'vrcdn:bravo'}]}, {fieldVisibility:{outboundLinks:'private' as const}}, {fieldVisibility:{outboundLinks:'public' as const}}]) {
        await f.t.run(({db}) => db.patch(f.person, patch));
        await refresh(); const changed = await row();
        assert.notDeepEqual(changed, before);
        await new Promise(resolve => setTimeout(resolve, 5));
        await refresh(); assert.deepEqual(await row(), changed); before = changed;
    }
    await f.t.run(async({db}) => {
        const original=await db.get(f.person);const {_id,_creationTime,...profile}=original!;
        const replacement=await db.insert('profiles',{...profile,slug:'replacement-performer'});
        await db.patch(f.slot,{personProfileId:replacement});
    });
    await refresh();const replaced=await row();assert.notEqual(replaced?.sourceProfileId,before?.sourceProfileId);
    await new Promise(resolve=>setTimeout(resolve,5));await refresh();assert.deepEqual(await row(),replaced);
    await f.t.run(({db}) => db.patch(f.slot, {personProfileId:undefined}));
    await refresh(); before = await row();
    await new Promise(resolve => setTimeout(resolve, 5));
    await refresh(); assert.deepEqual(await row(), before);
});
for (const reserved of [false, true]) it(`R4F5 unusable start settles session without fabricating task stop (reserved=${reserved})`, async () => {
    const f = await fixture();
    if (reserved) await f.t.mutation(worker('admitDispatch'), {bridgeToken,eventId:f.event.eventId,sessionId:f.args.sessionId,dispatchId:'reserved'});
    const pending = await f.owner.mutation(api.events.queueEventMediaCommand, {currentSlug:f.event.slug,type:'hold_current'});
    const registry = process.env.VRDEX_VRCDN_OUTPUT_ACCOUNTS_JSON;
    process.env.VRDEX_VRCDN_OUTPUT_ACCOUNTS_JSON = '[]';
    assert.equal(await f.t.mutation(api.events.claimEventMediaWorkerCommand, {bridgeToken,workerId:'bridge'}), null);
    const session = await f.t.run(({db}) => db.get(f.args.sessionId));
    assert.equal(session?.status, 'error');
    assert.equal(session?.dispatchStopConfirmedAt, undefined);
    assert.equal(session?.dispatchId, reserved ? 'reserved' : undefined);
    assert.equal((await f.t.run(({db}) => db.get(f.output.programId)))?.activeSessionId, undefined);
    for (const id of [pending.commandId,f.scheduled.startCommandId!]) assert.equal((await f.t.run(({db}) => db.get(id)))?.status,'failed');
    process.env.VRDEX_VRCDN_OUTPUT_ACCOUNTS_JSON = registry;
    if (reserved) {
        const retry = await f.owner.mutation(api.events.scheduleEventMediaWorker, {currentSlug:f.event.slug});
        assert.equal((await f.t.mutation(worker('admitDispatch'), {bridgeToken,eventId:f.event.eventId,sessionId:retry.sessionId,dispatchId:'retry'})).granted,false);
    }
    else assert.notEqual((await f.owner.mutation(api.events.scheduleEventMediaWorker, {currentSlug:f.event.slug})).sessionId,f.args.sessionId);
});
it('R4F6 acquired nonpolling worker Stop reaches exact ECS task and only STOPPED releases capacity', async () => {
    const f = await admittedBeforeAcquisition();
    const lease = await f.t.mutation(worker('acquireSession'),f.args);
    assert.equal(lease.granted,true);
    await f.t.run(({db})=>db.patch(f.scheduled.startCommandId!,{status:'queued'}));
    assert.equal(await f.t.mutation(api.events.claimEventMediaWorkerCommand,{bridgeToken,workerId:'bridge'}),null);
    await f.owner.mutation(api.events.stopEventMediaWorker, {currentSlug:f.event.slug,sessionId:f.args.sessionId});
    const calls:string[][]=[];
    assert.equal(await claimAndProcess(f.client,f.config,async (_config:any,args:string[]) => {calls.push(args);return {};}),true);
    assert.equal(calls.length,1); assert.equal(calls[0][1],'stop-task'); assert.equal(calls[0][calls[0].indexOf('--task')+1],'managed-task');
    assert.equal((await f.t.run(({db})=>db.get(f.args.sessionId)))?.workerTaskStatus,'stopping');
    assert.equal(await claimAndProcess(f.client,f.config,async()=>{throw Error('duplicate stop');}),false);
    await assertReservedUntilConfirmed(f);
});

function transactionalRuntime(relay?: any) {
    let now=0, sequence=0, commands:any[]=[], rendered:string|undefined='a';
    let prepared:string[]=[], preparedSources:any[]=[], renderedSource:string|undefined='a';
    const ready=new Set(['a']); const failures=new Map<string,number>(); const acks:any[]=[],reports:any[]=[];
    const config:any={mode:'manual',currentSourceId:'a',sessionDeadline:1000000,policy:{},outputId:'out',outputs:[{id:'out'}],sources:['a','b','c'].map(id=>({id,publicUrl:`https://example.test/${id}`})),slots:[{slotKey:'a',sourceId:'a',startAt:-1000,endAt:30000,available:true},{slotKey:'b',sourceId:'b',startAt:40000,endAt:50000,available:true}]};
    const renderer={start:async()=>{},stop:async()=>{},subscribe:()=>()=>{},reconcileSources:async(sources:any[])=>{preparedSources=sources.map(source=>({...source}));prepared=sources.map(s=>s.slotKey);},getInputs:()=>preparedSources.map(source=>({source,getObservation:()=>({...source,ready:ready.has(source.slotKey),progressing:ready.has(source.slotKey),failureSince:failures.get(source.slotKey),observedAt:now})})),selectSource:(slotKey:string)=>{if(!ready.has(slotKey)||!prepared.includes(slotKey))return false; rendered=slotKey;renderedSource=preparedSources.find(source=>source.slotKey===slotKey)?.sourceId;return true;},hold:()=>{rendered=undefined;renderedSource=undefined;},getState:()=>({running:true,outputMs:now+1,renderedSlotKey:rendered,renderedSourceId:renderedSource})};
    const worker=createEventWorker({identity:{},clock:()=>now,renderer,outputs:{start:async()=>{},stop:async()=>{},stopNow:()=>{},getState:()=>({publishing:true})},resolveSource:async(s:any)=>relay ? relay.resolveSource({...s,type:"vrcdn_link"}) : s.publicUrl,retainSources:(sources:any[])=>relay?.retainSources(sources.map(s=>({...s,type:"vrcdn_link"}))),checkEnabled:async()=>true,control:async(name:string,args:any)=>{
        if(name==='acquireSession'||name==='renewSession')return {granted:true,epoch:1,serverNow:now,expiresAt:now+30000,renewAfterMs:10000,configuration:structuredClone(config)};
        if(name==='refreshConfiguration')return {granted:true,serverNow:now,configuration:structuredClone(config)};
        if(name==='claimCommands')return {granted:true,commands};
        if(name==='acknowledgeCommand'){acks.push(args);commands=[];}
        if(name==='observeProgram')reports.push(args);
        return {accepted:true};
    }});
    return {worker,config,ready,failures,acks,reports,setTime:(time:number)=>{now=time;},prepared:()=>prepared,rendered:()=>rendered,command:(commandType:string,targetSourceId?:string)=>{commands=[{_id:`command-${++sequence}`,sequence,commandType,targetSourceId}];},tick:async(time=now+1000)=>{now=time;await worker.tick();}};
}
it('R4F1 failed source switch retains healthy playback, removes target and permits observed retry',async()=>{
    const f=transactionalRuntime();await f.worker.start();await f.tick();
    f.command('switch_source','b');await f.tick();
    assert.equal(f.worker.getState().current?.sourceId,'a');assert.equal(f.rendered(),'a');assert.deepEqual(f.prepared(),['a','b']);
    for(let i=0;i<17;i++)await f.tick();
    assert.equal(f.acks[0].outcome,'failed');assert.equal(f.worker.getState().current?.sourceId,'a');assert.deepEqual(f.prepared(),['a']);
    f.ready.add('b');await f.tick();assert.equal(f.rendered(),'a');assert.equal(f.reports.at(-1).sourceId,'a');
    f.command('switch_source','b');await f.tick();await f.tick();
    assert.equal(f.acks.at(-1).outcome,'succeeded');assert.equal(f.acks.at(-1).observedSourceId,'b');assert.equal(f.reports.at(-1).sourceId,'b');
    await f.worker.stop();
});
for(const scenario of [{name:'early authored',manual:'b',time:1000,expected:'a'},{name:'stale authored',manual:'a',time:40000,expected:'b'},{name:'synthetic',manual:'c',time:1000,expected:'a'},{name:'gap',manual:'b',time:35000,expected:undefined},{name:'exact boundary',manual:'a',time:40000,expected:'b'}]) it(`R4F2 Return to auto reconciles ${scenario.name} to authored current interval`,async()=>{
    const f=transactionalRuntime(); f.config.currentSourceId=scenario.manual;f.ready.add('b');f.ready.add('manual-c');
    f.setTime(scenario.time);await f.worker.start();await f.tick(scenario.time);f.command('set_automatic_mode');await f.tick();await f.tick();
    assert.equal(f.worker.getState().mode,'automatic');assert.equal(f.rendered(),scenario.expected);
    assert.equal(f.acks.at(-1).observedSourceId,scenario.expected??null);assert.equal(f.reports.at(-1).mode,'automatic');
    await f.worker.stop();
});
it('R4F2 unready current interval times out without committing automatic mode',async()=>{
    const f=transactionalRuntime();f.config.currentSourceId='b';f.ready.delete('a');f.ready.add('b');
    await f.worker.start();await f.tick();f.command('set_automatic_mode');await f.tick();
    for(let i=0;i<17;i++)await f.tick();
    assert.equal(f.acks.at(-1).outcome,'failed');assert.equal(f.worker.getState().mode,'manual');assert.equal(f.worker.getState().current.sourceId,'b');assert.equal(f.rendered(),'b');
    await f.worker.stop();
});

it('R4F3 draft host projection authorizes operations readers and conceals all other viewers and paths',async()=>{
    const f=await fixture();await f.t.run(({db})=>db.patch(f.event.eventId,{publicationState:'draft_private'}));
    const hostQuery=makeFunctionReference<'query'>('events:getHostBySlug');
    const args={slug:f.event.slug,communitySlug:'club'};
    assert.equal(await f.t.query(api.events.getPublicBySlug,{slug:f.event.slug}),null);
    assert.equal((await f.owner.query(hostQuery,args)).title,'Worker event');
    assert.equal(await f.t.query(hostQuery,args),null);
    assert.equal(await f.owner.query(hostQuery,{...args,communitySlug:'other'}),null);
    const subject=newClerkUserId();
    await f.t.run(async({db})=>{
        await db.insert('users',{clerkUserId:subject,name:'Reader'});
        const event=await db.get(f.event.eventId);
        await db.insert('communityAuthorities',{communityProfileId:event!.communityProfileId!,subjectTokenIdentifier:`test|${subject}`,subject:{subject,issuer:'test',tokenIdentifier:`test|${subject}`},capabilities:['view_event_operations'],state:'active',grantedAt:Date.now(),updatedAt:Date.now()});
    });
    const reader=f.t.withIdentity({subject,issuer:'test',tokenIdentifier:`test|${subject}`});
    const projected=await reader.query(hostQuery,args);
    assert.equal(projected.title,'Worker event');
    assert.doesNotMatch(JSON.stringify(projected),/secretRef|credential|claimedByWorker|preserved.*Association/);
    await assert.rejects(reader.mutation(api.events.queueEventMediaCommand,{currentSlug:f.event.slug,type:'switch_hold'}));
    await f.t.run(async({db})=>{for(const authority of await db.query('communityAuthorities').collect())await db.patch(authority._id,{state:'revoked'});});
    assert.equal(await reader.query(hostQuery,args),null);
    await f.t.run(({db})=>db.patch(f.event.eventId,{publicationState:'published'}));
    assert.equal((await f.t.query(hostQuery,args)).title,'Worker event');
    assert.equal(await f.t.query(hostQuery,{...args,communitySlug:'other'}),null);
});

it('R4F1 revoking the previous or pending source never resurrects revoked access on failure',async()=>{
 for(const revoked of ['a','b']) {
  const f=transactionalRuntime();await f.worker.start();await f.tick();f.command('switch_source','b');await f.tick();
  f.config.sources=f.config.sources.filter((s:any)=>s.id!==revoked);f.config.slots.find((s:any)=>s.sourceId===revoked).available=false;
  for(let i=0;i<17;i++)await f.tick();
  assert.equal(f.acks.at(-1).outcome,'failed');assert(!f.prepared().includes(revoked));
  assert.equal(f.rendered(),revoked==='a'?undefined:'a');await f.worker.stop();
 }
});
it('R4F6 worker Stop acknowledgement racing bridge completion preserves sequence and capacity',async()=>{
 const f=await admittedBeforeAcquisition();const lease=await f.t.mutation(worker('acquireSession'),f.args);const request={...f.args,epoch:lease.epoch};
 await f.owner.mutation(api.events.stopEventMediaWorker,{currentSlug:f.event.slug,sessionId:f.args.sessionId});
 const bridge=await f.t.mutation(api.events.claimEventMediaWorkerCommand,{bridgeToken,workerId:'bridge'});
 assert.equal(bridge?.commandType,'stop_program');
 const claimed=await f.t.mutation(worker('claimCommands'),request);const stop=claimed.commands.find((c:any)=>c.commandType==='stop_program');
 assert.equal((await f.t.mutation(worker('acknowledgeCommand'),{...request,commandId:stop._id,sequence:stop.sequence,outcome:'succeeded',observedState:'ended',observedSourceId:null})).accepted,true);
 assert.equal((await f.t.mutation(worker('recordTaskStopRequested'),{bridgeToken,sessionId:f.args.sessionId,taskArn:'wrong-task'})).accepted,false);
 assert.equal((await f.t.mutation(worker('recordTaskStopRequested'),{bridgeToken,sessionId:f.args.sessionId,taskArn:'managed-task'})).accepted,true);
 assert.equal((await f.t.run(({db})=>db.get(f.args.sessionId)))?.status,'ended');
 assert.equal((await f.t.run(({db})=>db.get(stop._id)))?.status,'succeeded');
 await assertReservedUntilConfirmed(f);
 assert.equal((await f.t.mutation(worker('recordTaskStopRequested'),{bridgeToken,sessionId:f.args.sessionId,taskArn:'managed-task'})).accepted,true);
 assert.equal((await f.t.run(({db})=>db.get(f.args.sessionId)))?.workerTaskStatus,'stopped');
});

it('R4F5 held task on rejected start retains cleanup intent through revoked credentials',async()=>{
 const f=await fixture();
 await f.t.mutation(worker('admitDispatch'),{bridgeToken,eventId:f.event.eventId,sessionId:f.args.sessionId,dispatchId:'reserved'});
 await f.t.mutation(worker('recordDispatchedTask'),{bridgeToken,sessionId:f.args.sessionId,dispatchId:'reserved',taskArn:'held-task',taskDefinitionArn:'held-definition'});
 process.env.VRDEX_VRCDN_OUTPUT_ACCOUNTS_JSON='[]';
 assert.equal(await f.t.mutation(api.events.claimEventMediaWorkerCommand,{bridgeToken,workerId:'bridge'}),null);
 const calls:string[][]=[];const client={query:(ref:any,args:any)=>f.t.query(ref,args),mutation:(ref:any,args:any)=>f.t.mutation(ref,args)};
 const config={bridgeToken,workerId:'bridge',cluster:'local-test'};
 const running=async(_config:any,args:string[])=>{calls.push(args);return args[1]==='describe-tasks'?{tasks:[{taskArn:'held-task',lastStatus:'RUNNING'}]}:{};};
 await refreshSessions(client,config,running);await refreshSessions(client,config,running);
 assert.equal(calls.filter(args=>args[1]==='stop-task').length,2);
 assert(calls.filter(args=>args[1]==='stop-task').every(args=>args[args.indexOf('--task')+1]==='held-task'));
 const session=await f.t.run(({db})=>db.get(f.args.sessionId));assert.equal(session?.status,'error');assert.equal(session?.dispatchStopConfirmedAt,undefined);
 await refreshSessions(client,config,async(_config:any,args:string[])=>args[1]==='describe-tasks'?{tasks:[{taskArn:'held-task',lastStatus:'STOPPED'}]}:{});
 assert.equal(typeof (await f.t.run(({db})=>db.get(f.args.sessionId)))?.dispatchStopConfirmedAt,'number');
});
it('R4F6 failed Stop request is retried against exact task by durable reconciliation',async()=>{
 const f=await admittedBeforeAcquisition();await f.t.mutation(worker('acquireSession'),f.args);
 await f.owner.mutation(api.events.stopEventMediaWorker,{currentSlug:f.event.slug,sessionId:f.args.sessionId});
 await claimAndProcess(f.client,f.config,async()=>{throw Error('AWS timeout');});
 let stops=0;
 await refreshSessions(f.client,f.config,async(_config:any,args:string[])=>{if(args[1]==='describe-tasks')return {tasks:[{taskArn:'managed-task',lastStatus:'RUNNING'}]};assert.equal(args[1],'stop-task');assert.equal(args[args.indexOf('--task')+1],'managed-task');stops++;return {};});
 assert.equal(stops,1);assert.equal((await f.t.run(({db})=>db.get(f.args.sessionId)))?.dispatchStopConfirmedAt,undefined);
});

it('R4F1 R4F2 real backend observation and command ack agree through failure, retry and Return to auto',async()=>{
 const f=await fixture();const now=Date.now();
 const sources=await f.t.run(async({db})=>{
  const result:any[]=[];
  for(const [index,key] of ['a','b'].entries()){
   const slot=await db.insert('eventSlots',{eventId:f.event.eventId,position:index,startAt:now+(index===0?-1000:60000),endAt:now+(index===0?60000:120000),displayLabel:key,roleLabel:'DJ',sourceType:'manual',sourceLabel:'Owner',confidence:1,reviewState:'confirmed',updatedAt:now});
   const source=await db.insert('eventMediaSources',{programId:f.output.programId,eventId:f.event.eventId,key,position:index,type:'vrcdn_link',purpose:'program',state:'ready',label:key,eventSlotId:slot,publicUrl:`https://stream.vrcdn.live/live/${key}.live.ts`,createdAt:now,updatedAt:now});result.push({slot,source});
  }return result;
 });
 let time=0,rendered:any,prepared:any[]=[];const ready=new Set([sources[0].slot]);
 const renderer={start:async()=>{},stop:async()=>{},subscribe:()=>()=>{},reconcileSources:async(rows:any[])=>{prepared=rows;},getInputs:()=>prepared.map(source=>({source,getObservation:()=>({...source,ready:ready.has(source.slotKey),progressing:ready.has(source.slotKey),observedAt:time})})),selectSource:(key:string)=>{if(!ready.has(key))return false;rendered=prepared.find(source=>source.slotKey===key);return !!rendered;},hold:()=>{rendered=undefined;},getState:()=>({running:true,outputMs:time+1,renderedSlotKey:rendered?.slotKey,renderedSourceId:rendered?.sourceId})};
 const runtime=createEventWorker({identity:{...f.args},renderer,clock:()=>time,resolveSource:async(s:any)=>s.publicUrl,checkEnabled:async()=>true,outputs:{start:async()=>{},stop:async()=>{},stopNow:()=>{},getState:()=>({publishing:true})},control:(name:string,args:any)=>f.t.mutation(worker(name),args)});
 const tick=async()=>{time+=1000;await runtime.tick();assert.equal(runtime.getState().stopped,false);};
 const state=()=>f.t.run(({db})=>db.get(f.args.sessionId));
 await runtime.start();await tick();await tick();await tick();
 assert.equal((await state())?.currentSourceId,sources[0].source);
 const failed=await f.owner.mutation(api.events.queueEventMediaCommand,{currentSlug:f.event.slug,type:'switch_source',targetSourceKey:'b'});
 for(let i=0;i<18;i++)await tick();
 assert.equal((await f.t.run(({db})=>db.get(failed.commandId)))?.status,'failed');
 assert.equal((await state())?.currentSourceId,sources[0].source);assert.equal((await state())?.broadcastMode,'automatic');
 ready.add(sources[1].slot);await tick();assert.equal((await state())?.currentSourceId,sources[0].source);
 const retry=await f.owner.mutation(api.events.queueEventMediaCommand,{currentSlug:f.event.slug,type:'switch_source',targetSourceKey:'b'});await tick();await tick();
 assert.equal((await f.t.run(({db})=>db.get(retry.commandId)))?.observedSourceId,sources[1].source);assert.equal((await state())?.broadcastMode,'manual');
 const auto=await f.owner.mutation(api.events.queueEventMediaCommand,{currentSlug:f.event.slug,type:'set_automatic_mode'});await tick();await tick();
 assert.equal((await f.t.run(({db})=>db.get(auto.commandId)))?.observedSourceId,sources[0].source);
 assert.equal((await state())?.currentSourceId,sources[0].source);assert.equal((await state())?.broadcastMode,'automatic');
 await runtime.stop();
});

it('R4F6 Stop before task registration is enforced when its exact ARN arrives',async()=>{
 const f=await fixture();await f.t.mutation(worker('admitDispatch'),{bridgeToken,eventId:f.event.eventId,sessionId:f.args.sessionId,dispatchId:'late-stop'});
 await f.t.run(({db})=>db.patch(f.scheduled.startCommandId!,{status:'succeeded'}));
 await f.owner.mutation(api.events.stopEventMediaWorker,{currentSlug:f.event.slug,sessionId:f.args.sessionId});
 const client={query:(ref:any,args:any)=>f.t.query(ref,args),mutation:(ref:any,args:any)=>f.t.mutation(ref,args)},config={bridgeToken,workerId:'bridge',cluster:'local-test',redactValues:[]};
 assert.equal(await claimAndProcess(client,config,async()=>{throw Error('No exact task to stop yet');}),true);
 assert.equal((await f.t.run(({db})=>db.get(f.args.sessionId)))?.dispatchStopConfirmedAt,undefined);
 await f.t.mutation(worker('recordDispatchedTask'),{bridgeToken,sessionId:f.args.sessionId,dispatchId:'late-stop',taskArn:'late-task',taskDefinitionArn:'late-definition'});
 let stopped=false;await refreshSessions(client,config,async(_config:any,args:string[])=>{if(args[1]==='describe-tasks')return {tasks:[{taskArn:'late-task',lastStatus:'RUNNING'}]};assert.equal(args[1],'stop-task');assert.equal(args[args.indexOf('--task')+1],'late-task');stopped=true;return {};});
 assert.equal(stopped,true);assert.equal((await f.t.run(({db})=>db.get(f.args.sessionId)))?.dispatchStopConfirmedAt,undefined);
});

for(const legacy of [false,true]) it(`R5F2 cleanup failure remains retryable while later task and commands reconcile (legacy=${legacy})`,async()=>{
 const f=await admittedBeforeAcquisition();
 let second:any;
 await f.t.run(async({db})=>{
  await db.patch(f.args.sessionId,{...(legacy?{dispatchId:undefined}:{}),status:'error',updatedAt:Date.now()+1000});
  second=await db.insert('eventMediaSessions',{programId:f.output.programId,eventId:f.event.eventId,status:'stopping',dispatchId:'second',workerProvider:'aws_ecs',workerTaskId:'second-task',workerTaskStatus:'running',stopRequestedAt:Date.now(),createdAt:Date.now(),updatedAt:Date.now()});
 });
 await f.owner.mutation(api.events.stopEventMediaWorker,{currentSlug:f.event.slug,sessionId:second});
 let failures=true,cleanupAttempts=0,stops=0,claims=0;
 const runAws=async(_config:any,args:string[])=>{
  if(args[1]==='describe-tasks')return {tasks:[{taskArn:'managed-task',lastStatus:'STOPPED',containers:[{exitCode:0}]},{taskArn:'second-task',lastStatus:'RUNNING'}]};
  if(args[1]==='deregister-task-definition'){cleanupAttempts++;if(failures)throw Error('test cleanup throttled');return {};}
  assert.equal(args[1],'stop-task');assert.equal(args[args.indexOf('--task')+1],'second-task');stops++;return {};
 };
 for(let i=0;i<2;i++){
  await refreshSessions(f.client,f.config,runAws);
  if(await claimAndProcess(f.client,f.config,runAws))claims++;
  assert.equal((await f.t.run(({db})=>db.get(f.args.sessionId)))?.workerTaskCleanupPending,true);
 }
 assert.equal(stops,3);assert.equal(claims,1);assert.equal(cleanupAttempts,2);
 failures=false;await refreshSessions(f.client,f.config,runAws);
 assert.equal((await f.t.run(({db})=>db.get(f.args.sessionId)))?.workerTaskCleanupPending,false);
 await refreshSessions(f.client,f.config,runAws);assert.equal(cleanupAttempts,3);
});
for(const terminal of ['ended','error','stop-ack'] as const) it(`R5F4 selected destination follows live/hold and ${terminal} without changing other outputs`,async()=>{
 const f=await admittedBeforeAcquisition();const lease=await f.t.mutation(worker('acquireSession'),f.args),request={...f.args,epoch:lease.epoch};
 const optional=await f.t.run(async({db})=>{const {_id,_creationTime,...output}=(await db.get(f.output.outputId))!;return db.insert('eventMediaOutputs',{...output,key:'other',state:'ready'});});
 const status=()=>f.owner.query(api.events.getEventMediaControlStatus,{currentSlug:f.event.slug});
 for(const state of ['live','hold'] as const){
  assert.equal((await f.t.mutation(worker('observeProgram'),{...request,state,outputMs:1000,publishing:true,outputId:f.output.outputId})).accepted,true);
  assert.equal((await status()).operationReadiness.activeOutputCount,1);
  const before=await f.t.run(({db})=>db.get(f.output.outputId));assert.equal(before?.state,'active');
  await new Promise(resolve=>setTimeout(resolve,5));await f.t.mutation(worker('observeProgram'),{...request,state,outputMs:2000,publishing:true});
  assert.deepEqual(await f.t.run(({db})=>db.get(f.output.outputId)),before);
 }
 if(terminal==='stop-ack'){
  await f.owner.mutation(api.events.stopEventMediaWorker,{currentSlug:f.event.slug,sessionId:f.args.sessionId});
  const {commands}=await f.t.mutation(worker('claimCommands'),request);const stop=commands.find((c:any)=>c.commandType==='stop_program');
  assert.equal((await f.t.mutation(worker('acknowledgeCommand'),{...request,commandId:stop._id,sequence:stop.sequence,outcome:'succeeded',observedState:'ended',observedOutputId:f.output.outputId})).accepted,true);
 }else assert.equal((await f.t.mutation(worker('observeProgram'),{...request,state:terminal,outputMs:2000,publishing:false})).accepted,true);
 assert.equal((await status()).operationReadiness.activeOutputCount,0);
 assert.equal((await f.t.run(({db})=>db.get(f.output.outputId)))?.state,'ready');
 assert.equal((await f.t.run(({db})=>db.get(optional)))?.state,'ready');
 assert.equal((await f.t.run(({db})=>db.get(f.args.sessionId)))?.dispatchStopConfirmedAt,undefined);
});

import { createSourceRelay } from '../../workers/restream/source-relay.mjs';
it('R5F3 actual controller retains current plus manual target and retires target on rollback', async()=>{
 const relay=await createSourceRelay({operatorEndpoints:['https://example.test/a','https://example.test/b','https://example.test/c']});const f=transactionalRuntime(relay);
 const resolve=(id:string)=>relay.resolveSource({...f.config.sources.find((s:any)=>s.id===id),type:'vrcdn_link'});
 try{
  await f.worker.start();await f.tick();const a=resolve('a');f.command('switch_source','b');await f.tick();const b=resolve('b');
  assert.equal(resolve('a'),a);assert.deepEqual(f.prepared(),['a','b']);
  for(let i=0;i<17;i++)await f.tick();assert.equal(f.acks[0].outcome,'failed');assert.equal(resolve('a'),a);assert.equal((await fetch(b)).status,404);
  f.config.sources.find((s:any)=>s.id==='b').publicUrl='http://127.0.0.1/private';f.command('switch_source','b');await f.tick();
  assert.equal(f.worker.getState().stopped,false);assert.equal(f.rendered(),'a');assert.equal(resolve('a'),a);
 }finally{await f.worker.stop();relay.stop();}
});
it('R5F1 scheduling attaches pre-session intent without losing command order',async()=>{
 const f=await fixture();
 await f.t.run(async({db})=>{await db.delete(f.scheduled.startCommandId!);await db.delete(f.args.sessionId);await db.patch(f.output.programId,{activeSessionId:undefined,state:'ready'});});
 await f.owner.mutation(api.events.queueEventMediaCommand,{currentSlug:f.event.slug,type:'switch_hold'});
 const before=await f.owner.query(api.events.getEventMediaControlStatus,{currentSlug:f.event.slug});const queued=before.commands.find(c=>c.status==='queued')!;assert.equal(queued.sessionId,undefined);
 const scheduled=await f.owner.mutation(api.events.scheduleEventMediaWorker,{currentSlug:f.event.slug,outputKey:'main',startImmediately:true});
 const lease=await f.t.mutation(worker('acquireSession'),{...f.args,sessionId:scheduled.sessionId});
 const claimed=await f.t.mutation(worker('claimCommands'),{...f.args,sessionId:scheduled.sessionId,epoch:lease.epoch});
 assert.equal(claimed.granted,true);assert.equal(claimed.commands.some((c:any)=>c._id===queued.commandId),true);
 const attached=await f.t.run(({db})=>db.get(queued.commandId));assert.equal(attached?.sessionId,scheduled.sessionId);
 const sequences=claimed.commands.map((c:any)=>c.sequence);assert.deepEqual(sequences,[...sequences].sort((a:number,b:number)=>a-b));assert.equal(new Set(sequences).size,sequences.length);
});

for(const changed of ['disabled','revoked','replacement'] as const) it(`R5F4 terminal observations preserve ${changed} destination authority`,async()=>{
 const f=await admittedBeforeAcquisition();const lease=await f.t.mutation(worker('acquireSession'),f.args),request={...f.args,epoch:lease.epoch};
 await f.t.mutation(worker('observeProgram'),{...request,state:'live',outputMs:1000,publishing:true});
 if(changed==='disabled')await f.t.run(({db})=>db.patch(f.output.outputId,{state:'disabled'}));
 if(changed==='revoked')process.env.VRDEX_VRCDN_OUTPUT_ACCOUNTS_JSON='[]';
 if(changed==='replacement')await f.t.run(async({db})=>{await db.patch(f.args.sessionId,{status:'ended'});const id=await db.insert('eventMediaSessions',{eventId:f.event.eventId,programId:f.output.programId,outputId:f.output.outputId,status:'live',createdAt:Date.now(),updatedAt:Date.now()});await db.patch(f.output.programId,{activeSessionId:id});});
 const before=await f.t.run(({db})=>db.get(f.output.outputId));
 const result=await f.t.mutation(worker('observeProgram'),{...request,state:'ended',outputMs:0,publishing:false});
 assert.equal(result.accepted,changed!=='replacement');assert.deepEqual(await f.t.run(({db})=>db.get(f.output.outputId)),before);
});
it('R5F4 mismatched destination and stale epoch cannot mark any output active',async()=>{
 const f=await fixture();const lease=await f.t.mutation(worker('acquireSession'),f.args),request={...f.args,epoch:lease.epoch};
 const other=await f.t.run(async({db})=>{const {_id,_creationTime,...output}=(await db.get(f.output.outputId))!;return db.insert('eventMediaOutputs',{...output,key:'other'});});
 for(const args of [{...request,epoch:lease.epoch-1,outputId:f.output.outputId},{...request,outputId:other}])assert.equal((await f.t.mutation(worker('observeProgram'),{...args,state:'live',outputMs:1000,publishing:true})).accepted,false);
 await f.t.mutation(worker('claimCommands'),request);
 assert.equal((await f.t.mutation(worker('acknowledgeCommand'),{...request,commandId:f.scheduled.startCommandId!,sequence:1,outcome:'succeeded',observedState:'live',observedOutputId:other})).accepted,false);
 assert.equal((await f.owner.query(api.events.getEventMediaControlStatus,{currentSlug:f.event.slug})).operationReadiness.activeOutputCount,0);
});
it('R5F2 cleanup isolation does not swallow backend control failures',async()=>{
 const f=await admittedBeforeAcquisition();
 const client={...f.client,mutation:async()=>{throw Error('control identity failure');}};
 await assert.rejects(refreshSessions(client,f.config,async()=>({tasks:[{taskArn:'managed-task',lastStatus:'STOPPED'}]})),/control identity failure/);
});
it('R5F4 successful command acknowledgements activate output and terminal omission restores ready',async()=>{
 const f=await fixture();const lease=await f.t.mutation(worker('acquireSession'),f.args),request={...f.args,epoch:lease.epoch};
 await f.t.mutation(worker('claimCommands'),request);
 const ack={...request,commandId:f.scheduled.startCommandId!,sequence:1,outcome:'succeeded',observedState:'hold'};
 assert.equal((await f.t.mutation(worker('acknowledgeCommand'),ack)).accepted,true);
 const active=await f.t.run(({db})=>db.get(f.output.outputId));assert.equal(active?.state,'active');
 assert.equal((await f.t.mutation(worker('acknowledgeCommand'),ack)).duplicate,true);assert.deepEqual(await f.t.run(({db})=>db.get(f.output.outputId)),active);
 await f.owner.mutation(api.events.stopEventMediaWorker,{currentSlug:f.event.slug,sessionId:f.args.sessionId});
 const claimed=await f.t.mutation(worker('claimCommands'),request);const stop=claimed.commands.find((c:any)=>c.commandType==='stop_program');
 const ended={...request,commandId:stop._id,sequence:stop.sequence,outcome:'succeeded',observedState:'ended'};
 assert.equal((await f.t.mutation(worker('acknowledgeCommand'),ended)).accepted,true);assert.equal((await f.t.run(({db})=>db.get(f.output.outputId)))?.state,'ready');
 await f.t.run(async({db})=>{const id=await db.insert('eventMediaSessions',{programId:f.output.programId,eventId:f.event.eventId,outputId:f.output.outputId,status:'live',createdAt:Date.now(),updatedAt:Date.now()});await db.patch(f.output.programId,{activeSessionId:id});await db.patch(f.output.outputId,{state:'active'});});
 assert.equal((await f.t.mutation(worker('acknowledgeCommand'),ended)).duplicate,true);assert.equal((await f.t.run(({db})=>db.get(f.output.outputId)))?.state,'active');
});

for (const priorObservation of [false, true]) it(`R5_REVIEW legacy ${priorObservation ? 'cleanup retry' : 'first stopped observation'} preserves replacement publication`, async () => {
  const f = await admittedBeforeAcquisition();
  await f.t.run(({ db }) => db.patch(f.args.sessionId, { dispatchId: undefined, status: 'error' }));
  let failCleanup = true, attempts = 0, publicationReports = 0;
  const client = { ...f.client, mutation: async (ref: any, args: any) => {
    if (getFunctionName(ref) === 'events:recordEventMediaWorkerBridgeTaskStatus') publicationReports++;
    return f.client.mutation(ref, args);
  } };
  const runAws = async (_config: any, args: string[]) => {
    if (args[1] === 'describe-tasks') return { tasks: [{ taskArn: 'managed-task', lastStatus: 'STOPPED', containers: [{ exitCode: 0 }] }] };
    assert.equal(args[1], 'deregister-task-definition'); attempts++;
    if (failCleanup) throw Error('cleanup throttled');
    return {};
  };
  if (priorObservation) await refreshSessions(client, f.config, runAws);
  const scheduled = await f.owner.mutation(api.events.scheduleEventMediaWorker, { currentSlug: f.event.slug, startImmediately: true });
  const lease = await f.t.mutation(worker('acquireSession'), { ...f.args, sessionId: scheduled.sessionId, epoch: 0 });
  assert.equal(lease.granted, true);
  const request = { ...f.args, sessionId: scheduled.sessionId, epoch: lease.epoch };
  assert.equal((await f.t.mutation(worker('observeProgram'), { ...request, state: 'live', outputMs: 1000, publishing: true })).accepted, true);
  const publication = () => f.t.run(async ({ db }) => ({ program: await db.get(f.output.programId), output: await db.get(f.output.outputId) }));
  const before = await publication();
  assert.equal(before.program?.activeSessionId, scheduled.sessionId); assert.equal(before.program?.state, 'live'); assert.equal(before.output?.state, 'active');
  for (let i = 0; i < 2; i++) {
    await refreshSessions(client, f.config, runAws);
    assert.deepEqual(await publication(), before);
    assert.equal(publicationReports, 1, "cleanup retries must not replay publication status");
    assert.equal((await f.t.run(({ db }) => db.get(f.args.sessionId)))?.workerTaskCleanupPending, true);
    assert.equal((await f.t.mutation(worker('renewSession'), request)).granted, true);
  }
  failCleanup = false;
  await refreshSessions(client, f.config, runAws);
  assert.deepEqual(await publication(), before);
  assert.equal((await f.t.run(({ db }) => db.get(f.args.sessionId)))?.workerTaskCleanupPending, false);
  assert.equal((await f.t.run(({ db }) => db.get(f.args.sessionId)))?.workerTaskStatus, 'stopped');
  const cleanedAttempts = attempts;
  await refreshSessions(client, f.config, runAws);
  assert.equal(attempts, cleanedAttempts); assert.deepEqual(await publication(), before);
});

for (const optionalActive of [false, true]) it(`R6F1 abrupt exact-task STOPPED permits replacement without resaving (optional active=${optionalActive})`, async () => {
  const f = await admittedBeforeAcquisition();
  const lease = await f.t.mutation(worker('acquireSession'), f.args);
  const request = { ...f.args, epoch: lease.epoch };
  const optional = await f.t.run(async ({ db }) => {
    const { _id, _creationTime, ...output } = (await db.get(f.output.outputId))!;
    return db.insert('eventMediaOutputs', { ...output, key: 'optional', state: optionalActive ? 'active' : 'ready' });
  });
  assert.equal((await f.t.mutation(worker('observeProgram'), { ...request, state: 'live', outputMs: 1000, publishing: true })).accepted, true);
  const confirm = { bridgeToken, sessionId: f.args.sessionId, taskArn: 'managed-task', stopped: true };
  assert.equal((await f.t.mutation(worker('recordProcessStatus'), { ...confirm, taskArn: 'wrong-task' })).accepted, false);
  await f.t.mutation(worker('recordProcessStatus'), { ...confirm, stopped: false });
  assert.equal((await f.t.run(({ db }) => db.get(f.output.outputId)))?.state, 'active');
  assert.equal((await f.t.run(({ db }) => db.get(f.args.sessionId)))?.dispatchStopConfirmedAt, undefined);
  await f.t.mutation(worker('recordProcessStatus'), confirm);
  const output = await f.t.run(({ db }) => db.get(f.output.outputId));
  assert.equal(output?.state, 'ready');
  assert.equal((await f.t.run(({ db }) => db.get(optional)))?.state, optionalActive ? 'active' : 'ready');
  assert.equal((await f.owner.query(api.events.getEventMediaControlStatus, { currentSlug: f.event.slug })).operationReadiness.activeOutputCount, optionalActive ? 1 : 0);
  const session = await f.t.run(({ db }) => db.get(f.args.sessionId));
  assert.equal(session?.status, 'error'); assert.equal(session?.workerTaskCleanupPending, true); assert.equal(typeof session?.dispatchStopConfirmedAt, 'number');
  await f.t.mutation(worker('recordProcessStatus'), confirm);
  assert.deepEqual(await f.t.run(({ db }) => db.get(f.output.outputId)), output);
  const replacement = await f.owner.mutation(api.events.scheduleEventMediaWorker, { currentSlug: f.event.slug, outputKey: 'main', startImmediately: true });
  assert.equal((await f.t.mutation(worker('admitDispatch'), { bridgeToken, eventId: f.event.eventId, sessionId: replacement.sessionId, dispatchId: 'replacement' })).granted, true);
  const acquired = await f.t.mutation(worker('acquireSession'), { ...f.args, sessionId: replacement.sessionId, epoch: 0 });
  assert.equal(acquired.granted, true);
  assert.equal((await f.t.run(({ db }) => db.get(f.args.sessionId)))?.workerTaskCleanupPending, true, 'cleanup success is not required for replacement admission');
});
for (const change of ['terminal-first', 'disabled', 'revoked', 'replacement'] as const) it(`R6F1 STOPPED respects ${change} output authority`, async () => {
  const f = await admittedBeforeAcquisition();
  const lease = await f.t.mutation(worker('acquireSession'), f.args), request = { ...f.args, epoch: lease.epoch };
  await f.t.mutation(worker('observeProgram'), { ...request, state: 'hold', outputMs: 1000, publishing: true });
  if (change === 'disabled') await f.t.run(({ db }) => db.patch(f.output.outputId, { state: 'disabled' }));
  if (change === 'revoked') process.env.VRDEX_VRCDN_OUTPUT_ACCOUNTS_JSON = '[]';
  if (change === 'terminal-first' || change === 'replacement') {
    await f.t.mutation(worker('observeProgram'), { ...request, state: 'ended', outputMs: 0, publishing: false });
    assert.equal((await f.t.run(({ db }) => db.get(f.output.programId)))?.activeSessionId, undefined);
  }
  let replacementRequest: any;
  if (change === 'replacement') {
    const scheduled = await f.owner.mutation(api.events.scheduleEventMediaWorker, { currentSlug: f.event.slug, outputKey: 'main', startImmediately: true });
    const acquired = await f.t.mutation(worker('acquireSession'), { ...f.args, sessionId: scheduled.sessionId, epoch: 0 });
    assert.equal(acquired.granted, true); replacementRequest = { ...f.args, sessionId: scheduled.sessionId, epoch: acquired.epoch };
    await f.t.mutation(worker('observeProgram'), { ...replacementRequest, state: 'live', outputMs: 2000, publishing: true });
  }
  const output = await f.t.run(({ db }) => db.get(f.output.outputId));
  const program = await f.t.run(({ db }) => db.get(f.output.programId));
  for (let i = 0; i < 2; i++) {
    assert.equal((await f.t.mutation(worker('recordProcessStatus'), { bridgeToken, sessionId: f.args.sessionId, taskArn: 'managed-task', stopped: true })).accepted, true);
    assert.deepEqual(await f.t.run(({ db }) => db.get(f.output.outputId)), output);
  }
  if (replacementRequest) {
    assert.deepEqual(await f.t.run(({ db }) => db.get(f.output.programId)), program);
    assert.equal((await f.t.mutation(worker('renewSession'), replacementRequest)).granted, true);
  }
});

for (const mismatch of ['event', 'program'] as const) it(`R6F1 STOPPED cannot reset a selected output with mismatched ${mismatch}`, async () => {
  const f = await admittedBeforeAcquisition();
  const other = await f.owner.mutation(api.events.createCommunityEvent, { title: 'Other event', communitySlug: 'club', startAt: Date.now() + 600000, timezone: 'UTC' });
  const foreign = await f.t.run(async ({ db }) => {
    const { _id, _creationTime, ...program } = (await db.get(f.output.programId))!;
    const otherProgram = await db.insert('eventMediaPrograms', { ...program, eventId: other.eventId, activeSessionId: undefined });
    const { _id: outputId, _creationTime: outputTime, ...output } = (await db.get(f.output.outputId))!;
    const id = await db.insert('eventMediaOutputs', { ...output, state: 'active', ...(mismatch === 'event' ? { eventId: other.eventId } : { programId: otherProgram }) });
    await db.patch(f.args.sessionId, { outputId: id }); return id;
  });
  const before = await f.t.run(({ db }) => db.get(foreign));
  await f.t.mutation(worker('recordProcessStatus'), { bridgeToken, sessionId: f.args.sessionId, taskArn: 'managed-task', stopped: true });
  assert.deepEqual(await f.t.run(({ db }) => db.get(foreign)), before);
  assert.equal((await f.t.run(({ db }) => db.get(f.args.sessionId)))?.workerTaskCleanupPending, true);
});

for (const type of ["switch_next", "next_slot"])
  for (const scenario of [
    { name: "gap slate", now: 35000, current: undefined, expected: "b" },
    {
      name: "after last slate",
      now: 60000,
      current: undefined,
      expected: undefined,
    },
    {
      name: "before first slate",
      now: 0,
      current: undefined,
      expected: "a",
      beforeFirst: true,
    },
    {
      name: "active interval slate",
      now: 1000,
      current: undefined,
      expected: "a",
    },
    {
      name: "synthetic manual in gap",
      now: 35000,
      current: "c",
      expected: "b",
    },
  ])
    it(`R7F2 ${type} from ${scenario.name} resolves current schedule`, async () => {
      const f = transactionalRuntime();
      f.config.currentSourceId = scenario.current;
      f.config.mode = scenario.current ? "manual" : "hold";
      f.ready.add("a");
      f.ready.add("b");
      f.ready.add("manual-c");
      f.setTime(scenario.now);
      if ("beforeFirst" in scenario) f.config.slots[0].startAt = 1000;
      await f.worker.start();
      await f.tick(scenario.now);
      f.command(type);
      await f.tick(scenario.now + 100);
      await f.tick(scenario.now + 200);
      assert.equal(
        f.acks.at(-1)?.outcome,
        scenario.expected ? "succeeded" : "failed",
      );
      assert.equal(f.acks.at(-1)?.observedSourceId, scenario.expected);
      assert.equal(f.rendered(), scenario.expected);
      await f.worker.stop();
    });

import * as workerFunctions from "../../convex/eventMediaWorker";
async function measuredWorker(
  f: Awaited<ReturnType<typeof fixture>>,
  name: keyof typeof workerFunctions,
  args: any,
) {
  let rows = 0;
  const queries: any[] = [];
  const result = await f.t.run(async (ctx) => {
    function queryProxy(query: any, entry: any): any {
      return new Proxy(query, {
        get(target, key) {
          if (["collect", "take", "first", "unique"].includes(String(key)))
            return async (...args: any[]) => {
              const value = await target[key](...args);
              const count = Array.isArray(value) ? value.length : value ? 1 : 0;
              rows += count;
              entry.rows += count;
              entry.operations.push(String(key));
              return value;
            };
          if (["withIndex", "filter", "order"].includes(String(key)))
            return (...args: any[]) => {
              if (key === "withIndex") entry.index = args[0];
              return queryProxy(target[key](...args), entry);
            };
          const value = Reflect.get(target, key);
          return typeof value === "function" ? value.bind(target) : value;
        },
      });
    }
    const db = new Proxy(ctx.db, {
      get(target, key) {
        if (key === "query")
          return (table: string) => {
            const entry = { table, rows: 0, index: undefined, operations: [] };
            queries.push(entry);
            return queryProxy(target.query(table as never), entry);
          };
        const value = Reflect.get(target, key);
        return typeof value === "function" ? value.bind(target) : value;
      },
    });
    return (workerFunctions[name] as any)._handler({ ...ctx, db }, args);
  });
  return { result, rows, queries };
}
it("R7F3 completed command history does not increase polling or acknowledgement reads", async () => {
  const f = await fixture();
  const lease = await f.t.mutation(worker("acquireSession"), f.args),
    request = { ...f.args, epoch: lease.epoch };
  await f.t.run(async ({ db }) => {
    await db.patch(f.scheduled.startCommandId!, { status: "succeeded" });
    for (let i = 0; i < 2000; i++)
      await db.insert("eventMediaCommands", {
        programId: f.output.programId,
        eventId: f.event.eventId,
        sessionId: f.args.sessionId,
        sequence: i + 2,
        commandType: "hold_current",
        status: "succeeded",
        actorSurface: "worker",
        publicFallbackLinks: [],
        createdAt: i,
        updatedAt: i,
      });
    await db.patch(f.args.sessionId, { nextCommandSequence: 2002 });
  });
  const queued = await f.owner.mutation(api.events.queueEventMediaCommand, {
    currentSlug: f.event.slug,
    type: "hold_current",
  });
  const claimed = await measuredWorker(f, "claimCommands", request);
  assert.equal(claimed.result.commands.length, 1);
  assert.equal(claimed.result.commands[0]._id, queued.commandId);
  assert(claimed.rows < 100, `poll read ${claimed.rows} rows`);
  const ack = await measuredWorker(f, "acknowledgeCommand", {
    ...request,
    commandId: queued.commandId,
    sequence: claimed.result.commands[0].sequence,
    outcome: "succeeded",
  });
  assert.equal(ack.result.accepted, true);
  assert(ack.rows < 10, `ack read ${ack.rows} rows`);
});
it("R7F4 acquisition ignores large terminal and expired nonterminal histories", async () => {
  const f = await fixture();
  await f.t.run(async ({ db }) => {
    for (let i = 0; i < 2000; i++)
      await db.insert("eventMediaSessions", {
        programId: f.output.programId,
        eventId: f.event.eventId,
        status: i % 3 === 0 ? "ended" : i % 3 === 1 ? "error" : "starting",
        leaseExpiresAt: i % 3 === 2 ? Date.now() - 1000 : Date.now() + 60000,
        createdAt: i,
        updatedAt: i,
      });
  });
  const measured = await measuredWorker(f, "acquireSession", f.args);
  assert.equal(measured.result.granted, true);
  assert(measured.rows < 50, `acquire read ${measured.rows} rows`);
});

for (const scenario of [
  "ended-current",
  "unavailable-current",
  "removed-current",
  "unavailable-active",
  "empty",
] as const)
  it(`R7F2 Next handles ${scenario} without replaying expired first slot`, async () => {
    const f = transactionalRuntime();
    f.ready.add("b");
    f.setTime(35000);
    if (scenario === "unavailable-active") {
      f.config.mode = "hold";
      f.config.currentSourceId = undefined;
      f.config.slots[0].endAt = 39000;
      f.config.slots[0].available = false;
    }
    await f.worker.start();
    if (scenario === "unavailable-current") f.config.slots[0].available = false;
    if (scenario === "removed-current") f.config.slots.shift();
    if (scenario === "empty") f.config.slots = [];
    await f.tick(35000);
    f.command("next_slot");
    await f.tick(35100);
    await f.tick(35200);
    assert.equal(
      f.acks.at(-1)?.outcome,
      scenario === "empty" ? "failed" : "succeeded",
    );
    if (scenario !== "empty") {
      assert.equal(f.acks.at(-1).observedSourceId, "b");
      assert.equal(f.rendered(), "b");
    }
    await f.worker.stop();
  });
for (const type of ["previous_slot", "switch_previous"])
  it(`R7F2 ${type} from slate fails without selecting a future or expired slot`, async () => {
    const f = transactionalRuntime();
    f.config.mode = "hold";
    f.config.currentSourceId = undefined;
    f.setTime(35000);
    await f.worker.start();
    await f.tick(35000);
    f.command(type);
    await f.tick(35100);
    assert.equal(f.acks.at(-1)?.outcome, "failed");
    assert.equal(f.rendered(), undefined);
    await f.worker.stop();
  });
it("R7F2 failed Next from gap keeps slate until an explicit successful retry", async () => {
  const f = transactionalRuntime();
  f.config.mode = "hold";
  f.config.currentSourceId = undefined;
  f.setTime(35000);
  await f.worker.start();
  await f.tick(35000);
  f.command("switch_next");
  await f.tick(35100);
  for (let time = 36100; time <= 51100; time += 1000) await f.tick(time);
  assert.equal(f.acks.at(-1)?.outcome, "failed");
  assert.equal(f.rendered(), undefined);
  assert.equal(f.worker.getState().mode, "hold");
  f.ready.add("b");
  await f.tick(51200);
  assert.equal(f.rendered(), undefined);
  // Extend the authored future slot to exercise retry rather than after-last failure.
  f.config.slots[1].startAt = 60000;
  f.config.slots[1].endAt = 70000;
  f.command("next_slot");
  await f.tick(51300);
  await f.tick(51400);
  assert.equal(f.acks.at(-1)?.observedSourceId, "b");
  assert.equal(f.rendered(), "b");
  await f.worker.stop();
});
it("R7F3 bounded legacy and sessionless attachment drains oldest intent before new commands", async () => {
  const f = await fixture();
  const lease = await f.t.mutation(worker("acquireSession"), f.args),
    request = { ...f.args, epoch: lease.epoch };
  const ids = await f.t.run(async ({ db }) => {
    await db.patch(f.scheduled.startCommandId!, { status: "succeeded" });
    const result = [];
    for (let i = 0; i < 95; i++)
      result.push(
        await db.insert("eventMediaCommands", {
          programId: f.output.programId,
          eventId: f.event.eventId,
          sessionId: i % 2 ? f.args.sessionId : undefined,
          commandType: "hold_current",
          status: i % 3 ? "queued" : "claimed",
          actorSurface: "worker",
          publicFallbackLinks: [],
          createdAt: i,
          updatedAt: i,
        }),
      );
    return result;
  });
  const newer = await f.owner.mutation(api.events.queueEventMediaCommand, {
    currentSlug: f.event.slug,
    type: "set_automatic_mode",
  });
  assert.equal(
    (await f.t.run(({ db }) => db.get(newer.commandId)))?.sequence,
    undefined,
    "new intent waits behind migration backlog",
  );
  const seen: string[] = [];
  let last = 0;
  for (let poll = 0; poll < 8; poll++) {
    const measured = await measuredWorker(f, "claimCommands", request);
    assert(measured.rows <= 125, `poll read ${measured.rows} rows`);
    assert(measured.result.commands.length <= 20);
    for (const command of measured.result.commands) {
      assert(command.sequence > last);
      last = command.sequence;
      seen.push(command._id);
      const ack = await measuredWorker(f, "acknowledgeCommand", {
        ...request,
        commandId: command._id,
        sequence: command.sequence,
        outcome: "succeeded",
      });
      assert.equal(ack.result.accepted, true);
      assert(ack.rows < 10);
    }
  }
  assert.deepEqual(seen, [...ids, newer.commandId]);
  assert.equal(
    (await f.t.mutation(worker("claimCommands"), request)).commands.length,
    0,
  );
});
it("R7F3 future pending head blocks later claims and earlier pending rows block out-of-order acknowledgements", async () => {
  const f = await fixture();
  const lease = await f.t.mutation(worker("acquireSession"), f.args),
    request = { ...f.args, epoch: lease.epoch };
  const ids = await f.t.run(async ({ db }) => {
    await db.patch(f.scheduled.startCommandId!, { status: "succeeded" });
    const base = {
      programId: f.output.programId,
      eventId: f.event.eventId,
      sessionId: f.args.sessionId,
      commandType: "hold_current",
      status: "queued" as const,
      actorSurface: "worker" as const,
      publicFallbackLinks: [],
      createdAt: 0,
      updatedAt: 0,
    };
    return [
      await db.insert("eventMediaCommands", {
        ...base,
        sequence: 2,
        availableAt: Date.now() + 60000,
      }),
      await db.insert("eventMediaCommands", { ...base, sequence: 3 }),
    ];
  });
  assert.equal(
    (await measuredWorker(f, "claimCommands", request)).result.commands.length,
    0,
  );
  await f.t.run(({ db }) => db.patch(ids[0], { availableAt: 0 }));
  const claimed = (await measuredWorker(f, "claimCommands", request)).result
    .commands;
  assert.deepEqual(
    claimed.map((c: any) => c._id),
    ids,
  );
  assert.deepEqual(
    (await f.t.mutation(worker("claimCommands"), request)).commands.map(
      (c: any) => c._id,
    ),
    ids,
    "unacknowledged batch replays in order",
  );
  const ack = (index: number) =>
    measuredWorker(f, "acknowledgeCommand", {
      ...request,
      commandId: ids[index],
      sequence: index + 2,
      outcome: "succeeded",
    });
  assert.equal((await ack(1)).result.accepted, false);
  assert.equal((await ack(0)).result.accepted, true);
  assert.equal((await ack(1)).result.accepted, true);
});
for (const status of [
  "scheduled",
  "starting",
  "live",
  "hold",
  "fallback",
  "stopping",
] as const)
  it(`R7F4 bounded ${status} siblings exclude an unexpired owner despite inconsistent pointer`, async () => {
    const f = await fixture();
    const siblings = await f.t.run(async ({ db }) => {
      const ids = [];
      for (let i = 0; i < 25; i++)
        ids.push(
          await db.insert("eventMediaSessions", {
            programId: f.output.programId,
            eventId: f.event.eventId,
            status,
            workerId: `sibling-${i}`,
            epoch: 1,
            leaseExpiresAt: Date.now() + 60000,
            createdAt: i,
            updatedAt: i,
          }),
        );
      await db.patch(f.output.programId, { activeSessionId: f.args.sessionId });
      return ids;
    });
    const denied = await measuredWorker(f, "acquireSession", f.args);
    assert.equal(denied.result.granted, false);
    assert(denied.rows < 20);
    await f.t.run(async ({ db }) => {
      for (const id of siblings)
        await db.patch(id, { leaseExpiresAt: Date.now() - 1 });
    });
    const allowed = await measuredWorker(f, "acquireSession", f.args);
    assert.equal(allowed.result.granted, true);
    assert(allowed.rows < 50);
  });

for(const edit of ['remove','replace','replace-source','reorder','gap','before-first','after-last','unavailable']) it(`R8 automatic established current handles ${edit} without replaying expired C`,async()=>{
 const f=transactionalRuntime();f.config.mode='automatic';f.config.currentSourceId=undefined;
 f.config.slots[0].endAt=90000;f.config.slots[1].startAt=95000;f.config.slots[1].endAt=100000;
 f.ready.add('c');f.ready.add('b');
 await f.worker.start();await f.tick(1000);await f.tick(2000);await f.tick(3000);
 assert.equal(f.worker.getState().current?.sourceId,'a');assert.equal(f.rendered(),'a');
 const expired={slotKey:'c',sourceId:'c',startAt:-30000,endAt:-10000,available:true};
 const b={...f.config.slots[1],startAt:0,endAt:80000};
 f.config.slots=[expired,b];
 if(edit==='replace')f.config.slots[1]={...b,slotKey:'replacement'};
 if(edit==='replace-source')f.config.slots[1]={...b,slotKey:'a'};
 if(edit==='reorder')f.config.slots=[b,expired];
 if(edit==='gap'||edit==='before-first'){f.config.slots[1].startAt=10000;if(edit==='before-first')f.config.slots.shift();}
 if(edit==='after-last')f.config.slots=[expired];
 if(edit==='unavailable')f.config.slots[1].available=false;
 // Replacement has the same source ID but a distinct real slot key.
 if(edit==='replace')f.ready.add('replacement');
 await f.tick(4000);await f.tick(5000);await f.tick(6000);
 if(['gap','before-first','after-last','unavailable'].includes(edit))assert.equal(f.rendered(),undefined);
 else assert.equal(f.worker.getState().current?.sourceId,'b');
 assert.notEqual(f.rendered(),'c');
 if(edit==='gap'||edit==='before-first'){await f.tick(9999);assert.equal(f.rendered(),undefined);await f.tick(10000);await f.tick(11000);assert.equal(f.worker.getState().current?.sourceId,'b');}
 await f.worker.stop();
});

async function prelaunchFixture(){
 const f=await fixture();
 const claimed=await f.t.mutation(api.events.claimEventMediaWorkerCommand,{bridgeToken,workerId:'bridge'});assert.ok(claimed);
 const identity={bridgeToken,eventId:f.event.eventId,sessionId:f.args.sessionId,dispatchId:'prelaunch',commandId:claimed.commandId,workerId:'bridge'};
 await f.t.mutation(worker('admitDispatch'),{bridgeToken,eventId:f.event.eventId,sessionId:f.args.sessionId,dispatchId:identity.dispatchId,launchProtocol:'fenced-v1'});
 return {...f,identity};
}
for(const first of ['marker','release','concurrent'])it(`R8 prelaunch ${first} has exactly one winner and real capacity follows`,async()=>{
 const f=await prelaunchFixture();
 const marker=()=>f.t.mutation(worker('markLaunchAttempt'),{...f.identity,taskDefinitionArn:'definition'});
 const release=()=>f.t.mutation(worker('releaseUnlaunchedDispatch'),f.identity);
 const results=first==='concurrent'?await Promise.all([marker(),release()]):first==='marker'?[await marker(),await release()]:[await release(),await marker()];
 assert.equal(results.filter(r=>r.accepted).length,1);
 const session=await f.t.run(({db})=>db.get(f.args.sessionId));
 if(session?.dispatchId){assert.ok(session.launchAttemptedAt);assert.equal((await marker()).accepted,false);assert.equal((await release()).accepted,false);}
 else{assert.equal(session?.status,'error');assert.equal(session?.dispatchStopConfirmedAt,undefined);const next=await f.owner.mutation(api.events.scheduleEventMediaWorker,{currentSlug:f.event.slug});assert.equal((await f.t.mutation(worker('admitDispatch'),{bridgeToken,eventId:f.event.eventId,sessionId:next.sessionId,dispatchId:'replacement'})).granted,true);}
});
for(const failure of ['config','register'])it(`R8 actual bridge ${failure} failure releases provably unlaunched admission`,async()=>{
 const f=await fixture();const calls:string[]=[];
 await claimAndProcess({mutation:(ref:any,args:any)=>f.t.mutation(ref,args)},{bridgeToken,workerId:'bridge',redactValues:[],secretRefMap:failure==='config'?{}:{'event-media/vrcdn/main':'test-secret'},baseEnvironment:{}},async(_config:any,args:string[])=>{calls.push(args[1]);throw Error('synthetic registration failure');});
 const session=await f.t.run(({db})=>db.get(f.args.sessionId));assert.equal(session?.dispatchId,undefined);assert.equal(session?.status,'error');assert.equal(session?.dispatchStopConfirmedAt,undefined);assert(!calls.includes('run-task'));assert.equal(calls.includes('register-task-definition'),failure==='register');
 const next=await f.owner.mutation(api.events.scheduleEventMediaWorker,{currentSlug:f.event.slug});assert.equal((await f.t.mutation(worker('admitDispatch'),{bridgeToken,eventId:f.event.eventId,sessionId:next.sessionId,dispatchId:'replacement'})).granted,true);
});

it('R8 healthy automatic current overruns with decoded ready successor until confirmed media death',async()=>{
 const f=transactionalRuntime();f.config.mode='automatic';f.config.currentSourceId=undefined;f.ready.add('b');
 await f.worker.start();await f.tick(1000);await f.tick(2000);assert.equal(f.rendered(),'a');
 for(let time=5000;time<=40000;time+=5000)await f.tick(time);await f.tick(41000);await f.tick(42000);assert.equal(f.worker.getState().current?.sourceId,'a');assert.equal(f.rendered(),'a');assert(f.prepared().includes('b'));
 f.ready.delete('a');f.failures.set('a',43000);await f.tick(43000);await f.tick(43999);assert.equal(f.worker.getState().current?.sourceId,'a');
 await f.tick(44000);assert.equal(f.worker.getState().current?.sourceId,'b');assert.equal(f.rendered(),'b');await f.worker.stop();
});
for(const mismatch of ['event','session','dispatch','owner','command','epoch','arn','old','replacement'])it(`R8 prelaunch denies ${mismatch} identity or authority`,async()=>{
 const f=await prelaunchFixture();const identity={...f.identity};
 if(mismatch==='event')identity.eventId=(await f.owner.mutation(api.events.createCommunityEvent,{title:'Other',communitySlug:'club',startAt:Date.now()+600000,timezone:'UTC'})).eventId;
 if(mismatch==='session')identity.sessionId=await f.t.run(async({db})=>{const {_id,_creationTime,...row}=(await db.get(f.args.sessionId))!;return db.insert('eventMediaSessions',row);});
 if(mismatch==='dispatch')identity.dispatchId='other';if(mismatch==='owner')identity.workerId='replacement';
 if(mismatch==='command')identity.commandId=(await f.owner.mutation(api.events.queueEventMediaCommand,{currentSlug:f.event.slug,type:'hold_current'})).commandId;
 if(mismatch==='epoch')await f.t.run(({db})=>db.patch(f.args.sessionId,{epoch:1}));
 if(mismatch==='arn')await f.t.run(({db})=>db.patch(f.args.sessionId,{workerTaskId:'already-task'}));
 if(mismatch==='old')await f.t.run(({db})=>db.patch(f.args.sessionId,{launchProtocol:undefined}));
 if(mismatch==='replacement')await f.t.run(({db})=>db.patch(f.output.programId,{activeSessionId:undefined}));
 assert.equal((await f.t.mutation(worker('markLaunchAttempt'),{...identity,taskDefinitionArn:'definition'})).accepted,false);
 assert.equal((await f.t.mutation(worker('releaseUnlaunchedDispatch'),identity)).accepted,false);
 assert.equal((await f.t.run(({db})=>db.get(f.args.sessionId)))?.dispatchId,'prelaunch');
});
for(const loss of ['before','after','malformed','unknown','run','record'])it(`R8 actual bridge ambiguous ${loss} retains reservation and never releases`,async()=>{
 const f=await fixture();let runs=0,releases=0;
 const client={mutation:async(ref:any,args:any)=>{
  const name=getFunctionName(ref);
  if(name==='eventMediaWorker:releaseUnlaunchedDispatch')releases++;
  if(name==='eventMediaWorker:markLaunchAttempt'){
   if(loss==='before')throw Error('not sent');
   if(loss==='unknown')return {};
   const result=await f.t.mutation(ref,args);
   if(loss==='after')throw Error('committed response lost');
   if(loss==='malformed')return {accepted:'true'};
   return result;
  }
  if(name==='eventMediaWorker:recordDispatchedTask'&&loss==='record'){await f.t.mutation(ref,args);throw Error('record response lost');}
  return f.t.mutation(ref,args);
 }};
 await claimAndProcess(client,{bridgeToken,workerId:'bridge',redactValues:[],secretRefMap:{'event-media/vrcdn/main':'test-secret'},baseEnvironment:{}},async(_config:any,args:string[])=>{
  if(args[1]==='register-task-definition')return {taskDefinition:{taskDefinitionArn:'definition'}};
  assert.equal(args[1],'run-task');runs++;if(loss==='run')throw Error('RunTask response unknown');return {tasks:[{taskArn:'task'}]};
 });
 const session=await f.t.run(({db})=>db.get(f.args.sessionId));assert.ok(session?.dispatchId);assert.equal(releases,0);assert.equal(runs,['run','record'].includes(loss)?1:0);assert.equal(session?.workerTaskId,loss==='record'?'task':undefined);
});
it('R8 Stop before marker releases and durable cleanup retries without capacity leak',async()=>{
 const f=await fixture();let cleanup=0;
 const client={mutation:(ref:any,args:any)=>f.t.mutation(ref,args),query:(ref:any,args:any)=>f.t.query(ref,args)};
 await claimAndProcess(client,{bridgeToken,workerId:'bridge',redactValues:[],secretRefMap:{'event-media/vrcdn/main':'test-secret'},baseEnvironment:{}},async(_config:any,args:string[])=>{
  if(args[1]==='register-task-definition'){await f.owner.mutation(api.events.stopEventMediaWorker,{currentSlug:f.event.slug,sessionId:f.args.sessionId});return {taskDefinition:{taskDefinitionArn:'unused-definition'}};}
  assert.equal(args[1],'deregister-task-definition');cleanup++;throw Error('cleanup unavailable');
 });
 const session=await f.t.run(({db})=>db.get(f.args.sessionId));assert.equal(session?.dispatchId,undefined);assert.equal(session?.workerTaskCleanupPending,true);assert.equal(cleanup,1);
 await refreshSessions(client,{bridgeToken,workerId:'bridge'},async(_config:any,args:string[])=>{assert.equal(args[1],'deregister-task-definition');cleanup++;return {};});
 assert.equal(cleanup,2);assert.equal((await f.t.run(({db})=>db.get(f.args.sessionId)))?.workerTaskCleanupPending,false);
});

it('R8 reclaimed competing bridges issue exactly one RunTask and never overwrite winner definition',async()=>{
 const f=await fixture();let calls=0,firstRelease:()=>void=()=>{};const firstHeld=new Promise<void>(resolve=>{firstRelease=resolve;});let firstRegistered:()=>void=()=>{};const registered=new Promise<void>(resolve=>{firstRegistered=resolve;});const deregistered:string[]=[];
 const client={mutation:(ref:any,args:any)=>f.t.mutation(ref,args)};
 const config={bridgeToken,workerId:'first',redactValues:[],secretRefMap:{'event-media/vrcdn/main':'test-secret'},baseEnvironment:{}};
 const runAws=async(_config:any,args:string[])=>{
  if(args[1]==='register-task-definition'){
   if(_config.workerId==='first'){firstRegistered();await firstHeld;return {taskDefinition:{taskDefinitionArn:'arn:aws:ecs:us-east-1:123456789012:task-definition/unused:1'}};}
   return {taskDefinition:{taskDefinitionArn:'winner-definition'}};
  }
  if(args[1]==='deregister-task-definition'){deregistered.push(args.at(-1)!);throw Error('unused cleanup failure');}
  assert.equal(args[1],'run-task');calls++;return {tasks:[{taskArn:'winner-task'}]};
 };
 const first=claimAndProcess(client,config,runAws);await registered;
 await f.t.run(({db})=>db.patch(f.scheduled.startCommandId!,{status:'queued'}));
 await claimAndProcess(client,{...config,workerId:'second'},runAws);
 firstRelease();await first;
 const session=await f.t.run(({db})=>db.get(f.args.sessionId));assert.equal(calls,1);assert.equal(session?.workerTaskDefinitionArn,'winner-definition');assert.equal(session?.workerTaskId,'winner-task');assert.deepEqual(deregistered,['arn:aws:ecs:us-east-1:123456789012:task-definition/unused:1']);
 const audits=await f.t.run(({db})=>db.query('eventMediaAuditEvents').collect());assert(audits.some(a=>a.action==='worker_unused_definition_manual_cleanup'&&a.privateSummary==='arn:aws:ecs:us-east-1:123456789012:task-definition/unused:1'));
});
it('R8 duplicate marker with same definition never deregisters winner',async()=>{
 const f=await fixture();let releases=0,runs=0;
 const client={mutation:async(ref:any,args:any)=>{if(getFunctionName(ref)==='eventMediaWorker:markLaunchAttempt'){await f.t.mutation(ref,args);return f.t.mutation(ref,args);}return f.t.mutation(ref,args);}};
 await claimAndProcess(client,{bridgeToken,workerId:'bridge',redactValues:[],secretRefMap:{'event-media/vrcdn/main':'test-secret'},baseEnvironment:{}},async(_config:any,args:string[])=>{if(args[1]==='register-task-definition')return {taskDefinition:{taskDefinitionArn:'winner-definition'}};if(args[1]==='deregister-task-definition')releases++;else runs++;return {};});
 assert.equal(releases,0);assert.equal(runs,0);assert.equal((await f.t.run(({db})=>db.get(f.args.sessionId)))?.workerTaskDefinitionArn,'winner-definition');
});
it('R8 unused-definition audit refuses arbitrary provider text and winner ARN',async()=>{
 const f=await prelaunchFixture();
 for(const taskDefinitionArn of ['secret-like-provider-exception','x'.repeat(513)])assert.equal((await f.t.mutation(worker('recordUnusedDefinitionCleanup'),{bridgeToken,sessionId:f.args.sessionId,taskDefinitionArn})).accepted,false);
 assert.equal((await f.t.run(({db})=>db.query('eventMediaAuditEvents').collect())).filter(a=>a.action==='worker_unused_definition_manual_cleanup').length,0);
});
