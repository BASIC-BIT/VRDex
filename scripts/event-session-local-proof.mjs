import assert from 'node:assert/strict';
import { spawn, execFileSync } from 'node:child_process';
import { createWriteStream } from 'node:fs';
import { mkdtemp, writeFile } from 'node:fs/promises';
import { setTimeout as sleep } from 'node:timers/promises';
import { createEventWorker } from '../workers/restream/event-worker.mjs';
import { createProgramRenderer } from '../workers/restream/program-renderer.mjs';
import { verifyProgramPackets } from './event-proof-metrics.mjs';

// This harness runs actual wall time and real decoding/encoding. Only the control
// service, source transport and output sink are local test injections.
const directory = await mkdtemp('/tmp/event-session-proof-');
const base = Number(process.env.PROOF_PORT_BASE ?? 19941);
const begun = Date.now(), events = [], processes = [], workers = [], files = [];
let epoch = 1, commands = [], sequence = 0;
const config = { sessionDeadline: begun + 150000, currentSourceId: 'a', mode: 'automatic', policy: {}, outputId: 'sink', outputs: [{ id: 'sink' }], sources: ['a', 'b'].map(id => ({ id, type: 'vrcdn_link', publicUrl: `https://stream.vrcdn.live/live/${id}.live.ts` })), slots: [{ slotKey: 'a', sourceId: 'a', startAt: begun - 60000, endAt: begun + 10000, available: true }, { slotKey: 'b', sourceId: 'b', startAt: begun + 10000, available: true }] };
function feed(id, silent = false) {
    const child = spawn('ffmpeg', ['-hide_banner', '-loglevel', 'error', '-re', '-f', 'lavfi', '-i', `color=${id === 'a' ? 'red' : 'blue'}:s=640x360:r=30`, '-re', '-f', 'lavfi', '-i', silent ? 'anullsrc=r=48000:cl=stereo' : 'sine=frequency=440:sample_rate=48000', '-c:v', 'libx264', '-threads', '2', '-preset', 'ultrafast', '-tune', 'zerolatency', '-g', '30', '-c:a', 'aac', '-f', 'mpegts', `udp://127.0.0.1:${base + (id === 'b' ? 1 : 0)}?pkt_size=1316`], { stdio: 'ignore' });
    processes.push(child);
    return child;
}
const record = (scenario, extra = {}) => { const event = { scenario, elapsed: (Date.now() - begun) / 1000, ...extra }; events.push(event); console.log(JSON.stringify(event)); };
async function until(predicate, milliseconds = 15000) {
    const deadline = Date.now() + milliseconds;
    while (!predicate()) { assert(Date.now() < deadline, JSON.stringify({ message: 'Timed out waiting for actual encoded state', workers: workers.map(value => ({ controller: value.worker.getState(), renderer: value.renderer.getState(), ...value.state(), inputs: value.renderer.getInputs().map(i => i.getObservation()) })) })); await sleep(100); }
}
function createWorker(number) {
    const renderer = createProgramRenderer();
    const path = `${directory}/worker-${number}.ts`, file = createWriteStream(path); files.push(file);
    let active = true, bytes = 0, fences = 0, reason, authority, closed = false;
    const worker = createEventWorker({ identity: { eventId: 'local', sessionId: 'local', workerId: `worker-${number}`, epoch: 0 }, renderer,
        control: async (name, args) => {
            if (number !== epoch) return { granted: false, accepted: false };
            if (name === 'acquireSession' || name === 'renewSession') return { granted: true, epoch, serverNow: Date.now(), expiresAt: Date.now() + 30000, renewAfterMs: 10000, configuration: structuredClone(config) };
            if (name === 'refreshConfiguration') return { granted: true, serverNow: Date.now(), configuration: structuredClone(config) };
            if (name === 'claimCommands') return { granted: true, commands };
            if (name === 'acknowledgeCommand') { assert.equal(args.outcome, 'succeeded'); commands = []; record('command-ack', { type: args.observedState, source: args.observedSourceId, sequence: args.sequence }); }
            return { accepted: true };
        }, resolveSource: async source => `udp://127.0.0.1:${base + (source.id === 'b' ? 1 : 0)}?fifo_size=1024&overrun_nonfatal=1`, checkEnabled: async () => true,
        outputs: { start: async () => {}, enqueue(chunk) { if (active) { assert(file.writableLength < 8 * 1024 * 1024); bytes += chunk.length; file.write(chunk); } }, getState: () => ({ publishing: active && bytes > 0 }), stopNow() { if (active) fences++; active = false; }, stop: async () => {} },
        metric(event) { if (event.event === 'event_worker_stopped') reason = event.reason; if (event.event === 'event_worker_authority_expired') authority = event.authority; } });
    const watchdog = setInterval(() => worker.watchdog(), 50), poll = setInterval(() => void worker.tick(), 250);
    const value = { worker, renderer, file, path, state: () => ({ bytes, fences, reason, authority }), async stop() { if (closed) return; closed = true; clearInterval(watchdog); clearInterval(poll); await worker.stop(); await new Promise(resolve => file.end(resolve)); } };
    workers.push(value);
    return value;
}
let a = feed('a');
try {
    const first = createWorker(1); await first.worker.start();
    await until(() => first.renderer.getState().renderedSourceId === 'a');
    record('live-a');
    await sleep(Math.max(0, begun + 15000 - Date.now()));
    assert.equal(first.renderer.getState().renderedSourceId, 'a'); record('healthy-overrun-late-next');
    a.kill('SIGKILL'); await sleep(1500); a = feed('a', true);
    await until(() => first.renderer.getState().renderedSourceId === 'a' && first.renderer.getInputs().find(i => i.source.sourceId === 'a')?.getObservation().ready);
    await sleep(7000);
    assert.equal(first.renderer.getState().renderedSourceId, 'a');
    const silenceAt = first.renderer.getState().outputMs / 1000 - 2;
    record('silence-does-not-switch', { outputSecond: silenceAt });
    a.kill('SIGKILL');
    const diedAt = first.renderer.getState().outputMs;
    await until(() => first.renderer.getState().renderedSourceId === undefined && first.renderer.getState().outputMs > diedAt + 2000);
    await sleep(2000); assert.equal(first.renderer.getState().renderedSourceId, undefined); record('source-death-hold-late-next');
    feed('b');
    await until(() => first.renderer.getState().renderedSourceId === 'b'); record('late-next-recovers');
    a = feed('a');
    function command(commandType, targetSourceId) { commands = [{ _id: `command-${++sequence}`, sequence, commandType, targetSourceId }]; }
    command('switch_source', 'a');
    await until(() => commands.length === 0);
    assert.equal(first.renderer.getState().renderedSourceId, 'a'); assert.equal(first.worker.getState().mode, 'manual'); record('operator-override');
    command('switch_hold'); await until(() => commands.length === 0);
    assert.equal(first.renderer.getState().renderedSourceId, undefined); record('operator-hold');
    command('set_automatic_mode'); await until(() => commands.length === 0);
    await until(() => first.renderer.getState().renderedSourceId === 'a'); record('automatic-resumed');
    epoch = 2;
    await until(() => first.worker.getState().stopped, 4000);
    const fencedBytes = first.state().bytes;
    await first.stop();
    assert.equal(first.state().fences, 1);
    config.currentSourceId = 'b'; config.sessionDeadline = Date.now() + 18000;
    const replacement = createWorker(2); await replacement.worker.start();
    await until(() => replacement.renderer.getState().renderedSourceId === 'b');
    assert.equal(first.state().bytes, fencedBytes); record('replacement-fences-old-publication');
    await until(() => replacement.worker.getState().stopped, 25000);
    const stoppedBytes = replacement.state().bytes;
    await sleep(400); assert.equal(replacement.state().bytes, stoppedBytes); assert.equal(replacement.state().fences, 1);
    assert.equal(replacement.state().authority, 'session-deadline');
    record('maximum-session-stop', { reason: replacement.state().reason, authority: replacement.state().authority });
    await replacement.stop();
    const probe = await verifyProgramPackets(first.path);
    assert(probe.maxGap < 0.2); assert(probe.maxGop <= 1.05);
    const pcm = execFileSync('ffmpeg', ['-v', 'error', '-ss', String(silenceAt), '-i', first.path, '-t', '1', '-vn', '-ac', '1', '-ar', '48000', '-f', 's16le', 'pipe:1']);
    let sum = 0; for (let i = 0; i < pcm.length; i += 2) sum += (pcm.readInt16LE(i) / 32768) ** 2;
    const silentRms = Math.sqrt(sum / (pcm.length / 2)); assert(silentRms < 0.001, 'Actual quiet PCM, not viewer mute, remained on current source');
    const result = { passed: true, directory, node: process.version, wallSeconds: (Date.now() - begun) / 1000, silentRms, events, packetContinuity: probe, limits: 'Real controller/media processes with injected local control and sink. Replacement uses a test epoch boundary, not actual Convex/ECS scheduling. Direct link UI/browser fallback is verified separately. Synthetic silence is not representative music calibration.' };
    await writeFile(`${directory}/result.json`, JSON.stringify(result, null, 2)); console.log(JSON.stringify(result));
} finally {
    for (const child of processes) child.kill('SIGKILL');
    for (const value of workers) { await value.stop(); }
}
