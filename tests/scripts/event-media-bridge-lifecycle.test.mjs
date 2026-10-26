import { allocatedSession } from './_event-allocation-fixture.mjs';
import assert from 'node:assert/strict';
import test from 'node:test';
import { EventEmitter } from 'node:events';
import { convexTest } from 'convex-test';
import { getFunctionName, makeFunctionReference } from 'convex/server';
import schemaModule from '../../convex/schema.ts';
import { api } from '../../convex/_generated/api.js';
import { bindVrcdnTestAccount } from '../backend/_eventOutputAccountFixture.ts';
import { newClerkUserId } from '../backend/_clerkTestIdentity.ts';
import * as bridge from '../../scripts/event-media-ecs-bridge.mjs';

const schema = schemaModule.default ?? schemaModule;
const bridgeToken = 'lifecycle-test-token';
const worker = name => makeFunctionReference(`eventMediaWorker:${name}`);
const config = { bridgeToken, workerId: 'lifecycle-bridge', cluster: 'test', pollMs: 1000, redactValues: [], secretRefMap: {}, baseEnvironment: {} };

test('optional drain epoch config accepts unsigned safe integers and preserves unbounded startup when absent', () => {
  const environment = {
    CONVEX_URL: 'https://example.convex.cloud',
    VRDEX_EVENT_MEDIA_BRIDGE_TOKEN: bridgeToken,
    VRDEX_EVENT_MEDIA_ECS_REGION: 'us-east-1',
    VRDEX_EVENT_MEDIA_ECS_CLUSTER: 'test',
    VRDEX_EVENT_MEDIA_ECS_IMAGE: 'image',
    VRDEX_EVENT_MEDIA_ECS_EXECUTION_ROLE_ARN: 'execution-role',
    VRDEX_EVENT_MEDIA_ECS_TASK_ROLE_ARN: 'task-role',
    VRDEX_EVENT_MEDIA_WORKER_TOKEN_SECRET_ARN: 'worker-token-secret',
    VRDEX_EVENT_MEDIA_ECS_LOG_GROUP: 'test',
    VRDEX_EVENT_MEDIA_ECS_SUBNETS: 'subnet',
    VRDEX_EVENT_MEDIA_ECS_SECURITY_GROUPS: 'security-group',
    VRDEX_EVENT_MEDIA_BRIDGE_DRAIN_AT_MS: undefined,
  };
  const previous = Object.fromEntries(Object.keys(environment).map(key => [key, process.env[key]]));
  try {
    for (const [key, value] of Object.entries(environment)) {
      if (value === undefined) delete process.env[key];
      else process.env[key] = value;
    }
    assert.equal(bridge.loadConfig().drainAtMs, undefined);
    for (const value of ['0', '1790000000000', String(Number.MAX_SAFE_INTEGER)]) {
      process.env.VRDEX_EVENT_MEDIA_BRIDGE_DRAIN_AT_MS = value;
      assert.equal(bridge.loadConfig().drainAtMs, Number(value));
    }
    for (const value of ['-1', '+1', '1.5', '1e3', 'NaN', '9007199254740992']) {
      process.env.VRDEX_EVENT_MEDIA_BRIDGE_DRAIN_AT_MS = value;
      assert.throws(() => bridge.loadConfig(), /VRDEX_EVENT_MEDIA_BRIDGE_DRAIN_AT_MS/);
    }
  } finally {
    for (const [key, value] of Object.entries(previous)) {
      if (value === undefined) delete process.env[key];
      else process.env[key] = value;
    }
  }
});

