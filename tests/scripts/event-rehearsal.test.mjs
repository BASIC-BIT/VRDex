import test from 'node:test';
import assert from 'node:assert/strict';
import { EventEmitter } from 'node:events';
import { PassThrough } from 'node:stream';
import { mkdtemp, readFile, writeFile, symlink } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { validateRehearsal, createRehearsalControl, runRehearsal, createReadinessEvidence, createTransportEvidence, REHEARSAL_PARAMETER } from '../../scripts/event-vrcdn-rehearsal.mjs';
import { runBounded, finalizeArtifacts, numericDiagnostics, syntheticEnvironment, runSynthetic, finalizeProof } from '../../scripts/event-proof-runner.mjs';
import { createEventWorker, checkHostedEnabled } from '../../workers/restream/event-worker.mjs';
const attestations = { sourceConsent: 'accepted', destinationAuthority: 'accepted', providerRules: 'accepted', rightsClearedMedia: 'accepted' };
const environment = () => ({ VRDEX_PROVIDER_REHEARSAL_CONFIRMED: 'true', VRDEX_PROVIDER_REHEARSAL_ATTESTATIONS_JSON: JSON.stringify(attestations), VRDEX_EVENT_MEDIA_OUTPUT_INGEST_SECRET_JSON: '{"rtmpUrl":"rtmp://uk.ingest.vrcdn.live/live","streamKey":"private-canary"}', AWS_REGION: 'us-east-1', VRDEX_RESTREAM_KILL_SWITCH_SSM_PARAMETER: REHEARSAL_PARAMETER });
test('rehearsal startup gate accepts canonical-host synthetic split and combined credentials', () => {
 for (const credential of [{ rtmpUrl: 'rtmp://ingest.vrcdn.live/live', streamKey: 'private-canary' }, { ingestUrl: 'rtmps://ingest.vrcdn.live:443/live/private-canary' }]) {
  assert.deepEqual(validateRehearsal({ ...environment(), VRDEX_EVENT_MEDIA_OUTPUT_INGEST_SECRET_JSON: JSON.stringify(credential) }), { seconds: 120, compliance: attestations });
 }
});
test('guards reject missing attestations, altered endpoints, production switch and Convex before any side effects', () => {
 assert.equal(validateRehearsal(environment()).seconds, 120);
 for (const patch of [{ VRDEX_PROVIDER_REHEARSAL_CONFIRMED: '' }, { VRDEX_PROVIDER_REHEARSAL_ATTESTATIONS_JSON: '{}' }, { VRDEX_PROVIDER_REHEARSAL_ATTESTATIONS_JSON: JSON.stringify({ ...attestations, providerRules: true }) }, { VRDEX_RESTREAM_KILL_SWITCH_SSM_PARAMETER: '/vrdex/restream/hosted-worker/enabled' }, { AWS_REGION: 'us-west-2' }, { CONVEX_URL: 'https://example.convex.cloud' }, { VRDEX_EVENT_MEDIA_BRIDGE_TOKEN: 'private-canary' }, { VRDEX_PROVIDER_REHEARSAL_SOURCE_URL: 'https://other.example/test' }, { PROOF_SECONDS: '180' }, { VRDEX_EVENT_MEDIA_OUTPUT_INGEST_SECRET_JSON: '{bad private-canary' }]) {
  assert.throws(() => validateRehearsal({ ...environment(), ...patch }), error => !error.message.includes('private-canary'));
 }
});
test('in-memory control uses explicit rights and expires leases at fixed deadline', async () => {
 let now = 1000;
 const evidence = { commands: [], observations: [] };
 const control = createRehearsalControl({ compliance: attestations, beganAt: now, now: () => now, evidence });
 let lease = await control('acquireSession');
 assert.deepEqual(lease.configuration.outputs[0].compliance, attestations);
 assert.equal(lease.configuration.sources[0].publicUrl, 'https://stream.vrcdn.live/live/basicbit1.live.ts');
 now += 20000;
 assert.equal((await control('claimCommands')).commands[0].commandType, 'switch_hold');
 await control('acknowledgeCommand', { sequence: 1, outcome: 'succeeded', observedState: 'hold', private: 'private-canary' });
 now += 10000;
 assert.equal((await control('claimCommands')).commands[0].commandType, 'switch_source');
 now = 181001;
 assert.equal((await control('renewSession')).granted, false);
 assert.ok(!JSON.stringify(evidence).includes('private-canary'));
});
test('readiness records death and recovery only after actual ready/lost/ready observations', () => {
 const state = createReadinessEvidence();
 state.observe({ ready: false }, 0); assert.equal(state.result().sourceLossObserved, false);
 state.observe({ ready: true }, 1); state.observe({ ready: false }, 2);
 assert.equal(state.result().sourceLossObserved, true); assert.equal(state.result().sourceRecoveryObserved, false);
 state.observe({ ready: true }, 3); assert.equal(state.result().sourceRecoveryObserved, true);
});
function fakeChild() {
 const child = new EventEmitter(); child.pid = 123; child.stdout = new PassThrough(); child.stderr = new PassThrough(); child.exitCode = null; child.signalCode = null; child.kills = [];
 child.kill = signal => { child.kills.push(signal); queueMicrotask(() => child.emit('close', null, signal)); return true; };
 return child;
}
test('bounded runner preserves child failure and keeps only numeric bounded diagnostics', async () => {
 const child = fakeChild();
 const resultPromise = runBounded({ command: 'test', args: [], env: {}, spawnProcess: () => child, killGroup: () => {}, timeoutMs: 1000 });
 child.stdout.write('private-canary\n'); child.stderr.write('private-canary'.repeat(10000)); child.emit('close', 7, null);
 const result = await resultPromise;
 assert.equal(result.exitCode, 7); assert.ok(result.stderrBytes > 1000); assert.ok(!JSON.stringify(result).includes('private-canary'));
});
test('bounded runner kills the entire process group on timeout and signal, preserving failure', async () => {
 for (const signal of [false, true]) {
  const child = fakeChild(), abort = new AbortController(), killed = [];
  const pending = runBounded({ command: 'test', args: [], env: {}, spawnProcess: () => child, timeoutMs: signal ? 1000 : 5, signal: abort.signal, killGroup: (pid, value) => { killed.push([pid, value]); child.kill(value); } });
  if (signal) abort.abort();
  const result = await pending;
  assert.equal(result.exitCode, signal ? 130 : 124); assert.deepEqual(killed[0], [-123, 'SIGTERM']);
 }
});
test('artifact finalizer excludes raw logs, unknown files, symlinks and secret strings; preserves prior failure', async () => {
 const directory = await mkdtemp(join(tmpdir(), 'rehearsal-test-'));
 await writeFile(join(directory, 'primary.ts'), Buffer.from([0x47, 1, 2]));
 await writeFile(join(directory, 'result.json'), JSON.stringify({ passed: false, samples: 2, error: 'private-canary', resources: { cpu: 3 } }));
 await writeFile(join(directory, 'raw.log'), 'private-canary');
 await symlink(join(directory, 'raw.log'), join(directory, 'optional-after.ts'));
 const uploads = [];
 const result = await finalizeArtifacts({ directory, exitCode: 7, runId: 'unit-1', artifactRoot: 's3://vrdex-restream-worker-079358094174-artifacts/synthetic-benchmarks', upload: async (file, target) => { uploads.push({ file, target, contents: await readFile(file) }); } });
 assert.equal(result.exitCode, 7); assert.equal(result.uploadFailures, 0);
 assert.ok(uploads.some(value => value.target.endsWith('/primary.ts')));
 assert.ok(!uploads.some(value => value.target.endsWith('/raw.log') || value.target.endsWith('/optional-after.ts')));
 assert.ok(!uploads.some(value => value.contents.includes('private-canary')));
 const failure = await finalizeArtifacts({ directory, exitCode: 0, runId: 'unit-2', artifactRoot: 's3://vrdex-restream-worker-079358094174-artifacts/synthetic-benchmarks', upload: async () => { throw Error('private-canary'); } });
 assert.equal(failure.exitCode, 1); assert.ok(failure.uploadFailures > 0);
 assert.ok(!JSON.stringify(failure).includes('private-canary'));
});
test('numeric projection and synthetic subprocess environment cannot carry injected credentials', () => {
 assert.deepEqual(numericDiagnostics({ a: 1, b: true, secret: 'private-canary', nested: { cpu: 2, url: 'private-canary' } }), { a: 1, b: true, nested: { cpu: 2 } });
 const env = syntheticEnvironment({ ...environment(), PATH: '/bin', AWS_CONTAINER_CREDENTIALS_RELATIVE_URI: '/credentials', EVIL: 'private-canary', PROOF_SECONDS: '3600' }, '/tmp/proof-');
 assert.equal(env.PROOF_SECONDS, '120'); assert.equal(env.PATH, '/bin'); assert.ok(!JSON.stringify(env).includes('private-canary')); assert.equal(env.AWS_CONTAINER_CREDENTIALS_RELATIVE_URI, undefined);
});
function fakeRuntime({ now, enabled = true, leaseMs = 1000 }) {
 let stopped = false;
 const renderer = { start: async () => {}, stop: async () => {}, subscribe: () => () => {}, getState: () => ({ running: true, outputMs: 1 }), getInputs: () => [], reconcileSources: async () => {}, hold() {}, selectSource: () => false };
 const outputs = { start: async () => {}, stopNow: () => { stopped = true; }, stop: async () => {}, enqueue() {}, getState: () => ({ publishing: true, destinations: [] }) };
 const config = { outputId: 'basicbit', outputs: [{ id: 'basicbit' }], sources: [], slots: [], mode: 'hold', policy: {}, sessionDeadline: 180000 };
 const worker = createEventWorker({ identity: {}, clock: now, renderer, outputs, checkEnabled: async () => enabled, control: async name => name === 'acquireSession' ? { granted: true, epoch: 1, serverNow: 0, expiresAt: leaseMs, renewAfterMs: 10000, configuration: config } : { granted: false } });
 return { worker, fenced: () => stopped };
}
test('unchanged worker fences on expired authority and dedicated switch failure', async () => {
 let clock = 0;
 const runtime = fakeRuntime({ now: () => clock });
 await runtime.worker.start(); clock = 751; runtime.worker.watchdog();
 assert.equal(runtime.fenced(), true); assert.equal(runtime.worker.getState().stopped, true);
 let invoked;
 assert.equal(await checkHostedEnabled({ parameter: REHEARSAL_PARAMETER, region: 'us-east-1', run: async (_command, args) => { invoked = args; return { stdout: '{"Parameter":{"Value":"false"}}' }; } }), false);
 assert.ok(invoked.includes(REHEARSAL_PARAMETER));
 const disabled = fakeRuntime({ now: () => 0, enabled: false });
 await assert.rejects(disabled.worker.start()); assert.equal(disabled.fenced(), true);
});
test('rehearsal cleanup runs after startup failure without serializing provider errors', async () => {
 const calls = [];
 const result = await runRehearsal({ env: environment(), directory: await mkdtemp(join(tmpdir(), 'rehearsal-test-')), dependencies: {
  createSourceRelay: async () => ({ stop: () => calls.push('relay-stop'), resolveSource() {}, retainSources() {} }),
  createProgramRenderer: () => ({ subscribe: () => () => {}, stop: async () => calls.push('renderer-stop') }),
  createEventOutputs: () => ({ stopNow: () => calls.push('fence'), stop: async () => calls.push('outputs-stop') }),
  createEventWorker: () => ({ start: async () => { throw Error('private-canary'); }, stop: async () => calls.push('worker-stop') }),
  processMetrics: () => ({ sample: async () => {}, result: () => ({}) })
 } });
 assert.equal(result.exitCode, 1); assert.ok(calls.indexOf('fence') < calls.indexOf('renderer-stop')); assert.ok(calls.includes('relay-stop')); assert.ok(!JSON.stringify(result).includes('private-canary'));
});
test('switch loss after publication fences synchronously on refresh or ten-second expiry', async () => {
 for (const failure of ['false', 'unavailable', 'hung']) {
  let now = 0, checks = 0, fenced = false;
  const renderer = { start: async () => {}, stop: async () => {}, subscribe: () => () => {}, getState: () => ({ running: true, outputMs: 1 }), getInputs: () => [], reconcileSources: async () => {}, hold() {}, selectSource: () => false };
  const outputs = { start: async () => {}, stopNow: () => { fenced = true; }, stop: async () => {}, enqueue() {}, getState: () => ({ publishing: true, destinations: [] }) };
  const configuration = { outputId: 'basicbit', outputs: [{ id: 'basicbit' }], sources: [], slots: [], mode: 'hold', policy: {}, sessionDeadline: 180000 };
  const worker = createEventWorker({ identity: {}, clock: () => now, renderer, outputs, checkEnabled: async () => { if (++checks === 1) return true; if (failure === 'false') return false; if (failure === 'unavailable') throw Error('private-canary'); return new Promise(() => {}); }, requestTimeoutMs: 20, control: async name => name === 'acquireSession' ? { granted: true, epoch: 1, serverNow: 0, expiresAt: 30000, renewAfterMs: 10000, configuration } : { granted: true, accepted: true, serverNow: 0, configuration, commands: [] } });
  await worker.start(); now = 5001;
  const tick = worker.tick();
  if (failure === 'hung') { now = 10001; worker.watchdog(); assert.equal(fenced, true); }
  await tick; assert.equal(fenced, true); assert.equal(worker.getState().stopped, true); await worker.stop();
 }
});
test('runner skips spawn if already aborted', async () => {
 const abort = new AbortController(); abort.abort(); let spawns = 0;
 const result = await runBounded({ command: 'test', args: [], env: {}, signal: abort.signal, spawnProcess: () => { spawns++; return fakeChild(); } });
 assert.equal(spawns, 0); assert.equal(result.exitCode, 130);
});
function simulatedRehearsal({ disabledAt = Infinity, abortAt = Infinity, publishes = true, failVerification = false } = {}) {
 let elapsed = 0, running = false, selected = 'basicbit1', publishing = true, outputMs = 0;
 const abort = new AbortController(), subscribers = new Set(), calls = [];
 const dependencies = {
  now: () => 1000000 + elapsed,
  sleep: async () => { elapsed += 1000; if (elapsed >= abortAt) abort.abort(); },
  createSourceRelay: async () => ({ stop: () => calls.push('relay-stop'), resolveSource: () => 'fake-source', retainSources() {} }),
  createProgramRenderer: () => ({ subscribe: fn => { subscribers.add(fn); return () => subscribers.delete(fn); }, start: async () => { running = true; for (const fn of subscribers) fn(Buffer.alloc(188)); }, stop: async () => { running = false; }, getInputs: () => [{ source: { slotKey: 'source-a' }, getObservation: () => ({ ready: true }) }], reconcileSources: async () => {}, selectSource: () => { selected = 'basicbit1'; return true; }, hold: () => { selected = undefined; }, getState: () => ({ running, outputMs: outputMs += 100, renderedSlotKey: selected ? 'source-a' : undefined, renderedSourceId: selected }) }),
  createEventOutputs: () => ({ start: async () => {}, enqueue() {}, stopNow: () => { publishing = false; }, stop: async () => {}, getState: () => ({ publishing: publishes && publishing, destinations: [{ outputId: 'basicbit', publishing: publishes && publishing, status: 'publishing', outputMs: elapsed, restarts: 0 }] }) }),
  createEventWorker: options => createEventWorker({ ...options, clock: () => elapsed }),
  checkHostedEnabled: async () => elapsed < disabledAt,
  processMetrics: () => ({ sample: async () => {}, result: () => ({ cpuSeconds: { worker: 1 } }) }),
  verifyProgramPackets: async () => { if (failVerification) throw Error('private-canary'); return { streams: [{ codec_name: 'h264', width: 1280, height: 720, r_frame_rate: '30/1' }, { codec_name: 'aac', sample_rate: '48000' }], maxGap: 0.03, maxGop: 1 }; },
 };
 return { dependencies, signal: abort.signal, calls };
}
test('early real worker switch fence remains nonzero with exact observed stop reason', async () => {
 const simulated = simulatedRehearsal({ disabledAt: 5000 });
 const result = await runRehearsal({ env: environment(), directory: await mkdtemp(join(tmpdir(), 'rehearsal-test-')), ...simulated });
 assert.equal(result.exitCode, 1); assert.equal(result.switchFalseObserved, true); assert.equal(result.fenced, true); assert.equal(result.stopReasons.control_failed, true); assert.equal(result.publishingAfterCleanup, false);
});
test('rehearsal signal preserves interrupted status and always fences publication', async () => {
 const simulated = simulatedRehearsal({ abortAt: 2000 });
 const result = await runRehearsal({ env: environment(), directory: await mkdtemp(join(tmpdir(), 'rehearsal-test-')), ...simulated });
 assert.equal(result.exitCode, 130); assert.equal(result.aborted, true); assert.equal(result.publishingAfterCleanup, false); assert.ok(simulated.calls.includes('relay-stop'));
});
test('no-publication never succeeds; failed verification preserves media and failure', async () => {
 for (const options of [{ publishes: false }, { failVerification: true }]) {
  const simulated = simulatedRehearsal(options);
  const result = await runRehearsal({ env: environment(), directory: await mkdtemp(join(tmpdir(), 'rehearsal-test-')), ...simulated });
  assert.equal(result.exitCode, 1); assert.equal(result.passed, false); assert.ok((await readFile(join(result.directory, 'program.ts'))).length > 0);
 }
});
test('synthetic failure classifies fixed diagnostic markers without retaining payloads', async () => {
 const child = fakeChild();
 const pending = runBounded({ command: 'test', args: [], env: {}, spawnProcess: () => child, killGroup: () => {} });
 child.stderr.write('private-canary Program render clock exceeded its pro');
 child.stderr.write('cessing budget private-canary'); child.emit('close', 1, null);
 const result = await pending;
 assert.equal(result.renderClockBudgetExceeded, true); assert.ok(!JSON.stringify(result).includes('private-canary'));
});
test('full isolated timeline succeeds without inventing source loss or recovery', async () => {
 const simulated = simulatedRehearsal();
 const result = await runRehearsal({ env: environment(), directory: await mkdtemp(join(tmpdir(), 'rehearsal-test-')), ...simulated });
 assert.equal(result.exitCode, 0); assert.equal(result.sourceLossObserved, false); assert.equal(result.sourceRecoveryObserved, false);
 assert.equal(result.commands.find(command => command.sequence === 1).hold, true);
 assert.equal(result.commands.find(command => command.sequence === 2).live, true);
 assert.equal(result.realConvexAuthority, false); assert.equal(result.publishingAfterCleanup, false);
});
test('provider guard rejects accidental source credentials and unknown configuration', () => {
 for (const key of ['VRDEX_VRCDN_POC_INGEST_SECRET_JSON', 'VRDEX_PROVIDER_REHEARSAL_OUTPUT_ACCOUNT', 'VRDEX_EVENT_MEDIA_SOURCE_SECRET_JSON']) assert.throws(() => validateRehearsal({ ...environment(), [key]: 'private-canary' }));
});
test('image workflow stays manual, main-bound, immutable and image-only', async () => {
 const { parse } = await import('yaml');
 const source = await readFile('.github/workflows/restream-image.yml', 'utf8'), workflow = parse(source);
 assert.deepEqual(Object.keys(workflow.on), ['workflow_dispatch']);
 assert.equal(workflow.jobs.image.if, "github.ref == 'refs/heads/main'");
 assert.equal(workflow.jobs.image['timeout-minutes'], 20);
 assert.ok(source.includes('git merge-base --is-ancestor "$REQUESTED_SHA" origin/main'));
 assert.ok(source.includes('proof-$REQUESTED_SHA')); assert.ok(source.includes('expected-runtime.sha256'));
 assert.ok(!/aws\s+(ecs|iam|ssm|secretsmanager|s3)\s/.test(source));
 const dockerfile = await readFile('workers/restream/Dockerfile', 'utf8');
 const copies = dockerfile.replace(/\\\n/g, ' ').split('\n').filter(line => line.startsWith('COPY ')).map(line => line.trim().split(/\s+/).slice(1));
 assert.equal(copies.length, 2);
 assert.deepEqual(copies.find(parts => parts.at(-1) === 'scripts/'), ['event-output-local-proof', 'event-proof-metrics', 'event-vrcdn-rehearsal', 'event-proof-runner'].map(name => `scripts/${name}.mjs`).concat('scripts/'));
 assert.deepEqual(copies.find(parts => parts.at(-1) === 'workers/restream/'), ['hosted-worker', 'live-control', 'vrcdn-poc', 'output-sender', 'event-worker', 'source-relay', 'handoff-policy', 'input-supervisor', 'program-renderer'].map(name => `workers/restream/${name}.mjs`).concat('workers/restream/'));
 assert.ok(dockerfile.includes('CMD ["node", "workers/restream/hosted-worker.mjs"]'));
});
test('rehearsal IAM resources are opt-in, standalone, exact and additive', async () => {
 const worker = await readFile('infra/terraform/restream-worker/rehearsal.tf', 'utf8');
 const image = await readFile('infra/terraform/state-mgmt/restream-proof.tf', 'utf8');
 assert.ok(worker.includes('default     = false')); assert.ok(image.includes('default     = false'));
 assert.ok(worker.includes('value = "false"')); assert.ok(!worker.includes('hosted-worker/enabled'));
 for (const name of ['vrdex-restream-rehearsal-source', 'vrdex-restream-rehearsal-switch']) assert.ok(worker.includes(name));
 assert.ok(image.includes('vrdex-restream-proof-image'));
 assert.ok(worker.includes('arn:aws:secretsmanager:us-east-1:079358094174:secret:event-media/vrcdn/basicbit1-smoke-GWQX7c'));
 assert.ok(worker.includes('arn:aws:ssm:us-east-1:079358094174:parameter/vrdex/restream/rehearsal/enabled'));
 assert.ok(!worker.includes('ssm:GetParameters')); assert.ok(!worker.includes('Resource = "*"'));
 assert.ok(image.includes('arn:aws:ecr:us-east-1:079358094174:repository/vrdex-restream-worker'));
 assert.ok(!image.includes('assume_role_policy'));
});
test('bounded runner terminates an actual isolated Node process without media', async () => {
 const result = await runBounded({ command: process.execPath, args: ['-e', 'setInterval(() => {}, 1000)'], env: {}, timeoutMs: 30 });
 assert.equal(result.exitCode, 124); assert.equal(result.timedOut, true);
});
test('required output loss or stalled progress after startup fails and fences the real worker', async () => {
 for (const failure of ['disconnected', 'stalled']) {
  const simulated = simulatedRehearsal(), original = simulated.dependencies.createEventOutputs;
  simulated.dependencies.createEventOutputs = options => {
   const outputs = original(options), getState = outputs.getState;
   return { ...outputs, getState: () => {
    const state = getState();
    if (simulated.dependencies.now() < 1040000 || !state.publishing) return state;
    return { ...state, publishing: failure !== 'disconnected', destinations: [{ outputId: 'basicbit', publishing: failure !== 'disconnected', status: failure === 'disconnected' ? 'reconnecting' : 'publishing', outputMs: failure === 'disconnected' ? 0 : 39000, restarts: 0 }] };
   } };
  };
  const result = await runRehearsal({ env: environment(), directory: await mkdtemp(join(tmpdir(), 'rehearsal-test-')), ...simulated });
  assert.equal(result.exitCode, 1); assert.equal(result.passed, false); assert.equal(result.requiredOutputProgressFailed, true);
  assert.ok(result.wallMs <= 44000); assert.equal(result.publishingAfterCleanup, false);
 }
});
test('signal during provider packet verification is retained in failure evidence', async () => {
 const simulated = simulatedRehearsal(), abort = new AbortController(), verify = simulated.dependencies.verifyProgramPackets;
 let forwardedSignal;
 simulated.dependencies.verifyProgramPackets = async (file, options) => { forwardedSignal = options?.signal; abort.abort(); return verify(file); };
 const result = await runRehearsal({ env: environment(), directory: await mkdtemp(join(tmpdir(), 'rehearsal-test-')), ...simulated, signal: abort.signal });
 assert.equal(result.exitCode, 130); assert.equal(result.passed, false); assert.equal(result.aborted, true); assert.equal(forwardedSignal, abort.signal);
 const saved = JSON.parse(await readFile(join(result.directory, 'rehearsal.json'), 'utf8'));
 assert.equal(saved.exitCode, 130); assert.equal(saved.aborted, true); assert.equal(result.publishingAfterCleanup, false);
});
test('late synthetic finalizer signal cannot return success or replace an earlier failure', async () => {
 for (const prior of [0, 7]) {
  const abort = new AbortController();
  const result = await runSynthetic({ env: { ...environment(), VRDEX_PROOF_RUN_ID: `late-${prior}`, VRDEX_RESTREAM_ARTIFACT_S3_URI: 's3://vrdex-restream-worker-079358094174-artifacts/synthetic-benchmarks' }, signal: abort.signal, run: async () => ({ exitCode: prior }), finalize: async options => { assert.equal(options.signal, abort.signal); abort.abort(); return { exitCode: options.exitCode }; } });
  assert.equal(result.exitCode, prior || 130); assert.equal(result.aborted, true);
 }
});
test('finalizer cancellation stops large uploads and saves interrupted status, including a status-upload signal', async () => {
 for (const phase of ['media', 'status']) {
  const abort = new AbortController(), directory = await mkdtemp(join(tmpdir(), 'rehearsal-test-')), uploads = [];
  await writeFile(join(directory, 'primary.ts'), Buffer.alloc(188));
  await writeFile(join(directory, 'optional-before.ts'), Buffer.alloc(188));
  const result = await finalizeArtifacts({ directory, exitCode: 0, runId: `abort-${phase}`, signal: abort.signal, upload: async (file, target, options = {}) => {
   uploads.push({ target, value: target.endsWith('.json') ? JSON.parse(await readFile(file, 'utf8')) : undefined });
   if (target.endsWith(phase === 'media' ? 'primary.ts' : 'status.json') && !abort.signal.aborted) { if (phase === 'media') assert.equal(options.signal, abort.signal); abort.abort(); }
  } });
  assert.equal(result.exitCode, 130); assert.equal(result.aborted, true);
  assert.equal(uploads.at(-1).value.exitCode, 130); assert.equal(uploads.at(-1).value.aborted, true);
  if (phase === 'media') assert.ok(!uploads.some(value => value.target.endsWith('/optional-before.ts')));
 }
});
test('provider invocation uses the same late-finalization signal and prior-failure preservation', async () => {
 for (const failVerification of [false, true]) {
  const simulated = simulatedRehearsal({ failVerification }), abort = new AbortController();
  const result = await runRehearsal({ env: environment(), directory: await mkdtemp(join(tmpdir(), 'rehearsal-test-')), ...simulated, signal: abort.signal });
  const status = await finalizeProof({ directory: result.directory, exitCode: result.exitCode, env: {}, signal: abort.signal, finalize: async options => { assert.equal(options.signal, abort.signal); abort.abort(); return { exitCode: options.exitCode }; } });
  assert.equal(status.exitCode, failVerification ? 1 : 130); assert.equal(status.aborted, true); assert.equal(result.publishingAfterCleanup, false);
 }
});
test('a real worker switch fence at 119 seconds cannot become a full-duration success', async () => {
 const simulated = simulatedRehearsal({ disabledAt: 119000 }), originalSleep = simulated.dependencies.sleep;
 // Shift the enable refresh from +110 to +114 without expiring its +115 authority.
 simulated.dependencies.sleep = async (...args) => {
  const count = simulated.dependencies.now() === 1109000 ? 5 : 1;
  for (let index = 0; index < count; index++) await originalSleep(...args);
 };
 const result = await runRehearsal({ env: environment(), directory: await mkdtemp(join(tmpdir(), 'rehearsal-test-')), ...simulated });
 assert.equal(result.exitCode, 1); assert.equal(result.passed, false);
 assert.equal(result.switchFalseObserved, true); assert.equal(result.switchDisabledFenceObserved, true);
 assert.equal(result.stopReasons.control_failed, true); assert.equal(result.publishingAfterCleanup, false);
 assert.equal(result.wallMs, 119000);
});
test('a real worker control failure on the final tick cannot be hidden by a last sleep', async () => {
 const simulated = simulatedRehearsal(), originalFactory = simulated.dependencies.createEventWorker;
 simulated.dependencies.createEventWorker = options => {
  const control = options.control;
  return originalFactory({ ...options, control: async (name, ...args) => {
   if (name === 'refreshConfiguration' && simulated.dependencies.now() >= 1119000) throw Error('private-canary');
   return control(name, ...args);
  } });
 };
 const result = await runRehearsal({ env: environment(), directory: await mkdtemp(join(tmpdir(), 'rehearsal-test-')), ...simulated });
 assert.equal(result.exitCode, 1); assert.equal(result.passed, false); assert.equal(result.wallMs, 119000);
 assert.equal(result.stopReasons.control_failed, true); assert.equal(result.publishingAfterCleanup, false);
});
test('a worker fenced during the last sleep cannot pass when the sample clock reaches 120 seconds', async () => {
 const simulated = simulatedRehearsal(), originalFactory = simulated.dependencies.createEventWorker, originalSleep = simulated.dependencies.sleep;
 let worker;
 simulated.dependencies.createEventWorker = options => worker = originalFactory(options);
 simulated.dependencies.sleep = async (...args) => {
  if (simulated.dependencies.now() === 1119000) await worker.stop();
  await originalSleep(...args);
 };
 const result = await runRehearsal({ env: environment(), directory: await mkdtemp(join(tmpdir(), 'rehearsal-test-')), ...simulated });
 assert.equal(result.wallMs, 120000); assert.equal(result.exitCode, 1); assert.equal(result.passed, false);
 assert.equal(result.publishingAfterCleanup, false); assert.equal(result.stopReasons.shutdown, true);
});


