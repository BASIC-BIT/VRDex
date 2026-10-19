import { spawn } from 'node:child_process';
import { performance } from 'node:perf_hooks';
import { createInterface } from 'node:readline';
import { createInputSupervisor } from './input-supervisor.mjs';
export const QUALITY_PROFILES = {
    '1080p60': { width: 1920, height: 1080, frameRate: 60, videoBitrateKbps: 3500 },
    '1080p30': { width: 1920, height: 1080, frameRate: 30, videoBitrateKbps: 3000 },
    '720p60': { width: 1280, height: 720, frameRate: 60, videoBitrateKbps: 2500 },
    '720p30': { width: 1280, height: 720, frameRate: 30, videoBitrateKbps: 1800 },
};
/** Stable encoder; subscribe receives MPEG-TS chunks synchronously and MUST NOT block.
 * Destination senders own their bounded queues; this module never waits on them.
 */
export function createProgramRenderer({ quality = '720p30', onProgress = () => { }, onObservation = () => { }, onError = () => { }, ffmpeg = 'ffmpeg', silenceThresholdDb, clock = () => performance.now() } = {}) {
    const profile = QUALITY_PROFILES[quality];
    if (!profile)
        throw new Error('Unsupported quality');
    const inputs = new Map(), subscribers = new Set(), acknowledgements = new RenderAcknowledgements();
    let reconcileQueue = Promise.resolve(), stopped = false;
    let child, timer, running = false, selected, submittedSlotKey, submittedSourceId, renderedSlotKey, renderedSourceId, startedAt, ticks = 0, error, outputMs = 0;
    const frameBytes = profile.width * profile.height * 3 / 2;
    const holdFrame = Buffer.alloc(frameBytes, 128);
    holdFrame.fill(32, 0, profile.width * profile.height);
    // Visible neutral slate with a brighter central rectangle; no product copy invented.
    for (let y = profile.height / 3 | 0; y < profile.height * 2 / 3; y++)
        holdFrame.fill(80, y * profile.width + (profile.width / 3 | 0), y * profile.width + (profile.width * 2 / 3 | 0));
    const silence = Buffer.alloc(48000 / profile.frameRate * 4);
    function fail(message) {
        if (error)
            return;
        error = new Error(message);
        clearTimeout(timer);
        running = false;
        onError(error);
        child?.kill('SIGKILL');
    }
    function tick() {
        if (!running)
            return;
        const due = Math.floor((clock() - startedAt) * profile.frameRate / 1000);
        if (due - ticks > profile.frameRate * 2)
            return fail('Program render clock exceeded its processing budget');
        while (ticks <= due) {
            // A slow encoder is a fatal session condition, never an unbounded raw-media queue.
            if (child.stdio[3].writableLength > frameBytes * 4 || child.stdio[4].writableLength > 48000 * 4)
                break;
            const input = inputs.get(selected);
            const ready = input?.getObservation().ready;
            const actualSlotKey = ready ? selected : undefined;
            const actualSourceId = ready ? input.source.sourceId : undefined;
            if (actualSlotKey !== submittedSlotKey || actualSourceId !== submittedSourceId) {
                acknowledgements.submit(actualSlotKey, (ticks + 1) * 1000 / profile.frameRate, actualSourceId);
                submittedSourceId = actualSourceId;
                submittedSlotKey = actualSlotKey;
            }
            child.stdio[3].write(ready ? input.buffer.frame : holdFrame);
            child.stdio[4].write(ready ? input.buffer.takeAudio(silence.length) : silence);
            ticks++;
        }
        timer = setTimeout(tick, Math.max(1, (ticks * 1000 / profile.frameRate) - (clock() - startedAt)));
    }
    return {
        profile,
        async reconcileSources(sources) {
            const snapshot = sources.map(source => ({ ...source }));
            const result = reconcileQueue.then(async () => {
                if (stopped)
                    throw new Error('Renderer is stopped');
                const sources = snapshot;
                if (sources.length > 2 || new Set(sources.map(s => s.slotKey)).size !== sources.length)
                    throw new Error('At most two distinct current/next inputs');
                for (const [key, input] of inputs) {
                    if (!sources.some(s => s.slotKey === key && s.sourceId === input.source.sourceId && s.url === input.source.url)) {
                        await input.stop();
                        inputs.delete(key);
                        if (selected === key)
                            selected = undefined;
                    }
                }
                for (const source of sources)
                    if (!inputs.has(source.slotKey)) {
                        const input = createInputSupervisor({ source, quality: profile, clock, onObservation, ffmpeg, silenceThresholdDb });
                        inputs.set(source.slotKey, input);
                        if (running)
                            input.start();
                    }
            });
            reconcileQueue = result.catch(() => { });
            return result;
        },
        getInputs: () => [...inputs.values()],
        getState: () => ({ selectedSlotKey: selected, renderedSlotKey, renderedSourceId, outputMs, error, running, ticks, videoQueueBytes: child?.stdio[3].writableLength ?? 0 }),
        selectSource(slotKey) {
            if (!inputs.get(slotKey)?.getObservation().ready)
                return false;
            selected = slotKey;
            return true;
        },
        hold() { selected = undefined; },
        subscribe(listener) { subscribers.add(listener); return () => subscribers.delete(listener); },
        async start() {
            if (stopped)
                throw new Error('Renderer is stopped');
            await reconcileQueue;
            if (running)
                return;
            if (child)
                throw new Error('Renderer cannot restart after stop');
            running = true;
            startedAt = clock();
            child = spawn(ffmpeg, ['-hide_banner', '-loglevel', 'error', '-nostdin', '-stats_period', '0.25', '-progress', 'pipe:5',
                '-thread_queue_size', '4', '-f', 'rawvideo', '-pixel_format', 'yuv420p', '-video_size', `${profile.width}x${profile.height}`, '-framerate', String(profile.frameRate), '-i', 'pipe:3',
                '-thread_queue_size', '4', '-probesize', '32', '-analyzeduration', '0', '-f', 's16le', '-ar', '48000', '-ac', '2', '-i', 'pipe:4',
                '-map', '0:v:0', '-map', '1:a:0', '-c:v', 'libx264', '-threads', '2', '-preset', 'veryfast', '-tune', 'zerolatency', '-g', String(profile.frameRate), '-keyint_min', String(profile.frameRate), '-sc_threshold', '0', '-b:v', `${profile.videoBitrateKbps}k`, '-maxrate', `${profile.videoBitrateKbps}k`, '-bufsize', `${profile.videoBitrateKbps * 2}k`,
                '-c:a', 'aac', '-b:a', '160k', '-ar', '48000', '-ac', '2', '-mpegts_flags', '+resend_headers', '-muxdelay', '0', '-f', 'mpegts', 'pipe:1'], { stdio: ['ignore', 'pipe', 'ignore', 'pipe', 'pipe', 'pipe'] });
            child.on('error', () => fail('Program encoder failed to start'));
            child.on('close', code => {
                if (running)
                    fail(`Program encoder exited (${code})`);
            });
            for (const pipe of [child.stdio[3], child.stdio[4]])
                pipe.on('error', () => {
                    if (running)
                        fail('Program encoder pipe closed');
                });
            child.stdout.on('data', chunk => {
                for (const listener of subscribers)
                    listener(chunk);
            });
            createInterface({ input: child.stdio[5] }).on('line', line => {
                if (line.startsWith('out_time_us=')) {
                    const next = Number(line.slice(12)) / 1000;
                    if (!Number.isFinite(next) || next < 0)
                        return;
                    if (next < outputMs)
                        return fail('Program timestamp regressed');
                    outputMs = next;
                    renderedSlotKey = acknowledgements.advance(outputMs);
                    renderedSourceId = acknowledgements.renderedSourceId;
                    onProgress({ outputMs, wallElapsedMs: clock() - startedAt, delayMs: clock() - startedAt - outputMs });
                }
            });
            for (const input of inputs.values())
                input.start();
            tick();
        },
        async stop() {
            stopped = true;
            await reconcileQueue;
            running = false;
            clearTimeout(timer);
            await Promise.all([...inputs.values()].map(input => input.stop()));
            inputs.clear();
            if (child && child.exitCode === null && child.signalCode === null)
                await new Promise(resolve => {
                    const kill = setTimeout(() => child.kill('SIGKILL'), 3000);
                    child.once('close', () => { clearTimeout(kill); resolve(); });
                    child.stdio[3].end();
                    child.stdio[4].end();
                });
        },
    };
}
export class RenderAcknowledgements {
    pending = [];
    renderedSlotKey = undefined;
    renderedSourceId = undefined;
    submit(slotKey, outputMs, sourceId) {
        // At most two seconds of submitted switches can exist before the clock fails.
        if (this.pending.length >= 256)
            throw new Error('Program acknowledgement queue exceeded bound');
        this.pending.push({ slotKey, outputMs, sourceId });
    }
    advance(outputMs) {
        while (this.pending[0]?.outputMs <= outputMs) {
            const rendered = this.pending.shift();
            this.renderedSlotKey = rendered.slotKey;
            this.renderedSourceId = rendered.sourceId;
        }
        return this.renderedSlotKey;
    }
}
