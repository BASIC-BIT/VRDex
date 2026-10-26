import assert from 'node:assert/strict';
import test from 'node:test';
import { fixtureCapacityResolver } from './_event-allocation-fixture.mjs';
import { loadConfig, runBridge as realRunBridge } from '../../scripts/event-media-ecs-bridge.mjs';
import * as lambda from '../../scripts/event-media-lambda-bridge.mjs';
const environment = {
  CONVEX_URL: 'https://example.convex.cloud',
  VRDEX_EVENT_MEDIA_ECS_REGION: 'us-east-1', VRDEX_EVENT_MEDIA_ECS_CLUSTER: 'cluster',
  VRDEX_EVENT_MEDIA_ECS_IMAGE: 'image', VRDEX_EVENT_MEDIA_ECS_EXECUTION_ROLE_ARN: 'execution',
  VRDEX_EVENT_MEDIA_ECS_TASK_ROLE_ARN: 'task-role', VRDEX_EVENT_MEDIA_WORKER_TOKEN_SECRET_ARN: 'exact-token-secret-arn',
  VRDEX_EVENT_MEDIA_ECS_LOG_GROUP: 'logs', VRDEX_EVENT_MEDIA_ECS_SUBNETS: 'subnet',
  VRDEX_EVENT_MEDIA_ECS_SECURITY_GROUPS: 'sg', VRDEX_EVENT_MEDIA_SECRET_REF_MAP_JSON: '{}',
  VRDEX_EVENT_MEDIA_BRIDGE_TOKEN: undefined, VRDEX_EVENT_MEDIA_BRIDGE_DRAIN_AT_MS: undefined,
  VRDEX_EVENT_MEDIA_BRIDGE_WORKER_ID: 'stale-environment-id',
};
function withEnvironment(t, overrides = {}) {
  const next = { ...environment, ...overrides };
  const previous = Object.fromEntries(Object.keys(next).map(key => [key, process.env[key]]));
  for (const [key, value] of Object.entries(next)) {
    if (value === undefined) delete process.env[key]; else process.env[key] = value;
  }
  t.after(() => {
    for (const [key, value] of Object.entries(previous)) {
      if (value === undefined) delete process.env[key]; else process.env[key] = value;
    }
  });
}
const commandNames = ['RegisterTaskDefinition', 'RunTask', 'DescribeTasks', 'StopTask', 'DeregisterTaskDefinition'];
const ecsCommands = Object.fromEntries(commandNames.map(operation => [`${operation}Command`, class {
  constructor(input) { this.operation = operation; this.input = input; }
}]));
function fixture(options = {}) {
  const requests = [], ecs = [], secretRequests = [], logs = [];
  let tokenVersion = 0;
  const runtime = {
    ecsCommands,
    ecsClient: { send: async (command, sendOptions) => {
      ecs.push(command);
      assert.ok(sendOptions.abortSignal instanceof AbortSignal);
      if (command.operation === 'DescribeTasks') return { tasks: [{ taskArn: 'task-a', lastStatus: 'RUNNING' }] };
      throw Error(`Unexpected operation ${command.operation}`);
    } },
    secretCommands: { GetSecretValueCommand: class { constructor(input) { this.input = input; } } },
    secretsClient: { send: async (command, sendOptions) => {
      secretRequests.push(command.input);
      assert.ok(sendOptions.abortSignal instanceof AbortSignal);
      return { SecretString: `fresh-secret-${++tokenVersion}` };
    } },
  };
  assert.equal(typeof lambda.createLambdaHandler, 'function', 'Lambda handler factory must exist');
  const handler = lambda.createLambdaHandler({
    loadRuntime: async () => runtime,
    logger: { info: value => logs.push(value), error: value => logs.push(value) },
    fetch: async (_url, init) => {
      const body = JSON.parse(init.body);
      requests.push({ ...body, signal: init.signal });
      assert.ok(init.signal instanceof AbortSignal);
      let value = null;
      if (body.path === 'events:listEventMediaWorkerBridgeSessions') value = [{ sessionId: 'session', dispatchId: 'dispatch', workerTaskId: 'task-a' }];
      return new Response(JSON.stringify({ status: 'success', value, logLines: ['private-token https://private-source.test'] }));
    },
    ...options,
  });
  return { handler, runtime, requests, ecs, secretRequests, logs };
}

test('loadConfig accepts a nonempty injected token without reading or mutating its environment token', t => {
  withEnvironment(t);
  assert.equal(loadConfig({ bridgeToken: 'fresh-token' }).bridgeToken, 'fresh-token');
  assert.equal(process.env.VRDEX_EVENT_MEDIA_BRIDGE_TOKEN, undefined);
  for (const bridgeToken of ['', ' ', null, 12]) assert.throws(() => loadConfig({ bridgeToken }), /token|Token/);
  process.env.VRDEX_EVENT_MEDIA_BRIDGE_TOKEN = 'legacy-cli-token';
  assert.equal(loadConfig().bridgeToken, 'legacy-cli-token');
});

