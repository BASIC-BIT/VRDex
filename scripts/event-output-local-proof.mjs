import assert from 'node:assert/strict';
import { spawn, execFileSync } from 'node:child_process';
import { mkdtemp, writeFile, appendFile, stat } from 'node:fs/promises';
import { setTimeout as sleep } from 'node:timers/promises';
import { createProgramRenderer } from '../workers/restream/program-renderer.mjs';
import { createEventOutputs } from '../workers/restream/output-sender.mjs';
import { createEventWorker } from '../workers/restream/event-worker.mjs';
import { verifyProgramPackets, processMetrics } from './event-proof-metrics.mjs';
const directory = await mkdtemp(process.env.PROOF_DIRECTORY_PREFIX ?? '/tmp/event-output-proof-');
const seconds = Number(process.env.PROOF_SECONDS ?? 60), base = Number(process.env.PROOF_PORT_BASE ?? 19561);
assert(Number.isInteger(seconds) && seconds >= 30 && seconds <= 43200, 'PROOF_SECONDS must be 30..43200');
const excluded = new Map(), senderPids = new Map();
const receiver = (port, name) => spawn('ffmpeg', ['-hide_banner', '-loglevel', 'error', '-listen', '1', '-i', `rtmp://127.0.0.1:${port}/live/test-key`, '-c', 'copy', '-f', 'mpegts', '-y', `${directory}/${name}.ts`], { stdio: 'ignore' });
let primary = receiver(base, 'primary'), optional = receiver(base + 1, 'optional-before'), recovered;
excluded.set(primary.pid, 'receivers'); excluded.set(optional.pid, 'receivers');
const children = { vrcdn: [], twitch: [] }, sentBytes = new Map();
const metrics = processMetrics(excluded, senderPids);
// Test-only spawn transport rewrite. Production credentials still pass strict provider
// parsing; no runtime flag or environment bypass permits a local/private target.
const spawnForDestination = destination => (command, args, options) => {
    const local = [...args];
    local[local.length - 1] = `rtmp://127.0.0.1:${base + (destination === 'twitch' ? 1 : 0)}/live`;
    const child = spawn(command, local, options);
    children[destination].push(child);
    senderPids.set(child.pid, destination);
    let progress = '';
    child.stdio[3].on('data', chunk => { progress += chunk; let end; while ((end = progress.indexOf('\n')) >= 0) {
        const line = progress.slice(0, end);
        progress = progress.slice(end + 1);
        if (line.startsWith('total_size=')) {
            const n = Number(line.slice(11));
            if (Number.isFinite(n) && n >= 0)
                sentBytes.set(child.pid, { destination, bytes: n });
        }
    } });
    return child;
};
const compliance = { sourceConsent: 'accepted', destinationAuthority: 'accepted', providerRules: 'accepted', rightsClearedMedia: 'accepted' };
const configuration = { outputId: 'primary', outputs: [{ id: 'primary', type: 'vrcdn', credential: { secretRef: 'primary' }, compliance }, { id: 'optional', type: 'external_rtmp', twitchSetup: { channel: 'test', profile: 'twitch-conservative-720p30' }, simulcastEnabled: true, credential: { secretRef: 'optional' }, compliance }] };
const outputs = createEventOutputs({ configuration, spawnForDestination, resolveCredential: ref => JSON.stringify({ rtmpUrl: ref === 'primary' ? 'rtmp://uk.ingest.vrcdn.live/live' : 'rtmp://live.twitch.tv/app', streamKey: 'test-key' }) });
const source = spawn('ffmpeg', ['-hide_banner', '-loglevel', 'error', '-re', '-f', 'lavfi', '-i', 'testsrc2=s=1280x720:r=30', '-re', '-f', 'lavfi', '-i', 'sine=frequency=440:sample_rate=48000', '-c:v', 'libx264', '-threads', '2', '-preset', 'ultrafast', '-tune', 'zerolatency', '-g', '30', '-c:a', 'aac', '-f', 'mpegts', `udp://127.0.0.1:${base + 2}?pkt_size=1316`], { stdio: 'ignore' });
excluded.set(source.pid, 'generators');
const renderer = createProgramRenderer();
const begun = Date.now();
Object.assign(configuration, { sessionDeadline: begun + seconds * 1000 + 30000, mode: 'automatic', policy: {}, currentSourceId: 'test', sources: [{ id: 'test', type: 'vrcdn_link', publicUrl: 'test-only' }], slots: [{ slotKey: 'test', sourceId: 'test', startAt: begun - 60000, endAt: begun + 10000, available: true }] });
let renewals = 0, reports = 0, stopReason;
const worker = createEventWorker({ identity: { eventId: 'local-proof', sessionId: 'local-proof', workerId: 'local-proof', epoch: 0 }, renderer, outputs,
    control: async name => {
        if (name === 'acquireSession' || name === 'renewSession') { if (name === 'renewSession') renewals++; return { granted: true, epoch: 1, serverNow: Date.now(), expiresAt: Date.now() + 30000, renewAfterMs: 10000, configuration }; }
        if (name === 'refreshConfiguration') return { granted: true, serverNow: Date.now(), configuration };
        if (name === 'claimCommands') return { granted: true, commands: [] };
        if (name === 'observeProgram') reports++;
        return { accepted: true };
    }, resolveSource: async () => `udp://127.0.0.1:${base + 2}?fifo_size=1024&overrun_nonfatal=1`, checkEnabled: async () => true,
    metric: event => { if (event.event === 'event_worker_stopped') stopReason = event.reason; if (event.event === 'event_worker_authority_expired') console.log(JSON.stringify(event)); } });
