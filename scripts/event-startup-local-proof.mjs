import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import { createServer } from 'node:http';
import { mkdtemp, writeFile } from 'node:fs/promises';
import { setTimeout as sleep } from 'node:timers/promises';
import { createProofWorker as createEventWorker, syntheticInputs } from './event-proof-fixtures.mjs';
import { createProgramRenderer } from '../workers/restream/program-renderer.mjs';
import { createEventOutputs } from '../workers/restream/output-sender.mjs';

// Local synthetic proof only. Production parsing stays enabled; transport rewrite
// occurs in this harness's injected spawn boundary, never in a runtime flag.
const directory = await mkdtemp(process.env.PROOF_DIRECTORY_PREFIX ?? '/tmp/event-startup-proof-');
const compliance = { sourceConsent: 'accepted', destinationAuthority: 'accepted', providerRules: 'accepted', rightsClearedMedia: 'accepted' };
const configuration = () => ({ sessionDeadline: Date.now() + 60000, mode: 'hold', policy: {}, sources: [], slots: [], outputId: 'primary', outputs: [
  { id: 'primary', type: 'vrcdn', credential: { secretRef: 'primary' }, compliance },
  { id: 'optional', type: 'external_rtmp', credential: { secretRef: 'optional' }, compliance, simulcastEnabled: true, twitchSetup: { channel: 'test', profile: 'twitch-conservative-720p30' } },
] });
const until = async (predicate, ms, label) => {
  const deadline = performance.now() + ms;
  while (!predicate()) { assert(performance.now() < deadline, `Timeout: ${label}`); await sleep(100); }
};
const results = [];

// Run the actual CLI, including its watchdog, HTTP boundary, relay cleanup and
// process exit. This test-owned executable answers only the enablement read;
// there are no AWS/provider requests, real tokens or real credential values.
await writeFile(`${directory}/aws`, '#!/bin/sh\n[ "$1" = ssm ] && [ "$2" = get-parameter ] || exit 1\nprintf \'{"Parameter":{"Value":"true"}}\'\n', { mode: 0o700 });
let cliRenewals = 0, cliErrorObserved = false;
const config = configuration();
const server = createServer(async (req, res) => {
  let body = '';
  for await (const chunk of req) body += chunk;
  const { path, args } = JSON.parse(body);
  const name = path.split(':')[1];
  if (name === 'renewSession') cliRenewals++;
  if (name === 'observeProgram' && args.state === 'error') cliErrorObserved = true;
  let value = { accepted: true };
  if (name === 'acquireSession' || name === 'renewSession') value = { granted: true, epoch: 1, serverNow: Date.now(), expiresAt: Date.now() + 30000, renewAfterMs: 10000, configuration: config };
  if (name === 'refreshConfiguration') value = { granted: true, configuration: config };
  if (name === 'claimCommands') value = { granted: true, commands: [] };
  res.setHeader('Content-Type', 'application/json'); res.end(JSON.stringify({ status: 'success', value }));
});
await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
const cli = spawn(process.execPath, ['workers/restream/event-worker.mjs'], { env: { ...process.env, PATH: `${directory}:${process.env.PATH}`, CONVEX_URL: `http://127.0.0.1:${server.address().port}`, VRDEX_EVENT_MEDIA_BRIDGE_TOKEN: 'local-fixture', VRDEX_EVENT_MEDIA_EVENT_ID: 'event', VRDEX_EVENT_MEDIA_SESSION_ID: 'session', VRDEX_RESTREAM_KILL_SWITCH_SSM_PARAMETER: '/local-fixture/enabled', AWS_REGION: 'us-east-1', VRDEX_EVENT_MEDIA_OUTPUT_INGEST_SECRET_JSON: 'malformed-fixture', VRDEX_EVENT_MEDIA_OPTIONAL_SECRET_ARNS_JSON: '{}' }, stdio: ['ignore', 'pipe', 'pipe'] });
let cliOutput = '', cliExit;
cli.stdout.on('data', chunk => { cliOutput += chunk; });
cli.stderr.on('data', chunk => { cliOutput += chunk; });
cli.once('exit', (code, signal) => { cliExit = { code, signal }; });
try {
  await until(() => cliExit !== undefined, 8000, 'primary invalid setup CLI exit');
  assert.equal(cliExit.code, 1); assert.equal(cliExit.signal, null);
  assert.match(cliOutput, /primary-startup-failed/); assert.equal(cliRenewals, 0); assert.equal(cliErrorObserved, true);
  await writeFile(`${directory}/primary-invalid-cli.log`, cliOutput);
  results.push({ case: 'primary-invalid-cli', ...cliExit, renewals: cliRenewals, errorObserved: cliErrorObserved });
} finally {
  cli.kill('SIGKILL');
  await new Promise(resolve => server.close(resolve));
}

