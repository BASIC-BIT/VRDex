import assert from 'node:assert/strict';
import { test } from 'node:test';
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
    assert.ok(container.secrets.some((s: any) => s.valueFrom === 'arn:twitch'));
    const bindings = JSON.parse(container.environment.find((e: any) => e.name === 'VRDEX_EVENT_MEDIA_OUTPUT_SECRET_BINDINGS_JSON').value);
    assert.equal(container.secrets.find((s: any) => s.name === bindings['ref-twitch']).valueFrom, 'arn:twitch');
    assert.ok(!JSON.stringify(container.environment).includes('arn:twitch'));
});
test('VRCDN hold program reserves its declared CBR envelope instead of collapsing on still frames', async (t) => {
    const { createProgramRenderer } = await import('../../workers/restream/program-renderer.mjs');
    const renderer = createProgramRenderer();
    t.after(() => renderer.stop());
    let bytes = 0;
    renderer.subscribe((chunk: Buffer) => bytes += chunk.length);
    await renderer.start();
    await new Promise(resolve => setTimeout(resolve, 3000));
    await renderer.stop();
    assert.ok(bytes > 500000, `Expected 1800kbps CBR filler during hold; got ${bytes} bytes`);
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
