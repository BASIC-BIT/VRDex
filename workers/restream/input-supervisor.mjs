import { spawn } from 'node:child_process';
import { performance } from 'node:perf_hooks';
import { createInterface } from 'node:readline';
export const reconnectDelay = attempt => Math.min(10000, 1000 * 2 ** Math.min(attempt, 4));
/** One complete video frame, one partial frame, and a capped PCM tail. */
export class LatestMediaBuffer {
    constructor(frameBytes, maxAudioBytes = 48000) {
        this.frameBytes = frameBytes;
        this.maxAudioBytes = maxAudioBytes;
        this.reset();
    }
    reset() { this.frame = undefined; this.partial = Buffer.alloc(0); this.pcm = Buffer.alloc(0); this.audioPartial = Buffer.alloc(0); }
    video(chunk) {
        let data = this.partial.length ? Buffer.concat([this.partial, chunk]) : chunk;
        let frames = 0;
        while (data.length >= this.frameBytes) {
            this.frame = Buffer.from(data.subarray(0, this.frameBytes));
            data = data.subarray(this.frameBytes);
            frames++;
        }
        this.partial = Buffer.from(data);
        return frames;
    }
    audio(chunk) {
        const data = Buffer.concat([this.audioPartial, chunk]);
        const complete = data.subarray(0, data.length - data.length % 4);
        this.audioPartial = Buffer.from(data.subarray(complete.length));
        // Copy the tail so a small view cannot retain a large upstream allocation.
        this.pcm = Buffer.from(Buffer.concat([this.pcm, complete]).subarray(-this.maxAudioBytes));
        return complete;
    }
    get audioBytes() { return this.pcm.length; }
    takeAudio(bytes) {
        const result = Buffer.alloc(bytes);
        this.pcm.copy(result, 0, 0, bytes);
        this.pcm = Buffer.from(this.pcm.subarray(bytes));
        return result;
    }
}
/** source is a trusted worker projection {slotKey, sourceId, url}; never log its URL. */
export function createInputSupervisor({ source, quality = { width: 1280, height: 720, frameRate: 30 }, clock = () => performance.now(), onObservation = () => { }, ffmpeg = 'ffmpeg', silenceThresholdDb, spawnProcess = spawn }) {
    const buffer = new LatestMediaBuffer(quality.width * quality.height * 3 / 2);
    let child, retryTimer, healthTimer, running = false, attempt = 0;
    let videoAt = -Infinity, audioAt = -Infinity, frames = 0, failureSince = clock(), silenceSince, audioLevelDb;
    let startedAt = clock(), mediaPts = -Infinity, mediaProgressAt = -Infinity;
    const reset = () => { buffer.reset(); videoAt = audioAt = -Infinity; frames = 0; mediaPts = mediaProgressAt = -Infinity; silenceSince = undefined; audioLevelDb = undefined; };
    function getObservation() {
        const now = clock();
        const progressing = frames >= 2 && now - videoAt < 1000 && now - audioAt < 1000 && now - mediaProgressAt < 1000;
        if (progressing)
            failureSince = undefined;
        else {
            failureSince ??= now;
            silenceSince = undefined;
        }
        return { slotKey: source.slotKey, sourceId: source.sourceId, observedAt: now, ready: progressing,
            progressing, analysisActive: progressing && audioLevelDb !== undefined,
            ...(failureSince === undefined ? {} : { failureSince }),
            ...(progressing && audioLevelDb !== undefined ? { audioLevelDb } : {}),
            ...(progressing && silenceSince !== undefined ? { silenceSince } : {}) };
    }
    function connect() {
        if (!running)
            return;
        reset();
        startedAt = clock();
        failureSince = startedAt;
        child = spawnProcess(ffmpeg, ['-hide_banner', '-loglevel', 'info', '-nostdin', '-threads', '2', '-analyzeduration', '1000000', '-probesize', '1000000', ...(source.url.startsWith('http://127.0.0.1:') ? ['-f', 'mpegts', '-protocol_whitelist', 'http,tcp'] : []), '-i', source.url,
            '-map', '0:v:0', '-vf', `showinfo,scale=${quality.width}:${quality.height}:force_original_aspect_ratio=decrease,pad=${quality.width}:${quality.height}:(ow-iw)/2:(oh-ih)/2,format=yuv420p`,
            '-fps_mode', 'passthrough', '-threads', '2', '-f', 'rawvideo', 'pipe:3',
            '-map', '0:a:0', '-ac', '2', '-ar', '48000', '-f', 's16le', 'pipe:4'], { stdio: ['ignore', 'ignore', 'pipe', 'pipe', 'pipe'] });
        const current = child;
        // Parse only the decoded video PTS; never retain or expose source diagnostics/URLs.
        createInterface({ input: child.stdio[2] }).on('line', line => {
            const match = line.match(/showinfo.*pts_time:([\d.e+-]+)/);
            if (!match)
                return;
            const pts = Number(match[1]);
            if (Number.isFinite(pts) && pts > mediaPts) {
                // The first timestamp establishes a baseline, not proof of movement.
                if (Number.isFinite(mediaPts))
                    mediaProgressAt = clock();
                mediaPts = pts;
            }
        });
        child.stdio[3].on('data', chunk => {
            const count = buffer.video(chunk);
            if (count) {
                frames += count;
                videoAt = clock();
            }
        });
        child.stdio[4].on('data', data => {
            const chunk = buffer.audio(data);
            if (!chunk.length)
                return;
            audioAt = clock();
            let sum = 0;
            for (let i = 0; i + 1 < chunk.length; i += 2) {
                const x = chunk.readInt16LE(i) / 32768;
                sum += x * x;
            }
            audioLevelDb = Math.max(-120, 10 * Math.log10(sum / Math.max(1, Math.floor(chunk.length / 2))));
            // Accumulate only with progressing decoded A/V and an explicitly calibrated threshold.
            if (getObservation().progressing && Number.isFinite(silenceThresholdDb) && audioLevelDb < silenceThresholdDb)
                silenceSince ??= clock();
            else
                silenceSince = undefined;
        });
        child.on('error', () => { }); // close also fires for spawn failure; diagnostics intentionally omit URLs.
        child.once('close', () => {
            if (child !== current)
                return;
            child = undefined;
            reset();
            failureSince ??= clock();
            onObservation(getObservation());
            if (running)
                retryTimer = setTimeout(connect, reconnectDelay(attempt++));
        });
    }
    return { source, buffer, getObservation,
        start() {
            if (running)
                return;
            running = true;
            connect();
            healthTimer = setInterval(() => {
                const observation = getObservation();
                onObservation(observation);
                if (observation.ready && clock() - startedAt > 10000)
                    attempt = 0;
                // A hung demuxer has a deadline too. Never keep a socket forever without decoded media.
                if (child && clock() - Math.max(startedAt, Math.min(videoAt, audioAt, mediaProgressAt)) > 5000)
                    child.kill('SIGKILL');
            }, 250);
        },
        async stop() {
            running = false;
            clearTimeout(retryTimer);
            clearInterval(healthTimer);
            const stopping = child;
            if (stopping)
                await new Promise(resolve => { stopping.once('close', resolve); stopping.kill('SIGKILL'); });
            reset();
            failureSince ??= clock();
        },
    };
}