async function fixture() {
  process.env.VRDEX_EVENT_MEDIA_BRIDGE_TOKEN = bridgeToken;
  process.env.VRDEX_EVENT_BROADCAST_MAX_CONCURRENT = '1';
  const t = convexTest({ schema, modules: {
    '../../convex/_generated/api.ts': () => import('../../convex/_generated/api.js'),
    '../../convex/events.ts': () => import('../../convex/events.ts'),
    '../../convex/eventMediaWorker.ts': () => import('../../convex/eventMediaWorker.ts'),
  } });
  const subject = newClerkUserId();
  await t.run(async ({ db }) => {
    const now = Date.now();
    const userId = await db.insert('users', { clerkUserId: subject, name: 'Owner', email: 'owner@example.test', emailVerificationTime: now });
    const profileId = await db.insert('profiles', { slug: 'club', displayName: 'Club', sortName: 'club', aliases: [], tags: [], claimState: 'claimed_verified', publicationState: 'published', publicSurfacingState: 'public', creationSource: 'self', updatedAt: now, profileType: 'community', community: { categoryTags: [] } });
    bindVrcdnTestAccount(profileId, 'event-media/vrcdn/main');
    await db.insert('profileOwners', { profileId, userId, roleKey: 'owner', state: 'active', grantedAt: now, updatedAt: now });
  });
  const owner = t.withIdentity({ subject, emailVerified: true, issuer: 'test', tokenIdentifier: `test|${subject}` });
  const event = await owner.mutation(api.events.createCommunityEvent, { title: 'Lifecycle event', communitySlug: 'club', startAt: Date.now() + 600000, timezone: 'UTC' });
  const output = await owner.mutation(api.events.configureVrcdnOutput, { currentSlug: event.slug, key: 'main', label: 'Main', credentialRef: 'event-media/vrcdn/main', sourceConsentAccepted: true, destinationAuthorityAccepted: true, providerRulesAccepted: true, rightsClearedMediaAccepted: true, playbackLinks: [{ platform: 'browser', url: 'https://example.test/watch' }] });
  const scheduled = await owner.mutation(api.events.scheduleEventMediaWorker, { currentSlug: event.slug, startImmediately: true });
  const client = { query: (ref, args) => t.query(ref, args), mutation: (ref, args) => t.mutation(ref, args) };
  const session = () => t.run(({ db }) => db.get(scheduled.sessionId));
  const admit = async () => {
    assert.equal((await t.mutation(worker('admitDispatch'), { bridgeToken, eventId: event.eventId, sessionId: scheduled.sessionId, dispatchId: 'dispatch' })).granted, true);
  };
  const register = () => t.mutation(worker('recordDispatchedTask'), { bridgeToken, sessionId: scheduled.sessionId, dispatchId: 'dispatch', taskArn: 'managed-task', taskDefinitionArn: 'managed-definition' });
  return { t, client, event, output, scheduled, session, admit, register };
}

test('RunTask propagates the ownership tags from its registered task definition', async () => {
  const command = { commandId: 'command', commandType: 'start_program', eventId: 'event', program: { programId: 'program' }, session: allocatedSession() };
  const calls = [];
  const client = { mutation: async ref => {
    const name = getFunctionName(ref);
    if (name === 'events:claimEventMediaWorkerCommand') return command;
    if (name === 'eventMediaWorker:admitDispatch') return { granted: true };
    return { accepted: true };
  } };
  await bridge.claimAndProcess(client, config, async (_config, args) => {
    calls.push(args);
    if (args[1] === 'register-task-definition') return { taskDefinition: { taskDefinitionArn: 'definition' } };
    return { tasks: [{ taskArn: 'task' }] };
  });
  const args = calls.find(args => args[1] === 'run-task');
  assert.ok(args, 'start must reach actual RunTask');
  assert.equal(args[args.indexOf('--propagate-tags') + 1], 'TASK_DEFINITION');
});

