import assert from 'node:assert/strict';
import { spawn, execFileSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { createServer } from 'node:http';
import { createWriteStream } from 'node:fs';
import { mkdtemp, readFile, writeFile, stat } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { pathToFileURL } from 'node:url';
import { performance } from 'node:perf_hooks';
import { setTimeout as sleep } from 'node:timers/promises';
import { createProofWorker as createEventWorker, syntheticInputs } from './event-proof-fixtures.mjs';
import { createProgramRenderer, QUALITY_PROFILES } from '../workers/restream/program-renderer.mjs';
import { decideHandoff } from '../workers/restream/handoff-policy.mjs';
import { verifyProgramPackets } from './event-proof-metrics.mjs';

// Real wall-time A/V proof. Only authority, source transport and output sink are
// local. Observations, selection, encoded acknowledgements and packets are real.
export async function runSilenceProof({ receiptPath, thresholdDb = -90 } = {}) {
    // Use the supported 480p30 output preset; source fixtures remain 180p15.

    const directory = await mkdtemp(join(tmpdir(), 'event-silence-proof-'));
    const path = join(directory, 'program.ts'), file = createWriteStream(path);
    const begun = Date.now(), events = [], children = new Set(), samples = [];
    let renderer, worker, poll, watchdog, bytes = 0, active = true, sequence = 0, commands = [], aStartedAt, bEnabled = true;
    let factoryThreshold, positive, encodedBAt, blueOutputSecond;
    const config = { sessionDeadline: begun + 110_000, mode: 'automatic', policy: { silence: { thresholdDb, durationMs: 15_000 } }, outputId: 'sink', outputs: [{ id: 'sink' }], sources: ['a', 'b'].map(id => ({ id, type: 'vrcdn_link', publicUrl: `https://stream.vrcdn.live/live/${id}.live.ts` })), slots: [{ slotKey: 'a', sourceId: 'a', startAt: begun - 60_000, endAt: begun + 5000, available: true }, { slotKey: 'b', sourceId: 'b', startAt: begun + 5000, available: true }] };
    const record = (scenario, extra = {}) => { const event = { scenario, elapsedMs: Date.now() - begun, ...extra }; events.push(event); console.log(JSON.stringify(event)); };
    const observation = id => renderer?.getInputs().find(i => i.source.sourceId === id)?.getObservation();
    const server = createServer((request, response) => {
        const id = request.url === '/a' ? 'a' : 'b';
        if (id === 'b' && !bEnabled) { response.writeHead(503); response.end(); return; }
        if (id === 'a') aStartedAt ??= Date.now();
        const sourceOffset = id === 'a' ? (Date.now() - aStartedAt) / 1000 : 0;
        // Peak -78 dBFS sine gives nominal -81 dBFS RMS, then an 11s pause,
        // an audible reset burst, then sustained digital zero. AAC -> s16le
        // quantization is measured below, never assumed from the formula.
        const audio = id === 'a' ? `aevalsrc='if(lt(t+${sourceOffset},28),0.000125892541*sin(2*PI*440*t),if(lt(t+${sourceOffset},39),0,if(lt(t+${sourceOffset},43),0.1*sin(2*PI*440*t),0)))':s=48000:c=stereo` : 'sine=frequency=880:sample_rate=48000';
        const child = spawn('ffmpeg', ['-hide_banner', '-loglevel', 'error', '-re', '-f', 'lavfi', '-i', `color=${id === 'a' ? 'red' : 'blue'}:s=320x180:r=15`, '-re', '-f', 'lavfi', '-i', audio, '-c:v', 'libx264', '-threads', '2', '-preset', 'ultrafast', '-tune', 'zerolatency', '-g', '15', '-c:a', 'aac', '-b:a', '160k', '-f', 'mpegts', 'pipe:1'], { stdio: ['ignore', 'pipe', 'pipe'] });
        children.add(child);
        let diagnostic = '';
        child.stderr.on('data', chunk => { diagnostic = (diagnostic + chunk).slice(-1024); });
        child.on('error', error => response.destroy(error));
        child.once('close', code => { children.delete(child); if (code) response.destroy(Error(`Source encoder exited ${code}: ${diagnostic}`)); });
        response.writeHead(200, { 'Content-Type': 'video/mp2t' });
        child.stdout.pipe(response);
        response.once('close', () => child.kill('SIGKILL'));
    });
    await new Promise((resolve, reject) => { server.once('error', reject); server.listen(0, '127.0.0.1', resolve); });
    const { port } = server.address();
    async function until(predicate, timeout = 12_000) {
        const end = Date.now() + timeout;
        while (!predicate()) {
            assert(Date.now() < end, JSON.stringify({ timeout, controller: worker?.getState(), renderer: renderer ? { ...renderer.getState(), error: renderer.getState().error?.message } : undefined, a: observation('a'), b: observation('b') }));
            assert(!worker?.getState().stopped, 'worker remains authoritative');
            await sleep(100);
        }
    }
    async function stay(milliseconds, source = 'a') {
        const end = Date.now() + milliseconds;
        while (Date.now() < end) {
            assert.equal(renderer.getState().renderedSourceId, source === null ? undefined : source);
            assert.equal(worker.getState().stopped, false);
            await sleep(100);
        }
    }
    async function command(commandType) {
        commands = [{ _id: `command-${++sequence}`, sequence, commandType }];
        await until(() => commands.length === 0);
    }
    try {
        worker = createEventWorker({ identity: { eventId: 'local', sessionId: 'local', workerId: 'silence-proof', epoch: 0 },
            createRenderer(options) {
                factoryThreshold = options.silenceThresholdDb;
                renderer = createProgramRenderer({ ...options, quality: '480p30' });
                const select = renderer.selectSource;
                renderer.selectSource = slotKey => {
                    if (slotKey === 'b' && !positive) {
                        const current = worker.getState().current, evidence = observation('a'), nextReadiness = observation('b');
                        const decision = decideHandoff({ scheduleNow: Date.now(), observationNow: performance.now(), sessionDeadline: config.sessionDeadline, mode: worker.getState().mode, current, next: config.slots[1], evidence, nextReadiness, policy: config.policy });
                        assert.equal(decision.reason, 'silence');
                        assert.equal(decision.kind, 'switch');
                        assert(evidence.observedAt - evidence.silenceSince >= 15_000);
                        positive = { decision, evidence, nextReadiness, eligibleAt: Math.max(current.endAt, config.slots[1].startAt), selectedAt: Date.now() };
                    }
                    return select(slotKey);
                };
                return renderer;
            },
            control: async (name, args) => {
                if (name === 'acquireSession' || name === 'renewSession') return { granted: true, epoch: 1, serverNow: Date.now(), expiresAt: Date.now() + 30_000, renewAfterMs: 10_000, configuration: structuredClone(config) };
                if (name === 'refreshConfiguration') return { granted: true, serverNow: Date.now(), configuration: structuredClone(config) };
                if (name === 'claimCommands') return { granted: true, commands: structuredClone(commands) };
                if (name === 'acknowledgeCommand') { assert.equal(args.outcome, 'succeeded'); commands = []; }
                return { accepted: true };
            }, metric(event) { if (event.event !== 'event_worker_heartbeat') record(event.event, { ...event, renderer: renderer ? { ...renderer.getState(), error: renderer.getState().error?.message } : undefined, a: observation('a'), b: observation('b') }); }, inputs: syntheticInputs(async source => `http://127.0.0.1:${port}/${source.id}`), checkEnabled: async () => true,
            outputs: { start: async () => {}, enqueue(chunk) { if (!active) return; bytes += chunk.length; assert(bytes < 100 * 1024 * 1024, 'bounded recording'); assert(file.writableLength < 8 * 1024 * 1024, 'bounded sink queue'); file.write(chunk); }, getState: () => ({ publishing: active && bytes > 0 }), stopNow() { active = false; }, stop: async () => {} } });
        await worker.start();
        assert.equal(factoryThreshold, thresholdDb, 'worker passes threshold to renderer factory');
        poll = setInterval(() => void worker.tick(), 100);
        watchdog = setInterval(() => worker.watchdog(), 50);
        const sampler = setInterval(() => { const a = observation('a'); if (a?.analysisActive) samples.push({ elapsedMs: Date.now() - aStartedAt, ...a }); }, 200);
        try {
            await until(() => renderer.getState().renderedSourceId === 'a' && observation('b')?.ready);
            const liveAt = Date.now();
            record('decoded-a-and-b-ready', { a: observation('a'), b: observation('b') });
            await stay(Math.max(16_000, begun + 21_000 - liveAt));
            assert(Date.now() - aStartedAt < 28_000, 'quiet control ends before pause');
            assert(observation('a').audioLevelDb > thresholdDb);
            record('quiet-minus81-retained-after-boundary', { afterBoundaryMs: Date.now() - config.slots[1].startAt, decodedLevelDb: observation('a').audioLevelDb });
            // Accumulated silence before eligibility is valid evidence, but cannot
            // bypass the authored boundary. It may qualify immediately later.
            config.slots[0].endAt = config.slots[1].startAt = begun + 100_000;
            await until(() => observation('a')?.silenceSince !== undefined && performance.now() - observation('a').silenceSince > 7000, 22_000);
            record('short-pause-retained', { evidence: observation('a') });
            await until(() => observation('a')?.audioLevelDb > -40, 10_000);
            assert.equal(observation('a').silenceSince, undefined);
            assert.equal(renderer.getState().renderedSourceId, 'a');
            record('audible-burst-resets-continuous-silence', { evidence: observation('a') });
            await until(() => observation('a')?.silenceSince !== undefined && performance.now() - observation('a').silenceSince >= 15_000, 24_000);
            await stay(1000);
            record('qualified-zero-before-boundary-retained', { evidence: observation('a') });
            // No successor and final-slot cases must retain a healthy silent A.
            const successor = config.slots.pop();
            config.slots[0].endAt = begun;
            await stay(1200);
            record('final-slot-zero-retained');
            config.slots.push({ ...successor, startAt: begun, available: false });
            await stay(1200);
            record('disabled-successor-zero-retained');
            bEnabled = false;
            config.slots[1].available = true;
            await stay(1200);
            assert(!observation('b')?.ready);
            record('unready-successor-zero-retained');
            await command('hold_current');
            bEnabled = true;
            await stay(1200);
            assert.equal(worker.getState().mode, 'manual');
            record('manual-current-zero-retained');
            // Return to auto keeps A's decoder and its measured interval. Slate
            // is checked after the positive handoff to avoid restarting A here.
            config.slots[0].endAt = config.slots[1].startAt = begun + 100_000;
            await command('set_automatic_mode');
            await until(() => renderer.getState().renderedSourceId === 'a' && observation('b')?.ready);
            await until(() => observation('a')?.silenceSince !== undefined && performance.now() - observation('a').silenceSince >= 15_000, 21_000);
            assert.equal(positive, undefined);
            config.slots[0].endAt = config.slots[1].startAt = Date.now() - 100;
            await until(() => renderer.getState().renderedSourceId === 'b');
            encodedBAt = Date.now();
            const blueStartOutputMs = renderer.getState().outputMs;
            assert(positive.selectedAt >= positive.eligibleAt);
            await stay(6000, 'b');
            blueOutputSecond = (blueStartOutputMs + renderer.getState().outputMs) / 2000;
            record('encoded-positive-silence-handoff', { ...positive, encodedBAt, blueOutputSecond });
            await command('switch_hold');
            await until(() => renderer.getState().renderedSourceId === undefined);
            await stay(1200, null);
            assert.equal(worker.getState().mode, 'hold');
            record('hold-slate-no-automatic-handoff');
        } finally { clearInterval(sampler); }
    } catch (error) {
        console.error(error);
        throw error;
    } finally {
        clearInterval(poll); clearInterval(watchdog);
        await worker?.stop();
        for (const child of children) child.kill('SIGKILL');
        server.closeAllConnections();
        await new Promise(resolve => server.close(resolve));
        await new Promise(resolve => file.end(resolve));
    }
    const packets = await verifyProgramPackets(path);
    assert(packets.maxGap < 0.2, 'continuous encoded output');
    assert(packets.maxGop < 1.2, 'bounded GOP');
    // Decode the positive encoded window to RGB: a blue B frame proves source
    // identity independently of the renderer acknowledgement bookkeeping.
    const rgb = execFileSync('ffmpeg', ['-v', 'error', '-ss', String(blueOutputSecond), '-i', path, '-frames:v', '1', '-vf', 'scale=1:1', '-f', 'rawvideo', '-pix_fmt', 'rgb24', 'pipe:1']);
    assert.equal(rgb.length, 3);
    assert(rgb[2] > rgb[0] + 100, 'positive encoded output window is blue source B');
    const finalRgb = execFileSync('ffmpeg', ['-v', 'error', '-i', path, '-ss', String(renderer.getState().outputMs / 1000 - 0.5), '-frames:v', '1', '-vf', 'scale=1:1', '-f', 'rawvideo', '-pix_fmt', 'rgb24', 'pipe:1']);
    assert.equal(finalRgb.length, 3);
    assert(Math.abs(finalRgb[0] - finalRgb[2]) < 10, 'final encoded output is neutral hold slate');
    const range = values => ({ min: Math.min(...values), max: Math.max(...values), samples: values.length });
    const levels = { quietMinus81: range(samples.filter(s => s.elapsedMs > 4000 && s.elapsedMs < 26_000).map(s => s.audioLevelDb)), normalBurst: range(samples.filter(s => s.elapsedMs > 40_000 && s.elapsedMs < 42_000).map(s => s.audioLevelDb)), digitalZero: range(samples.filter(s => s.elapsedMs > 47_000).map(s => s.audioLevelDb)) };
    assert(levels.quietMinus81.min > -90);
    assert(levels.digitalZero.max < thresholdDb);
    const media = await readFile(path);
    const receipt = { profile: QUALITY_PROFILES['480p30'], candidate: config.policy.silence, factoryThreshold, elapsedMs: Date.now() - begun, recordingBytes: (await stat(path)).size, mediaSha256: createHash('sha256').update(media).digest('hex'), ffmpegVersion: execFileSync('ffmpeg', ['-version'], { encoding: 'utf8' }).split('\n')[0], levels, packets, positiveFrameSecond: blueOutputSecond, positiveEncodedRgb: [...rgb], finalEncodedRgb: [...finalRgb], events, limits: 'Synthetic conservative AAC/MPEGTS calibration only. No production-resolution capacity claim, observed musical false-positive rate, hosted Convex authority, provider acceptance, reconnect/frozen-PTS or delayed-event-loop proof. Media is temporary; receipt retains hashes and measurements.' };
    if (receiptPath) await writeFile(receiptPath, `${JSON.stringify(receipt, null, 2)}\n`);
    console.log(JSON.stringify({ result: 'passed', receiptPath, ...receipt }));
    return receipt;
}
if (process.argv[1] && import.meta.url === pathToFileURL(resolve(process.argv[1])).href) {
    await runSilenceProof({ receiptPath: process.env.PROOF_RECEIPT_PATH });
}
