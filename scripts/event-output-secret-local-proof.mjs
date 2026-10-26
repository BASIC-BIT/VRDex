// Targeted runtime secret-boundary proof. No AWS/provider traffic: fake aws is
// first on PATH, and real FFmpeg publishes only to a loopback RTMP receiver.
import assert from 'node:assert/strict';
import { mkdtemp, writeFile, chmod, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { spawn } from 'node:child_process';
import { setTimeout as sleep } from 'node:timers/promises';
import { createEventOutputs, resolveOptionalOutputSecret } from '../workers/restream/output-sender.mjs';
import { createProgramRenderer } from '../workers/restream/program-renderer.mjs';
const directory = await mkdtemp(join(tmpdir(), 'optional-secret-proof-'));
const previousPath = process.env.PATH;
await writeFile(join(directory, 'aws'), `#!/bin/sh\ncase "$4" in\n *denied*) echo 'AccessDeniedException synthetic-private-key' >&2; exit 254;;\n *missing*) echo 'ResourceNotFoundException synthetic-private-key' >&2; exit 254;;\n *) exec sleep 20;;\nesac\n`);
await chmod(join(directory, 'aws'), 0o700);
process.env.PATH = `${directory}:${previousPath}`;
const arn = name => `arn:aws:secretsmanager:us-east-1:123456789012:secret:${name}-ABC123`;
const receiver = spawn('ffmpeg', ['-hide_banner', '-loglevel', 'error', '-listen', '1', '-i', 'rtmp://127.0.0.1:19621/live/test-key', '-c', 'copy', '-f', 'null', '-'], { stdio: 'ignore' });
const compliance = { sourceConsent: 'accepted', destinationAuthority: 'accepted', providerRules: 'accepted', rightsClearedMedia: 'accepted' };
const configuration = { outputId: 'main', outputs: [{ id: 'main', type: 'vrcdn', credential: { secretRef: 'main' }, compliance }, { id: 'optional', type: 'external_rtmp', simulcastEnabled: true, twitchSetup: { channel: 'example', profile: 'twitch-conservative-720p30' }, credential: { secretRef: 'optional' }, compliance }] };
let primaryProcesses = 0, optionalProcesses = 0;
const outputs = createEventOutputs({ configuration, env: { AWS_REGION: 'us-east-1', VRDEX_EVENT_MEDIA_OUTPUT_INGEST_SECRET_JSON: JSON.stringify({ rtmpUrl: 'rtmp://uk.ingest.vrcdn.live/live', streamKey: 'test-key' }), VRDEX_EVENT_MEDIA_OPTIONAL_SECRET_ARNS_JSON: JSON.stringify({ optional: arn('hung') }) }, spawnForDestination: destination => (command, args, options) => { if (destination === 'vrcdn')
        primaryProcesses++;
    else
        optionalProcesses++; const local = [...args]; local[local.length - 1] = 'rtmp://127.0.0.1:19621/live'; return spawn(command, local, options); } });
const renderer = createProgramRenderer();
renderer.subscribe(chunk => outputs.enqueue(chunk));
try {
    for (const name of ['denied', 'missing'])
        await assert.rejects(() => resolveOptionalOutputSecret({ arn: arn(name), region: 'us-east-1' }), /^Error: Optional credential unavailable$/);
    await sleep(200);
    const start = performance.now();
    await outputs.start();
    assert(performance.now() - start < 500, 'optional retrieval cannot block primary start');
    await renderer.start();
    let progressingSamples = 0, last = 0;
    for (let i = 0; i < 24; i++) {
        await sleep(250);
        const state = outputs.getState();
        if (state.publishing && state.destinations[0].outputMs > last) {
            progressingSamples++;
            last = state.destinations[0].outputMs;
        }
    }
    assert(progressingSamples >= 10, 'real primary continues while optional AWS process hangs');
    assert.equal(primaryProcesses, 1);
    assert.equal(optionalProcesses, 0);
    assert.equal(outputs.getState().destinations[1].status, 'invalid_setup');
    assert(outputs.getState().publishing);
    assert(last > 4000);
    console.log(JSON.stringify({ passed: true, node: process.version, primaryProcesses, optionalProcesses, progressingSamples, primaryOutputMs: last, optionalStatus: outputs.getState().destinations[1].status, aws: 'local fake process only; denied/missing/hung' }));
}
finally {
    outputs.stopNow();
    await outputs.stop();
    await renderer.stop();
    receiver.kill('SIGKILL');
    process.env.PATH = previousPath;
    await rm(directory, { recursive: true, force: true });
}