test('deadline drain stops a late worker and releases capacity only after exact STOPPED and cleanup acknowledgement', async () => {
  assert.equal(typeof bridge.runBridge, 'function', 'bridge must expose its real lifecycle loop');
  const f = await fixture();
  await f.admit();
  let monotonic = 50, waits = 0, stops = 0, describes = 0, cleanup = 0, claims = 0;
  const client = { ...f.client, mutation: async (ref, args) => {
    if (getFunctionName(ref) === 'events:claimEventMediaWorkerCommand') claims++;
    assert.notEqual(getFunctionName(ref), 'eventMediaWorker:recordTaskStopRequested', 'deadline alone is not manual stop intent');
    return f.client.mutation(ref, args);
  } };
  await bridge.runBridge(client, { ...config, drainAtMs: 1000 }, async (_config, args) => {
    if (args[1] === 'describe-tasks') {
      describes++;
      return { tasks: [{ taskArn: 'managed-task', lastStatus: describes === 1 ? 'RUNNING' : 'STOPPED', containers: [{ exitCode: 0 }] }] };
    }
    if (args[1] === 'stop-task') {
      stops++;
      assert.equal(args[args.indexOf('--task') + 1], 'managed-task');
      assert.equal((await f.session()).dispatchStopConfirmedAt, undefined);
      return {};
    }
    assert.equal(args[1], 'deregister-task-definition');
    assert.equal(typeof (await f.session()).dispatchStopConfirmedAt, 'number');
    cleanup++;
    return {};
  }, { wallClock: () => 1000, monotonicClock: () => monotonic, signals: new EventEmitter(), wait: async () => {
    waits++;
    assert.ok(waits < 5, 'drain must finish after confirmed cleanup');
    if (waits === 1) {
      assert.equal((await f.session()).workerTaskId, undefined);
      assert.equal((await f.session()).dispatchStopConfirmedAt, undefined);
      await f.register();
    } else {
      assert.equal((await f.session()).dispatchStopConfirmedAt, undefined, 'RUNNING never releases capacity');
    }
    monotonic += 1000;
  } });
  assert.equal(claims, 0);
  assert.equal(stops, 1);
  assert.equal(describes, 2);
  assert.equal(cleanup, 1);
  assert.equal((await f.session()).workerTaskCleanupPending, false);
  const replacement = await f.t.run(async ({ db }) => {
    const now = Date.now();
    const id = await db.insert('eventMediaSessions', { eventId: f.event.eventId, programId: f.output.programId, outputId: f.output.outputId, status: 'starting', createdAt: now, updatedAt: now });
    await db.patch(f.output.programId, { activeSessionId: id });
    return id;
  });
  assert.equal((await f.t.mutation(worker('admitDispatch'), { bridgeToken, eventId: f.event.eventId, sessionId: replacement, dispatchId: 'replacement' })).granted, true);
});

for (const failure of ['unknown-arn', 'missing-task', 'cleanup-provider', 'cleanup-ack', 'control']) test(`drain cannot report success with ${failure}`, async () => {
  assert.equal(typeof bridge.runBridge, 'function');
  const f = await fixture();
  await f.admit();
  if (failure !== 'unknown-arn') await f.register();
  let waits = 0;
  const client = { ...f.client, mutation: async (ref, args) => {
    const name = getFunctionName(ref);
    if (failure === 'control' && name === 'eventMediaWorker:recordProcessStatus') throw Error('control failure');
    if (failure === 'cleanup-ack' && name === 'eventMediaWorker:completeTaskCleanup') return { accepted: false };
    return f.client.mutation(ref, args);
  } };
  await assert.rejects(bridge.runBridge(client, { ...config, drainAtMs: 1 }, async (_config, args) => {
    if (args[1] === 'describe-tasks') return { tasks: failure === 'missing-task' ? [] : [{ taskArn: 'managed-task', lastStatus: 'STOPPED' }] };
    if (failure === 'cleanup-provider') throw Error('cleanup provider unavailable');
    return {};
  }, { wallClock: () => 2, monotonicClock: () => 100, signals: new EventEmitter(), wait: async () => {
    waits++;
    throw Error('test drain remains pending');
  } }), /control failure|test drain remains pending/);
  if (failure !== 'control') assert.equal(waits, 1);
  if (['unknown-arn', 'missing-task'].includes(failure)) assert.equal((await f.session()).dispatchStopConfirmedAt, undefined);
  if (failure.startsWith('cleanup')) assert.equal((await f.session()).workerTaskCleanupPending, true);
});

test('the same expired absolute deadline never claims after a process retry', async () => {
  assert.equal(typeof bridge.runBridge, 'function');
  let claims = 0;
  const client = { query: async () => [], mutation: async () => { claims++; return null; } };
  for (const wallNow of [1000, 90000]) {
    await bridge.runBridge(client, { ...config, drainAtMs: 1000 }, async () => { throw Error('no tasks expected'); }, { wallClock: () => wallNow, monotonicClock: () => 50, signals: new EventEmitter() });
  }
  assert.equal(claims, 0);
});

