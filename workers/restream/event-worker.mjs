import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { createSourceRelay } from './source-relay.mjs';
import { randomUUID } from 'node:crypto';
import { pathToFileURL } from 'node:url';
import { decideHandoff } from './handoff-policy.mjs';
import { createProgramRenderer } from './program-renderer.mjs';
/** Every operation is bounded; watchdog is independent of this promise chain. */
export async function bounded(operation, timeoutMs = 3000) {
    const controller = new AbortController();
    let timer;
    try {
        return await Promise.race([Promise.resolve().then(() => operation(controller.signal)), new Promise((_, reject) => {
                timer = setTimeout(() => { controller.abort(); reject(new Error('Worker operation timed out')); }, timeoutMs);
            })]);
    }
    finally {
        clearTimeout(timer);
    }
}
/** Output contract: start, bounded synchronous enqueue, getState({publishing}),
 * synchronous stopNow (publication fence), asynchronous stop (cleanup).
 * No default sender: Task6 supplies the required selected-output implementation.
 */
export function createEventWorker({ identity, control, renderer, outputs, createRenderer, createOutputs, resolveSource, checkEnabled, clock = () => performance.now(), maxSessionMs = 43200000, requestTimeoutMs = 3000, metric = () => { } }) {
    let stopped = false, started = false, busy = false, config, current, mode = 'automatic';
    let authorityUntil = -Infinity, runtimeUntil = Infinity, renewAt = Infinity, enabledUntil = -Infinity;
    let serverTime = 0, sampledAt = 0, pending, lastSequence = 0, unsubscribe;
    let lastOutput = 0, outputProgressAt = 0, silenceThresholdDb, outputConfiguration;
    const completed = new Map(), sourceURLs = new Map(), revisionBarriers = new Map();
    const request = (name, args = {}) => bounded(signal => control(name, { ...identity, ...args }, signal), requestTimeoutMs);
    function fence(reason) {
        if (stopped)
            return;
        stopped = true;
        unsubscribe?.();
        // This MUST precede all awaited cleanup, including renderer decoder shutdown.
        outputs?.stopNow();
        metric({ event: 'event_worker_stopped', reason });
        if (started && clock() < authorityUntil && reason !== 'operator-stop')
            void request('observeProgram', { state: 'error', outputMs: lastOutput, publishing: false }).catch(() => { });
        void Promise.resolve(renderer?.stop()).catch(() => { });
        void Promise.resolve(outputs?.stop()).catch(() => { });
    }
    function watchdog() {
        if (!started || stopped)
            return;
        const now = clock();
        if (now >= Math.min(authorityUntil, runtimeUntil, enabledUntil))
            fence('authority-expired');
    }
    function acceptLease(lease, sentAt) {
        if (!lease.granted || !Number.isFinite(lease.serverNow) || !Number.isFinite(lease.expiresAt))
            throw Error('Session authority denied');
        // Subtract the full round trip, conservatively anchoring at request start.
        authorityUntil = sentAt + Math.max(0, lease.expiresAt - lease.serverNow - 250);
        identity.epoch = lease.epoch;
        renewAt = sentAt + Math.min(lease.renewAfterMs, 10000);
        serverTime = lease.serverNow;
        sampledAt = sentAt;
    }
    const scheduleNow = () => serverTime + clock() - sampledAt;
    function observation(slot) {
        if (!slot)
            return undefined;
        const input = renderer.getInputs().find(input => input.source.slotKey === slot.slotKey);
        return input?.getObservation ? input.getObservation() : input;
    }
    async function reconcile(extra) {
        const slots = [current, extra].filter((s, i, all) => s?.available && all.findIndex(a => a?.slotKey === s.slotKey) === i);
        const sources = [];
        for (const slot of slots) {
            const source = config.sources.find(s => s.id === slot.sourceId);
            if (!source)
                continue;
            try {
                const url = await bounded(() => resolveSource(source), requestTimeoutMs);
                if (stopped)
                    return;
                sources.push({ slotKey: slot.slotKey, sourceId: slot.sourceId, url });
            }
            catch {
                slot.available = false;
            }
        }
        if (!stopped)
            await bounded(() => renderer.reconcileSources(sources), requestTimeoutMs);
    }
    function actual() {
        const state = renderer.getState();
        if (state.outputMs > lastOutput) {
            lastOutput = state.outputMs;
            outputProgressAt = clock();
        }
        return { ...state, publishing: outputs?.getState().publishing === true && state.running && state.outputMs > 0 && clock() - outputProgressAt <= 2000 };
    }
    async function report() {
        const state = actual();
        if (state.error || !state.running)
            throw Error('Renderer failed');
        if (!state.publishing)
            return;
        if (revisionBarriers.size)
            return;
        if (state.renderedSourceId && !(current?.sourceId === state.renderedSourceId && current.available) && !config.slots.some(s => s.sourceId === state.renderedSourceId && s.available))
            return;
        const result = await request('observeProgram', { state: state.renderedSourceId ? 'live' : 'hold', sourceId: state.renderedSourceId, outputId: config.outputId, outputMs: state.outputMs, publishing: true, mode });
        if (!result.accepted)
            throw Error('Observation rejected');
    }
    async function execute(command) {
        if (completed.has(command.sequence))
            return request('acknowledgeCommand', completed.get(command.sequence));
        if (command.sequence <= lastSequence)
            return;
        if (!pending) {
            pending = { command, beganAt: clock(), outcome: 'succeeded' };
            const type = command.commandType;
            if (type === 'stop_program') {
                outputs.stopNow();
                renderer.hold();
                pending.terminal = true;
            }
            else if (type === 'hold_current') {
                mode = 'manual';
            }
            else if (['switch_hold', 'show_hold_scene'].includes(type)) {
                const scene = type === 'show_hold_scene' ? config.scenes?.find(s => s.id === command.targetSceneId) : undefined;
                if (type === 'show_hold_scene' && (!scene || scene.type !== 'hold_slate' || scene.sourceId))
                    pending.outcome = 'failed';
                else {
                    mode = 'hold';
                    renderer.hold();
                }
            }
            else if (type === 'set_automatic_mode') {
                mode = 'automatic';
                if (current?.slotKey.startsWith('manual-'))
                    current = undefined;
            }
            else if (['switch_source', 'switch_next', 'next_slot', 'switch_previous', 'previous_slot'].includes(type)) {
                const index = config.slots.findIndex(s => s.slotKey === current?.slotKey);
                const manualSource = config.sources.find(s => s.id === command.targetSourceId);
                const target = type === 'switch_source' ? config.slots.find(s => s.sourceId === command.targetSourceId) ?? (manualSource ? { slotKey: `manual-${manualSource.id}`, sourceId: manualSource.id, startAt: scheduleNow(), available: true } : undefined) : config.slots[index + (['switch_previous', 'previous_slot'].includes(type) ? -1 : 1)];
                if (!target?.available)
                    pending.outcome = 'failed';
                else {
                    mode = 'manual';
                    current = { ...target };
                    pending.target = current;
                    await reconcile();
                }
            }
            else if (type !== 'start_program')
                pending.outcome = 'failed';
        }
        if (stopped)
            return;
        const state = actual();
        if (pending.target && !revisionBarriers.has(pending.target.slotKey) && !pending.selected && renderer.selectSource(pending.target.slotKey))
            pending.selected = true;
        const rendered = pending.target ? !revisionBarriers.has(pending.target.slotKey) && state.renderedSlotKey === pending.target.slotKey && state.renderedSourceId === pending.target.sourceId : mode !== 'hold' || state.renderedSourceId === undefined;
        if (clock() - pending.beganAt > 15000)
            pending.outcome = 'failed';
        if (!pending.terminal && pending.outcome === 'succeeded' && (!state.publishing || !rendered))
            return;
        const ack = { commandId: command._id, sequence: command.sequence, outcome: pending.outcome,
            ...(pending.outcome === 'succeeded' ? { observedState: pending.terminal ? 'ended' : state.renderedSourceId ? 'live' : 'hold', observedSourceId: pending.terminal ? null : state.renderedSourceId ?? null, observedOutputId: config.outputId, observedSceneId: null } : {}) };
        const result = await request('acknowledgeCommand', ack);
        if (!result.accepted)
            throw Error('Command acknowledgement rejected');
        completed.set(command.sequence, ack);
        if (completed.size > 64)
            completed.delete(completed.keys().next().value);
        lastSequence = command.sequence;
        metric({ event: 'event_worker_command', sequence: command.sequence, latencyMs: clock() - pending.beganAt, outcome: pending.outcome });
        const terminal = pending.terminal;
        pending = undefined;
        if (terminal)
            fence('operator-stop');
    }
    return {
        watchdog,
        getState: () => ({ stopped, current, mode, authorityUntil }),
        async start() {
            try {
                if (!outputs && !createOutputs)
                    throw Error('Output sender is unavailable');
                if (!await bounded(checkEnabled, requestTimeoutMs))
                    throw Error('Worker disabled');
                enabledUntil = clock() + 10000;
                const sent = clock();
                const lease = await request('acquireSession');
                acceptLease(lease, sent);
                config = lease.configuration;
                outputConfiguration = JSON.stringify({ outputId: config.outputId, outputs: config.outputs });
                for (const source of config.sources)
                    sourceURLs.set(source.id, source.publicUrl);
                mode = config.mode;
                current = config.slots.find(s => s.sourceId === config.currentSourceId);
                if (!current && mode === 'manual' && config.sources.some(s => s.id === config.currentSourceId))
                    current = { slotKey: `manual-${config.currentSourceId}`, sourceId: config.currentSourceId, startAt: lease.serverNow, available: true };
                started = true;
                runtimeUntil = Math.min(sent + maxSessionMs, sent + config.sessionDeadline - lease.serverNow);
                if (!config.outputs.some(output => output.id === config.outputId))
                    throw Error('Selected output unavailable');
                silenceThresholdDb = config.policy.silence?.thresholdDb;
                renderer ??= createRenderer({ silenceThresholdDb });
                outputs ??= await bounded(() => createOutputs({ configuration: config, clock }), requestTimeoutMs);
                if (stopped) {
                    outputs.stopNow();
                    throw Error('Authority expired');
                }
                await bounded(() => outputs.start(), requestTimeoutMs);
                watchdog();
                if (stopped)
                    throw Error('Authority expired');
                unsubscribe = renderer.subscribe(chunk => {
                    watchdog();
                    if (!stopped)
                        outputs.enqueue(chunk);
                });
                await bounded(() => renderer.start(), requestTimeoutMs);
            }
            catch (error) {
                fence('startup-failed');
                throw error;
            }
        },
        async tick() {
            watchdog();
            if (stopped || busy || !started)
                return;
            busy = true;
            try {
                if (clock() >= enabledUntil - 1000) {
                    if (!await bounded(checkEnabled, requestTimeoutMs))
                        throw Error('Worker disabled');
                    enabledUntil = clock() + 10000;
                }
                if (clock() >= renewAt) {
                    const sent = clock();
                    acceptLease(await request('renewSession'), sent);
                }
                const sent = clock();
                const fresh = await request('refreshConfiguration');
                if (!fresh.granted)
                    throw Error('Configuration authority denied');
                config = fresh.configuration;
                if (JSON.stringify({ outputId: config.outputId, outputs: config.outputs }) !== outputConfiguration)
                    throw Error('Destination configuration changed');
                for (const source of config.sources) {
                    if (sourceURLs.has(source.id) && sourceURLs.get(source.id) !== source.publicUrl && current?.sourceId === source.id) {
                        revisionBarriers.set(current.slotKey, renderer.getState().outputMs);
                        renderer.hold();
                        if (pending)
                            pending.selected = false;
                        await reconcile();
                    }
                    sourceURLs.set(source.id, source.publicUrl);
                }
                const encodedState = renderer.getState();
                for (const [slotKey, afterMs] of revisionBarriers) {
                    if (encodedState.renderedSlotKey === undefined && encodedState.outputMs > afterMs)
                        revisionBarriers.delete(slotKey);
                }
                serverTime = fresh.serverNow;
                sampledAt = sent;
                if (current)
                    current = { ...current, ...config.slots.find(s => s.slotKey === current.slotKey), available: current.slotKey.startsWith('manual-') ? config.sources.some(s => s.id === current.sourceId) : config.slots.some(s => s.slotKey === current.slotKey && s.sourceId === current.sourceId && s.available) };
                watchdog();
                if (stopped)
                    return;
                if (current && !current.available) {
                    renderer.hold();
                    await reconcile();
                    if (pending?.target)
                        pending.outcome = 'failed';
                }
                const claims = await request('claimCommands');
                if (!claims.granted)
                    throw Error('Command authority denied');
                for (const command of [...claims.commands].sort((a, b) => a.sequence - b.sequence)) {
                    await execute(command);
                    if (pending || stopped)
                        break;
                }
                if (stopped)
                    return;
                if (config.stopped) {
                    fence('event-stopped');
                    return;
                }
                if (!pending) {
                    const ordered = config.slots;
                    const next = current ? ordered.slice(ordered.findIndex(s => s.slotKey === current.slotKey) + 1).find(s => s.available) : [...ordered].reverse().find(s => s.available && s.startAt <= scheduleNow()) ?? ordered.find(s => s.available);
                    const evidence = observation(current), nextReadiness = observation(next);
                    const decision = decideHandoff({ scheduleNow: scheduleNow(), observationNow: clock(), sessionDeadline: config.sessionDeadline, mode, current, next, evidence, nextReadiness, policy: { ...config.policy, ...(config.policy.silence?.thresholdDb !== silenceThresholdDb ? { silence: undefined } : {}) } });
                    if (decision.kind === 'stop') {
                        fence('session-deadline');
                        return;
                    }
                    if (decision.kind === 'hold')
                        renderer.hold();
                    const prepare = decision.kind === 'prepare' || decision.kind === 'switch' || decision.prepare || mode === 'automatic' && next && scheduleNow() >= Math.max(next.startAt, current?.endAt ?? next.startAt) - 120000;
                    await reconcile(prepare ? next : undefined);
                    if (decision.kind === 'switch' && renderer.selectSource(next.slotKey))
                        current = { ...next };
                    // Recover the current decoder after transient failure without moving slots.
                    if (decision.kind === 'stay' && !revisionBarriers.has(current?.slotKey) && current?.available && mode !== 'hold' && renderer.getState().renderedSlotKey !== current.slotKey)
                        renderer.selectSource(current.slotKey);
                }
                watchdog();
                if (!stopped)
                    await report();
                metric({ event: 'event_worker_heartbeat', outputMs: lastOutput, remainingMs: Math.max(0, runtimeUntil - clock()) });
            }
            catch {
                fence('control-failed');
            }
            finally {
                busy = false;
            }
        },
        async stop() { fence('shutdown'); await bounded(() => Promise.all([renderer.stop(), outputs?.stop()]), 4000).catch(() => { }); },
    };
}
export function createHttpControl({ url, token, fetcher = fetch }) {
    const base = new URL(url);
    if (base.protocol !== 'https:' && !(base.protocol === 'http:' && ['localhost', '127.0.0.1'].includes(base.hostname)))
        throw Error('Invalid control endpoint');
    return async (name, args, signal) => {
        const response = await fetcher(new URL('/api/mutation', base), { method: 'POST', redirect: 'error', signal, headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ path: `eventMediaWorker:${name}`, args: { ...args, bridgeToken: token }, format: 'json' }) });
        if (!response.ok)
            throw Error('Control request failed');
        let text = '', bytes = 0;
        const reader = response.body.getReader();
        const decoder = new TextDecoder();
        while (true) {
            const { value, done } = await reader.read();
            if (done)
                break;
            bytes += value.length;
            if (bytes > 262144) {
                await reader.cancel();
                throw Error('Control response exceeds bound');
            }
            text += decoder.decode(value, { stream: true });
        }
        text += decoder.decode();
        const body = JSON.parse(text);
        if (body.status !== 'success')
            throw Error('Control mutation failed');
        return body.value;
    };
}
export async function checkHostedEnabled({ parameter, region, run = promisify(execFile) }) {
    if (!parameter || !region)
        return false;
    const { stdout } = await run('aws', ['ssm', 'get-parameter', '--name', parameter, '--region', region, '--output', 'json', '--cli-connect-timeout', '2', '--cli-read-timeout', '2'], { timeout: 3000, maxBuffer: 16384 });
    return JSON.parse(stdout).Parameter?.Value === 'true';
}
/** Task6 supplies createOutputs; defaults deliberately refuse publication. */
export async function runEventWorker({ createOutputs, env = process.env } = {}) {
    if (!createOutputs)
        throw Error('Output sender is unavailable');
    const maxSessionMs = Number(env.VRDEX_RESTREAM_MAX_SESSION_SECONDS ?? 43200) * 1000;
    if (!Number.isSafeInteger(maxSessionMs) || maxSessionMs < 1000 || maxSessionMs > 86400000)
        throw Error('Invalid runtime bound');
    const relay = await createSourceRelay({ operatorEndpoints: JSON.parse(env.VRDEX_EVENT_MEDIA_SOURCE_ENDPOINTS_JSON ?? '[]') });
    let worker;
    worker = createEventWorker({ identity: { eventId: env.VRDEX_EVENT_MEDIA_EVENT_ID, sessionId: env.VRDEX_EVENT_MEDIA_SESSION_ID, workerId: randomUUID(), epoch: Number(env.VRDEX_EVENT_MEDIA_EPOCH ?? 0) }, control: createHttpControl({ url: env.CONVEX_URL, token: env.VRDEX_EVENT_MEDIA_BRIDGE_TOKEN }), createRenderer: options => createProgramRenderer({ ...options, onError: () => void worker?.stop() }), createOutputs: options => createOutputs({ ...options, env }), maxSessionMs, checkEnabled: () => checkHostedEnabled({ parameter: env.VRDEX_RESTREAM_KILL_SWITCH_SSM_PARAMETER, region: env.AWS_REGION }), resolveSource: source => relay.resolveSource(source), metric: value => console.log(JSON.stringify(value)) });
    let timer, poll;
    const close = () => { clearInterval(timer); clearInterval(poll); relay.stop(); };
    timer = setInterval(() => {
        worker.watchdog();
        if (worker.getState().stopped)
            close();
    }, 50);
    poll = setInterval(() => void worker.tick(), 1000);
    const shutdown = () => { close(); void worker.stop(); };
    for (const signal of ['SIGTERM', 'SIGINT'])
        process.once(signal, shutdown);
    try {
        await worker.start();
    }
    catch (error) {
        close();
        throw error;
    }
    return { worker, stop: async () => { close(); await worker.stop(); } };
}
if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href)
    runEventWorker().catch(() => { console.error(JSON.stringify({ event: 'event_worker_failed' })); process.exitCode = 1; });
