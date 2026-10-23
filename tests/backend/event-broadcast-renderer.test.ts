import assert from 'node:assert/strict';
import { test } from 'node:test';
import { createInputSupervisor, LatestMediaBuffer, reconnectDelay } from '../../workers/restream/input-supervisor.mjs';
import { createProgramRenderer, QUALITY_PROFILES } from '../../workers/restream/program-renderer.mjs';
test('decoded buffers keep the latest frame and cap audio at 250ms', () => {
    const buffer = new LatestMediaBuffer(6, 16);
    buffer.video(Buffer.from([1, 2]));
    buffer.video(Buffer.from([3, 4, 5, 6, 7, 8, 9, 10, 11, 12]));
    assert.deepEqual([...buffer.frame], [7, 8, 9, 10, 11, 12]);
    buffer.audio(Buffer.alloc(40, 3));
    assert.equal(buffer.audioBytes, 16);
    assert.equal(buffer.takeAudio(8).length, 8);
    assert.equal(buffer.audioBytes, 8);
    buffer.reset();
    assert.equal(buffer.frame, undefined);
    assert.equal(buffer.audioBytes, 0);
});
test('reconnect backs off to ten seconds', () => assert.deepEqual(Array.from({ length: 8 }, (_, i) => reconnectDelay(i)), [1000, 2000, 4000, 8000, 10000, 10000, 10000, 10000]));
test('unstarted input never claims decoded readiness and binds its identity', () => {
    const input = createInputSupervisor({ source: { slotKey: 'appearance-2', sourceId: 'dj-1', url: 'udp://127.0.0.1:19999' }, clock: () => 50 });
    assert.deepEqual(input.getObservation(), { slotKey: 'appearance-2', sourceId: 'dj-1', observedAt: 50, ready: false, progressing: false, analysisActive: false, failureSince: 50 });
    input.stop();
});
test('renderer bounds active decoders and releases obsolete slots', async () => {
    const renderer = createProgramRenderer({ quality: '720p30' });
    // Reconcile while stopped allocates identities, not connections.
    await renderer.reconcileSources([{ slotKey: 'a', sourceId: 'a', url: 'udp://127.0.0.1:19997' }, { slotKey: 'b', sourceId: 'b', url: 'udp://127.0.0.1:19998' }]);
    assert.equal(renderer.getInputs().length, 2);
    await assert.rejects(() => renderer.reconcileSources(['a', 'b', 'c'].map(slotKey => ({ slotKey, sourceId: slotKey, url: 'udp://127.0.0.1:19999' }))), /two/);
    await renderer.reconcileSources([{ slotKey: 'b', sourceId: 'new-b', url: 'udp://127.0.0.1:19998' }]);
    assert.deepEqual(renderer.getInputs().map(i => i.source.sourceId), ['new-b']);
    assert.equal(renderer.selectSource('b'), false);
    await renderer.stop();
});
test('profiles preserve the existing worker encoding contracts', () => {
    assert.deepEqual(QUALITY_PROFILES['720p30'], { width: 1280, height: 720, frameRate: 30, videoBitrateKbps: 1800 });
    assert.equal(QUALITY_PROFILES['1080p60'].frameRate, 60);
    assert.throws(() => createProgramRenderer({ quality: 'bogus' }), /quality/);
});
test('decoded readiness expires, failure persists, and recovery resets silence evidence', async (t) => {
    const { EventEmitter } = await import('node:events');
    const { PassThrough } = await import('node:stream');
    let now = 0;
    const process = new EventEmitter() as any;
    process.stdio = [null, null, new PassThrough(), new PassThrough(), new PassThrough()];
    process.kill = () => { queueMicrotask(() => process.emit('close', null)); return true; };
    const input = createInputSupervisor({ source: { slotKey: 's', sourceId: 'id', url: 'test' }, quality: { width: 2, height: 2, frameRate: 30 }, clock: () => now, silenceThresholdDb: -50, spawnProcess: () => process });
    t.after(() => input.stop());
    input.start();
    const decode = (pts: number) => { process.stdio[2].write(`showinfo pts_time:${pts}\n`); process.stdio[3].write(Buffer.alloc(6)); process.stdio[4].write(Buffer.alloc(6400)); };
    decode(0);
    now = 100;
    decode(0.1);
    assert.equal(input.getObservation().ready, true);
    assert.equal(input.getObservation().silenceSince, 100);
    now = 1200;
    assert.equal(input.getObservation().ready, false);
    assert.equal(input.getObservation().failureSince, 1200);
    now = 2300;
    assert.equal(input.getObservation().failureSince, 1200);
    decode(0.1);
    assert.equal(input.getObservation().ready, false, 'repeated media timestamp cannot count as progress');
    now = 2400;
    decode(0.2);
    assert.equal(input.getObservation().ready, true);
    assert.equal(input.getObservation().failureSince, undefined);
    assert.equal(input.getObservation().silenceSince, 2400);
    await input.stop();
    assert.equal(input.getObservation().ready, false);
});
test('split PCM samples retain stereo alignment when the bounded tail overflows', () => {
    const buffer = new LatestMediaBuffer(6, 8);
    buffer.audio(Buffer.from([1, 2, 3]));
    assert.equal(buffer.audioBytes, 0);
    buffer.audio(Buffer.from([4, 5, 6, 7, 8, 9, 10, 11, 12]));
    assert.deepEqual([...buffer.takeAudio(8)], [5, 6, 7, 8, 9, 10, 11, 12]);
});
test('switch acknowledgements wait for encoded program progress', async () => {
    const { RenderAcknowledgements } = await import('../../workers/restream/program-renderer.mjs');
    const state = new RenderAcknowledgements();
    state.submit('a', 1000);
    assert.equal(state.advance(999), undefined);
    assert.equal(state.advance(1000), 'a');
    state.submit(undefined, 2000);
    assert.equal(state.advance(1999), 'a');
    assert.equal(state.advance(2000), undefined);
});
test('overlapping reconciliation never leaves more than current and next inputs', async () => {
    const renderer = createProgramRenderer();
    const sources = (keys: string[]) => keys.map(slotKey => ({ slotKey, sourceId: slotKey, url: 'udp://127.0.0.1:19999' }));
    await renderer.reconcileSources(sources(['a', 'b']));
    await Promise.all([renderer.reconcileSources(sources(['c', 'd'])), renderer.reconcileSources(sources(['e', 'f']))]);
    assert.equal(renderer.getInputs().length, 2);
    await renderer.stop();
    await assert.rejects(() => renderer.reconcileSources(sources(['g'])), /stopped/);
});
test('encoded acknowledgement retains source identity when a slot is replaced', async () => {
    const { RenderAcknowledgements } = await import('../../workers/restream/program-renderer.mjs');
    const state = new RenderAcknowledgements();
    state.submit('same-slot', 1000, 'old-source');
    state.advance(1000);
    assert.equal(state.renderedSourceId, 'old-source');
    state.submit('same-slot', 2000, 'new-source');
    state.advance(1999);
    assert.equal(state.renderedSourceId, 'old-source');
    state.advance(2000);
    assert.equal(state.renderedSourceId, 'new-source');
});
test('reconnect starts a new evidence epoch without retaining stale failure duration', async (t) => {
    const { EventEmitter } = await import('node:events');
    const { PassThrough } = await import('node:stream');
    t.mock.timers.enable({ apis: ['setTimeout', 'setInterval'] });
    let now = 0;
    const children: any[] = [];
    const spawnProcess = () => { const child = new EventEmitter() as any; child.stdio = [null, null, new PassThrough(), new PassThrough(), new PassThrough()]; child.kill = () => { queueMicrotask(() => child.emit('close', null)); return true; }; children.push(child); return child; };
    const input = createInputSupervisor({ source: { slotKey: 's', sourceId: 'id', url: 'test' }, clock: () => now, spawnProcess });
    input.start();
    assert.equal(input.getObservation().failureSince, 0);
    now = 3000;
    children[0].emit('close', null);
    now = 4000;
    t.mock.timers.tick(1000);
    assert.equal(input.getObservation().failureSince, 4000);
    await input.stop();
});