test('deadline is monotonic after startup even if wall clock moves backwards', async () => {
  assert.equal(typeof bridge.runBridge, 'function');
  let monotonic = 0, wall = 100, claims = 0, waits = 0;
  await bridge.runBridge({ query: async () => [], mutation: async () => { claims++; return null; } }, { ...config, drainAtMs: 200 }, async () => ({}), {
    wallClock: () => wall, monotonicClock: () => monotonic, signals: new EventEmitter(), wait: async ms => {
      assert.equal(ms, 100, 'sleep must wake at deadline before the next full poll');
      assert.equal(waits++, 0);
      monotonic = 100;
      wall = 0;
    },
  });
  assert.equal(claims, 1);
});

test('drain observes a worker that stops after five seconds and acknowledges cleanup before a thirty-second forced shutdown', async () => {
  const f = await fixture();
  await f.admit();
  await f.register();
  let now = 0, stoppedAt, claims = 0, cleanupAcknowledged = false;
  const describes = [], waits = [];
  const advance = ms => {
    now += ms;
    assert.ok(now < 30000, 'forced shutdown would prevent STOPPED reconciliation and cleanup');
  };
  const client = {
    query: async (ref, args) => { advance(100); return f.client.query(ref, args); },
    mutation: async (ref, args) => {
      const name = getFunctionName(ref);
      if (name === 'events:claimEventMediaWorkerCommand') { claims++; return null; }
      advance(100);
      const result = await f.client.mutation(ref, args);
      if (name === 'eventMediaWorker:completeTaskCleanup') cleanupAcknowledged = result.accepted;
      return result;
    },
  };
  await bridge.runBridge(client, { ...config, pollMs: 30000, drainAtMs: 0 }, async (_config, args) => {
    if (args[1] === 'describe-tasks') {
      advance(200);
      const status = stoppedAt !== undefined && now >= stoppedAt ? 'STOPPED' : 'RUNNING';
      describes.push({ at: now, status });
      return { tasks: [{ taskArn: 'managed-task', lastStatus: status }] };
    }
    advance(100);
    if (args[1] === 'stop-task') {
      stoppedAt ??= now + 5000;
      assert.equal((await f.session()).dispatchStopConfirmedAt, undefined);
    } else assert.equal(args[1], 'deregister-task-definition');
    return {};
  }, { wallClock: () => 0, monotonicClock: () => now, signals: new EventEmitter(), wait: async ms => {
    waits.push(ms);
    advance(ms);
  } });
  assert.equal(claims, 0);
  assert.ok(describes.length > 1, 'drain must describe again after requesting stop');
  assert.equal(describes.at(-1).status, 'STOPPED');
  assert.ok(describes.at(-1).at >= stoppedAt);
  assert.ok(waits.length > 0 && waits.every(ms => ms === 1000));
  assert.equal(cleanupAcknowledged, true);
  assert.equal((await f.session()).workerTaskCleanupPending, false);
  assert.ok(now < 30000);
});

test('ambiguous reservations retain a positive bounded drain retry cadence', async () => {
  const f = await fixture();
  await f.admit();
  const waits = [];
  await assert.rejects(bridge.runBridge(f.client, { ...config, pollMs: 30000, drainAtMs: 0 }, async () => { throw Error('no exact task ARN'); }, {
    wallClock: () => 0, monotonicClock: () => 0, signals: new EventEmitter(), wait: async ms => {
      waits.push(ms);
      if (waits.length === 3) throw Error('test bounded pending drain');
    },
  }), /test bounded pending drain/);
  assert.deepEqual(waits, [1000, 1000, 1000]);
  assert.equal((await f.session()).dispatchStopConfirmedAt, undefined);
  assert.equal((await f.session()).dispatchId, 'dispatch');
});

