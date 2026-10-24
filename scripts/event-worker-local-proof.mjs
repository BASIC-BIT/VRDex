import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import { setTimeout as sleep } from 'node:timers/promises';
import { createProofWorker as createEventWorker, syntheticInputs } from './event-proof-fixtures.mjs';
import { createProgramRenderer } from '../workers/restream/program-renderer.mjs';
// Test-only injection: production source resolution has no loopback bypass.
const port = 19439;
const source = spawn('ffmpeg', ['-hide_banner', '-loglevel', 'error', '-re', '-f', 'lavfi', '-i', 'color=red:s=640x360:r=30', '-re', '-f', 'lavfi', '-i', 'sine=frequency=440:sample_rate=48000', '-c:v', 'libx264', '-threads', '2', '-preset', 'ultrafast', '-tune', 'zerolatency', '-g', '30', '-pix_fmt', 'yuv420p', '-c:a', 'aac', '-f', 'mpegts', `udp://127.0.0.1:${port}?pkt_size=1316`], { stdio: 'ignore' });
const begun = Date.now();
const configuration = { sessionDeadline: begun + 23000, mode: 'automatic', policy: {}, outputId: 'sink', outputs: [{ id: 'sink' }], sources: [{ id: 'a', type: 'vrcdn_link', publicUrl: 'test-only' }], slots: [{ slotKey: 'slot-a', sourceId: 'a', startAt: begun - 1000, available: true }] };
let bytes = 0, fences = 0, active = true;
const observations = [];
const renderer = createProgramRenderer();
const worker = createEventWorker({ identity: { eventId: 'test', sessionId: 'test', workerId: 'test', epoch: 0 }, renderer,
    control: async (name) => {
        if (name === 'acquireSession' || name === 'renewSession')
            return { granted: true, epoch: 1, serverNow: Date.now(), expiresAt: Date.now() + 30000, renewAfterMs: 10000, configuration };
        if (name === 'refreshConfiguration')
            return { granted: true, serverNow: Date.now(), configuration };
        if (name === 'claimCommands')
            return { granted: true, commands: [] };
        return { accepted: true };
    }, inputs: syntheticInputs(async () => `udp://127.0.0.1:${port}?fifo_size=1000000&overrun_nonfatal=1`), checkEnabled: async () => true,
    outputs: { start: async () => { }, enqueue: chunk => { if (active)
            bytes += chunk.length; }, getState: () => ({ publishing: active && bytes > 0 }), stopNow: () => { active = false; fences++; }, stop: async () => { } }, metric: event => { if (event.event === 'event_worker_stopped')
        console.log(JSON.stringify(event)); observations.push({ ...renderer.getState(), at: Date.now() }); } });
const watchdog = setInterval(() => worker.watchdog(), 25), poll = setInterval(() => void worker.tick(), 250);
try {
    await worker.start();
    const until = async (predicate, ms) => { const end = Date.now() + ms; while (!predicate()) {
        assert(Date.now() < end, JSON.stringify({ message: 'Timed out waiting for actual media state', worker: worker.getState(), renderer: renderer.getState(), inputs: renderer.getInputs().map(i => i.getObservation()) }));
        await sleep(100);
    } };
    await until(() => renderer.getState().renderedSourceId === 'a', 12000);
    const liveOutput = renderer.getState().outputMs;
    assert(liveOutput > 0);
    source.kill('SIGKILL');
    await until(() => renderer.getState().renderedSourceId === undefined && renderer.getState().outputMs > liveOutput + 1000, 7000);
    const holdOutput = renderer.getState().outputMs;
    await until(() => worker.getState().stopped, 25000);
    assert.equal(fences, 1);
    const fencedBytes = bytes;
    await sleep(300);
    assert.equal(bytes, fencedBytes);
    console.log(JSON.stringify({ passed: true, liveOutputMs: liveOutput, holdOutputMs: holdOutput, bytes, fences, observations: observations.length, node: process.version }));
}
finally {
    clearInterval(watchdog);
    clearInterval(poll);
    source.kill('SIGKILL');
    await worker.stop();
}
