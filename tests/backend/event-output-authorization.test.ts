import assert from 'node:assert/strict';
import { it, afterEach } from 'node:test';
import { convexTest } from 'convex-test';
import { makeFunctionReference } from 'convex/server';
import { api } from '../../convex/_generated/api';
import schemaModule from '../../convex/schema';
import { newClerkUserId } from './_clerkTestIdentity';
const schema = (schemaModule as unknown as { default?: typeof schemaModule }).default ?? schemaModule;
const modules = {
  '../../convex/_generated/api.ts': () => import('../../convex/_generated/api'),
  '../../convex/events.ts': () => import('../../convex/events'),
  '../../convex/eventMediaWorker.ts': () => import('../../convex/eventMediaWorker'),
};
const bridgeToken = 'destination-test-only';
const worker = (name: string) => makeFunctionReference<'mutation'>(`eventMediaWorker:${name}`);
const prior = process.env.VRDEX_VRCDN_OUTPUT_ACCOUNTS_JSON;
afterEach(() => { if (prior === undefined) delete process.env.VRDEX_VRCDN_OUTPUT_ACCOUNTS_JSON; else process.env.VRDEX_VRCDN_OUTPUT_ACCOUNTS_JSON = prior; });
const consent = { sourceConsentAccepted: true, destinationAuthorityAccepted: true, providerRulesAccepted: true, rightsClearedMediaAccepted: true };
async function fixture() {
  process.env.VRDEX_EVENT_MEDIA_BRIDGE_TOKEN = bridgeToken;
  const t = convexTest({ schema, modules });
  async function community(slug: string) {
    const subject = newClerkUserId();
    const id = await t.run(async ({ db }) => {
      const now = Date.now();
      const userId = await db.insert('users', { clerkUserId: subject, name: slug, email: `${slug}@example.test`, emailVerificationTime: now });
      const profileId = await db.insert('profiles', { slug, displayName: slug, sortName: slug, aliases: [], tags: [], claimState: 'claimed_verified', publicationState: 'published', publicSurfacingState: 'public', creationSource: 'self', updatedAt: now, profileType: 'community', community: { categoryTags: [] } });
      await db.insert('profileOwners', { profileId, userId, roleKey: 'owner', state: 'active', grantedAt: now, updatedAt: now });
      return profileId;
    });
    const actor = t.withIdentity({ subject, emailVerified: true, issuer: 'test', tokenIdentifier: `test|${subject}` });
    const event = await actor.mutation(api.events.createCommunityEvent, { title: `${slug} event`, communitySlug: slug, startAt: Date.now() + 600000, timezone: 'UTC' });
    return { id, actor, event };
  }
  const a = await community('owner-a'), b = await community('owner-b');
  const account = { key: 'basicbit', label: 'Owned account', credentialRef: 'event-media/vrcdn/basicbit-output', ownerCommunityProfileId: a.id, playbackLinks: [{ platform: 'browser' as const, url: 'https://stream.vrcdn.live/live/basicbit.live.ts' }] };
  process.env.VRDEX_VRCDN_OUTPUT_ACCOUNTS_JSON = JSON.stringify([account]);
  const setup = { currentSlug: b.event.slug, key: 'main', label: 'Main', outputAccountKey: account.key, ...consent };
  async function schedule(actor = a.actor, event = a.event) {
    const session = await actor.mutation(api.events.scheduleEventMediaWorker, { currentSlug: event.slug });
    await t.run(async ({db}) => { await db.patch(session.sessionId, { scheduledStartAt: Date.now() - 1 }); if (session.startCommandId) await db.patch(session.startCommandId, { availableAt: Date.now() - 1 }); });
    return { ...session, args: { bridgeToken, eventId: event.eventId, sessionId: session.sessionId, workerId: 'test-worker', epoch: 0 } };
  }
  return { t, a, b, account, setup, schedule };
}
it('an unrelated community cannot configure the global VRCDN key and dispatch its deployment credential', async () => {
  const f = await fixture();
  let rejected = false;
  try { await f.b.actor.mutation(api.events.configureVrcdnOutput, f.setup); } catch (error) { assert.match(String(error), /not authorized/); rejected = true; }
  if (!rejected) {
    await f.schedule(f.b.actor, f.b.event);
    const dispatched = await f.t.mutation(api.events.claimEventMediaWorkerCommand, { bridgeToken, workerId: 'unauthorized-bridge' });
    assert.equal(dispatched, null, 'Unrelated community reached deployment credential dispatch');
  }
  assert.equal(rejected, true, 'Cross-community setup must be rejected before ready state');
});
it('direct credential references cannot bypass community destination ownership', async () => {
  const f = await fixture();
  await assert.rejects(f.b.actor.mutation(api.events.configureVrcdnOutput, { ...f.setup, outputAccountKey: undefined, credentialRef: f.account.credentialRef }), /not authorized/);
});
it('VRCDN listing requires event capability and filters owner/grants without exposing refs', async () => {
  const f = await fixture();
  assert.deepEqual(await f.t.query(api.events.listVrcdnOutputAccounts, {}), []);
  await assert.rejects(f.t.query(api.events.listVrcdnOutputAccounts, { currentSlug: f.a.event.slug }));
  await assert.rejects(f.b.actor.query(api.events.listVrcdnOutputAccounts, { currentSlug: f.a.event.slug }));
  assert.deepEqual(await f.b.actor.query(api.events.listVrcdnOutputAccounts, { currentSlug: f.b.event.slug }), []);
  const listed = await f.a.actor.query(api.events.listVrcdnOutputAccounts, { currentSlug: f.a.event.slug });
  assert.equal(listed[0].key, 'basicbit');
  assert.equal(JSON.stringify(listed).includes('credentialRef'), false);
  assert.equal(JSON.stringify(listed).includes(f.a.id), false);
  process.env.VRDEX_VRCDN_OUTPUT_ACCOUNTS_JSON = JSON.stringify([{ ...f.account, authorizedCommunityProfileIds: [f.b.id] }]);
  assert.equal((await f.b.actor.query(api.events.listVrcdnOutputAccounts, { currentSlug: f.b.event.slug })).length, 1);
  await f.b.actor.mutation(api.events.configureVrcdnOutput, f.setup);
  await f.b.actor.mutation(api.events.configureVrcdnOutput, { ...f.setup, outputAccountKey: undefined, credentialRef: f.account.credentialRef });
  await assert.rejects(f.b.actor.mutation(api.events.configureVrcdnOutput, { ...f.setup, credentialRef: 'unbound-reference' }), /not authorized/);
});
it('unbound, malformed and duplicate registry entries fail closed, including persisted ready outputs', async () => {
  const f = await fixture();
  for (const registry of [undefined, 'invalid-json', JSON.stringify([{ ...f.account, ownerCommunityProfileId: undefined }]), JSON.stringify([f.account, f.account])]) {
    if (registry === undefined) delete process.env.VRDEX_VRCDN_OUTPUT_ACCOUNTS_JSON; else process.env.VRDEX_VRCDN_OUTPUT_ACCOUNTS_JSON = registry;
    assert.deepEqual(await f.a.actor.query(api.events.listVrcdnOutputAccounts, { currentSlug: f.a.event.slug }), []);
    await assert.rejects(f.a.actor.mutation(api.events.configureVrcdnOutput, { ...f.setup, currentSlug: f.a.event.slug }));
  }
});
it('revoked VRCDN entitlement denies every publication path while Stop remains available', async () => {
  const f = await fixture();
  process.env.VRDEX_VRCDN_OUTPUT_ACCOUNTS_JSON = JSON.stringify([{ ...f.account, authorizedCommunityProfileIds: [f.b.id] }]);
  const configured = await f.b.actor.mutation(api.events.configureVrcdnOutput, f.setup);
  const session = await f.schedule(f.b.actor, f.b.event);
  const lease = await f.t.mutation(worker('acquireSession'), session.args);
  assert.equal(lease.granted, true);
  const request = { ...session.args, epoch: lease.epoch };
  await f.t.run(({db}) => db.patch(session.sessionId, { workerTaskId: 'synthetic-task', workerTaskStatus: 'running' }));
  const claim = await f.t.mutation(worker('claimCommands'), request);
  assert.ok(claim.commands[0]);
  process.env.VRDEX_VRCDN_OUTPUT_ACCOUNTS_JSON = JSON.stringify([f.account]);
  assert.equal((await f.t.run(({db}) => db.get(configured.outputId)))?.state, 'ready');
  await assert.rejects(f.b.actor.mutation(api.events.scheduleEventMediaWorker, { currentSlug: f.b.event.slug }), /not authorized/);
  assert.equal(await f.t.mutation(api.events.claimEventMediaWorkerCommand, { bridgeToken, workerId: 'revoked-bridge' }), null);
  assert.equal((await f.t.mutation(worker('admitDispatch'), { bridgeToken, eventId: f.b.event.eventId, sessionId: session.sessionId, dispatchId: 'revoked' })).granted, false);
  for (const name of ['acquireSession', 'renewSession', 'refreshConfiguration', 'claimCommands']) assert.equal((await f.t.mutation(worker(name), request)).granted, false, name);
  assert.equal((await f.t.mutation(worker('acknowledgeCommand'), { ...request, commandId: claim.commands[0]._id, sequence: claim.commands[0].sequence, outcome: 'succeeded', observedState: 'hold' })).accepted, false);
  assert.equal((await f.t.mutation(worker('observeProgram'), { ...request, state: 'hold', outputMs: 1000, publishing: true, outputId: configured.outputId })).accepted, false);
  assert.equal((await f.t.mutation(worker('observeOutputs'), { ...request, destinations: [{ outputId: configured.outputId, destination: 'vrcdn', status: 'publishing', publishing: true, queueBytes: 0, outputMs: 1000, restarts: 0 }] })).accepted, false);
  await f.b.actor.mutation(api.events.stopEventMediaWorker, { currentSlug: f.b.event.slug, sessionId: session.sessionId });
  const pendingStops = await f.t.run(({db}) => db.query('eventMediaCommands').filter(q => q.eq(q.field('commandType'), 'stop_program')).collect());
  assert.equal(pendingStops.length, 1);
  assert.equal((await f.t.run(({db}) => db.get(session.sessionId)))?.status, 'stopping');
});
it('legacy ready VRCDN output cannot acquire or dispatch after registry removal before worker startup', async () => {
  const f = await fixture();
  await f.a.actor.mutation(api.events.configureVrcdnOutput, { ...f.setup, currentSlug: f.a.event.slug, outputAccountKey: undefined, credentialRef: f.account.credentialRef });
  const session = await f.schedule();
  delete process.env.VRDEX_VRCDN_OUTPUT_ACCOUNTS_JSON;
  assert.equal((await f.t.mutation(worker('admitDispatch'), { bridgeToken, eventId: f.a.event.eventId, sessionId: session.sessionId, dispatchId: 'legacy' })).granted, false);
  assert.equal((await f.t.mutation(worker('acquireSession'), session.args)).granted, false);
  assert.equal(await f.t.mutation(api.events.claimEventMediaWorkerCommand, { bridgeToken, workerId: 'legacy-bridge' }), null);
  await f.a.actor.mutation(api.events.stopEventMediaWorker, { currentSlug: f.a.event.slug, sessionId: session.sessionId });
  assert.equal((await f.t.mutation(api.events.claimEventMediaWorkerCommand, { bridgeToken, workerId: 'legacy-cleanup' }))?.commandType, 'stop_program');
});

