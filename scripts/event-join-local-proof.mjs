import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import { mkdtemp, writeFile } from 'node:fs/promises';
import { setTimeout as sleep } from 'node:timers/promises';
import { createProofWorker as createEventWorker, syntheticInputs } from './event-proof-fixtures.mjs';
import { createProgramRenderer } from '../workers/restream/program-renderer.mjs';
import { createEventOutputs } from '../workers/restream/output-sender.mjs';
import { verifyProgramPackets } from './event-proof-metrics.mjs';

// Real packaged controller/media pipeline; synthetic control and local transport
// are injected only at harness boundaries. No provider publishing or credentials.
const directory = await mkdtemp(process.env.PROOF_DIRECTORY_PREFIX ?? '/tmp/event-join-proof-');
const compliance = { sourceConsent: 'accepted', destinationAuthority: 'accepted', providerRules: 'accepted', rightsClearedMedia: 'accepted' };
const begun = Date.now(), boundary = begun + 10000, endAt = boundary + 4000;
const configuration = {
  sessionDeadline: begun + 60000, mode: 'automatic', policy: {}, currentSourceId: 'expired',
  sources: [{ id: 'expired', type: 'vrcdn_link', publicUrl: 'test-only-expired' }, { id: 'upcoming', type: 'vrcdn_link', publicUrl: 'test-only-upcoming' }],
  slots: [{ slotKey: 'expired', sourceId: 'expired', startAt: begun - 20000, endAt: begun - 1000, available: true }, { slotKey: 'upcoming', sourceId: 'upcoming', startAt: boundary, endAt, available: true }],
  outputId: 'primary', outputs: [{ id: 'primary', type: 'vrcdn', credential: { secretRef: 'primary' }, compliance }],
};
const source = spawn('ffmpeg', ['-hide_banner', '-loglevel', 'error', '-re', '-f', 'lavfi', '-i', 'testsrc2=s=1280x720:r=30', '-re', '-f', 'lavfi', '-i', 'sine=frequency=440:sample_rate=48000', '-c:v', 'libx264', '-threads', '2', '-preset', 'ultrafast', '-tune', 'zerolatency', '-g', '30', '-c:a', 'aac', '-f', 'mpegts', 'udp://127.0.0.1:19883?pkt_size=1316'], { stdio: 'ignore' });
const results = [];
try {
  for (const replacement of [false, true]) {
    const name = replacement ? 'replacement-after-end' : 'gap-to-boundary-overrun';
    const file = `${directory}/${name}.ts`, resolved = [], samples = [];
    let renewals = 0, reports = 0, selectedAt;
    if (replacement) configuration.currentSourceId = 'upcoming';
    const receiver = spawn('ffmpeg', ['-hide_banner', '-loglevel', 'error', '-listen', '1', '-i', 'rtmp://127.0.0.1:19881/live/test-key', '-c', 'copy', '-f', 'mpegts', '-y', file], { stdio: 'ignore' });
    const renderer = createProgramRenderer();
    const outputs = createEventOutputs({ configuration,
      resolveCredential: () => JSON.stringify({ rtmpUrl: 'rtmp://uk.ingest.vrcdn.live/live', streamKey: 'test-key' }),
      spawnForDestination: () => (command, args, options) => { const local = [...args]; local[local.length - 1] = 'rtmp://127.0.0.1:19881/live'; return spawn(command, local, options); },
    });
    const worker = createEventWorker({ identity: { eventId: 'local', sessionId: name, workerId: name, epoch: 0 }, renderer, outputs,
      inputs: syntheticInputs(async source => { resolved.push(source.id); assert.equal(source.id, 'upcoming', 'expired feed must never be opened'); return 'udp://127.0.0.1:19883?fifo_size=1024&overrun_nonfatal=1'; }), checkEnabled: async () => true,
      control: async name => {
        if (name === 'acquireSession' || name === 'renewSession') { if (name === 'renewSession') renewals++; return { granted: true, epoch: 1, serverNow: Date.now(), expiresAt: Date.now() + 30000, renewAfterMs: 10000, configuration }; }
        if (name === 'refreshConfiguration') return { granted: true, serverNow: Date.now(), configuration };
        if (name === 'claimCommands') return { granted: true, commands: [] };
        if (name === 'observeProgram') reports++;
        return { accepted: true };
      },
    });
    let watchdog;
    try {
      await sleep(300); await worker.start(); watchdog = setInterval(() => worker.watchdog(), 50);
      const finish = replacement ? Date.now() + 12000 : endAt + 6000;
      while (Date.now() < finish) {
        await worker.tick(); await sleep(250);
        const now = Date.now(), state = renderer.getState();
        samples.push({ at: now, source: state.renderedSourceId ?? null, publishing: outputs.getState().publishing });
        assert.equal(worker.getState().stopped, false);
        if (replacement || now < boundary) assert.equal(state.renderedSourceId, undefined, 'gap/expired startup remains on slate');
        if (state.renderedSourceId === 'upcoming') selectedAt ??= now;
      }
      assert(outputs.getState().publishing, 'actual primary media progress');
      assert(renewals > 0 && reports > 0);
      if (replacement) { assert.deepEqual(resolved, []); assert.equal(selectedAt, undefined); }
      else { assert(selectedAt >= boundary); assert.equal(renderer.getState().renderedSourceId, 'upcoming', 'healthy selected source overruns authored end'); }
      clearInterval(watchdog); await worker.stop();
      receiver.kill('SIGINT');
      if (receiver.exitCode === null) await new Promise(resolve => receiver.once('exit', resolve));
      const probe = await verifyProgramPackets(file);
      assert(probe.maxGap < 0.2); assert(probe.maxGop <= 1.05);
      results.push({ case: name, resolved, selectedAt, boundary, endAt, renewals, reports, maxPacketGapSeconds: probe.maxGap, maxGopSeconds: probe.maxGop, streams: probe.streams });
      await writeFile(`${directory}/${name}-samples.json`, JSON.stringify(samples, null, 2));
    } finally { clearInterval(watchdog); await worker.stop(); receiver.kill('SIGKILL'); }
  }
} finally { source.kill('SIGKILL'); }
const result = { passed: true, node: process.version, directory, results, limits: 'Synthetic control/UDP source/local RTMP receivers. Actual packaged controller, decoder, renderer, encoder and required sender. No hosted/provider acceptance or new two-hour soak.' };
await writeFile(`${directory}/result.json`, JSON.stringify(result, null, 2));
console.log(JSON.stringify(result));
