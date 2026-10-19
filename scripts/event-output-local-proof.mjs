import assert from 'node:assert/strict';
import { spawn, execFileSync } from 'node:child_process';
import { readFile, mkdir, writeFile, stat } from 'node:fs/promises';
import { setTimeout as sleep } from 'node:timers/promises';
import { createProgramRenderer } from '../workers/restream/program-renderer.mjs';
import { createEventOutputs } from '../workers/restream/output-sender.mjs';
const directory = '/tmp/event-output-proof';
await mkdir(directory, { recursive: true });
const seconds = Number(process.env.PROOF_SECONDS ?? 60), base = Number(process.env.PROOF_PORT_BASE ?? 19561);
const receiver = (port, name) => spawn('ffmpeg', ['-hide_banner', '-loglevel', 'error', '-listen', '1', '-i', `rtmp://127.0.0.1:${port}/live/test-key`, '-c', 'copy', '-f', 'mpegts', '-y', `${directory}/${name}.ts`], { stdio: 'ignore' });
let primary = receiver(base, 'primary'), optional = receiver(base + 1, 'optional-before'), recovered;
const children = { vrcdn: [], twitch: [] }, cpu = new Map(), sentBytes = new Map();
const sampleCpu = async () => { for (const [destination, procs] of Object.entries(children))
    for (const p of procs) {
        try {
            const fields = (await readFile(`/proc/${p.pid}/stat`, 'utf8')).split(' ');
            cpu.set(p.pid, { destination, ticks: Number(fields[13]) + Number(fields[14]) });
        }
        catch { }
    } };
// Test-only spawn transport rewrite. Production credentials still pass strict provider
// parsing; no runtime flag or environment bypass permits a local/private target.
const spawnForDestination = destination => (command, args, options) => {
    const local = [...args];
    local[local.length - 1] = `rtmp://127.0.0.1:${base + (destination === 'twitch' ? 1 : 0)}/live`;
    const child = spawn(command, local, options);
    children[destination].push(child);
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
const renderer = createProgramRenderer();
renderer.subscribe(chunk => outputs.enqueue(chunk));
const samples = [];
let killed = false, restarted = false, selected = false, maxQueueBytes = 0;
try {
    await sleep(300);
    await outputs.start();
    await renderer.reconcileSources([{ slotKey: 'test', sourceId: 'test', url: `udp://127.0.0.1:${base + 2}?fifo_size=1024&overrun_nonfatal=1` }]);
    await renderer.start();
    const started = performance.now();
    while (performance.now() - started < seconds * 1000) {
        await sleep(250);
        const elapsed = (performance.now() - started) / 1000;
        if (!selected && renderer.getInputs()[0].getObservation().ready)
            selected = renderer.selectSource('test');
        if (elapsed > seconds / 3 && !killed) {
            await sampleCpu();
            optional.kill('SIGKILL');
            killed = true;
        }
        if (elapsed > seconds / 2 && !restarted) {
            recovered = receiver(base + 1, 'optional-after');
            restarted = true;
        }
        const state = outputs.getState();
        samples.push({ elapsed, ...state });
        await sampleCpu();
        maxQueueBytes = Math.max(maxQueueBytes, ...state.destinations.map(d => d.queueBytes));
        assert.equal(renderer.getState().error, undefined);
        if (elapsed > 8)
            assert.equal(state.publishing, true, `primary progress at ${elapsed}`);
    }
    assert(selected);
    assert.equal(children.vrcdn.length, 1, 'primary never restarted');
    assert(outputs.getState().destinations[1].publishing, 'optional recovered');
    assert(maxQueueBytes <= 524288);
    await sampleCpu();
    outputs.stopNow();
    await renderer.stop();
    await sleep(300);
    primary.kill('SIGINT');
    recovered?.kill('SIGINT');
    await sleep(500);
    const probe = JSON.parse(execFileSync('ffprobe', ['-v', 'error', '-show_streams', '-show_packets', '-show_entries', 'packet=stream_index,dts_time,flags:stream=codec_name,width,height,r_frame_rate,sample_rate', '-of', 'json', `${directory}/primary.ts`], { maxBuffer: 32 * 1024 * 1024 }));
    const last = new Map();
    let maxGap = 0;
    for (const packet of probe.packets) {
        const t = Number(packet.dts_time);
        if (!Number.isFinite(t))
            continue;
        const prev = last.get(packet.stream_index);
        if (prev !== undefined) {
            assert(t >= prev);
            maxGap = Math.max(maxGap, t - prev);
        }
        last.set(packet.stream_index, t);
    }
    assert(maxGap < 0.2, 'primary packets continuous across optional failure');
    const keys = probe.packets.filter(p => p.stream_index === 0 && p.flags.includes('K')).map(p => Number(p.dts_time));
    const maxGop = Math.max(...keys.slice(1).map((v, i) => v - keys[i]));
    assert(maxGop <= 1.05);
    const primaryBytes = (await stat(`${directory}/primary.ts`)).size;
    const optionalBytes = (await stat(`${directory}/optional-before.ts`)).size + (await stat(`${directory}/optional-after.ts`)).size;
    const ticksPerSecond = Number(execFileSync('getconf', ['CLK_TCK'], { encoding: 'utf8' }));
    const cpuSeconds = Object.fromEntries(['vrcdn', 'twitch'].map(d => [d, [...cpu.values()].filter(v => v.destination === d).reduce((n, v) => n + v.ticks, 0) / ticksPerSecond]));
    const applicationEgressBytes = Object.fromEntries(['vrcdn', 'twitch'].map(d => [d, [...sentBytes.values()].filter(v => v.destination === d).reduce((n, v) => n + v.bytes, 0)]));
    const result = { applicationEgressBytes, passed: true, node: process.version, seconds, primaryProcesses: children.vrcdn.length, optionalProcesses: children.twitch.length, maxQueueBytes, maxPacketGapSeconds: maxGap, maxGopSeconds: maxGop, cpuSeconds, primaryBytes, optionalBytes, streams: probe.streams, limits: 'Synthetic local RTMP proof; CPU is sender processes only; byte counts are received MPEGTS including container overhead, FLV progress bytes measure application egress excluding TCP/TLS overhead, not billed network egress or provider acceptance.' };
    await writeFile(`${directory}/result.json`, JSON.stringify(result, null, 2));
    await writeFile(`${directory}/samples.json`, JSON.stringify(samples));
    console.log(JSON.stringify(result));
}
finally {
    source.kill('SIGKILL');
    primary.kill('SIGKILL');
    optional.kill('SIGKILL');
    recovered?.kill('SIGKILL');
    await outputs.stop();
    await renderer.stop();
}