for (const reconnect of [false, true]) {
    test(`duplicate initial PTS cannot establish readiness ${reconnect ? 'after reconnect' : 'at startup'}`, async (t) => {
        const { EventEmitter } = await import('node:events');
        const { PassThrough } = await import('node:stream');
        t.mock.timers.enable({ apis: ['setTimeout', 'setInterval'] });
        let now = 0;
        const children: any[] = [];
        const spawnProcess = () => {
            const child = new EventEmitter() as any;
            child.stdio = [null, null, new PassThrough(), new PassThrough(), new PassThrough()];
            child.kill = () => { queueMicrotask(() => child.emit('close', null)); return true; };
            children.push(child);
            return child;
        };
        const input = createInputSupervisor({ source: { slotKey: 'next', sourceId: 'dj', url: 'test' }, quality: { width: 2, height: 2, frameRate: 30 }, clock: () => now, spawnProcess });
        t.after(() => input.stop());
        const decode = (pts: number) => {
            const child = children.at(-1);
            child.stdio[2].write(`showinfo pts_time:${pts}\n`);
            child.stdio[3].write(Buffer.alloc(6));
            child.stdio[4].write(Buffer.alloc(6400));
        };
        input.start();
        if (reconnect) {
            decode(0); now = 100; decode(0.1);
            assert.equal(input.getObservation().ready, true, 'advancing original connection is ready');
            children[0].emit('close', null);
            now = 1100;
            t.mock.timers.tick(1000);
            assert.equal(children.length, 2);
        }
        decode(0); now += 100; decode(0);
        assert.equal(input.getObservation().ready, false, 'two identical initial PTS do not prove advancement');
        assert.equal(input.getObservation().progressing, false);
        assert.equal(input.getObservation().analysisActive, false);
        now += 100; decode(0.1);
        assert.equal(input.getObservation().ready, true, 'second distinct increasing PTS establishes progress');
        assert.equal(input.getObservation().progressing, true);
    });
}
test('renderer accepts six video presets and rejects unsupported audio', async () => {
    const renderer = createProgramRenderer({quality:'480p60',audioBitrateKbps:320});
    assert.equal(renderer.profile.height,480);
    assert.equal(renderer.profile.frameRate,60);
    await renderer.stop();
    assert.throws(() => createProgramRenderer({audioBitrateKbps:192}), /audio|settings/i);
});
test('encoded snapshot retains revision when the same source and slot acquire a newer revision', async () => {
    const { RenderAcknowledgements } = await import('../../workers/restream/program-renderer.mjs');
    const state = new RenderAcknowledgements();
    state.submit('slot', 1000, 'source', 1);
    state.advance(1000);
    state.submit('slot', 2000, 'source', 2);
    state.advance(1999);
    assert.equal(state.renderedSourceRevision, 1);
    state.advance(2000);
    assert.equal(state.renderedSourceRevision, 2);
    state.submit(undefined, 3000, undefined, undefined);
    state.advance(3000);
    assert.equal(state.renderedSourceRevision, undefined);
    assert.equal(state.renderedSourceId, undefined);
});