test('passive relay wrappers forward exact arguments, promises, requests and response callbacks', async () => {
 let clock = 100, dnsCall, httpCall;
 const answers = [{ address: '8.8.8.8', family: 4 }, { address: '127.0.0.1', family: 4 }];
 const promise = Promise.resolve(answers), request = new EventEmitter(), response = new EventEmitter(), socket = new EventEmitter();
 socket.bytesRead = 10; socket.bytesWritten = 20; response.statusCode = 200;
 const observer = createTransportEvidence({ now: () => clock, lookup(...args) { dnsCall = args; return promise; }, request(...args) { httpCall = args; request.on('response', args[2]); return request; } });
 const dnsOptions = { all: true, family: 4 }, url = new URL('https://example.test/private-canary'), options = { method: 'GET', lookup() {}, agent: false };
 assert.equal(observer.resolveAddresses('private-canary', dnsOptions), promise);
 assert.equal(await promise, answers); await Promise.resolve();
 assert.deepEqual(dnsCall, ['private-canary', dnsOptions]); assert.equal(dnsCall[1], dnsOptions);
 let callbackThis, callbackResponse, closes = 0;
 function callback(value) { callbackThis = this; callbackResponse = value; }
 assert.equal(observer.requestSource(url, options, callback), request);
 assert.equal(httpCall[0], url); assert.equal(httpCall[1], options); assert.equal(httpCall[2], callback);
 request.on('close', () => closes++);
 clock = 110; request.emit('socket', socket); clock = 120; socket.emit('connect'); clock = 130; socket.emit('secureConnect');
 clock = 140; request.emit('response', response);
 assert.equal(callbackResponse, response); assert.equal(callbackThis, request); assert.equal(response.listenerCount('data'), 0);
 socket.bytesRead = 110; socket.bytesWritten = 70;
 clock = 160; response.emit('end'); request.emit('close'); socket.emit('close', false);
 const transport = observer.result();
 assert.equal(closes, 1); assert.equal(transport.dns[0].publicAddresses, 1); assert.equal(transport.dns[0].addresses, 2);
 assert.equal(transport.requests[0].tcpMs, 20); assert.equal(transport.requests[0].tlsMs, 30); assert.equal(transport.requests[0].headersMs, 40);
 assert.equal(transport.requests[0].httpStatus, 200); assert.equal(transport.requests[0].readBytes, 100); assert.equal(transport.requests[0].writtenBytes, 50);
 assert.equal(transport.requests[0].ended, true); assert.equal(transport.requests[0].socketClosed, true);
 assert.ok(!JSON.stringify(transport).includes('private-canary'));
});
test('passive source failures preserve original rejection and distinguish timeout from cleanup', async () => {
 const failure = Error('private-canary https://private.invalid'); failure.code = 'PRIVATE_CANARY';
 const requests = [];
 const observer = createTransportEvidence({ lookup: () => Promise.reject(failure), request: () => { const request = new EventEmitter(); requests.push(request); return request; } });
 await assert.rejects(observer.resolveAddresses('private-canary', {}), value => value === failure);
 const first = observer.requestSource('private-canary', {});
 first.emit('timeout'); first.emit('error', failure);
 const response = new EventEmitter(); response.statusCode = 401; first.emit('response', response); response.emit('aborted'); response.emit('error', failure);
 observer.teardown(); first.emit('close');
 const second = observer.requestSource('private-canary', {}); second.emit('timeout'); second.emit('error', failure); second.emit('close');
 const result = observer.result();
 assert.equal(result.dns[0].failures, 1); assert.equal(result.requests[0].httpStatus, 401); assert.equal(result.requests[0].aborted, true);
 assert.equal(result.requests[0].timeoutCount, 1); assert.equal(result.requests[0].beforeTeardownFailures, 4);
 assert.equal(result.requests[0].closedDuringTeardown, true); assert.equal(result.requests[1].beforeTeardownFailures, 0);
 assert.equal(result.teardownStarted, true); assert.ok(!JSON.stringify(result).includes('private'));
});
test('passive wrappers preserve synchronous throws and survive observer failures', () => {
 const failure = Error('private-canary'), child = fakeChild(), request = new EventEmitter();
 const brokenClock = () => { throw failure; };
 const observer = createTransportEvidence({ now: brokenClock, request: () => request, spawn: () => child, lookup: () => { throw failure; } });
 assert.throws(() => observer.resolveAddresses('private-canary', {}), value => value === failure);
 assert.equal(observer.requestSource('private-canary', {}), request);
 assert.equal(observer.spawnForDestination('vrcdn')('ffmpeg', [], {}), child);
 const socket = new EventEmitter(); Object.defineProperty(socket, 'bytesRead', { get() { throw failure; } });
 assert.doesNotThrow(() => { request.emit('socket', socket); socket.emit('connect'); request.emit('close'); child.stderr.write('Connection timed out'); child.emit('close', 1, null); observer.observeInput(new Proxy({}, { get() { throw failure; } })); });
});
test('sender observation preserves spawn arguments, draining, close callbacks and fixed split markers', () => {
 const child = fakeChild(); let forwarded, drained = 0, closed = 0, clock = 0;
 const observer = createTransportEvidence({ now: () => clock, spawn(...args) { forwarded = args; return child; } });
 const args = ['-rtmp_playpath', 'private-canary'], options = { env: { PRIVATE: 'private-canary' }, stdio: ['pipe', 'ignore', 'pipe', 'pipe'] };
 assert.equal(observer.spawnForDestination('vrcdn')('ffmpeg', args, options), child);
 assert.equal(forwarded[1], args); assert.equal(forwarded[2], options);
 child.stderr.on('data', chunk => { drained += chunk.length; }); child.on('close', () => closed++);
 child.stderr.write('private-canary Connection timed o'); child.stderr.write('ut Connection refused Network is unreachable Failed to resolve hostname TLS handshake failed RTMP handshake failed Server error: NetStream.Publish.BadName Invalid data found when processing input Unrecognized option');
 clock = 50; child.emit('close', 1, 'SIGKILL');
 const attempt = observer.result().senders[0];
 assert.equal(closed, 1); assert.equal(attempt.stderrBytes, drained); assert.equal(attempt.exitCode, 1); assert.equal(attempt.sigkill, true); assert.equal(attempt.closeMs, 50);
 for (const field of ['timedOut', 'refused', 'unreachable', 'dnsFailed', 'tlsFailed', 'handshakeFailed', 'rejectionIndicated', 'invalidInput', 'invalidOption']) assert.equal(attempt[field], true, field);
 assert.equal(attempt.tailBytes, 0); assert.ok(!JSON.stringify(observer.result()).includes('private-canary'));
});
test('transport attempts, counters, input observations and stderr scanning stay explicitly bounded', async () => {
 const children = [];
 const observer = createTransportEvidence({ lookup: () => Promise.resolve([]), request: () => new EventEmitter(), spawn: () => { const child = fakeChild(); children.push(child); return child; } });
 for (let index = 0; index < 1000; index++) { await observer.resolveAddresses('private-canary'); observer.requestSource('private-canary'); observer.spawnForDestination('vrcdn')('ffmpeg', ['private-canary'], {}); observer.observeInput({ ready: true, progressing: true, observedAt: Infinity, sourceId: 'private-canary' }, { frame: Buffer.alloc(1), audioBytes: 1e100 }); }
 children[0].stderr.write(Buffer.alloc(1024 * 1024, 120));
 let result = observer.result();
 assert.equal(result.dns.length, 32); assert.equal(result.requests.length, 32); assert.equal(result.senders.length, 16); assert.equal(result.inputs.length, 64);
 assert.equal(result.dnsOmitted, 968); assert.equal(result.requestsOmitted, 968); assert.equal(result.sendersOmitted, 984);
 assert.equal(result.inputs[0].pcmBytes, 1e9); assert.equal(result.inputs[0].framePresent, true); assert.equal(result.inputs[0].observedAt, undefined);
 assert.equal(result.senders[0].stderrBytes, 1024 * 1024); assert.equal(result.senders[0].scannedBytes, 65536); assert.ok(result.senders[0].tailBytes <= 128);
 children[0].emit('close', 1, null); result = observer.result(); assert.equal(result.senders[0].tailBytes, 0);
 assert.ok(JSON.stringify(result).length < 40000); assert.ok(!JSON.stringify(result).includes('private-canary'));
});
test('rehearsal wires passive transport evidence and finalizer retains safe fields', async () => {
 const simulated = simulatedRehearsal({ publishes: false }); let relayOptions, outputOptions;
 simulated.dependencies.createSourceRelay = async options => { relayOptions = options; return { stop() {}, resolveSource() {}, retainSources() {} }; };
 const rendererFactory = simulated.dependencies.createProgramRenderer;
 simulated.dependencies.createProgramRenderer = options => { options.onObservation({ ready: true, progressing: true, observedAt: 123, sourceId: 'private-canary' }); options.onProgress({ outputMs: 10 }); return rendererFactory(options); };
 const outputFactory = simulated.dependencies.createEventOutputs;
 simulated.dependencies.createEventOutputs = options => { outputOptions = options; return outputFactory(options); };
 const result = await runRehearsal({ env: environment(), directory: await mkdtemp(join(tmpdir(), 'rehearsal-test-')), ...simulated });
 assert.equal(typeof relayOptions.resolveAddresses, 'function'); assert.equal(typeof relayOptions.requestSource, 'function'); assert.equal(typeof outputOptions.spawnForDestination, 'function');
 assert.equal(result.exitCode, 1); assert.equal(result.transport.teardownStarted, true); assert.equal(result.transport.inputs[0].ready, true); assert.equal(result.transport.progressObserved, true);
 const uploads = [];
 await finalizeArtifacts({ directory: result.directory, exitCode: result.exitCode, runId: 'transport-unit', upload: async (file, target) => { if (target.endsWith('/rehearsal.json')) uploads.push(JSON.parse(await readFile(file, 'utf8'))); } });
 assert.equal(uploads.length, 1); assert.deepEqual(uploads[0].transport, result.transport); assert.ok(!JSON.stringify(uploads).includes('private-canary'));
});