test('warm invocations refresh the exact secret and reconcile healthy tasks once with distinct identities', async t => {
  withEnvironment(t);
  const f = fixture();
  for (const awsRequestId of ['request-one', 'request-two']) {
    assert.deepEqual(await f.handler({}, { awsRequestId, getRemainingTimeInMillis: () => 0 }), { outcome: 'completed' });
  }
  assert.deepEqual(f.secretRequests, [{ SecretId: 'exact-token-secret-arn' }, { SecretId: 'exact-token-secret-arn' }]);
  const claims = f.requests.filter(request => request.path === 'events:claimEventMediaWorkerCommand');
  assert.equal(claims.length, 2);
  assert.notEqual(claims[0].args[0].workerId, claims[1].args[0].workerId);
  assert.match(claims[0].args[0].workerId, /request-one/);
  assert.deepEqual(claims.map(request => request.args[0].bridgeToken), ['fresh-secret-1', 'fresh-secret-2']);
  assert.equal(f.requests.filter(request => request.path === 'events:listEventMediaWorkerBridgeSessions').length, 2);
  assert.equal(f.requests.filter(request => request.path === 'eventMediaWorker:recordProcessStatus').length, 2);
  assert.deepEqual(f.ecs.map(command => command.operation), ['DescribeTasks', 'DescribeTasks']);
  assert.equal(process.env.VRDEX_EVENT_MEDIA_BRIDGE_TOKEN, undefined);
  assert.doesNotMatch(JSON.stringify(f.logs), /fresh-secret|private-token|private-source/);
});

test('missing request IDs use fresh UUID identities for warm calls', async t => {
  withEnvironment(t);
  const f = fixture();
  await f.handler({}, {});
  await f.handler({}, {});
  const ids = f.requests.filter(request => request.path === 'events:claimEventMediaWorkerCommand').map(request => request.args[0].workerId);
  assert.notEqual(ids[0], ids[1]);
});

for (const drain of ['0', 'invalid', '']) test(`refuses inherited drain ${JSON.stringify(drain)} before secret or control-plane work`, async t => {
  withEnvironment(t, { VRDEX_EVENT_MEDIA_BRIDGE_DRAIN_AT_MS: drain });
  const f = fixture();
  await assert.rejects(f.handler({}, {}), /Event media dispatcher invocation failed/);
  assert.equal(f.secretRequests.length, 0);
  assert.equal(f.requests.length, 0);
  assert.equal(f.ecs.length, 0);
});

test('passes no deadline or process signal listeners to the bridge loop', async t => {
  withEnvironment(t);
  const before = { term: process.listenerCount('SIGTERM'), int: process.listenerCount('SIGINT') };
  const f = fixture({ runBridge: async (client, config, _runner, options) => {
    assert.equal(config.once, true);
    assert.equal(config.drainAtMs, undefined);
    assert.notEqual(options.signals, process);
    assert.equal(options.signals.listenerCount('SIGTERM'), 0);
    assert.equal(process.listenerCount('SIGTERM'), before.term);
    assert.equal(process.listenerCount('SIGINT'), before.int);
    await client.mutation((await import('convex/server')).makeFunctionReference('events:claimEventMediaWorkerCommand'), { bridgeToken: config.bridgeToken, workerId: config.workerId });
  } });
  await f.handler({}, { getRemainingTimeInMillis: () => 0 });
  assert.equal(process.listenerCount('SIGTERM'), before.term);
  assert.equal(process.listenerCount('SIGINT'), before.int);
  assert.equal(f.ecs.length, 0);
});

test('secret failure logs and throws only a generic error and performs no queries', async t => {
  withEnvironment(t);
  const f = fixture();
  f.runtime.secretsClient.send = async () => { throw Error('private-token https://private-source.test'); };
  await assert.rejects(f.handler({}, {}), error => {
    assert.equal(error.message, 'Event media dispatcher invocation failed.');
    assert.equal(error.cause, undefined);
    return true;
  });
  assert.equal(f.requests.length, 0);
  assert.equal(f.ecs.length, 0);
  assert.match(JSON.stringify(f.logs), /failed/);
  assert.doesNotMatch(JSON.stringify(f.logs), /private-token|private-source/);
});

for (const secret of [{}, { SecretString: '' }, { SecretString: ' ' }, { SecretBinary: new Uint8Array([1, 2]) }]) test('invalid secret fails closed before queries', async t => {
  withEnvironment(t);
  const f = fixture();
  f.runtime.secretsClient.send = async () => secret;
  await assert.rejects(f.handler({}, {}), /dispatcher invocation failed/);
  assert.equal(f.requests.length, 0);
});