for (const receive of [true, false]) {
  const port = receive ? 19781 : 19782;
  const receiver = receive ? spawn('ffmpeg', ['-hide_banner', '-loglevel', 'error', '-listen', '1', '-i', `rtmp://127.0.0.1:${port}/live/test-key`, '-c', 'copy', '-f', 'mpegts', '-y', `${directory}/optional-invalid-primary.ts`], { stdio: 'ignore' }) : undefined;
  const config = configuration(), renderer = createProgramRenderer();
  const outputs = createEventOutputs({ configuration: config,
    resolveCredential: ref => ref === 'primary' ? JSON.stringify({ rtmpUrl: 'rtmp://uk.ingest.vrcdn.live/live', streamKey: 'test-key' }) : 'malformed-fixture',
    spawnForDestination: () => (command, args, options) => {
      const local = [...args]; local[local.length - 1] = `rtmp://127.0.0.1:${port}/live`;
      return spawn(command, local, options);
    },
  });
  let renewals = 0, reports = 0, reason;
  const worker = createEventWorker({ identity: { eventId: 'local', sessionId: 'local', workerId: 'local', epoch: 0 }, renderer, outputs, inputs: syntheticInputs(async () => { throw Error('No source expected'); }), checkEnabled: async () => true,
    control: async name => {
      if (name === 'acquireSession' || name === 'renewSession') { if (name === 'renewSession') renewals++; return { granted: true, epoch: 1, serverNow: Date.now(), expiresAt: Date.now() + 30000, renewAfterMs: 10000, configuration: config }; }
      if (name === 'refreshConfiguration') return { granted: true, configuration: config };
      if (name === 'claimCommands') return { granted: true, commands: [] };
      if (name === 'observeProgram') reports++;
      return { accepted: true };
    }, metric: event => { if (event.event === 'event_worker_stopped') reason = event.reason; },
  });
  let watchdog, poll;
  try {
    await sleep(300); await worker.start();
    watchdog = setInterval(() => worker.watchdog(), 50);
    poll = setInterval(() => void worker.tick(), 250);
    if (receive) {
      await until(() => outputs.getState().publishing && reports > 0, 14000, 'primary publication while optional setup is invalid');
      const before = renderer.getState().outputMs;
      await until(() => renewals > 0 && renderer.getState().outputMs > before + 2000, 12000, 'continued healthy primary publication');
      assert.equal(worker.getState().stopped, false);
      assert.equal(outputs.getState().destinations[1].status, 'invalid_setup');
      results.push({ case: 'optional-invalid-isolated', outputMs: renderer.getState().outputMs, renewals, reports, primaryRestarts: outputs.getState().destinations[0].restarts });
    } else {
      await until(() => worker.getState().stopped, 18000, 'primary startup deadline');
      assert.equal(reason, 'primary-startup-failed');
      const heldRenewals = renewals;
      await worker.tick(); await sleep(500); await worker.tick();
      assert.equal(renewals, heldRenewals);
      assert(outputs.getState().destinations.every(output => output.status === 'stopped'));
      results.push({ case: 'primary-unreachable-deadline', reason, renewals, noRenewalAfterFence: true });
    }
  } finally {
    clearInterval(watchdog); clearInterval(poll); await worker.stop(); receiver?.kill('SIGINT');
    if (receiver && receiver.exitCode === null) await new Promise(resolve => receiver.once('exit', resolve));
  }
}
const result = { passed: true, node: process.version, directory, results };
await writeFile(`${directory}/result.json`, JSON.stringify(result, null, 2));
console.log(JSON.stringify(result));