test('socket-only failures and sender exit 146 remain indicators before teardown, with late DNS completion', async () => {
 let complete, clock = 0;
 const child = fakeChild(), request = new EventEmitter(), socket = new EventEmitter();
 const observer = createTransportEvidence({ now: () => clock, lookup: () => new Promise(resolve => { complete = resolve; }), request: () => request, spawn: () => child });
 const pending = observer.resolveAddresses('private-canary'); observer.requestSource('private-canary'); request.emit('socket', socket);
 socket.emit('timeout'); socket.emit('error', Error('private-canary')); observer.spawnForDestination('vrcdn')('ffmpeg', [], {});
 child.stderr.write('Cannot read RTMP handshake response Connection timed out'); clock = 2100; child.emit('close', 146, null);
 observer.teardown(); clock = 2500; complete(Array.from({ length: 1000 }, () => ({ address: '8.8.8.8', family: 4 }))); await pending;
 socket.emit('timeout'); socket.emit('error', Error('private-canary'));
 const result = observer.result();
 assert.equal(result.requests[0].socketBeforeTeardownFailures, 2); assert.equal(result.requests[0].socketTimeoutCount, 2); assert.equal(result.requests[0].socketFailures, 2);
 assert.equal(result.senders[0].exitCode, 146); assert.equal(result.senders[0].handshakeFailed, true); assert.equal(result.senders[0].timedOut, true); assert.equal(result.senders[0].beforeTeardownFailures, 1);
 assert.equal(result.dns[0].doneMs, 2500); assert.equal(result.dns[0].doneDuringTeardown, true); assert.equal(result.dns[0].addressesInspected, 256); assert.equal(result.dns[0].addressesOmitted, 744);
});
test('a snapshot getter failure cannot change an otherwise successful rehearsal', async () => {
 const simulated = simulatedRehearsal(), factory = simulated.dependencies.createProgramRenderer;
 simulated.dependencies.createProgramRenderer = options => {
  const renderer = factory(options), inputs = renderer.getInputs;
  return { ...renderer, getInputs: () => inputs().map(input => Object.defineProperty(input, 'buffer', { get() { throw Error('private-canary'); } })) };
 };
 const result = await runRehearsal({ env: environment(), directory: await mkdtemp(join(tmpdir(), 'rehearsal-test-')), ...simulated });
 assert.equal(result.exitCode, 0); assert.equal(result.passed, true);
});
