// CI orchestration only. The packaged full transport CLI owns the native tests.
import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import { randomUUID } from 'node:crypto';
import { appendFile, readFile } from 'node:fs/promises';
import { pathToFileURL } from 'node:url';
import { createCiNativeProducer } from '../../scripts/event-marker-native-ci-controller.mjs';

const BYTE_CAP = 128 * 1024;
const ID = /^[a-f0-9]{64}$/;
const LABEL = 'io.vrdex.native-ci';

import { validateReceipt } from '../../scripts/event-marker-native132-receipt.mjs';
export { validateReceipt } from '../../scripts/event-marker-native132-receipt.mjs';

// Failed receipts are diagnostic claims only. Copy reviewed values, never raw
// errors or unknown fields, and leave native exit/positive acceptance untouched.
function projectNegativeReceipt(result, names) {
  const unavailable = { receipt: 'unavailable' };
  if (result.code !== 1 || result.failure !== null || result.signal !== null ||
      typeof result.stdout !== 'string' || typeof result.stderr !== 'string' ||
      Buffer.byteLength(result.stdout) + Buffer.byteLength(result.stderr) > BYTE_CAP) return unavailable;
  try {
    const receipt = JSON.parse(result.stdout); // No partial, prefix or suffix parsing.
    if (!receipt || receipt.schemaVersion !== 1 || receipt.terminal !== true || receipt.case !== 'all' ||
        receipt.deterministic !== true || receipt.passed !== false ||
        !['python_contracts', 'owner_contracts', 'blocked_resolution_cancellation', 'cleanup'].includes(receipt.failurePhase) ||
        receipt.failureCode !== 'transport_contract_failed' || !receipt.tests) return unavailable;
    const failed = [];
    for (const [suite, summary, expected, count] of [
      ['python', receipt.tests, names.python, 42], ['owner', receipt.tests.owner, names.node, 90],
    ]) {
      if (suite === 'owner' && !Object.hasOwn(receipt.tests, 'owner')) continue;
      if (!summary || !Array.isArray(expected) || expected.length !== count ||
          expected.some(name => typeof name !== 'string') || new Set(expected).size !== count ||
          !Number.isInteger(summary.testsRun) || summary.testsRun < 1 || summary.testsRun > count ||
          typeof summary.passed !== 'boolean' || !Array.isArray(summary.outcomes) ||
          summary.outcomes.length !== summary.testsRun) return unavailable;
      const allowed = new Set(expected), seen = new Set();
      for (const row of summary.outcomes) {
        if (!row || !allowed.has(row.test) || seen.has(row.test) ||
            !['passed', 'failed', 'error', 'skipped', 'expected_failure', 'unexpected_success', 'todo'].includes(row.outcome)) return unavailable;
        seen.add(row.test);
        if (row.outcome !== 'passed') failed.push({ suite, name: row.test, outcome: row.outcome });
      }
    }
    const diagnostic = { receipt: 'complete', failurePhase: receipt.failurePhase,
      failureCode: 'transport_contract_failed', failed };
    if (failed.length > 132 || Buffer.byteLength(JSON.stringify(diagnostic)) > 32 * 1024) return unavailable;
    return diagnostic;
  } catch {
    return unavailable;
  }
}