test('all Convex calls use a fresh fifteen-second timeout signal and suppress provider logs', async t => {
  withEnvironment(t);
  const timeouts = [];
  const original = AbortSignal.timeout.bind(AbortSignal);
  t.mock.method(AbortSignal, 'timeout', ms => { timeouts.push(ms); return original(ms); });
  const logged = [];
  t.mock.method(console, 'log', (...values) => logged.push(values));
  const f = fixture();
  await f.handler({}, {});
  assert.equal(timeouts.length, f.requests.length);
  assert.ok(timeouts.length >= 3);
  assert.ok(timeouts.every(ms => ms === 15000));
  assert.equal(new Set(f.requests.map(request => request.signal)).size, f.requests.length);
  assert.doesNotMatch(JSON.stringify(logged), /private-token|private-source/);
});

test('a hung Convex request aborts and yields a safe failed invocation', async t => {
  withEnvironment(t);
  let signal;
  const f = fixture({ timeoutMs: 5, fetch: async (_url, init) => {
    signal = init.signal;
    return new Promise((resolve, reject) => signal.addEventListener('abort', () => reject(Error('private-token')), { once: true }));
  } });
  const keepAlive = setTimeout(() => {}, 1000);
  try { await assert.rejects(f.handler({}, {}), /dispatcher invocation failed/); }
  finally { clearTimeout(keepAlive); }
  assert.equal(signal.aborted, true);
  assert.doesNotMatch(JSON.stringify(f.logs), /private-token/);
});

test('secret requests also abort after fifteen seconds', async t => {
  withEnvironment(t);
  t.mock.timers.enable({ apis: ['setTimeout'] });
  let signal;
  const f = fixture();
  f.runtime.secretsClient.send = async (_command, options) => {
    signal = options.abortSignal;
    return new Promise((resolve, reject) => signal.addEventListener('abort', () => reject(signal.reason), { once: true }));
  };
  const pending = assert.rejects(f.handler({}, {}), /dispatcher invocation failed/);
  // Deferred runtime loading crosses one microtask boundary before sending.
  await Promise.resolve();
  await Promise.resolve();
  assert.ok(signal);
  t.mock.timers.tick(14999);
  assert.equal(signal.aborted, false);
  t.mock.timers.tick(1);
  await pending;
  assert.equal(signal.aborted, true);
  assert.equal(f.requests.length, 0);
});

test('Lambda dispatch carries explicit synthetic resources and launch fence through the SDK', async t => {
  withEnvironment(t);
  const { allocatedSession } = await import('./_event-allocation-fixture.mjs');
  const { taskDefinitionFor } = await import('../../scripts/event-media-ecs-bridge.mjs');
  const command={commandId:'command',commandType:'start_program',eventId:'event',program:{programId:'program'},session:allocatedSession({videoPreset:'1080p60',optional:'optional'})};
  const events=[], sent=[];let registered;
  const f=fixture({runBridge: (client, config, runner, options) => realRunBridge(client, config, runner, { ...options, resolveAllocation: fixtureCapacityResolver }), fetch:async(_url,init)=>{
    const body=JSON.parse(init.body);events.push(body.path);
    let value={accepted:true};
    if(body.path==='events:claimEventMediaWorkerCommand')value=command;
    if(body.path==='eventMediaWorker:admitDispatch')value={granted:true};
    if(body.path==='events:listEventMediaWorkerBridgeSessions')value=[];
    return new Response(JSON.stringify({status:'success',value}));
  }});
  f.runtime.ecsClient.send=async request=>{sent.push(request);if(request.operation==='RegisterTaskDefinition'){registered=request.input;return {taskDefinition:{taskDefinitionArn:'definition'}};}assert.equal(request.operation,'RunTask');assert(events.includes('eventMediaWorker:markLaunchAttempt'));assert.equal(request.input.taskDefinition,'definition');assert.equal(typeof request.input.clientToken,'string');assert.equal(request.input.overrides,undefined);return {tasks:[{taskArn:'task'}]};};
  await f.handler({}, {awsRequestId:'launch'});
  assert.ok(registered, 'synthetic capacity must reach task registration');
  const expected=taskDefinitionFor(command,loadConfig({bridgeToken:'test-token'}),fixtureCapacityResolver);
  assert.equal(registered.cpu,'4096');
  assert.equal(registered.memory,'8192');
  assert.equal(registered.containerDefinitions[0].cpu,4096);
  assert.equal(registered.containerDefinitions[0].memory,8192);
  assert.deepEqual(registered,JSON.parse(JSON.stringify(expected)));
  assert.equal(registered.cpu,expected.cpu);assert.equal(registered.memory,expected.memory);
  assert.equal(registered.containerDefinitions[0].cpu,expected.containerDefinitions[0].cpu);
  assert.equal(registered.containerDefinitions[0].memory,expected.containerDefinitions[0].memory);
  assert.deepEqual(registered.containerDefinitions[0].environment,expected.containerDefinitions[0].environment);
  assert.deepEqual(sent.map(r=>r.operation),['RegisterTaskDefinition','RunTask']);
  assert(events.indexOf('eventMediaWorker:admitDispatch')<events.indexOf('eventMediaWorker:markLaunchAttempt'));
  assert(events.includes('eventMediaWorker:recordDispatchedTask'));
});