for (const trigger of ['SIGTERM', 'SIGINT', 'deadline', 'deadline-at-sleep']) test(`${trigger} during an in-flight ordinary refresh stops the task before any poll sleep`, async () => {
  const f = await fixture();
  await f.admit();
  await f.register();
  const signals = new EventEmitter();
  const queryEntered = Promise.withResolvers();
  const releaseQuery = Promise.withResolvers();
  let firstQuery = true, now = 0, claims = 0, stopped = false, waits = 0;
  let observeDeadline = false, postObservationClockReads = 0;
  const calls = [];
  const client = {
    query: async (ref, args) => {
      if (firstQuery) {
        firstQuery = false;
        queryEntered.resolve();
        await releaseQuery.promise;
      }
      return f.client.query(ref, args);
    },
    mutation: async (ref, args) => {
      if (getFunctionName(ref) === 'events:claimEventMediaWorkerCommand') { claims++; return null; }
      const result = await f.client.mutation(ref, args);
      if (trigger === 'deadline-at-sleep' && getFunctionName(ref) === 'eventMediaWorker:recordProcessStatus') observeDeadline = true;
      return result;
    },
  };
  const pending = bridge.runBridge(client, { ...config, pollMs: 30000, ...(trigger.startsWith('deadline') ? { drainAtMs: 100 } : {}) }, async (_config, args) => {
    calls.push(args[1]);
    if (args[1] === 'describe-tasks') return { tasks: [{ taskArn: 'managed-task', lastStatus: stopped ? 'STOPPED' : 'RUNNING' }] };
    if (args[1] === 'stop-task') {
      assert.equal(args[args.indexOf('--task') + 1], 'managed-task');
      assert.equal((await f.session()).dispatchStopConfirmedAt, undefined);
      stopped = true;
    }
    return {};
  }, { signals, wallClock: () => 0, monotonicClock: () => {
    // The first clock read after ordinary refresh still precedes the deadline.
    // The next read, while selecting the sleep duration, reaches it.
    if (observeDeadline && postObservationClockReads++ > 0) now = 100;
    return now;
  }, wait: async ms => {
    assert.equal(stopped, true, 'drain must stop the task before the first poll sleep');
    assert.equal(ms, 1000, 'steady-state drain polls within the shutdown grace');
    assert.equal((await f.session()).dispatchStopConfirmedAt, undefined, 'StopTask alone cannot release capacity');
    waits++;
  } });
  await queryEntered.promise;
  if (trigger === 'deadline') now = 100;
  else if (trigger !== 'deadline-at-sleep') signals.emit(trigger);
  releaseQuery.resolve();
  await pending;
  assert.equal(claims, 1, 'drain must not claim again');
  assert.equal(waits, 1, 'poll only between stop request and confirmed STOPPED');
  assert.deepEqual(calls, ['describe-tasks', 'describe-tasks', 'stop-task', 'describe-tasks', 'deregister-task-definition']);
  assert.equal((await f.session()).workerTaskCleanupPending, false);
  assert.equal(signals.listenerCount('SIGTERM'), 0);
  assert.equal(signals.listenerCount('SIGINT'), 0);
});

for (const signal of ['SIGTERM', 'SIGINT']) test(`${signal} wakes idle sleep and drains without aborting cleanup control calls`, async () => {
  assert.equal(typeof bridge.runBridge, 'function');
  const f = await fixture();
  await f.admit();
  await f.register();
  const signals = new EventEmitter();
  let claims = 0, waits = 0, stopped = false, cleanupAcknowledged = false;
  const calls = [];
  const client = { ...f.client, mutation: async (ref, args) => {
    const name = getFunctionName(ref);
    if (name === 'events:claimEventMediaWorkerCommand') { claims++; return null; }
    if (name === 'eventMediaWorker:completeTaskCleanup') signals.emit(signal);
    const result = await f.client.mutation(ref, args);
    if (name === 'eventMediaWorker:completeTaskCleanup') cleanupAcknowledged = result.accepted;
    return result;
  } };
  await bridge.runBridge(client, { ...config, pollMs: 30000 }, async (_config, args) => {
    calls.push(args[1]);
    if (args[1] === 'describe-tasks') return { tasks: [{ taskArn: 'managed-task', lastStatus: stopped ? 'STOPPED' : 'RUNNING' }] };
    if (args[1] === 'stop-task') {
      assert.equal((await f.session()).dispatchStopConfirmedAt, undefined);
      stopped = true;
    }
    return {};
  }, { signals, wait: async (ms, signalController) => {
    if (waits++ > 0) {
      assert.equal(ms, 1000, 'drain uses the shorter reconciliation cadence');
      return;
    }
    assert.equal(ms, 30000, 'ordinary polling keeps its configured interval');
    signals.emit(signal);
    assert.equal(signalController.aborted, true);
    const error = Error('sleep interrupted'); error.name = 'AbortError'; throw error;
  } });
  assert.equal(claims, 1);
  assert.equal(cleanupAcknowledged, true);
  assert.deepEqual(calls, ['describe-tasks', 'describe-tasks', 'stop-task', 'describe-tasks', 'deregister-task-definition']);
  assert.equal(signals.listenerCount(signal), 0);
});