// A Docker CLI can hang independently of the container. Bound both output streams
// together and terminate its process group even when its leader has already exited.
export function boundedCommand(command, args, { timeoutMs, signal, graceMs = 1000, spawnProcess = spawn,
  killGroup = (pid, value) => process.kill(-pid, value) } = {}) {
  return new Promise(resolve => {
    const buffers = { stdout: [], stderr: [] };
    let bytes = 0, failure = null, settled = false, killed = false, grace, final;
    const child = spawnProcess(command, args, { detached: true, stdio: ['ignore', 'pipe', 'pipe'] });
    function kill(value) {
      if (value === 'SIGKILL') {
        if (killed) return;
        killed = true;
      }
      try { if (child.pid) killGroup(child.pid, value); } catch (error) {
        if (error.code !== 'ESRCH') failure ??= 'process_cleanup';
      }
    }
    function finish(code, exitSignal) {
      if (settled) return;
      settled = true;
      clearTimeout(deadline); clearTimeout(grace); clearTimeout(final);
      signal?.removeEventListener('abort', abort);
      child.stdout.destroy(); child.stderr.destroy(); child.unref?.();
      resolve({ code, signal: exitSignal, failure,
        stdout: Buffer.concat(buffers.stdout).toString('utf8'), stderr: Buffer.concat(buffers.stderr).toString('utf8') });
    }
    function stop(reason) {
      if (failure || settled) return;
      failure = reason;
      kill('SIGTERM');
      if (settled) return;
      grace = setTimeout(() => {
        kill('SIGKILL');
        // Missing close is a failure, never an unbounded wait for the daemon/pipe.
        if (!settled) final = setTimeout(() => finish(null, null), 100);
      }, Math.min(graceMs, 1000));
    }
    const abort = () => stop('cancelled');
    const deadline = setTimeout(() => stop('deadline'), timeoutMs);
    for (const stream of ['stdout', 'stderr']) child[stream].on('data', chunk => {
      if (failure || settled) return;
      const data = Buffer.from(chunk);
      if (bytes + data.length > BYTE_CAP) return stop('output_limit');
      bytes += data.length; buffers[stream].push(data);
    });
    child.once('error', () => { failure ??= 'spawn'; finish(null, null); });
    child.once('close', (code, value) => {
      // On cancellation still kill the owned group if the leader closes on TERM.
      if (failure) kill('SIGKILL');
      finish(code, value);
    });
    signal?.addEventListener('abort', abort, { once: true });
    if (signal?.aborted) abort();
  });
}

function successful(result) {
  assert.equal(result.code, 0, 'Docker/native exit');
  assert.equal(result.signal, null, 'Docker/native signal');
  assert.equal(result.failure, null, 'Docker/native bound');
  assert.ok(Buffer.byteLength(result.stdout) + Buffer.byteLength(result.stderr) <= BYTE_CAP, 'output limit');
  return result.stdout.trim();
}

