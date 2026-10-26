import { promisify } from 'node:util';
import { spawn, execFile } from 'node:child_process';
import { performance } from 'node:perf_hooks';
// A strict memory ceiling in addition to the two-second age bound. Never accumulate
// data behind a blocked pipe: recycle that destination and rejoin the live program.
export const OUTPUT_QUEUE_BYTES = 512 * 1024;
export const OUTPUT_QUEUE_MS = 2000;
export const TWITCH_PROFILE = 'twitch-conservative-720p30';
export function parseOutputCredential(destination, value) {
    try {
        if (typeof value !== 'string' || value.length > 8192)
            throw Error();
        const secret = JSON.parse(value);
        let url, key;
        if (secret.ingestUrl) {
            url = new URL(secret.ingestUrl);
            key = url.pathname.split('/').pop();
            url.pathname = url.pathname.slice(0, url.pathname.lastIndexOf('/'));
        }
        else {
            url = new URL(secret.rtmpUrl);
            key = secret.streamKey;
        }
        const domain = destination === 'vrcdn' ? /^(?:[a-z0-9-]+\.)?ingest\.vrcdn\.live$/ : /^(?:[a-z0-9-]+\.)*live\.twitch\.tv$/;
        if (!['vrcdn', 'twitch'].includes(destination) || !['rtmp:', 'rtmps:'].includes(url.protocol) || !domain.test(url.hostname) || url.username || url.password || url.search || url.hash || (url.port && !['1935', '443'].includes(url.port)) || url.pathname.replace(/\/$/, '') !== (destination === 'vrcdn' ? '/live' : '/app') || typeof key !== 'string' || !/^[a-zA-Z0-9_-]{1,512}$/.test(key))
            throw Error();
        return { url: url.href.replace(/\/$/, ''), key };
    }
    catch {
        throw Error('Invalid output credential');
    }
}
/** Optional secrets are runtime dependencies, never ECS initialization secrets.
 * The task role grants only explicit secret ARNs; neither AWS stderr nor values
 * escape this boundary. The sender supplies an independent abort/deadline.
 */
export async function resolveOptionalOutputSecret({ arn, region, signal, run = promisify(execFile) }) {
    try {
        const match = typeof arn === 'string' && arn.match(/^arn:aws(?:-us-gov|-cn)?:secretsmanager:([a-z0-9-]+):[0-9]{12}:secret:[A-Za-z0-9/_+=.@-]+$/);
        if (!match || (region && region !== match[1]))
            throw Error();
        const { stdout } = await run('aws', ['secretsmanager', 'get-secret-value', '--secret-id', arn, '--region', match[1], '--output', 'json', '--cli-connect-timeout', '1', '--cli-read-timeout', '1'], { signal, timeout: 2000, maxBuffer: 16384 });
        const value = JSON.parse(stdout).SecretString;
        if (typeof value !== 'string' || value.length > 8192)
            throw Error();
        return value;
    }
    catch {
        throw Error('Optional credential unavailable');
    }
}
export function outputArguments(destination, target) {
    return ['-hide_banner', '-loglevel', 'error', '-nostdin', '-stats_period', '0.25', '-progress', 'pipe:3',
        '-fflags', '+discardcorrupt', '-probesize', '262144', '-analyzeduration', '1000000', '-f', 'mpegts', '-i', 'pipe:0',
        '-map', '0:v:0', '-map', '0:a:0',
        ...(destination === 'vrcdn' ? ['-c', 'copy'] : ['-c:v', 'libx264', '-threads', '2', '-preset', 'veryfast', '-vf', 'scale=1280:720,fps=30', '-pix_fmt', 'yuv420p', '-g', '60', '-keyint_min', '60', '-sc_threshold', '0', '-bf', '0', '-b:v', '1800k', '-minrate', '1800k', '-maxrate', '1800k', '-bufsize', '3600k', '-x264-params', 'nal-hrd=cbr:force-cfr=1', '-c:a', 'aac', '-b:a', '160k', '-ar', '48000', '-ac', '2']),
        '-rw_timeout', '2000000', '-rtmp_playpath', target.key, '-f', 'flv', target.url];
}
/** Secret resolution and process creation happen only on start, inside the worker.
 * stderr is drained and discarded: arbitrary FFmpeg/provider diagnostics never
 * cross this boundary. Only fixed status codes are observable.
 */
