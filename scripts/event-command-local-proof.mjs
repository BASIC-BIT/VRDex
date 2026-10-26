import assert from 'node:assert/strict';
import { spawn, execFileSync } from 'node:child_process';
import { mkdtemp, writeFile } from 'node:fs/promises';
import { setTimeout as sleep } from 'node:timers/promises';
import { createProofWorker as createEventWorker, syntheticInputs } from './event-proof-fixtures.mjs';
import { createProgramRenderer } from '../workers/restream/program-renderer.mjs';
import { createEventOutputs } from '../workers/restream/output-sender.mjs';
import { verifyProgramPackets } from './event-proof-metrics.mjs';

// Synthetic control and local transport only; all media/runtime modules are packaged.
const directory = await mkdtemp(process.env.PROOF_DIRECTORY_PREFIX ?? '/tmp/event-command-proof-');
const begun = Date.now(), samples = [], acknowledgements = [], observations = [];
const compliance = { sourceConsent: 'accepted', destinationAuthority: 'accepted', providerRules: 'accepted', rightsClearedMedia: 'accepted' };
const configuration = {
  sessionDeadline: begun + 120000, mode: 'automatic', policy: {},
  sources: ['a', 'b', 'c'].map(id => ({ id, type: 'vrcdn_link', publicUrl: `test-only-${id}` })),
  slots: [{ slotKey: 'a', sourceId: 'a', startAt: begun - 1000, endAt: begun + 90000, available: true }, { slotKey: 'b', sourceId: 'b', startAt: begun + 100000, available: true }],
  outputId: 'primary', outputs: [{ id: 'primary', type: 'vrcdn', credential: { secretRef: 'primary' }, compliance }],
};
const sources = [];
function source(port, frequency) {
  const child = spawn('ffmpeg', ['-hide_banner', '-loglevel', 'error', '-re', '-f', 'lavfi', '-i', `color=${frequency===440?'red':'blue'}:s=1280x720:r=30`, '-re', '-f', 'lavfi', '-i', `sine=frequency=${frequency}:sample_rate=48000`, '-c:v', 'libx264', '-threads', '1', '-preset', 'ultrafast', '-tune', 'zerolatency', '-g', '30', '-c:a', 'aac', '-f', 'mpegts', `udp://127.0.0.1:${port}?pkt_size=1316`], { stdio: 'ignore' });
  sources.push(child);
}
const file = `${directory}/commands.ts`;
const receiver = spawn('ffmpeg', ['-hide_banner', '-loglevel', 'error', '-listen', '1', '-i', 'rtmp://127.0.0.1:19881/live/test-key', '-c', 'copy', '-f', 'mpegts', '-y', file], { stdio: 'ignore' });
const renderer = createProgramRenderer();
const outputs = createEventOutputs({ configuration,
  resolveCredential: () => JSON.stringify({ rtmpUrl: 'rtmp://uk.ingest.vrcdn.live/live', streamKey: 'test-key' }),
  spawnForDestination: () => (command, args, options) => { const local = [...args]; local[local.length - 1] = 'rtmp://127.0.0.1:19881/live'; return spawn(command, local, options); },
});
let lateReady;const delayed=new Promise(resolve=>{lateReady=resolve;});
let commands = [], sequence = 0, renewals = 0, watchdog;
const worker = createEventWorker({ identity: { eventId: 'local', sessionId: 'command-proof', workerId: 'command-proof', epoch: 0 }, renderer, outputs,metric:event=>{if(event.event==='event_worker_stopped')console.log(JSON.stringify({...event,renderer:{...renderer.getState(),error:renderer.getState().error?.message}}));},
  inputs: syntheticInputs(source => source.id==='c'?delayed:`udp://127.0.0.1:${source.id === 'a' ? 19883 : 19884}?fifo_size=1024&overrun_nonfatal=1`), checkEnabled: async () => true,
  control: async (name, args) => {
    if (name === 'acquireSession' || name === 'renewSession') { if (name === 'renewSession') renewals++; return { granted: true, epoch: 1, serverNow: Date.now(), expiresAt: Date.now() + 30000, renewAfterMs: 10000, configuration: structuredClone(configuration) }; }
    if (name === 'refreshConfiguration') return { granted: true, serverNow: Date.now(), configuration: structuredClone(configuration) };
    if (name === 'claimCommands') return { granted: true, commands };
    if (name === 'acknowledgeCommand') { acknowledgements.push({ at: Date.now(), ...args }); commands = []; }
    if (name === 'observeProgram') observations.push({ at: Date.now(), ...args });
    return { accepted: true };
  },
});
async function step() {
  await worker.tick(); await sleep(250);
  assert.equal(worker.getState().stopped, false,JSON.stringify({worker:worker.getState(),renderer:{...renderer.getState(),error:renderer.getState().error?.message}}));
  const state = renderer.getState();
  samples.push({ at: Date.now(), source: state.renderedSourceId ?? null, publishing: outputs.getState().publishing, mode: worker.getState().mode, current: worker.getState().current?.sourceId });
}
async function until(predicate, ms = 12000) {
  const deadline = Date.now() + ms;
  do { await step(); if (predicate()) return; } while (Date.now() < deadline);
  throw Error('Proof condition deadline exceeded');
}
async function command(commandType, targetSourceId) {
  commands = [{ _id: `command-${++sequence}`, sequence, commandType, targetSourceId }];
  await until(() => acknowledgements.at(-1)?.sequence === sequence, 20000);
  return acknowledgements.at(-1);
}
try {
  source(19883, 440); await sleep(300); await worker.start(); watchdog = setInterval(() => worker.watchdog(), 50);
  await until(() => renderer.getState().renderedSourceId === 'a' && outputs.getState().publishing);
  const failureBegan = Date.now();
  const failed = await command('switch_source', 'b');
  assert.equal(failed.outcome, 'failed');
  assert.equal(worker.getState().current.sourceId, 'a'); assert.equal(worker.getState().mode, 'automatic');
  assert(samples.filter(sample => sample.at >= failureBegan).every(sample => sample.source === 'a'), 'healthy A remains published throughout failed B preparation');
  source(19884, 880);
  const recoveryUntil = Date.now() + 4000;
  while (Date.now() < recoveryUntil) { await step(); assert.equal(renderer.getState().renderedSourceId, 'a', 'late B recovery cannot publish failed target'); }
  const retried = await command('switch_source', 'b');
  assert.equal(retried.outcome, 'succeeded'); assert.equal(retried.observedSourceId, 'b');
  const returned = await command('set_automatic_mode');
  assert.equal(returned.outcome, 'succeeded'); assert.equal(returned.observedSourceId, 'a');
  assert.equal(worker.getState().mode, 'automatic');
  await command('switch_source', 'b');
  configuration.slots[0].endAt = Date.now() - 1000;
  const gap = await command('set_automatic_mode');
  assert.equal(gap.outcome, 'succeeded'); assert.equal(gap.observedSourceId, null);
  assert.equal(renderer.getState().renderedSourceId, undefined);
  // A third, unresolved transport must never delay locally received Cut.
  commands=[{_id:`command-${++sequence}`,sequence,commandType:'switch_source',targetSourceId:'c'}];
  await until(()=>worker.getState().pending?.command.targetSourceId==='c');
  const cut=await command('cut_to_slate');
  assert.equal(worker.getState().committedIntent.kind,'slate');assert.equal(cut.observedSourceId,null);
  lateReady('udp://127.0.0.1:19884?fifo_size=1024&overrun_nonfatal=1');
  const cutSamples=[];
  for(let i=0;i<16;i++){await step();assert.equal(renderer.getState().renderedSourceId,undefined);cutSamples.push(renderer.getState().outputMs);}
  assert(renewals > 0); assert(observations.length > 0);
  clearInterval(watchdog); await worker.stop(); receiver.kill('SIGINT');
  if (receiver.exitCode === null) await new Promise(resolve => receiver.once('exit', resolve));
  const probe = await verifyProgramPackets(file); assert(probe.maxGap < 0.2); assert(probe.maxGop <= 1.05);
  const colors=acknowledgements.filter(ack=>ack.observedSourceId).map(ack=>{
    const rgb=execFileSync('ffmpeg',['-v','error','-i',file,'-ss',String(ack.outputMs/1000),'-frames:v','1','-vf','scale=1:1','-f','rawvideo','-pix_fmt','rgb24','pipe:1']);
    assert.equal(rgb.length,3);if(ack.observedSourceId==='a')assert(rgb[0]>150&&rgb[2]<60);else assert(rgb[2]>150&&rgb[0]<60);
    return {sequence:ack.sequence,sourceId:ack.observedSourceId,rgb:[...rgb]};
  });
  const finalRgb=execFileSync('ffmpeg',['-v','error','-i',file,'-ss',String(cutSamples.at(-1)/1000-1.5),'-frames:v','1','-vf','scale=1:1','-f','rawvideo','-pix_fmt','rgb24','pipe:1']);
  assert.equal(finalRgb.length,3);assert(Math.max(...finalRgb)-Math.min(...finalRgb)<8,'post-Cut encoded output is neutral slate');
  const result = { colors,finalRgb:[...finalRgb],cutSamples,passed: true, node: process.version, directory, elapsedMs: Date.now() - begun, renewals, acknowledgements, observationCount: observations.length, maxPacketGapSeconds: probe.maxGap, maxGopSeconds: probe.maxGop, streams: probe.streams, limits: 'Host real controller/decoder/renderer/encoder/sender; actual image remains a separate gate; injected local control and UDP/RTMP endpoints. No hosted/provider acceptance or new two-hour soak.' };
  await writeFile(`${directory}/samples.json`, JSON.stringify(samples, null, 2));
  await writeFile(`${directory}/observations.json`, JSON.stringify(observations, null, 2));
  await writeFile(`${directory}/result.json`, JSON.stringify(result, null, 2)); console.log(JSON.stringify(result));
} finally {
  clearInterval(watchdog); await worker.stop(); receiver.kill('SIGKILL'); for (const child of sources) child.kill('SIGKILL');
  await writeFile(`${directory}/samples.json`, JSON.stringify(samples, null, 2));
  await writeFile(`${directory}/acknowledgements.json`, JSON.stringify(acknowledgements, null, 2));
}
