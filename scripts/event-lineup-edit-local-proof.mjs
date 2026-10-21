import assert from 'node:assert/strict';
import { createServer, request as httpRequest } from 'node:http';
import { createSourceRelay } from '../workers/restream/source-relay.mjs';
import { spawn, execFileSync } from 'node:child_process';
import { PerformanceObserver, monitorEventLoopDelay } from 'node:perf_hooks';
import { chmod, mkdtemp, writeFile, readFile, readdir } from 'node:fs/promises';
import { setTimeout as sleep } from 'node:timers/promises';
import { createEventWorker } from '../workers/restream/event-worker.mjs';
import { createProgramRenderer } from '../workers/restream/program-renderer.mjs';
import { createEventOutputs } from '../workers/restream/output-sender.mjs';
import { verifyProgramPackets } from './event-proof-metrics.mjs';

// Synthetic control and local transport only; all media/runtime modules are packaged.
const directory = await mkdtemp(process.env.PROOF_DIRECTORY_PREFIX ?? '/tmp/event-lineup-edit-proof-');
await chmod(directory, 0o755);
const begun = Date.now(), samples = [], acknowledgements = [], observations = [], metrics = [], resourceSamples = [];
let resourceTimer, samplingResources = false, gcCursor = 0;
const gcEvents = [], loopDelay = monitorEventLoopDelay({ resolution: 20 });
const gcObserver = new PerformanceObserver(list => { for (const entry of list.getEntries()) gcEvents.push({ startTime: entry.startTime, duration: entry.duration, kind: entry.detail?.kind }); });
gcObserver.observe({ entryTypes: ['gc'] }); loopDelay.enable();
const compliance = { sourceConsent: 'accepted', destinationAuthority: 'accepted', providerRules: 'accepted', rightsClearedMedia: 'accepted' };
const configuration = {
  sessionDeadline: begun + 180000, mode: 'automatic', policy: {},
  sources: ['a', 'b', 'c'].map(id => ({ id, type: 'vrcdn_link', publicUrl: `https://stream.vrcdn.live/live/proof-${id}.live.ts` })),
  slots: [{ slotKey: 'c', sourceId: 'c', startAt: begun - 90000, endAt: begun - 70000, available: true }, { slotKey: 'a', sourceId: 'a', startAt: begun - 60000, endAt: begun + 120000, available: true }, { slotKey: 'b', sourceId: 'b', startAt: begun + 125000, endAt: begun + 160000, available: true }],
  outputId: 'primary', outputs: [{ id: 'primary', type: 'vrcdn', credential: { secretRef: 'primary' }, compliance }],
};
const sources = new Set(), providerRequests = [];
let enabledB = false, deadA = false;
const sourceIdentities = new Map();
const provider = createServer((req, res) => {
  providerRequests.push({ path: req.url, at: Date.now() });
  const b = req.url.includes('proof-b'), c = req.url.includes('proof-c');
  if (deadA && !b && !c) { res.writeHead(503).end(); return; }
  if (b && !enabledB) { res.writeHead(503).end(); return; }
  const rotated = req.url.includes('-v2');
  res.writeHead(200, { 'content-type': 'video/mp2t' });
  const child = spawn('ffmpeg', ['-hide_banner', '-loglevel', 'error', '-re', '-f', 'lavfi', '-i', `color=c=${b ? 'green' : c || rotated ? 'blue' : 'red'}:s=1280x720:r=30`, '-re', '-f', 'lavfi', '-i', `sine=frequency=${b ? 880 : rotated ? 660 : 440}:sample_rate=48000`, '-c:v', 'libx264', '-threads', '1', '-preset', 'ultrafast', '-tune', 'zerolatency', '-g', '30', '-c:a', 'aac', '-f', 'mpegts', 'pipe:1'], { stdio: ['ignore', 'pipe', 'ignore'] });
  sources.add(child); sourceIdentities.set(child, b ? 'b' : c ? 'c' : 'a'); child.stdout.pipe(res); res.on('close', () => child.kill('SIGKILL')); child.on('exit', () => sources.delete(child));
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
const file = `${directory}/lineup-edit.ts`;
const receiver = spawn('ffmpeg', ['-hide_banner', '-loglevel', 'error', '-listen', '1', '-i', 'rtmp://127.0.0.1:19881/live/test-key', '-c', 'copy', '-f', 'mpegts', '-y', file], { stdio: 'ignore' });
const renderer = createProgramRenderer({ onError: error => metrics.push({ at: Date.now(), rendererError: error.message }) });
const outputs = createEventOutputs({ configuration,
  resolveCredential: () => JSON.stringify({ rtmpUrl: 'rtmp://uk.ingest.vrcdn.live/live', streamKey: 'test-key' }),
  spawnForDestination: () => (command, args, options) => { const local = [...args]; local[local.length - 1] = 'rtmp://127.0.0.1:19881/live'; return spawn(command, local, options); },
});
let commands = [], sequence = 0, renewals = 0, watchdog;
const worker = createEventWorker({ identity: { eventId: 'local', sessionId: 'command-proof', workerId: 'command-proof', epoch: 0 }, renderer, outputs, metric: value => metrics.push({ at: Date.now(), ...value }),
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
  samples.push({ at: Date.now(), renderer: state, inputs: renderer.getInputs().map(input => input.getObservation()), generatorCount: sources.size, source: state.renderedSourceId ?? null, publishing: outputs.getState().publishing, mode: worker.getState().mode, current: worker.getState().current?.sourceId });
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
  assert.equal(observations.at(-1)?.sourceId ?? null, expected, `${label} control observation`);
  assert.equal(observations.at(-1)?.state, expected === null ? 'hold' : 'live');
  assert.equal(outputs.getState().publishing, true);
  mediaSamples.push({ label, expected, outputMs: renderer.getState().outputMs - 500 });
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
async function sampleResources() {
  if (samplingResources) return;
  samplingResources = true;
  try {
    const processes = [];
    for (const id of (await readdir('/proc')).filter(id => /^\d+$/.test(id))) {
      try {
        const raw = await readFile(`/proc/${id}/stat`, 'utf8'), fields = raw.slice(raw.lastIndexOf(')') + 2).split(' ');
        const cmd = (await readFile(`/proc/${id}/cmdline`, 'utf8')).replaceAll('\0', ' ');
        const pid = Number(id);
        const role = pid === process.pid ? 'controller' : pid === receiver.pid ? 'receiver' : [...sources].some(child => child.pid === pid) ? 'generator' : cmd.includes('showinfo,scale=') ? 'decoder' : cmd.includes('-video_size 1280x720') ? 'renderer-encoder' : cmd.includes('ffmpeg') ? 'sender' : 'other';
        processes.push({ pid, parent: Number(fields[1]), role, cpuTicks: Number(fields[11]) + Number(fields[12]), rssBytes: Number(fields[21]) * 4096, threads: Number(fields[17]), minorFaults: Number(fields[7]), majorFaults: Number(fields[9]) });
      } catch { /* Exited between reads. */ }
    }
    const cpu = await readFile('/sys/fs/cgroup/cpu.stat', 'utf8').catch(() => '');
    const memory = {};
    for (const name of ['memory.current', 'memory.stat', 'memory.events', 'memory.pressure', 'cpu.pressure', 'cpu.max', 'memory.max']) memory[name] = await readFile(`/sys/fs/cgroup/${name}`, 'utf8').catch(() => 'unavailable');
    const cpuStat = Object.fromEntries(cpu.trim().split('\n').filter(Boolean).map(line => {const [key,value] = line.split(' ');return [key,Number(value)];}));
    resourceSamples.push({ at: Date.now(), monotonicNow: performance.now(), cpuStat, cgroupMemory: memory, memory: process.memoryUsage(), loopDelayMs: { max: loopDelay.max / 1e6, p99: loopDelay.percentile(99) / 1e6 }, gcEvents: gcEvents.slice(gcCursor), renderer: renderer.getState(), generatorCount: sources.size, processes });
    await writeFile(`${directory}/resource-samples.json`, JSON.stringify(resourceSamples, null, 2));
    gcCursor = gcEvents.length; loopDelay.reset();
  } finally { samplingResources = false; }
}
try {
  await sleep(300); await worker.start(); await sampleResources(); resourceTimer = setInterval(() => void sampleResources(), 1000); watchdog = setInterval(() => worker.watchdog(), 50);
  await until(() => outputs.getState().publishing && renderer.getState().outputMs > 1000);
  await until(() => renderer.getState().renderedSourceId === 'a');
  await sample('established automatic A red', 'a');
  await step(); await step();
  const manualC = await command('switch_source', 'c');
  assert.equal(manualC.outcome, 'succeeded'); assert.equal(manualC.observedSourceId, 'c'); assert.equal(manualC.renderedSourceId, 'c');
  await sample('expired C is actually decodable blue', 'c');
  const automaticA = await command('set_automatic_mode');
  assert.equal(automaticA.outcome, 'succeeded'); assert.equal(automaticA.observedSourceId, 'a'); assert.equal(automaticA.renderedSourceId, 'a');
  await sample('return automatic A red', 'a');
  const obsoleteEndAt = configuration.slots.find(slot => slot.slotKey === 'a').endAt;
  configuration.slots = [configuration.slots[0], { ...configuration.slots[2], startAt: begun - 1000 }];
  await until(() => renderer.getState().renderedSourceId === undefined);
  await sample('removed A fences to slate while B unready', null);
  enabledB = true;
  await until(() => renderer.getState().renderedSourceId === 'b', 20000);
  assert(Date.now() < obsoleteEndAt, 'removed A future end must not delay replacement');
  await sample('current interval B green before obsolete A end', 'b');
  const boundary = Date.now() + 8000;
  configuration.slots = [configuration.slots[0], { slotKey: 'a', sourceId: 'a', startAt: boundary, endAt: boundary + 5000, available: true }, { slotKey: 'b', sourceId: 'b', startAt: boundary + 5000, endAt: begun + 160000, available: true }];
  // Remove B as the current identity while preserving a future B successor later.
  configuration.slots[2].slotKey = 'b-later';
  await until(() => renderer.getState().renderedSourceId === undefined);
  await sample('future A gap slate', null);
  while (Date.now() < boundary - 300) { await step(); assert.equal(renderer.getState().renderedSourceId, undefined, 'no early automatic promotion'); }
  await until(() => renderer.getState().renderedSourceId === 'a');
  await sample('A red at future boundary', 'a');
  await until(() => Date.now() >= boundary + 6500 && renderer.getInputs().some(input => input.source.slotKey === 'b-later' && input.getObservation().ready));
  await sample('healthy A overruns with decoded-ready eligible B', 'a');
  const killedAt = Date.now(); deadA = true;
  for (const child of sources) if (sourceIdentities.get(child) === 'a') child.kill('SIGKILL');
  const deathEvidence = [];
  await until(() => {
    const input = renderer.getInputs().find(input => input.source.slotKey === 'a');
    if (input) deathEvidence.push({ at: Date.now(), monotonicNow: performance.now(), ...input.getObservation() });
    return renderer.getState().renderedSourceId === 'b';
  }, 20000);
  assert(Date.now() - killedAt >= 1000, 'media death must be confirmed for at least one second');
  const confirmed = deathEvidence.find(e => !e.progressing && e.failureSince !== undefined && e.observedAt - e.failureSince >= 1000);
  assert(confirmed, 'real decoder must expose qualified death evidence before handoff');
  await sample('confirmed A death switches B green', 'b');
  await writeFile(`${directory}/death-evidence.json`, JSON.stringify({ killedAt, deathEvidence }, null, 2));
  assert(renewals > 0); assert(observations.length > 0);
  clearInterval(watchdog); await worker.stop(); receiver.kill('SIGINT');
  if (receiver.exitCode === null) await new Promise(resolve => receiver.once('exit', resolve));
  const probe = await verifyProgramPackets(file); assert(probe.maxGap < 0.2); assert(probe.maxGop <= 1.05);
  assert(probe.streams.some(stream => stream.codec_name === 'h264' && stream.width === 1280 && stream.height === 720 && stream.r_frame_rate === '30/1'));
  assert(probe.streams.some(stream => stream.codec_name === 'aac' && stream.sample_rate === '48000'));
  await writeFile(`${directory}/media-samples.json`, JSON.stringify(mediaSamples, null, 2));
  const colors = mediaSamples.map(sample => {
    const rgb = execFileSync('ffmpeg', ['-v', 'error', '-i', file, '-ss', String(sample.outputMs / 1000), '-frames:v', '1', '-vf', 'scale=1:1', '-f', 'rawvideo', '-pix_fmt', 'rgb24', 'pipe:1']);
    assert.equal(rgb.length, 3);
    let slateRegions;
    if (sample.expected === null) {
      // Authored hold is Y=32 with a Y=80 center, U/V=128. Check spatial
      // structure as well as average RGB; one-pixel chroma resampling rounds.
      const region = crop => [...execFileSync('ffmpeg', ['-v', 'error', '-i', file, '-ss', String(sample.outputMs / 1000), '-frames:v', '1', '-vf', `${crop},scale=1:1`, '-f', 'rawvideo', '-pix_fmt', 'rgb24', 'pipe:1'])];
      slateRegions = { corner: region('crop=100:100:0:0'), center: region('crop=100:100:590:310') };
      assert(Math.max(...rgb) - Math.min(...rgb) <= 8 && rgb[0] >= 15 && rgb[0] <= 50, `${sample.label} average slate: ${[...rgb]}`);
      for (const values of Object.values(slateRegions)) assert.equal(values.length, 3);
      assert(slateRegions.corner.every(value => value >= 10 && value <= 30));
      assert(slateRegions.center.every(value => value >= 60 && value <= 90));
      assert(slateRegions.center.every((value, index) => value - slateRegions.corner[index] >= 30));
    }
    else if (sample.expected === 'a') assert(rgb[0] > 150 && rgb[1] < 60 && rgb[2] < 60, `${sample.label}: ${[...rgb]}`);
    else if (sample.expected === 'c') assert(rgb[2] > 150 && rgb[0] < 60 && rgb[1] < 60, `${sample.label}: ${[...rgb]}`);
    else assert(rgb[1] > 70 && rgb[0] < 60 && rgb[2] < 60, `${sample.label}: ${[...rgb]}`);
    return { ...sample, rgb: [...rgb], ...(slateRegions ? { slateRegions } : {}) };
  });
  const result = { passed: true, node: process.version, directory, elapsedMs: Date.now() - begun, renewals, acknowledgements, observationCount: observations.length, killedAt, confirmedDeath: confirmed, mediaSamples, colors, providerRequests, maxPacketGapSeconds: probe.maxGap, maxGopSeconds: probe.maxGop, streams: probe.streams, limits: 'Packaged Node22 real controller/relay HTTP/decoder/renderer/encoder/sender; injected local control and provider DNS/transport plus local RTMP sink. Production HTTPS/SSRF defaults unchanged. No hosted/provider acceptance or new two-hour soak.' };
  await writeFile(`${directory}/observations.json`, JSON.stringify(observations, null, 2));
  await writeFile(`${directory}/result.json`, JSON.stringify(result, null, 2)); console.log(JSON.stringify(result));
} finally {
  clearInterval(resourceTimer);
  await sampleResources(); gcObserver.disconnect(); loopDelay.disable();
  await writeFile(`${directory}/diagnostic.json`, JSON.stringify({ metrics, worker: worker.getState(), renderer: renderer.getState(), outputs: outputs.getState(), inputs: renderer.getInputs().map(input => input.getObservation()) }, null, 2));
  await writeFile(`${directory}/observations.json`, JSON.stringify(observations, null, 2));
  await writeFile(`${directory}/media-samples.json`, JSON.stringify(mediaSamples, null, 2));
  clearInterval(watchdog); await worker.stop(); relay.stop(); provider.closeAllConnections(); provider.close(); receiver.kill('SIGKILL'); for (const child of sources) child.kill('SIGKILL');
  await writeFile(`${directory}/samples.json`, JSON.stringify(samples, null, 2));
  await writeFile(`${directory}/acknowledgements.json`, JSON.stringify(acknowledgements, null, 2));
}