export function createOutputSender({ destination, credentialRef, program, onHealth = () => { }, resolveCredential, spawnProcess = spawn, clock = () => performance.now(), parseCredential = parseOutputCredential, credentialTimeoutMs = 2000 }) {
    let child, terminal = false, active = false, timer, unsubscribe, blockedAt, lastProgressAt, startedAt, retryAt = 0, attempts = 0, progressMs = 0, status = 'idle', progressBuffer = '';
    let resolving = false, credentialController, credentialTimer, cachedTarget;
    const queue = [];
    let queueBytes = 0;
    function health() { return { destination, status, publishing: status === 'publishing' && lastProgressAt !== undefined && clock() - lastProgressAt <= 2000, queueBytes: queueBytes + (child?.stdin?.writableLength ?? 0), outputMs: progressMs, restarts: attempts }; }
    function notify() {
        try {
            onHealth(health());
        }
        catch { }
    }
    function clear() { queue.length = 0; queueBytes = 0; blockedAt = undefined; progressBuffer = ''; }
    function detach() { const old = child; child = undefined; clear(); old?.stdin?.destroy(); old?.kill('SIGKILL'); }
    function retry() {
        if (terminal)
            return;
        status = 'reconnecting';
        lastProgressAt = undefined;
        detach();
        retryAt = clock() + Math.min(500 * 2 ** Math.min(attempts++, 4), 8000);
        notify();
    }
    function launch() {
        if (terminal || child || resolving || !active || status === 'invalid_setup')
            return;
        if (!cachedTarget) {
            const controller = new AbortController();
            try {
                const value = resolveCredential(credentialRef, { signal: controller.signal });
                if (value && typeof value.then === 'function') {
                    resolving = true;
                    status = 'connecting';
                    credentialController = controller;
                    const timeout = new Promise((_, reject) => { credentialTimer = setTimeout(() => { controller.abort(); reject(Error('Credential deadline')); }, credentialTimeoutMs); });
                    void Promise.race([value, timeout]).then(secret => {
                        if (terminal)
                            return;
                        cachedTarget = parseCredential(destination, secret);
                        resolving = false;
                        launch();
                    }).catch(() => { if (!terminal) {
                        status = 'invalid_setup';
                        notify();
                    } }).finally(() => {
                        clearTimeout(credentialTimer);
                        resolving = false;
                        credentialController = undefined;
                    });
                    return;
                }
                cachedTarget = parseCredential(destination, value);
            }
            catch {
                status = 'invalid_setup';
                notify();
                return;
            }
        }
        const target = cachedTarget;
        try {
            const proc = spawnProcess('ffmpeg', outputArguments(destination, target), { stdio: ['pipe', 'ignore', 'pipe', 'pipe'] });
            child = proc;
            startedAt = clock();
            progressMs = 0;
            status = 'connecting';
            proc.stderr.on('data', () => { });
            proc.stdin.on('error', () => {
                if (child === proc)
                    retry();
            });
            proc.on('error', () => {
                if (child === proc)
                    retry();
            });
            proc.on('close', () => {
                if (child === proc)
                    retry();
            });
            proc.stdin.on('drain', () => {
                if (child === proc) {
                    blockedAt = undefined;
                    flush();
                }
            });
            proc.stdio[3].on('data', chunk => {
                if (child !== proc || terminal)
                    return;
                progressBuffer = (progressBuffer + chunk.toString()).slice(-8192);
                let end;
                while ((end = progressBuffer.indexOf('\n')) >= 0) {
                    const line = progressBuffer.slice(0, end);
                    progressBuffer = progressBuffer.slice(end + 1);
                    if (!line.startsWith('out_time_us='))
                        continue;
                    const ms = Number(line.slice(12)) / 1000;
                    if (Number.isFinite(ms) && ms > progressMs) {
                        progressMs = ms;
                        lastProgressAt = clock();
                        status = 'publishing';
                        notify();
                    }
                }
            });
        }
        catch {
            retry();
        }
    }
    function flush() {
        while (child && blockedAt === undefined && queue.length) {
            const item = queue.shift();
            queueBytes -= item.chunk.length;
            if (clock() - item.at > OUTPUT_QUEUE_MS) {
                retry();
                break;
            }
            try {
                if (!child.stdin.write(item.chunk))
                    blockedAt = clock();
            }
            catch {
                retry();
            }
        }
    }
    function tick() {
        if (terminal || !active)
            return;
        const now = clock();
        if (child && ((blockedAt !== undefined && now - blockedAt >= OUTPUT_QUEUE_MS) || (queue[0] && now - queue[0].at >= OUTPUT_QUEUE_MS) || now - (lastProgressAt ?? startedAt) > (lastProgressAt === undefined ? 6000 : 2000)))
            retry();
        if (!child && now >= retryAt)
            launch();
    }
    function enqueue(chunk) {
        if (terminal || !active || !Buffer.isBuffer(chunk))
            return;
        tick();
        if (!child)
            return;
        if (queueBytes + child.stdin.writableLength + chunk.length > OUTPUT_QUEUE_BYTES) {
            retry();
            return;
        }
        queue.push({ chunk, at: clock() });
        queueBytes += chunk.length;
        flush();
    }
    function stopNow() {
        if (terminal)
            return;
        terminal = true;
        active = false;
        credentialController?.abort();
        clearTimeout(credentialTimer);
        cachedTarget = undefined;
        clearInterval(timer);
        unsubscribe?.();
        detach();
        status = 'stopped';
        lastProgressAt = undefined;
        notify();
    }
    return { enqueue, getState: health, stopNow, async start() {
            if (terminal || active)
                return;
            active = true;
            launch();
            unsubscribe = program?.subscribe(enqueue);
            timer = setInterval(tick, 100);
        }, async stop() { stopNow(); } };
}
export function createEventOutputs({ configuration, clock, env = process.env, resolveCredential, spawnForDestination = () => spawn, readSecret = resolveOptionalOutputSecret, credentialTimeoutMs = 2000 }) {
    const selected = configuration.outputs.find(o => o.id === configuration.outputId);
    if (!selected || !['vrcdn', 'external_rtmp'].includes(selected.type) || (selected.type === 'external_rtmp' && !selected.twitchSetup) || (selected?.type === 'vrcdn' && selected.twitchSetup))
        throw Error('Selected output unavailable');
    const optional = configuration.outputs.filter(o => o.id !== selected.id && o.simulcastEnabled === true && o.type === 'external_rtmp' && o.twitchSetup);
    if (optional.length > 1)
        throw Error('At most one optional Twitch output');
    const resolver = resolveCredential ?? ((ref, { signal }) => {
        if (ref === selected.credential?.secretRef)
            return env.VRDEX_EVENT_MEDIA_OUTPUT_INGEST_SECRET_JSON;
        const bindings = JSON.parse(env.VRDEX_EVENT_MEDIA_OPTIONAL_SECRET_ARNS_JSON ?? '{}');
        const arn = bindings[ref];
        if (typeof arn !== 'string')
            throw Error('Optional credential unavailable');
        return readSecret({ arn, region: env.AWS_REGION, signal });
    });
    const entries = [selected, ...optional].map(output => {
        const destination = output.type === 'vrcdn' ? 'vrcdn' : 'twitch';
        const resolve = (ref, options) => {
            if (!output.credential?.secretRef || !['sourceConsent', 'destinationAuthority', 'providerRules', 'rightsClearedMedia'].every(k => output.compliance?.[k] === 'accepted') || (destination === 'twitch' && output.twitchSetup?.profile !== TWITCH_PROFILE) || (destination === 'vrcdn' && Object.entries({ keyframeIntervalSeconds: 1, targetVideoBitrateKbps: 1800, targetAudioBitrateKbps: 160, audioSampleRateHz: 48000 }).some(([key, value]) => output.vrcdnSetup?.[key] !== undefined && output.vrcdnSetup[key] !== value)))
                throw Error('Invalid output setup');
            return resolver(ref, options);
        };
        return { outputId: output.id, sender: createOutputSender({ destination, credentialRef: output.credential?.secretRef, resolveCredential: resolve, spawnProcess: spawnForDestination(destination), clock, credentialTimeoutMs }) };
    });
    return { async start() { await Promise.all(entries.map(e => e.sender.start())); }, enqueue(chunk) {
            for (const e of entries)
                e.sender.enqueue(chunk);
        }, getState() { const destinations = entries.map(e => ({ outputId: e.outputId, ...e.sender.getState() })); return { publishing: destinations[0].publishing, destinations }; }, stopNow() {
            for (const e of entries)
                e.sender.stopNow();
        }, async stop() { await Promise.all(entries.map(e => e.sender.stop())); } };
}