export async function runGate({ execute = boundedCommand, names, signal, now = () => performance.now(),bindingProducer } = {}) {
  const deadline = now() + 400000;
  const token = randomUUID();
  const name = `vrdex-native-${token}`; // Identity exists before even an uncertain create.
  const report = { passed: false, nativeExit: null, nativeSignal: null, cleanup: false, image: null, counts: null, versions: null, errors: [], negativeDiagnostic: { receipt: 'unavailable' } };
  let id, createAttempted = false;
  const invoke = async (args, limit = 5000, cleaning = false) => {
    const remaining = deadline - now() - (cleaning ? 1100 : 20000);
    assert.ok(remaining > 0 && (cleaning || !signal?.aborted), 'outer deadline/cancellation');
    return execute('docker', args, { timeoutMs: Math.min(limit, remaining), signal: cleaning ? undefined : signal });
  };
  const inspect = async (container, cleaning = false) => {
    const original=successful(await invoke(['inspect', container], 5000, cleaning));bindingProducer?.inspected(original);const rows = JSON.parse(original);
    assert.equal(rows.length, 1, 'single container');
    const value = rows[0];
    assert.ok(ID.test(value.Id), 'container ID');
    assert.equal(value.Name, '/' + name, 'owned name');
    assert.equal(value.Config.Labels[LABEL], token, 'owned label');
    assert.equal(value.Image, report.image, 'fresh image');
    return value;
  };
  const listOwned = async () => successful(await invoke(['container', 'ls', '--all', '--no-trunc', '--format', '{{.ID}}',
    '--filter', `name=^/${name}$`, '--filter', `label=${LABEL}=${token}`], 5000, true));
  try {
    const image = successful(await invoke(['image', 'inspect', '--format', '{{.Id}}', 'vrdex-restream-worker:ci']));
    assert.match(image, /^sha256:[a-f0-9]{64}$/);
    report.image = image;
    let createArguments=['create', '--name', name, '--label', `${LABEL}=${token}`, '--network', 'none',
      '--workdir', '/app', '-e', 'VRDEX_PROOF_INNER=twitch', '--entrypoint', 'timeout', report.image,
      '--signal=TERM', '--kill-after=1s', '360s', 'sh', '-c',
      'node --version >&2 && python3 --version >&2 && ffmpeg -version >&2 || exit 1\n' +
      'node scripts/event-twitch-input-proof.mjs --case all --output-dir /tmp/event-capacity-ci-native\n' +
      'result=$?\ncat /tmp/event-capacity-ci-native/receipt.json\nexit "$result"'];
    if(bindingProducer)createArguments=await bindingProducer.prepare({image:report.image,originalArguments:createArguments,invoke,deadline,signal});
    createAttempted = true;
    id = successful(await invoke(createArguments));bindingProducer?.created(id);
    assert.match(id, ID);
    const attached = await invoke(['start', '--attach', id], 362000);
    bindingProducer?.attached(attached);
    report.nativeExit = attached.code;
    report.nativeSignal = attached.signal;
    report.versions = {
      node: attached.stderr.match(/^v\d+\.\d+\.\d+$/m)?.[0],
      python: attached.stderr.match(/^Python [0-9.]+$/m)?.[0],
      ffmpeg: attached.stderr.match(/^ffmpeg version [^\r\n]{1,200}/m)?.[0],
    };
    report.negativeDiagnostic = projectNegativeReceipt(attached, names);
    const raw = successful(attached);
    assert.ok(Object.values(report.versions).every(Boolean), 'runtime versions');
    const container = await inspect(id);
    assert.equal(container.Id, id);
    assert.deepEqual(container.State && {
      status: container.State.Status, running: container.State.Running, pid: container.State.Pid,
      exit: container.State.ExitCode, oom: container.State.OOMKilled, error: container.State.Error,
    }, { status: 'exited', running: false, pid: 0, exit: 0, oom: false, error: '' }, 'independent stopped native state');
    report.counts = validateReceipt(raw, names);
    await bindingProducer?.readback({id,deadline,signal});
  } catch (error) {
    report.errors.push(error.message.slice(0, 1000));
  } finally {
    try {
      if (createAttempted) {
        if (!id || !ID.test(id)) {
          id = undefined;
          // Creation may have reached the daemon even if its CLI timed out.
          const found = await listOwned();
          assert.ok(found, 'creation outcome unconfirmed despite empty name readback');
          assert.match(found, ID);
          id = (await inspect(found, true)).Id;
        }
        let removal;if (id) {removal=await invoke(['rm', '--force', id], 5000, true);successful(removal);}
        const nameAbsence=await listOwned();assert.equal(nameAbsence, '', 'owned name absence');
        if (id) {
          const remaining = successful(await invoke(['container', 'ls', '--all', '--no-trunc', '--format', '{{.ID}}', '--filter', `id=${id}`], 5000, true));
          assert.equal(remaining, '', 'exact ID absence');
          bindingProducer?.cleaned({schema:'native-docker-cleanup-v1',remove:removal,ownedName:{stdout:nameAbsence,code:0,signal:null,failure:null},ownedId:{stdout:remaining,code:0,signal:null,failure:null}});
        }
      }
      report.cleanup = true;
    } catch (error) { report.errors.push(`cleanup: ${error.message.slice(0, 1000)}`); }
  }
  if (signal?.aborted || now() >= deadline) report.errors.push('outer deadline/cancellation');
  report.passed = report.errors.length === 0 && report.nativeExit === 0 && report.cleanup && report.counts !== null;
  if(bindingProducer)try{report.binding=await bindingProducer.finish(report);}catch(error){report.errors.push('binding retention: '+error.message);report.passed=false;}
  return report;
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  const controller = new AbortController();
  const cancel = () => controller.abort();
  process.on('SIGINT', cancel); process.on('SIGTERM', cancel);
  // Independent of CLI promises: final backstop is below the seven-minute step.
  const absolute = setTimeout(() => { console.error('Native CI absolute deadline; cleanup unconfirmed'); process.exit(1); }, 400000);
  try {
    const names = JSON.parse(await readFile(new URL('./restream-native-names.json', import.meta.url)));
    const report = await runGate({ names, signal: controller.signal,bindingProducer:createCiNativeProducer() });
    const safe = { sourceRevision: process.env.GITHUB_SHA, ...report };
    const output = JSON.stringify(safe, null, 2);
    console.log(output);
    if (process.env.GITHUB_STEP_SUMMARY) await appendFile(process.env.GITHUB_STEP_SUMMARY, `\n### Required native transport gate\n\n\`\`\`json\n${output}\n\`\`\`\n`);
    process.exitCode = report.passed ? 0 : 1;
  } catch (error) { console.error(error.message); process.exitCode = 1; }
  finally { clearTimeout(absolute); process.off('SIGINT', cancel); process.off('SIGTERM', cancel); }
}
