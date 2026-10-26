import assert from 'node:assert/strict';
import { createServer, request as httpRequest } from 'node:http';
import { createSourceRelay } from '../workers/restream/source-relay.mjs';
import { spawn } from 'node:child_process';
import { mkdtemp, writeFile } from 'node:fs/promises';
import { setTimeout as sleep } from 'node:timers/promises';
import { createProofWorker as createEventWorker, syntheticInputs } from './event-proof-fixtures.mjs';
import { createProgramRenderer } from '../workers/restream/program-renderer.mjs';
import { createEventOutputs } from '../workers/restream/output-sender.mjs';
import { verifyProgramPackets } from './event-proof-metrics.mjs';

// Synthetic control and local transport only; all media/runtime modules are packaged.
const directory = await mkdtemp(process.env.PROOF_DIRECTORY_PREFIX ?? '/tmp/event-relay-proof-');
const begun = Date.now(), samples = [], acknowledgements = [], observations = [];
const compliance = { sourceConsent: 'accepted', destinationAuthority: 'accepted', providerRules: 'accepted', rightsClearedMedia: 'accepted' };
const configuration = {
  sessionDeadline: begun + 120000, mode: 'automatic', policy: {},
  sources: ['a', 'b'].map(id => ({ id, type: 'vrcdn_link', publicUrl: `https://stream.vrcdn.live/live/proof-${id}.live.ts` })),
  slots: [{ slotKey: 'a', sourceId: 'a', startAt: begun - 1000, endAt: begun + 90000, available: true }, { slotKey: 'b', sourceId: 'b', startAt: begun + 100000, available: true }],
  outputId: 'primary', outputs: [{ id: 'primary', type: 'vrcdn', credential: { secretRef: 'primary' }, compliance }],
};
const sources = new Set(), providerRequests = [];
let enabledB = false;
const provider = createServer((req, res) => {
  providerRequests.push({ path: req.url, at: Date.now() });
  const b = req.url.includes('proof-b');
  if (b && !enabledB) { res.writeHead(503).end(); return; }
  const rotated = req.url.includes('-v2');
  res.writeHead(200, { 'content-type': 'video/mp2t' });
  const child = spawn('ffmpeg', ['-hide_banner', '-loglevel', 'error', '-re', '-f', 'lavfi', '-i', `color=c=${b ? 'green' : rotated ? 'blue' : 'red'}:s=1280x720:r=30`, '-re', '-f', 'lavfi', '-i', `sine=frequency=${b ? 880 : rotated ? 660 : 440}:sample_rate=48000`, '-c:v', 'libx264', '-threads', '1', '-preset', 'ultrafast', '-tune', 'zerolatency', '-g', '30', '-c:a', 'aac', '-f', 'mpegts', 'pipe:1'], { stdio: ['ignore', 'pipe', 'ignore'] });
  sources.add(child); child.stdout.pipe(res); res.on('close', () => child.kill('SIGKILL')); child.on('exit', () => sources.delete(child));
});
await new Promise(resolve => provider.listen(0, '127.0.0.1', resolve));
// Inject only provider DNS/transport. The packaged relay still validates URLs,
// pins the validated public IPv4, serves loopback HTTP, and owns stream teardown.
const relay = await createSourceRelay({
  resolveAddresses: async () => [{ address: '93.184.216.34', family: 4 }],
  requestSource: (url, options, callback) => {
    options.lookup(url.hostname, {}, (error, address) => { assert.equal(error, null); assert.equal(address, '93.184.216.34'); });
    return httpRequest(`http://127.0.0.1:${provider.address().port}${url.pathname}`, callback);
  },
});
for (let i = 0; i < 70; i++) {
  const source = { id: `historical-${i}`, type: 'vrcdn_link', publicUrl: `https://stream.vrcdn.live/live/history-${i}.live.ts` };
  relay.retainSources([source]); relay.resolveSource(source);
}
relay.retainSources([]);
const file = `${directory}/relay.ts`;
const receiver = spawn('ffmpeg', ['-hide_banner', '-loglevel', 'error', '-listen', '1', '-i', 'rtmp://127.0.0.1:19881/live/test-key', '-c', 'copy', '-f', 'mpegts', '-y', file], { stdio: 'ignore' });
const renderer = createProgramRenderer();
const outputs = createEventOutputs({ configuration,
  resolveCredential: () => JSON.stringify({ rtmpUrl: 'rtmp://uk.ingest.vrcdn.live/live', streamKey: 'test-key' }),
  spawnForDestination: () => (command, args, options) => { const local = [...args]; local[local.length - 1] = 'rtmp://127.0.0.1:19881/live'; return spawn(command, local, options); },
});
let commands = [], sequence = 0, renewals = 0, watchdog;
const worker = createEventWorker({ identity: { eventId: 'local', sessionId: 'command-proof', workerId: 'command-proof', epoch: 0 }, renderer, outputs,
  inputs: syntheticInputs(undefined, relay), checkEnabled: async () => true,
  control: async (name, args) => {
    if (name === 'acquireSession' || name === 'renewSession') { if (name === 'renewSession') renewals++; return { granted: true, epoch: 1, serverNow: Date.now(), expiresAt: Date.now() + 30000, renewAfterMs: 10000, configuration: structuredClone(configuration) }; }
    if (name === 'refreshConfiguration') return { granted: true, serverNow: Date.now(), configuration: structuredClone(configuration) };
    if (name === 'claimCommands') return { granted: true, commands };
    if (name === 'acknowledgeCommand') { acknowledgements.push({ at: Date.now(), ...args }); commands = []; }
    if (name === 'observeProgram') observations.push({ at: Date.now(), ...args });
    return { accepted: true };
  },
});
async function step() {
  await worker.tick(); await sleep(250);
  assert.equal(worker.getState().stopped, false);
  const state = renderer.getState();
  samples.push({ at: Date.now(), source: state.renderedSourceId ?? null, publishing: outputs.getState().publishing, mode: worker.getState().mode, current: worker.getState().current?.sourceId });
}
async function until(predicate, ms = 12000) {
  const deadline = Date.now() + ms;
  do { await step(); if (predicate()) return; } while (Date.now() < deadline);
  throw Error('Proof condition deadline exceeded');
}
async function command(commandType, targetSourceId) {
  commands = [{ _id: `command-${++sequence}`, sequence, commandType, targetSourceId }];
  await until(() => acknowledgements.at(-1)?.sequence === sequence, 20000);
  return acknowledgements.at(-1);
}
try {
  await sleep(300); await worker.start(); watchdog = setInterval(() => worker.watchdog(), 50);
  await until(() => renderer.getState().renderedSourceId === 'a' && outputs.getState().publishing);
  const oldRoute = relay.resolveSource(configuration.sources[0]);
  configuration.sources[0].publicUrl = 'https://stream.vrcdn.live/live/proof-a-v2.live.ts';
  await until(() => providerRequests.some(request => request.path.includes('proof-a-v2')) && renderer.getState().renderedSourceId === 'a' && outputs.getState().publishing);
  assert.equal((await fetch(oldRoute)).status, 404);
  const currentConnections = providerRequests.filter(request => request.path.includes('proof-a')).length;
  const failureBegan = Date.now();
  const failed = await command('switch_source', 'b');
  assert.equal(failed.outcome, 'failed');
  assert.equal(worker.getState().current.sourceId, 'a'); assert.equal(worker.getState().mode, 'automatic');
  assert(samples.filter(sample => sample.at >= failureBegan).every(sample => sample.source === 'a'), 'healthy A remains published throughout failed B preparation');
  assert.equal(providerRequests.filter(request => request.path.includes('proof-a')).length, currentConnections, 'current HTTP stream survives repeated warm-target reconciliation');
  enabledB = true;
  const recoveryUntil = Date.now() + 4000;
  while (Date.now() < recoveryUntil) { await step(); assert.equal(renderer.getState().renderedSourceId, 'a', 'late B recovery cannot publish failed target'); }
  const retried = await command('switch_source', 'b');
  assert.equal(retried.outcome, 'succeeded'); assert.equal(retried.observedSourceId, 'b');
  configuration.sources[0].publicUrl = 'https://stream.vrcdn.live/live/proof-a-v2.live.ts';
  const returned = await command('set_automatic_mode');
  assert(providerRequests.some(request => request.path.includes('proof-a-v2')));
  assert.equal(returned.outcome, 'succeeded'); assert.equal(returned.observedSourceId, 'a');
  assert.equal(worker.getState().mode, 'automatic');
  await command('switch_source', 'b');
  configuration.slots[0].endAt = Date.now() - 1000;
  const gap = await command('set_automatic_mode');
  assert.equal(gap.outcome, 'succeeded'); assert.equal(gap.observedSourceId, null);
  assert.equal(renderer.getState().renderedSourceId, undefined);
  assert(renewals > 0); assert(observations.length > 0);
  clearInterval(watchdog); await worker.stop(); receiver.kill('SIGINT');
  if (receiver.exitCode === null) await new Promise(resolve => receiver.once('exit', resolve));
  const probe = await verifyProgramPackets(file); assert(probe.maxGap < 0.2); assert(probe.maxGop <= 1.05);
  const result = { passed: true, node: process.version, directory, elapsedMs: Date.now() - begun, renewals, acknowledgements, observationCount: observations.length, historicalSources: 70, providerRequests, maxPacketGapSeconds: probe.maxGap, maxGopSeconds: probe.maxGop, streams: probe.streams, limits: 'Packaged Node22 real controller/relay HTTP/decoder/renderer/encoder/sender; injected local control and provider DNS/transport plus local RTMP sink. Production HTTPS/SSRF defaults unchanged. No hosted/provider acceptance or new two-hour soak.' };
  await writeFile(`${directory}/samples.json`, JSON.stringify(samples, null, 2));
  await writeFile(`${directory}/observations.json`, JSON.stringify(observations, null, 2));
  await writeFile(`${directory}/result.json`, JSON.stringify(result, null, 2)); console.log(JSON.stringify(result));
} finally {
  clearInterval(watchdog); await worker.stop(); relay.stop(); provider.closeAllConnections(); provider.close(); receiver.kill('SIGKILL'); for (const child of sources) child.kill('SIGKILL');
  await writeFile(`${directory}/samples.json`, JSON.stringify(samples, null, 2));
  await writeFile(`${directory}/acknowledgements.json`, JSON.stringify(acknowledgements, null, 2));
}