it('revoked managed VRCDN and Twitch links disappear from public metadata without removing authored fallback', async () => {
  for (const destination of ['vrcdn', 'twitch']) {
    const f = await fixture();
    await f.t.run(({db}) => db.patch(f.a.event.eventId, { publicationState: 'published', mediaLinks: [{ label: 'Direct fallback', url: 'https://example.test/direct', type: 'stream', presentation: 'open' }] }));
    process.env.VRDEX_TWITCH_OUTPUT_ACCOUNTS_JSON = JSON.stringify([{ key: 'twitch-owned', channel: 'owned_channel', credentialRef: 'event-media/twitch/owned', ownerCommunityProfileId: f.a.id }]);
    const output = destination === 'vrcdn'
      ? await f.a.actor.mutation(api.events.configureVrcdnOutput, { ...f.setup, currentSlug: f.a.event.slug })
      : await f.a.actor.mutation(api.events.configureTwitchOutput, { currentSlug: f.a.event.slug, key: 'twitch', label: 'Twitch', channel: 'owned_channel', outputAccountKey: 'twitch-owned', ...consent });
    await f.t.run(async ({db}) => { const row = await db.get(output.outputId); assert.ok(row); await db.patch(output.programId, { state: 'ready', currentOutputId: row._id, publicLinks: row.playbackLinks }); });
    const before = await f.t.query(api.events.getPublicBySlug, { slug: f.a.event.slug });
    assert.ok(before && before.mediaLinks.length > 1);
    process.env.VRDEX_VRCDN_OUTPUT_ACCOUNTS_JSON = '[]';
    process.env.VRDEX_TWITCH_OUTPUT_ACCOUNTS_JSON = '[]';
    const after = await f.t.query(api.events.getPublicBySlug, { slug: f.a.event.slug });
    assert.deepEqual(after?.mediaLinks.map(link => link.url), ['https://example.test/direct']);
    await f.t.run(({db}) => db.patch(output.programId, { currentOutputId: undefined }));
    const staleCache = await f.t.query(api.events.getPublicBySlug, { slug: f.a.event.slug });
    assert.deepEqual(staleCache?.mediaLinks.map(link => link.url), ['https://example.test/direct']);
  }
});