test('unset drain epoch preserves one-pass legacy --once behavior', async () => {
  let claims = 0, queries = 0;
  const signals = new EventEmitter();
  await bridge.runBridge({ mutation: async () => { claims++; return null; }, query: async () => { queries++; return []; } }, { ...config, once: true }, async () => ({}), {
    signals, wait: async () => { throw Error('--once must not wait'); },
  });
  assert.equal(claims, 1);
  assert.equal(queries, 1);
  assert.equal(signals.listenerCount('SIGTERM'), 0);
  assert.equal(signals.listenerCount('SIGINT'), 0);
});

for (const boundary of ['claim', 'admission', 'registration']) test(`crossing deadline during ${boundary} prevents RunTask`, async () => {
  assert.equal(typeof bridge.runBridge, 'function');
  const f = await fixture();
  let now = 0, launched = false;
  const names = { claim: 'events:claimEventMediaWorkerCommand', admission: 'eventMediaWorker:admitDispatch' };
  const client = { ...f.client, mutation: async (ref, args) => {
    const result = await f.client.mutation(ref, args);
    if (getFunctionName(ref) === names[boundary]) now = 100;
    return result;
  } };
  const pending = bridge.runBridge(client, { ...config, drainAtMs: 100, secretRefMap: { 'event-media/vrcdn/main': 'test-secret' } }, async (_config, args) => {
    if (args[1] === 'register-task-definition') {
      if (boundary === 'registration') now = 100;
      return { taskDefinition: { taskDefinitionArn: 'managed-definition' } };
    }
    if (args[1] === 'run-task') { launched = true; return { tasks: [{ taskArn: 'managed-task' }] }; }
    return {};
  }, { wallClock: () => 0, monotonicClock: () => now, signals: new EventEmitter(), wait: async () => { throw Error('ambiguous launch marker remains pending'); } });
  await pending;
  assert.equal(launched, false);
  const session = await f.session();
  assert.equal(session.dispatchId, undefined);
  assert.equal(session.status, 'error');
  if (boundary === 'registration') assert.equal(session.workerTaskCleanupPending, false);
});

test('accepted launch marker finishes task registration then immediately drains if the deadline arrives in flight', async () => {
  assert.equal(typeof bridge.runBridge, 'function');
  const f = await fixture();
  let now = 0, stopped = false;
  const calls = [];
  const client = { ...f.client, mutation: async (ref, args) => {
    const result = await f.client.mutation(ref, args);
    if (getFunctionName(ref) === 'eventMediaWorker:markLaunchAttempt') now = 100;
    return result;
  } };
  await bridge.runBridge(client, { ...config, drainAtMs: 100, secretRefMap: { 'event-media/vrcdn/main': 'test-secret' } }, async (_config, args) => {
    calls.push(args[1]);
    if (args[1] === 'register-task-definition') return { taskDefinition: { taskDefinitionArn: 'managed-definition' } };
    if (args[1] === 'run-task') return { tasks: [{ taskArn: 'managed-task' }] };
    if (args[1] === 'describe-tasks') return { tasks: [{ taskArn: 'managed-task', lastStatus: stopped ? 'STOPPED' : 'RUNNING' }] };
    if (args[1] === 'stop-task') stopped = true;
    return {};
  }, { wallClock: () => 0, monotonicClock: () => now, signals: new EventEmitter(), wait: async () => {} });
  assert.deepEqual(calls, ['register-task-definition', 'run-task', 'describe-tasks', 'stop-task', 'describe-tasks', 'deregister-task-definition']);
  assert.equal((await f.session()).workerTaskCleanupPending, false);
});
