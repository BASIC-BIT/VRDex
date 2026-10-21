import assert from 'node:assert/strict';
import { createServer, request as httpRequest } from 'node:http';
import { createSourceRelay } from '../workers/restream/source-relay.mjs';
import { spawn, execFileSync } from 'node:child_process';
import { mkdtemp, writeFile } from 'node:fs/promises';
import { setTimeout as sleep } from 'node:timers/promises';
import { createEventWorker } from '../workers/restream/event-worker.mjs';
import { createProgramRenderer } from '../workers/restream/program-renderer.mjs';
import { createEventOutputs } from '../workers/restream/output-sender.mjs';
import { verifyProgramPackets } from './event-proof-metrics.mjs';

// Synthetic control and local transport only; all media/runtime modules are packaged.
const directory = await mkdtemp(process.env.PROOF_DIRECTORY_PREFIX ?? '/tmp/event-next-proof-');
const begun = Date.now(), samples = [], acknowledgements = [], observations = [];
const compliance = { sourceConsent: 'accepted', destinationAuthority: 'accepted', providerRules: 'accepted', rightsClearedMedia: 'accepted' };
const configuration = {
  sessionDeadline: begun + 120000, mode: 'hold', policy: {},
  sources: ['a', 'b'].map(id => ({ id, type: 'vrcdn_link', publicUrl: `https://stream.vrcdn.live/live/proof-${id}.live.ts` })),
  slots: [{ slotKey: 'a', sourceId: 'a', startAt: begun - 60000, endAt: begun - 1000, available: true }, { slotKey: 'b', sourceId: 'b', startAt: begun + 90000, endAt: begun + 110000, available: true }],
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
const file = `${directory}/next.ts`;
const receiver = spawn('ffmpeg', ['-hide_banner', '-loglevel', 'error', '-listen', '1', '-i', 'rtmp://127.0.0.1:19881/live/test-key', '-c', 'copy', '-f', 'mpegts', '-y', file], { stdio: 'ignore' });
const renderer = createProgramRenderer();
const outputs = createEventOutputs({ configuration,
  resolveCredential: () => JSON.stringify({ rtmpUrl: 'rtmp://uk.ingest.vrcdn.live/live', streamKey: 'test-key' }),
  spawnForDestination: () => (command, args, options) => { const local = [...args]; local[local.length - 1] = 'rtmp://127.0.0.1:19881/live'; return spawn(command, local, options); },
});
let commands = [], sequence = 0, renewals = 0, watchdog;
const worker = createEventWorker({ identity: { eventId: 'local', sessionId: 'command-proof', workerId: 'command-proof', epoch: 0 }, renderer, outputs,
  resolveSource: source => relay.resolveSource(source), retainSources: sources => relay.retainSources(sources), checkEnabled: async () => true,
  control: async (name, args) => {
    if (name === 'acquireSession' || name === 'renewSession') { if (name === 'renewSession') renewals++; return { granted: true, epoch: 1, serverNow: Date.now(), expiresAt: Date.now() + 30000, renewAfterMs: 10000, configuration: structuredClone(configuration) }; }
    if (name === 'refreshConfiguration') return { granted: true, serverNow: Date.now(), configuration: structuredClone(configuration) };
    if (name === 'claimCommands') return { granted: true, commands };
    if (name === 'acknowledgeCommand') { acknowledgements.push({ at: Date.now(), renderedSourceId: renderer.getState().renderedSourceId ?? null, outputMs: renderer.getState().outputMs, ...args }); commands = []; }
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
const mediaSamples = [];
async function sample(label, expected) {
  const deadline = Date.now() + 1200;
  while (Date.now() < deadline) {
    await step();
    assert.equal(renderer.getState().renderedSourceId ?? null, expected, label);
  }
  mediaSamples.push({ label, expected, outputMs: renderer.getState().outputMs });
}
async function next(type, expected) {
  const ack = await command(type);
  assert.equal(ack.outcome, expected === undefined ? 'failed' : 'succeeded');
  if (expected !== undefined) {
    assert.equal(ack.observedSourceId, expected);
    assert.equal(ack.renderedSourceId, expected);
  }
  return ack;
}
try {
  await sleep(300); await worker.start(); watchdog = setInterval(() => worker.watchdog(), 50);
  await until(() => outputs.getState().publishing && renderer.getState().outputMs > 1000);
  await sample('initial gap slate', null);
  await next('switch_next', undefined);
  assert.equal(worker.getState().mode, 'hold');
  await sample('failed Next keeps slate', null);
  enabledB = true;
  await sample('late recovery does not publish failed target', null);
  await next('next_slot', 'b');
  assert(Date.now() < configuration.slots[1].startAt, 'explicit Next selected future B early');
  await sample('Next from gap publishes green B', 'b');
  const automatic = await command('set_automatic_mode');
  assert.equal(automatic.outcome, 'succeeded'); assert.equal(automatic.observedSourceId, null);
  await sample('automatic mode stays on gap slate before B boundary', null);
  await command('switch_source', 'a');
  await sample('manual expired A is red', 'a');
  configuration.slots[0].available = false;
  await next('switch_next', 'b');
  await sample('Next from unavailable current publishes green B', 'b');
  configuration.slots[0].available = true;
  await command('switch_source', 'a');
  await sample('manual A before removal is red', 'a');
  configuration.slots.shift();
  await next('next_slot', 'b');
  await sample('Next from removed current publishes green B', 'b');
  configuration.slots[0].startAt = begun - 60000;
  configuration.slots[0].endAt = begun - 1000;
  const afterLast = await command('set_automatic_mode');
  assert.equal(afterLast.observedSourceId, null);
  await next('next_slot', undefined);
  await sample('Next after last fails and keeps slate', null);
  configuration.slots[0].endAt = Date.now() + 60000;
  await next('switch_next', 'b');
  await sample('Next from slate joins current interval B', 'b');
  assert(renewals > 0); assert(observations.length > 0);
  clearInterval(watchdog); await worker.stop(); receiver.kill('SIGINT');
  if (receiver.exitCode === null) await new Promise(resolve => receiver.once('exit', resolve));
  const probe = await verifyProgramPackets(file); assert(probe.maxGap < 0.2); assert(probe.maxGop <= 1.05);
  await writeFile(`${directory}/media-samples.json`, JSON.stringify(mediaSamples, null, 2));
  const colors = acknowledgements.filter(ack => ack.observedSourceId).map(ack => {
    // Sample during the stable window after this encoded acknowledgement.
    const sample = { sequence: ack.sequence, expected: ack.observedSourceId, outputMs: ack.outputMs + 500 };
    const rgb = execFileSync('ffmpeg', ['-v', 'error', '-i', file, '-ss', String(sample.outputMs / 1000), '-frames:v', '1', '-vf', 'scale=1:1', '-f', 'rawvideo', '-pix_fmt', 'rgb24', 'pipe:1']);
    assert.equal(rgb.length, 3);
    if (sample.expected === 'a') assert(rgb[0] > 150 && rgb[1] < 60 && rgb[2] < 60, `red A sequence ${sample.sequence} pixels: ${[...rgb]}`);
    else assert(rgb[1] > 70 && rgb[0] < 60 && rgb[2] < 60, `green B sequence ${sample.sequence} pixels: ${[...rgb]}`);
    return { ...sample, rgb: [...rgb] };
  });
  const result = { passed: true, node: process.version, directory, elapsedMs: Date.now() - begun, renewals, acknowledgements, observationCount: observations.length, mediaSamples, colors, providerRequests, maxPacketGapSeconds: probe.maxGap, maxGopSeconds: probe.maxGop, streams: probe.streams, limits: 'Packaged Node22 real controller/relay HTTP/decoder/renderer/encoder/sender; injected local control and provider DNS/transport plus local RTMP sink. Production HTTPS/SSRF defaults unchanged. No hosted/provider acceptance or new two-hour soak.' };
  await writeFile(`${directory}/observations.json`, JSON.stringify(observations, null, 2));
  await writeFile(`${directory}/result.json`, JSON.stringify(result, null, 2)); console.log(JSON.stringify(result));
} finally {
  clearInterval(watchdog); await worker.stop(); relay.stop(); provider.closeAllConnections(); provider.close(); receiver.kill('SIGKILL'); for (const child of sources) child.kill('SIGKILL');
  await writeFile(`${directory}/samples.json`, JSON.stringify(samples, null, 2));
  await writeFile(`${directory}/acknowledgements.json`, JSON.stringify(acknowledgements, null, 2));
}