it('F4 public projection hides disabled optional Twitch but preserves enabled and selected legacy output', async () => {
  const f = await fixture();
  await f.t.run(({db}) => db.patch(f.a.event.eventId, { publicationState: 'published', mediaLinks: [{ label: 'Direct', url: 'https://example.test/direct', type: 'stream', presentation: 'open' }] }));
  await f.a.actor.mutation(api.events.configureVrcdnOutput, { ...f.setup, currentSlug: f.a.event.slug, playbackLinks: [{ platform: 'pc', url: 'vrcdn:basicbit' }, { platform: 'standalone', url: 'vrcdn:basicbit' }] });
  const baseline = (await f.t.query(api.events.getPublicBySlug, { slug: f.a.event.slug }))!.mediaLinks;
  const primary = await f.t.run(({db}) => db.query('eventMediaOutputs').first());
  assert.ok(primary!.playbackLinks.some(link => link.platform === 'pc' && link.url === 'rtspt://stream.vrcdn.live/live/basicbit'));
  assert.ok(primary!.playbackLinks.some(link => link.platform === 'standalone' && link.url === 'https://stream.vrcdn.live/live/basicbit.live.ts'));
  process.env.VRDEX_TWITCH_OUTPUT_ACCOUNTS_JSON = JSON.stringify([{ key: 'twitch-owned', channel: 'owned_channel', credentialRef: 'event-media/twitch/owned', ownerCommunityProfileId: f.a.id }]);
  const args = { currentSlug: f.a.event.slug, key: 'twitch', label: 'Twitch', channel: 'owned_channel', outputAccountKey: 'twitch-owned', ...consent };
  const output = await f.a.actor.mutation(api.events.configureTwitchOutput, args);
  const urls = async () => (await f.t.query(api.events.getPublicBySlug, { slug: f.a.event.slug }))!.mediaLinks.map(link => link.url);
  const disabled = await urls();
  assert.equal(disabled.some(url => url.includes('twitch.tv')), false);
  assert.ok(disabled.some(url => url === 'https://example.test/direct'));
  assert.deepEqual((await f.t.query(api.events.getPublicBySlug, { slug: f.a.event.slug }))!.mediaLinks, baseline);
  assert.ok(disabled.some(url => url.includes('vrcdn.live')));
  await f.a.actor.mutation(api.events.configureTwitchOutput, { ...args, simulcastEnabled: true });
  assert.ok((await urls()).some(url => url.includes('twitch.tv')));
  await f.a.actor.mutation(api.events.configureTwitchOutput, { ...args, simulcastEnabled: false });
  await f.t.run(async ({db}) => { const row = await db.get(output.outputId); await db.patch(output.programId, { currentOutputId: output.outputId, publicLinks: row!.playbackLinks }); });
  assert.ok((await urls()).some(url => url.includes('twitch.tv')));
});
it('F5 VRCDN rejects ninth output without poisoning configuration and permits updates at the limit', async () => {
  const f = await fixture();
  const args = { ...f.setup, currentSlug: f.a.event.slug };
  for (let i = 0; i < 8; i++) await f.a.actor.mutation(api.events.configureVrcdnOutput, { ...args, key: `out-${i}` });
  await assert.rejects(f.a.actor.mutation(api.events.configureVrcdnOutput, { ...args, key: 'overflow' }), /Output limit/);
  await f.a.actor.mutation(api.events.configureVrcdnOutput, { ...args, key: 'out-0', label: 'Updated' });
  const rows = await f.t.run(({db}) => db.query('eventMediaOutputs').collect());
  assert.equal(rows.length, 8);
  assert.equal(rows.find(row => row.key === 'out-0')?.label, 'Updated');
  const session = await f.schedule();
  assert.equal((await f.t.mutation(worker('acquireSession'), session.args)).granted, true);
});
for (const offset of [60000, 0, -3600000]) it(`F2 immediate start uses server time at event offset ${offset} and can replace failed live sessions`, async () => {
  const f = await fixture();
  await f.a.actor.mutation(api.events.configureVrcdnOutput, { ...f.setup, currentSlug: f.a.event.slug });
  await f.t.run(({db}) => db.patch(f.a.event.eventId, { startAt: Date.now() + offset, endAt: offset < 0 ? Date.now() - 1000 : Date.now() + offset + 3600000 }));
  await assert.rejects(f.a.actor.mutation(api.events.scheduleEventMediaWorker, { currentSlug: f.a.event.slug, scheduledStartAt: Date.now() }), /before the event starts|at or after the scheduled start/);
  const before = Date.now();
  const session = await f.a.actor.mutation(api.events.scheduleEventMediaWorker, { currentSlug: f.a.event.slug, startImmediately: true });
  assert.ok(session.scheduledStartAt >= before && session.scheduledStartAt <= Date.now());
  assert.equal(session.readyDeadlineAt - session.scheduledStartAt, 180000);
  const claimed = await f.t.mutation(api.events.claimEventMediaWorkerCommand, { bridgeToken, workerId: 'bridge' });
  assert.equal(claimed?.session.sessionId, session.sessionId);
  const request = { bridgeToken, eventId: f.a.event.eventId, sessionId: session.sessionId, workerId: 'worker', epoch: 0 };
  const lease = await f.t.mutation(worker('acquireSession'), request);
  assert.equal(lease.granted, true);
  assert.ok(lease.configuration.sessionDeadline >= before + 43200000);
  assert.ok(lease.configuration.sessionDeadline <= Date.now() + 43200000);
  await f.a.actor.mutation(api.events.markEventMediaWorkerEnded, { currentSlug: f.a.event.slug, sessionId: session.sessionId, status: 'error' });
  const replacement = await f.a.actor.mutation(api.events.scheduleEventMediaWorker, { currentSlug: f.a.event.slug, startImmediately: true });
  assert.notEqual(replacement.sessionId, session.sessionId);
});
it('F2 scheduled starts retain pre-event validation and immediate starts reject conflicting schedule fields', async () => {
  const f = await fixture();
  await f.a.actor.mutation(api.events.configureVrcdnOutput, { ...f.setup, currentSlug: f.a.event.slug });
  await f.t.run(({db}) => db.patch(f.a.event.eventId, { startAt: Date.now() - 1000 }));
  await assert.rejects(f.a.actor.mutation(api.events.scheduleEventMediaWorker, { currentSlug: f.a.event.slug, scheduledStartAt: Date.now() }), /before the event starts/);
  await assert.rejects(f.a.actor.mutation(api.events.scheduleEventMediaWorker, { currentSlug: f.a.event.slug, startImmediately: true, scheduledStartAt: 1 }), /Immediate start/);
});