let watchdog, poll, sampleCount = 0;
console.log(JSON.stringify({ event: 'proof-start', directory, seconds, pid: process.pid, startedAt: new Date().toISOString() }));
let killed = false, restarted = false, selected = false, maxQueueBytes = 0;
try {
    await sleep(300);
    await worker.start();
    watchdog = setInterval(() => worker.watchdog(), 50);
    poll = setInterval(() => void worker.tick(), 1000);
    const started = performance.now();
    while (performance.now() - started < seconds * 1000) {
        await sleep(1000);
        const elapsed = (performance.now() - started) / 1000;
        selected ||= renderer.getState().renderedSourceId === 'test';
        assert.equal(worker.getState().stopped, false, `worker stopped: ${stopReason}`);
        if (elapsed > seconds / 3 && !killed) {
            await metrics.sample();
            optional.kill('SIGKILL');
            killed = true;
        }
        if (elapsed > seconds / 2 && !restarted) {
            recovered = receiver(base + 1, 'optional-after');
            excluded.set(recovered.pid, 'receivers');
            restarted = true;
        }
        const state = outputs.getState();
        sampleCount++;
        await appendFile(`${directory}/samples.ndjson`, JSON.stringify({ elapsed, ...state }) + '\n');
        if (sampleCount % 30 === 0) console.log(JSON.stringify({ event: 'proof-progress', elapsed, outputMs: renderer.getState().outputMs, renewals, ...metrics.result() }));
        await metrics.sample();
        maxQueueBytes = Math.max(maxQueueBytes, ...state.destinations.map(d => d.queueBytes));
        assert.equal(renderer.getState().error, undefined);
        if (elapsed > 8) {
            assert.equal(state.publishing, true, `primary progress at ${elapsed}`);
            const measured = metrics.result();
            assert(measured.sampledProcesses >= 8 && measured.cpuSeconds.generators > 0 && measured.cpuSeconds.receivers > 0 && measured.senderCpuSeconds.vrcdn > 0 && measured.senderCpuSeconds.twitch > 0, 'Resource sampler must include the controller, encoder, decoder, two senders, generator and receivers');
        }
    }
    assert(selected);
    assert.equal(children.vrcdn.length, 1, 'primary never restarted');
    assert(outputs.getState().destinations[1].publishing, 'optional recovered');
    assert(maxQueueBytes <= 524288);
    await metrics.sample();
    clearInterval(watchdog); clearInterval(poll);
    outputs.stopNow();
    await renderer.stop();
    await sleep(300);
    primary.kill('SIGINT');
    recovered?.kill('SIGINT');
    await sleep(500);
    const probe = await verifyProgramPackets(`${directory}/primary.ts`);
    const { maxGap, maxGop } = probe;
    assert(maxGap < 0.2, 'primary packets continuous across optional failure');
    assert(maxGop <= 1.05);
    const primaryBytes = (await stat(`${directory}/primary.ts`)).size;
    const optionalBytes = (await stat(`${directory}/optional-before.ts`)).size + (await stat(`${directory}/optional-after.ts`)).size;
    const applicationEgressBytes = Object.fromEntries(['vrcdn', 'twitch'].map(d => [d, [...sentBytes.values()].filter(v => v.destination === d).reduce((n, v) => n + v.bytes, 0)]));
    const result = { applicationEgressBytes, passed: true, node: process.version, seconds, primaryProcesses: children.vrcdn.length, optionalProcesses: children.twitch.length, maxQueueBytes, maxPacketGapSeconds: maxGap, maxGopSeconds: maxGop, resources: metrics.result(), renewals, reports, sampleCount, wallSeconds: (performance.now() - started) / 1000, primaryBytes, optionalBytes, streams: probe.streams, limits: 'Synthetic local RTMP proof; real controller/renderer/decoder/senders with synthetic control responses and local transport injection; no hosted authority/provider acceptance; byte counts are received MPEGTS including container overhead, FLV progress bytes measure application egress excluding TCP/TLS overhead, not billed network egress or provider acceptance.' };
    await writeFile(`${directory}/result.json`, JSON.stringify(result, null, 2));
    console.log(JSON.stringify(result));
}
finally {
    clearInterval(watchdog); clearInterval(poll);
    await worker.stop();
    source.kill('SIGKILL');
    primary.kill('SIGKILL');
    optional.kill('SIGKILL');
    recovered?.kill('SIGKILL');
    await outputs.stop();
    await renderer.stop();
}
