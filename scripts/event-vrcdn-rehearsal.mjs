import { createWriteStream } from 'node:fs';
import { mkdtemp, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { pathToFileURL } from 'node:url';
import { setTimeout as sleep } from 'node:timers/promises';
import { createEventWorker, checkHostedEnabled, bounded } from '../workers/restream/event-worker.mjs';
import { createProgramRenderer } from '../workers/restream/program-renderer.mjs';
import { createEventOutputs, parseOutputCredential } from '../workers/restream/output-sender.mjs';
import { createSourceRelay } from '../workers/restream/source-relay.mjs';
import { processMetrics } from './event-proof-metrics.mjs';
import { ARTIFACT_ROOT, finalizeProof, numericDiagnostics, proofStart, verifyRecording } from './event-proof-runner.mjs';

export const REHEARSAL_PARAMETER = '/vrdex/restream/rehearsal/enabled';
export const SOURCE_URL = 'https://stream.vrcdn.live/live/basicbit1.live.ts';
export const OUTPUT_URL = 'https://stream.vrcdn.live/live/basicbit.live.ts';
const RIGHTS = ['sourceConsent', 'destinationAuthority', 'providerRules', 'rightsClearedMedia'];
export function validateRehearsal(env) {
    if (env.VRDEX_PROVIDER_REHEARSAL_CONFIRMED !== 'true' || env.AWS_REGION !== 'us-east-1' || env.VRDEX_RESTREAM_KILL_SWITCH_SSM_PARAMETER !== REHEARSAL_PARAMETER) throw Error('Rehearsal guard or dedicated switch is invalid');
    // Fixed endpoints and identity. Reject alternate launch settings, including
    // production authority, rather than silently ignoring a mistyped override.
    for (const [key, value] of Object.entries(env)) {
        if (value && (/CONVEX|BRIDGE_TOKEN|OPTIONAL_SECRET|SOURCE_URL|OUTPUT_URL|INGEST_URL|STREAM_KEY/.test(key) || /^VRDEX_EVENT_MEDIA_(EVENT_ID|SESSION_ID|EPOCH)$/.test(key))) throw Error('Unsupported rehearsal configuration');
        if (value && key.startsWith('VRDEX_') && ![
            'VRDEX_PROVIDER_REHEARSAL_CONFIRMED', 'VRDEX_PROVIDER_REHEARSAL_ATTESTATIONS_JSON',
            'VRDEX_EVENT_MEDIA_OUTPUT_INGEST_SECRET_JSON', 'VRDEX_RESTREAM_KILL_SWITCH_SSM_PARAMETER',
            'VRDEX_RESTREAM_ARTIFACT_S3_URI', 'VRDEX_RESTREAM_QUALITY_GATE', 'VRDEX_PROOF_RUN_ID',
        ].includes(key)) throw Error('Unsupported rehearsal configuration');
    }
    if (env.PROOF_SECONDS !== undefined && env.PROOF_SECONDS !== '120') throw Error('Rehearsal duration must be 120 seconds');
    if (env.VRDEX_RESTREAM_QUALITY_GATE !== undefined && env.VRDEX_RESTREAM_QUALITY_GATE !== '720p30') throw Error('Rehearsal profile must be 720p30');
    let compliance;
    try { compliance = JSON.parse(env.VRDEX_PROVIDER_REHEARSAL_ATTESTATIONS_JSON); } catch { throw Error('Explicit rights attestations required'); }
    if (!compliance || Array.isArray(compliance) || Object.keys(compliance).length !== RIGHTS.length || !RIGHTS.every(key => compliance[key] === 'accepted')) throw Error('Four explicit rights attestations required');
    // Use the production parser with its normal provider restrictions. The ECS
    // secret ARN identifies basicbit; an opaque stream key cannot prove ownership.
    parseOutputCredential('vrcdn', env.VRDEX_EVENT_MEDIA_OUTPUT_INGEST_SECRET_JSON);
    return { seconds: 120, compliance: Object.fromEntries(RIGHTS.map(key => [key, compliance[key]])) };
}
export function createReadinessEvidence() {
    let wasReady = false, everReady = false, sourceLossObserved = false, sourceRecoveryObserved = false;
    return {
        observe(observation) {
            if (observation.ready === true) { if (sourceLossObserved && !wasReady) sourceRecoveryObserved = true; everReady = true; wasReady = true; }
            else if (observation.ready === false) { if (wasReady) sourceLossObserved = true; wasReady = false; }
        },
        result: () => ({ sourceReadyObserved: everReady, sourceLossObserved, sourceRecoveryObserved }),
    };
}
export function createRehearsalControl({ compliance, beganAt, now = Date.now, evidence, recoveryObserved = () => false }) {
    const deadline = beganAt + 180000;
    const configuration = {
        outputId: 'basicbit', outputs: [{ id: 'basicbit', type: 'vrcdn', credential: { secretRef: 'basicbit-output' }, compliance }],
        sessionDeadline: deadline, mode: 'manual', currentSourceId: 'basicbit1', policy: {},
        sources: [{ id: 'basicbit1', type: 'vrcdn_link', publicUrl: SOURCE_URL }],
        slots: [{ slotKey: 'source-a', sourceId: 'basicbit1', startAt: beganAt - 1000, endAt: deadline, available: true }],
    };
    const acknowledged = new Set();
    return async (name, args = {}) => {
        const current = now();
        if (current >= deadline) return { granted: false, accepted: false };
        if (name === 'acquireSession' || name === 'renewSession') return { granted: true, epoch: 1, serverNow: current, expiresAt: Math.min(current + 30000, deadline), renewAfterMs: 10000, configuration };
        if (name === 'refreshConfiguration') return { granted: true, serverNow: current, configuration };
        if (name === 'claimCommands') {
            const elapsed = current - beganAt;
            const commands = [
                { _id: 'rehearsal-hold', sequence: 1, commandType: 'switch_hold', after: 20000 },
                { _id: 'rehearsal-return', sequence: 2, commandType: 'switch_source', targetSourceId: 'basicbit1', after: 30000 },
                ...(recoveryObserved() ? [{ _id: 'rehearsal-recovery-return', sequence: 3, commandType: 'switch_source', targetSourceId: 'basicbit1', after: 60000 }] : []),
            ];
            return { granted: true, commands: commands.filter(command => command.after <= elapsed && !acknowledged.has(command.sequence)).slice(0, 1).map(({ after: _after, ...command }) => command) };
        }
        if (name === 'acknowledgeCommand') {
            acknowledged.add(args.sequence);
            if (evidence.commands.length < 64) evidence.commands.push({ sequence: args.sequence, succeeded: args.outcome === 'succeeded', live: args.observedState === 'live', hold: args.observedState === 'hold' });
        }
        if (name === 'observeProgram' && evidence.observations.length < 256) evidence.observations.push({ elapsedMs: current - beganAt, live: args.state === 'live', hold: args.state === 'hold', publishing: args.publishing === true, outputMs: args.outputMs });
        return { accepted: true };
    };
}
/** Only the CLI uses production defaults. Dependencies allow offline lifecycle tests. */
export async function runRehearsal({ env = process.env, directory, signal, dependencies = {} } = {}) {
    const { compliance } = validateRehearsal(env);
    const deps = { createSourceRelay, createProgramRenderer, createEventOutputs, createEventWorker, checkHostedEnabled, processMetrics, verifyProgramPackets: verifyRecording, now: Date.now, sleep, ...dependencies };
    directory ??= await mkdtemp(join(tmpdir(), 'event-vrcdn-rehearsal-'));
    const beganAt = deps.now(), evidence = { commands: [], observations: [] }, readiness = createReadinessEvidence();
    const samples = [], metricsEvents = [];
    const stopReasons = {}, expiredAuthorities = {};
    let relay, renderer, outputs, worker, metrics, timer, internalDeadline, unsubscribe, recording, recordingDone;
    let exitCode = 1, aborted = signal?.aborted === true, timedOut = false, rendererFailed = false, recordingFailed = false, recordedBytes = 0, published = false, switchFalseObserved = false, switchUnavailable = false, fenced = false;
    let lastRequiredOutputMs = 0, lastRequiredProgressAt, requiredOutputProgressFailed = false;
    const fence = () => { outputs?.stopNow(); };
    const abort = () => { aborted = true; fence(); void worker?.stop(); };
    signal?.addEventListener('abort', abort, { once: true });
    try {
        if (aborted) throw Error('Interrupted');
        relay = await bounded(() => deps.createSourceRelay(), 3000);
        renderer = deps.createProgramRenderer({ quality: '720p30', onError: () => { rendererFailed = true; fence(); void worker?.stop(); } });
        outputs = deps.createEventOutputs({ configuration: { outputId: 'basicbit', outputs: [{ id: 'basicbit', type: 'vrcdn', credential: { secretRef: 'basicbit-output' }, compliance }] }, env });
        metrics = deps.processMetrics(new Map(), new Map());
        recording = createWriteStream(join(directory, 'program.ts'), { mode: 0o600 });
        recording.on('error', () => { recordingFailed = true; fence(); });
        recordingDone = new Promise(resolveDone => { recording.once('close', resolveDone); });
        unsubscribe = renderer.subscribe(chunk => {
            recordedBytes += chunk.length;
            if (recordedBytes > 64 * 1024 * 1024 || recording.writableLength > 1024 * 1024) { recordingFailed = true; fence(); return; }
            recording.write(chunk);
        });
        worker = deps.createEventWorker({ identity: { eventId: 'isolated-rehearsal', sessionId: 'isolated-rehearsal', workerId: 'isolated-rehearsal', epoch: 0 }, renderer, outputs, maxSessionMs: 180000,
            control: createRehearsalControl({ compliance, beganAt, evidence, now: deps.now, recoveryObserved: () => readiness.result().sourceRecoveryObserved }),
            resolveSource: source => relay.resolveSource(source), retainSources: sources => relay.retainSources(sources),
            checkEnabled: async () => {
                try { const enabled = await deps.checkHostedEnabled({ parameter: REHEARSAL_PARAMETER, region: 'us-east-1' }); switchFalseObserved ||= !enabled; return enabled; }
                catch { switchUnavailable = true; throw Error('Dedicated switch unavailable'); }
            },
            metric: value => {
                if (value.event === 'event_worker_stopped') {
                    fenced = true;
                    for (const reason of ['startup-failed', 'primary-startup-failed', 'authority-expired', 'control-failed', 'operator-stop', 'session-deadline', 'shutdown']) {
                        if (value.reason === reason) stopReasons[reason.replaceAll('-', '_')] = true;
                    }
                }
                if (value.event === 'event_worker_authority_expired') {
                    for (const authority of ['kill-switch', 'lease', 'session-deadline']) {
                        if (value.authority === authority) expiredAuthorities[authority.replaceAll('-', '_')] = true;
                    }
                }
                if (metricsEvents.length < 512) metricsEvents.push(numericDiagnostics(value));
            },
        });
        timer = setInterval(() => worker.watchdog(), 50);
        internalDeadline = setTimeout(() => { timedOut = true; fence(); void worker.stop(); }, 180000);
        await bounded(() => worker.start(), 12000);
        while (deps.now() - beganAt < 120000 && !worker.getState().stopped && !aborted && !timedOut && !rendererFailed && !recordingFailed) {
            await worker.tick();
            const state = renderer.getState(), output = outputs.getState();
            // Hold/return deliberately recreate a decoder. Only evaluate loss after
            // the first explicit return is acknowledged as actual live output.
            const returned = evidence.commands.some(command => command.sequence === 2 && command.succeeded && command.live);
            if (deps.now() - beganAt < 20000 || returned) {
                for (const input of renderer.getInputs()) readiness.observe(input.getObservation());
            }
            const primary = output.destinations?.find(destination => destination.outputId === 'basicbit');
            const primaryMs = primary?.outputMs;
            if (output.publishing === true && primary?.publishing === true && Number.isFinite(primaryMs) && primaryMs > lastRequiredOutputMs && state.running && state.outputMs > 0) {
                published = true;
                lastRequiredProgressAt = deps.now();
            }
            if (Number.isFinite(primaryMs)) lastRequiredOutputMs = primaryMs;
            samples.push(numericDiagnostics({ elapsedMs: deps.now() - beganAt, outputMs: state.outputMs, running: state.running, rendererFailed: Boolean(state.error), publishing: output.publishing, destinations: output.destinations, ...readiness.result() }));
            await metrics.sample();
            if (deps.now() - beganAt > 15000 && !published) throw Error('No advancing publication');
            if (published && !worker.getState().stopped && deps.now() - lastRequiredProgressAt >= 3000) {
                requiredOutputProgressFailed = true;
                fence();
                throw Error('Required output progress expired');
            }
            if (state.error) throw Error('Renderer failed');
            await deps.sleep(1000, undefined, { signal }).catch(() => { aborted = true; });
        }
        // Early switch fencing is useful evidence, but it does not turn a short
        // or failed workload into a successful 120-second rehearsal.
        const fullDuration = deps.now() - beganAt >= 120000;
        const commandsPassed = [1, 2].every(sequence => evidence.commands.some(command => command.sequence === sequence && command.succeeded));
        exitCode = aborted ? 130 : fullDuration && published && readiness.result().sourceReadyObserved && commandsPassed && !timedOut && !rendererFailed && !recordingFailed && !switchUnavailable ? 0 : 1;
    } catch { exitCode = aborted ? 130 : 1; }
    finally {
        clearInterval(timer); clearTimeout(internalDeadline);
        // Synchronous sender fence always precedes awaited decoder cleanup.
        fence(); unsubscribe?.();
        for (const cleanup of [() => worker?.stop(), () => outputs?.stop(), () => renderer?.stop(), () => relay?.stop()]) {
            try { await bounded(cleanup, 4500); } catch { exitCode ||= 1; }
        }
        if (recording) { recording.end(); await bounded(() => recordingDone, 3000).catch(() => { exitCode ||= 1; }); }
    }
    try {
        let packetVerification;
        if (recordedBytes > 0) {
            try {
                packetVerification = await deps.verifyProgramPackets(join(directory, 'program.ts'), { signal });
                const video = packetVerification.streams.find(stream => stream.codec_name === 'h264');
                const audio = packetVerification.streams.find(stream => stream.codec_name === 'aac');
                if (!video || video.width !== 1280 || video.height !== 720 || video.r_frame_rate !== '30/1' || !audio || Number(audio.sample_rate) !== 48000 || packetVerification.maxGop > 1.05 || packetVerification.maxGap >= 0.2) exitCode ||= 1;
            } catch { exitCode ||= signal?.aborted ? 130 : 1; }
        } else exitCode ||= 1;
        const publishingAfterCleanup = outputs?.getState?.().publishing === true;
        if (publishingAfterCleanup) exitCode ||= 1;
        aborted ||= signal?.aborted === true;
        if (aborted) exitCode ||= 130;
        const switchDisabledFenceObserved = published && switchFalseObserved && fenced && !publishingAfterCleanup && stopReasons.control_failed === true;
        const result = numericDiagnostics({ exitCode, passed: exitCode === 0, seconds: 120, wallMs: deps.now() - beganAt, syntheticAuthority: true, realConvexAuthority: false, independentSourceHandoff: false, twitchAcceptance: false, deviceAcceptance: false, attestations: Object.fromEntries(RIGHTS.map(key => [key, compliance[key] === 'accepted'])), ...readiness.result(), published, requiredOutputProgressFailed, switchFalseObserved, switchUnavailable, switchDisabledFenceObserved, fenced, stopReasons, expiredAuthorities, publishingAfterCleanup, aborted, timedOut, rendererFailed, recordingFailed, recordedBytes, commands: evidence.commands, observations: evidence.observations, resources: metrics?.result(), metricsEvents, packetVerification });
        await writeFile(join(directory, 'rehearsal.json'), JSON.stringify(result), { mode: 0o600 });
        await writeFile(join(directory, 'samples.ndjson'), samples.map(sample => JSON.stringify(sample)).join('\n'), { mode: 0o600 });
        if (signal?.aborted && !result.aborted) {
            result.aborted = true; result.exitCode ||= 130; result.passed = false;
            await writeFile(join(directory, 'rehearsal.json'), JSON.stringify(result), { mode: 0o600 });
        }
        return { ...result, directory };
    } finally { signal?.removeEventListener('abort', abort); }
}
if (process.argv[1] && import.meta.url === pathToFileURL(resolve(process.argv[1])).href) {
    const abort = new AbortController(), shutdown = () => abort.abort();
    process.once('SIGTERM', shutdown); process.once('SIGINT', shutdown);
    try {
        if (process.argv.length !== 2) throw Error('Rehearsal accepts no command-line configuration');
        validateRehearsal(process.env);
        if (!/^[a-zA-Z0-9][a-zA-Z0-9_-]{0,95}$/.test(process.env.VRDEX_PROOF_RUN_ID ?? '') || process.env.VRDEX_RESTREAM_ARTIFACT_S3_URI !== ARTIFACT_ROOT) throw Error('Invalid private artifact configuration');
        proofStart(process.env.VRDEX_PROOF_RUN_ID, 'vrcdn-rehearsal');
        const result = await runRehearsal({ signal: abort.signal });
        const status = await finalizeProof({ directory: result.directory, exitCode: result.exitCode, env: process.env, signal: abort.signal });
        console.log(JSON.stringify(status)); process.exitCode = status.exitCode;
    } catch { console.error('VRCDN rehearsal failed'); process.exitCode = 1; }
    finally { process.removeListener('SIGTERM', shutdown); process.removeListener('SIGINT', shutdown); }
}