for (const status of ['scheduled', 'starting', 'live', 'hold', 'fallback', 'stopping', 'error', 'ended'] as const) {
  it(`R2F1 destination saves reject ${status} sessions with reserved capacity`, async () => {
    const f = await fixture();
    const setup = { ...f.setup, currentSlug: f.a.event.slug };
    const output = await f.a.actor.mutation(api.events.configureVrcdnOutput, setup);
    const session = await f.schedule();
    await f.t.run(({db}) => db.patch(session.sessionId, {status, dispatchId:'reserved', workerTaskStatus:'running'}));
    const before = await f.t.run(({db}) => db.get(output.outputId));
    await assert.rejects(f.a.actor.mutation(api.events.configureVrcdnOutput, setup), /session|stopped/i);
    assert.deepEqual(await f.t.run(({db}) => db.get(output.outputId)), before);
    assert.equal((await f.a.actor.query(api.events.getEventMediaControlStatus, {currentSlug:f.a.event.slug})).outputConfigurationLocked, true);
    process.env.VRDEX_TWITCH_OUTPUT_ACCOUNTS_JSON = JSON.stringify([{key:'owned',channel:'example',credentialRef:'event-media/twitch/owned',ownerCommunityProfileId:f.a.id}]);
    await assert.rejects(f.a.actor.mutation(api.events.configureTwitchOutput, {currentSlug:f.a.event.slug,key:'twitch',label:'Twitch',channel:'example',outputAccountKey:'owned',...consent}), /session|stopped/i);
    await f.t.run(({db}) => db.patch(session.sessionId, {status:'ended',workerTaskStatus:'stopped',dispatchStopConfirmedAt:Date.now()}));
    await f.a.actor.mutation(api.events.configureVrcdnOutput, setup);
    await f.a.actor.mutation(api.events.configureTwitchOutput, {currentSlug:f.a.event.slug,key:'twitch',label:'Twitch',channel:'example',outputAccountKey:'owned',...consent});
    assert.equal((await f.a.actor.query(api.events.getEventMediaControlStatus, {currentSlug:f.a.event.slug})).outputConfigurationLocked, false);
  });
}
