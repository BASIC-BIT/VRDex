import assert from 'node:assert/strict';
import { test } from 'node:test';
import { spawnSync } from 'node:child_process';
import { EventEmitter } from 'node:events';
import { PassThrough } from 'node:stream';
const load = () => import('../../workers/restream/output-sender.mjs');
function processFactory(blocked = false) {
    const children: any[] = [];
    const spawn = () => {
        const child: any = new EventEmitter();
        child.stdin = new PassThrough({ highWaterMark: 32 });
        if (!blocked) {
            child.stdin.resume();
            child.stdin.write = () => true;
        }
        child.stderr = new PassThrough();
        child.stdio = [child.stdin, null, child.stderr, new PassThrough()];
        child.kill = () => { child.killed = true; child.emit('close', 1); };
        children.push(child);
        return child;
    };
    return { spawn, children };
}
const compliance = { sourceConsent: 'accepted', destinationAuthority: 'accepted', providerRules: 'accepted', rightsClearedMedia: 'accepted' };
const configuration = { outputId: 'main', outputs: [{ id: 'main', type: 'vrcdn', credential: { secretRef: 'main-ref' }, compliance }, { id: 'optional', type: 'external_rtmp', simulcastEnabled: true, twitchSetup: { channel: 'example', profile: 'twitch-conservative-720p30' }, credential: { secretRef: 'twitch-ref' }, compliance }] };
const secrets = (ref: string) => JSON.stringify({ rtmpUrl: ref === 'main-ref' ? 'rtmp://uk.ingest.vrcdn.live/live' : 'rtmp://live.twitch.tv/app', streamKey: 'synthetic-private-key' });
test('isolated blocked Twitch has bounded memory while primary progresses; stop is terminal', async () => {
    const mod = await load();
    assert.equal(typeof mod.createEventOutputs, 'function');
    let now = 0;
    const primary = processFactory(), optional = processFactory(true);
    const outputs = mod.createEventOutputs({ configuration, clock: () => now, resolveCredential: secrets, spawnForDestination: (d: string) => d === 'vrcdn' ? primary.spawn : optional.spawn });
    assert.equal(primary.children.length, 0);
    await outputs.start();
    for (let i = 0; i < 100; i++) {
        now += 30;
        outputs.enqueue(Buffer.alloc(20000));
        primary.children[0].stdio[3].write(`out_time_us=${(i + 1) * 30000}\n`);
    }
    const state = outputs.getState();
    assert.equal(state.publishing, true);
    assert.ok(state.destinations.every((d: any) => d.queueBytes <= mod.OUTPUT_QUEUE_BYTES));
    assert.ok(optional.children[0].killed);
    assert.equal(primary.children[0].killed, undefined);
    outputs.stopNow();
    outputs.stopNow();
    await outputs.start();
    outputs.enqueue(Buffer.alloc(20000));
    assert.equal(outputs.getState().publishing, false);
    assert.equal(primary.children.length, 1);
    await outputs.stop();
});
test('disconnect and hostile FFmpeg error never leak credentials and cannot fail primary', async () => {
    const mod = await load();
    const p = processFactory(), t = processFactory();
    const outputs = mod.createEventOutputs({ configuration, resolveCredential: secrets, spawnForDestination: (d: string) => d === 'vrcdn' ? p.spawn : t.spawn });
    await outputs.start();
    p.children[0].stdio[3].write('out_time_us=1000000\n');
    t.children[0].stderr.write('rtmp://live.twitch.tv/app/synthetic-private-key failed');
    t.children[0].emit('error', Error('synthetic-private-key'));
    assert.equal(outputs.getState().publishing, true);
    assert.ok(!JSON.stringify(outputs.getState()).includes('synthetic-private-key'));
    await outputs.stop();
});
test('missing setup and invalid optional credentials fail independently; required credentials fail closed', async () => {
    const mod = await load();
    const p = processFactory();
    assert.throws(() => mod.createEventOutputs({ configuration: { outputId: 'missing', outputs: [] } }), /Selected output/);
    const outputs = mod.createEventOutputs({ configuration, resolveCredential: (ref: string) => ref === 'main-ref' ? secrets(ref) : '{secret-invalid', spawnForDestination: () => p.spawn });
    await outputs.start();
    p.children[0].stdio[3].write('out_time_us=1000000\n');
    assert.equal(outputs.getState().publishing, true);
    assert.equal(outputs.getState().destinations[1].status, 'invalid_setup');
    await outputs.stop();
    const invalid = mod.createEventOutputs({ configuration, resolveCredential: () => '{invalid' });
    await invalid.start();
    assert.equal(invalid.getState().publishing, false);
    await invalid.stop();
});
test('credential boundary rejects wrong providers, embedded private endpoints and preserves ref binding', async () => {
    const mod = await load();
    for (const value of [{ rtmpUrl: 'rtmp://127.0.0.1/live', streamKey: 'key' }, { rtmpUrl: 'rtmp://live.twitch.tv.evil.test/app', streamKey: 'key' }, { rtmpUrl: 'rtmp://live.twitch.tv/app', streamKey: 'a\nb' }])
        assert.throws(() => mod.parseOutputCredential('twitch', JSON.stringify(value)));
    assert.ok(mod.parseOutputCredential('twitch', secrets('twitch-ref')));
});
for (const form of ['split', 'combined']) {
    test(`VRCDN credential accepts canonical and regional hosts in ${form} form`, async () => {
        const { parseOutputCredential } = await load();
        for (const host of ['ingest.vrcdn.live', 'uk.ingest.vrcdn.live']) {
            for (const protocol of ['rtmp', 'rtmps']) {
                for (const port of ['', ':1935', ':443']) {
                    const url = `${protocol}://${host}${port}/live`;
                    const credential = form === 'split'
                        ? { rtmpUrl: `${url}/`, streamKey: 'synthetic-private-key' }
                        : { ingestUrl: `${url}/synthetic-private-key` };
                    assert.deepEqual(parseOutputCredential('vrcdn', JSON.stringify(credential)), { url, key: 'synthetic-private-key' });
                }
            }
        }
    });
    test(`VRCDN credential rejects unapproved destinations and URL bypasses in ${form} form`, async () => {
        const { parseOutputCredential } = await load();
        for (const rtmpUrl of [
            'rtmp://ingest.vrcdn.live.evil.test/live',
            'rtmp://uk.ingest.vrcdn.live.evil.test/live',
            'rtmp://evil.ingest.vrcdn.live.evil.test/live',
            'rtmp://nested.uk.ingest.vrcdn.live/live',
            'rtmp://fakeingest.vrcdn.live/live',
            'rtmp://ingest.vrcdn.live./live',
            'rtmp://vrcdn.live/live',
            'rtmp://stream.vrcdn.live/live',
            'rtmp://live.twitch.tv/app',
            'rtmp://127.0.0.1/live',
            'https://ingest.vrcdn.live/live',
            'rtmp://ingest.vrcdn.live:1936/live',
            'rtmp://ingest.vrcdn.live/app',
            'rtmp://ingest.vrcdn.live/live/extra',
            'rtmp://user@ingest.vrcdn.live/live',
            'rtmp://user:password@ingest.vrcdn.live/live',
            'rtmp://ingest.vrcdn.live/live?token=private-canary',
            'rtmp://ingest.vrcdn.live/live#private-canary',
        ]) {
            const combined = new URL(rtmpUrl);
            combined.pathname += '/synthetic-private-key';
            const credential = form === 'split'
                ? { rtmpUrl, streamKey: 'synthetic-private-key' }
                : { ingestUrl: combined.href };
            assert.throws(() => parseOutputCredential('vrcdn', JSON.stringify(credential)), { message: 'Invalid output credential' }, rtmpUrl);
        }
        for (const key of ['', 'a/b', 'a%20b', 'a b', form === 'split' ? 'a\nb' : 'a%0Ab', 'a'.repeat(513)]) {
            const credential = form === 'split'
                ? { rtmpUrl: 'rtmp://ingest.vrcdn.live/live', streamKey: key }
                : { ingestUrl: `rtmp://ingest.vrcdn.live/live/${key}` };
            assert.throws(() => parseOutputCredential('vrcdn', JSON.stringify(credential)), { message: 'Invalid output credential' }, JSON.stringify(key));
        }
        for (const destination of ['twitch', 'unknown']) {
            const credential = form === 'split'
                ? { rtmpUrl: 'rtmp://ingest.vrcdn.live/live', streamKey: 'key' }
                : { ingestUrl: 'rtmp://ingest.vrcdn.live/live/key' };
            assert.throws(() => parseOutputCredential(destination, JSON.stringify(credential)), { message: 'Invalid output credential' });
        }
    });
}
test('disabled optional destinations are never started and bridge binds each enabled reference separately', async () => {
    const mod = await load();
    const p = processFactory();
    const outputs = mod.createEventOutputs({ configuration: { ...configuration, outputs: configuration.outputs.map(o => ({ ...o, simulcastEnabled: false })) }, resolveCredential: secrets, spawnForDestination: () => p.spawn });
    await outputs.start();
    assert.equal(p.children.length, 1);
    await outputs.stop();
    const { taskDefinitionFor } = await import('../../scripts/event-media-ecs-bridge.mjs');
    const command = { commandId: 'c', eventId: 'e', program: { programId: 'p' }, session: { sessionId: 's' }, output: { outputId: 'main', credentialRef: 'ref-main', playbackLinks: [] }, optionalOutputs: [{ outputId: 't', credentialRef: 'ref-twitch' }] };
    const definition = taskDefinitionFor(command, { baseEnvironment: {}, secretRefMap: { 'ref-main': 'arn:main', 'ref-twitch': 'arn:twitch' }, outputSecretEnvName: 'VRDEX_EVENT_MEDIA_OUTPUT_INGEST_SECRET_JSON', workerTokenSecretArn: 'arn:token' });
    const container = definition.containerDefinitions[0];
    assert.ok(!container.secrets.some((s: any) => s.valueFrom === 'arn:twitch'));
    const bindings = JSON.parse(container.environment.find((e: any) => e.name === 'VRDEX_EVENT_MEDIA_OPTIONAL_SECRET_ARNS_JSON').value);
    assert.equal(bindings['ref-twitch'], 'arn:twitch');
    assert.ok(container.secrets.some((s: any) => s.valueFrom === 'arn:main'));
});
test('VRCDN hold program reserves its declared CBR envelope instead of collapsing on still frames', async (t) => {
    const prerequisite = spawnSync('ffmpeg', ['-hide_banner', '-encoders'], { encoding: 'utf8', timeout: 5000 });
    assert.equal(prerequisite.status, 0, `FFmpeg is required for the real CBR test: ${prerequisite.error?.message ?? prerequisite.stderr}. Install ffmpeg with libx264 and AAC.`);
    assert.match(prerequisite.stdout, /libx264/);
    assert.match(prerequisite.stdout, /\baac\b/);
    const { createProgramRenderer } = await import('../../workers/restream/program-renderer.mjs');
    const renderer = createProgramRenderer();
    t.after(() => renderer.stop());
    let bytes = 0;
    renderer.subscribe((chunk: Buffer) => bytes += chunk.length);
    await renderer.start();
    const deadline = performance.now() + 15000;
    while (renderer.getState().outputMs < 3500) {
        assert.equal(renderer.getState().error, undefined, 'Real encoder must remain healthy');
        assert.ok(performance.now() < deadline, `Encoder did not produce 3.5 seconds within 15 seconds: ${JSON.stringify(renderer.getState())}`);
        await new Promise(resolve => setTimeout(resolve, 50));
    }
    const outputSeconds = renderer.getState().outputMs / 1000;
    const bitrateKbps = bytes * 8 / outputSeconds / 1000;
    await renderer.stop();
    assert.ok(bitrateKbps > 1500 && bitrateKbps < 2600, `Expected the declared 1800kbps CBR video envelope plus TS/audio overhead; got ${bitrateKbps}kbps over ${outputSeconds}s (${bytes} bytes)`);
});
test('unsupported VRCDN profile settings are a setup fault rather than silently ignored', async (t) => {
    const mod = await load();
    const p = processFactory();
    const outputs = mod.createEventOutputs({ configuration: { ...configuration, outputs: configuration.outputs.map(o => o.id === 'main' ? { ...o, vrcdnSetup: { targetVideoBitrateKbps: 6000 } } : o) }, resolveCredential: secrets, spawnForDestination: () => p.spawn });
    t.after(() => outputs.stop());
    await outputs.start();
    assert.equal(outputs.getState().destinations[0].status, 'invalid_setup');
    await outputs.stop();
});
test('legacy selected-output secret environment alias also reaches the actual event CLI', async () => {
    const { taskDefinitionFor } = await import('../../scripts/event-media-ecs-bridge.mjs');
    const command = { commandId: 'c', eventId: 'e', program: { programId: 'p' }, session: { sessionId: 's' }, output: { outputId: 'main', credentialRef: 'ref-main', playbackLinks: [] } };
    const definition = taskDefinitionFor(command, { baseEnvironment: {}, secretRefMap: { 'ref-main': 'arn:main' }, outputSecretEnvName: 'LEGACY_OUTPUT_SECRET', workerTokenSecretArn: 'arn:token' });
    const secrets = definition.containerDefinitions[0].secrets;
    assert.ok(secrets.some((s: any) => s.name === 'LEGACY_OUTPUT_SECRET' && s.valueFrom === 'arn:main'));
    assert.ok(secrets.some((s: any) => s.name === 'VRDEX_EVENT_MEDIA_OUTPUT_INGEST_SECRET_JSON' && s.valueFrom === 'arn:main'));
});
const optionalArn = 'arn:aws:secretsmanager:us-east-1:123456789012:secret:twitch-ABC123';
const secretEnv = { AWS_REGION: 'us-east-1', VRDEX_EVENT_MEDIA_OUTPUT_INGEST_SECRET_JSON: secrets('main-ref'), VRDEX_EVENT_MEDIA_OPTIONAL_SECRET_ARNS_JSON: JSON.stringify({ 'twitch-ref': optionalArn }) };
test('denied and not-found optional secret retrieval never prevent primary publication', async (t) => {
    const mod = await load();
    for (const fault of ['AccessDeniedException', 'ResourceNotFoundException']) {
        const p = processFactory(), optional = processFactory();
        let reads = 0;
        const outputs = mod.createEventOutputs({ configuration, env: secretEnv, readSecret: async () => { reads++; throw Error(`${fault} synthetic-private-key`); }, spawnForDestination: (d: string) => d === 'vrcdn' ? p.spawn : optional.spawn });
        t.after(() => outputs.stop());
        await outputs.start();
        await new Promise(resolve => setImmediate(resolve));
        p.children[0].stdio[3].write('out_time_us=1000000\n');
        assert.equal(reads, 1);
        assert.equal(outputs.getState().publishing, true);
        assert.equal(outputs.getState().destinations[1].status, 'invalid_setup');
        assert.equal(optional.children.length, 0);
        assert.ok(!JSON.stringify(outputs.getState()).includes('synthetic-private-key'));
        await outputs.stop();
    }
});
test('hung optional retrieval is bounded and aborted while primary progresses', async (t) => {
    const mod = await load();
    const p = processFactory(), optional = processFactory();
    let signal: AbortSignal | undefined;
    const outputs = mod.createEventOutputs({ configuration, env: secretEnv, credentialTimeoutMs: 25, readSecret: ({ signal: s }: any) => { signal = s; return new Promise(() => { }); }, spawnForDestination: (d: string) => d === 'vrcdn' ? p.spawn : optional.spawn });
    t.after(() => outputs.stop());
    await outputs.start();
    p.children[0].stdio[3].write('out_time_us=1000000\n');
    assert.equal(outputs.getState().publishing, true);
    assert.equal(outputs.getState().destinations[1].status, 'connecting');
    await new Promise(resolve => setTimeout(resolve, 50));
    assert.equal(outputs.getState().destinations[1].status, 'invalid_setup');
    assert.equal(signal?.aborted, true);
    assert.equal(optional.children.length, 0);
    assert.equal(outputs.getState().publishing, true);
});
test('stopNow aborts pending secret resolution and late completion cannot spawn', async (t) => {
    const mod = await load();
    const p = processFactory();
    let finish: any, signal: AbortSignal | undefined;
    const outputs = mod.createEventOutputs({ configuration, env: secretEnv, readSecret: ({ signal: s }: any) => { signal = s; return new Promise(resolve => { finish = resolve; }); }, spawnForDestination: () => p.spawn });
    t.after(() => outputs.stop());
    await outputs.start();
    outputs.stopNow();
    assert.equal(signal?.aborted, true);
    finish(secrets('twitch-ref'));
    await new Promise(resolve => setImmediate(resolve));
    assert.equal(p.children.length, 1);
    assert.equal(outputs.getState().destinations[1].status, 'stopped');
    await outputs.start();
    assert.equal(p.children.length, 1);
});
test('AWS optional secret boundary scopes the request and suppresses errors', async () => {
    const { resolveOptionalOutputSecret } = await load();
    let call: any;
    const value = await resolveOptionalOutputSecret({ arn: optionalArn, region: 'us-east-1', run: async (...args: any[]) => { call = args; return { stdout: JSON.stringify({ SecretString: secrets('twitch-ref') }) }; } });
    assert.equal(value, secrets('twitch-ref'));
    assert.deepEqual(call[1].slice(0, 4), ['secretsmanager', 'get-secret-value', '--secret-id', optionalArn]);
    assert.ok(call[2].maxBuffer <= 16384);
    assert.ok(call[2].timeout <= 2500);
    await assert.rejects(() => resolveOptionalOutputSecret({ arn: optionalArn, region: 'us-east-1', run: async () => { throw Error('synthetic-private-key'); } }), /^Error: Optional credential unavailable$/);
    await assert.rejects(() => resolveOptionalOutputSecret({ arn: '*', region: 'us-east-1' }), /Optional credential unavailable/);
});
