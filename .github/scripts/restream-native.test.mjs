import assert from 'node:assert/strict';
import test from 'node:test';
import { readFile } from 'node:fs/promises';
import { EventEmitter } from 'node:events';
import { PassThrough } from 'node:stream';

const implementation = await import('./restream-native.mjs').catch(() => ({}));
const { validateReceipt, runGate, boundedCommand } = implementation;
const names = JSON.parse(await readFile(new URL('./restream-native-names.json', import.meta.url)));
const image = `sha256:${'a'.repeat(64)}`;
const id = 'b'.repeat(64);
function receipt() {
  return { schemaVersion: 1, terminal: true, passed: true, case: 'all', deterministic: true,
    tests: { testsRun: 42, passed: true, outcomes: names.python.map(test => ({ test, outcome: 'passed' })),
      owner: { testsRun: 90, passed: true, outcomes: names.node.map(test => ({ test, outcome: 'passed' })) }, cancellationMs: 100 },
    cleanup: { closed: true, liveChildren: 0, liveGroups: 0 } };
}
const ok = (stdout = '') => ({ code: 0, signal: null, stdout, stderr: '', failure: null });
function dockerFixture(change = () => {}) {
  const calls = [];
  let name, label, created = false, removed = false;
  const execute = async (command, args, options) => {
    assert.equal(command, 'docker');
    assert.ok(options.timeoutMs > 0 && options.timeoutMs <= 362000);
    calls.push(args);
    let result;
    if (args[0] === 'image') result = ok(image + '\n');
    else if (args[0] === 'create') {
      name = args[args.indexOf('--name') + 1]; label = args[args.indexOf('--label') + 1]; created = true;
      assert.equal(args[args.indexOf('--network') + 1], 'none');
      assert.deepEqual(args.filter((v, i) => args[i - 1] === '-e'), ['VRDEX_PROOF_INNER=twitch']);
      assert.ok(args.includes(image));
      assert.ok(args.includes('--kill-after=1s'));
      assert.ok(args.includes('360s'));
      assert.match(args.at(-1), /--case all --output-dir \/tmp\/event-capacity-ci-native/);
      result = ok(id + '\n');
    } else if (args[0] === 'start') result = { ...ok(JSON.stringify(receipt())), stderr: 'v22.23.4\nPython 3.11.2\nffmpeg version 5.1.9 Copyright\n' };
    else if (args[0] === 'inspect') result = ok(JSON.stringify([{ Id: id, Name: '/' + name, Image: image,
      Config: { Labels: { [label.split('=')[0]]: label.split('=')[1] } },
      State: { Status: 'exited', Running: false, Pid: 0, ExitCode: 0, OOMKilled: false, Error: '' } }]));
    else if (args[0] === 'rm') { removed = true; result = ok(id); }
    else if (args[0] === 'container') result = ok(created && !removed ? id + '\n' : '');
    else assert.fail(`Unexpected Docker operation: ${args}`);
    return change(args, result) ?? result;
  };
  return { execute, calls };
}

test('strict receipt verifier accepts the complete independently pinned 42 plus 90 names', () => {
  assert.equal(typeof validateReceipt, 'function', 'native receipt verifier must exist');
  assert.deepEqual(validateReceipt(JSON.stringify(receipt()), names), { python: 42, node: 90 });
});

test('strict receipt rejects missing, duplicate, extra, failed, skipped and todo identities', () => {
  assert.equal(typeof validateReceipt, 'function');
  for (const group of ['python', 'node']) {
    for (const mutate of [r => r.pop(), r => r.push(r[0]), r => { r[1] = r[0]; },
      r => { r[0].test = 'unexpected'; }, ...['failed', 'skipped', 'todo', 'error', 'expected_failure'].map(value => r => { r[0].outcome = value; })]) {
      const value = receipt(); mutate(group === 'python' ? value.tests.outcomes : value.tests.owner.outcomes);
      assert.throws(() => validateReceipt(JSON.stringify(value), names));
    }
  }
});

test('strict receipt rejects forged types, failure fields, unclosed cleanup and invalid cancellation', () => {
  assert.equal(typeof validateReceipt, 'function');
  for (const mutate of [r => { r.passed = 'true'; }, r => { r.terminal = false; }, r => { r.schemaVersion = '1'; },
    r => { r.case = 'input'; }, r => { r.deterministic = 1; }, r => { r.tests.testsRun = '42'; },
    r => { r.tests.owner.testsRun = 89; }, r => { r.tests.passed = false; }, r => { r.tests.owner.passed = false; },
    r => { r.failurePhase = null; }, r => { r.failureCode = ''; }, r => { r.cleanup.closed = false; },
    r => { r.cleanup.liveChildren = 1; }, r => { r.cleanup.liveGroups = '0'; },
    ...[-1, 1501, null, '100'].map(value => r => { r.tests.cancellationMs = value; })]) {
    const value = receipt(); mutate(value); assert.throws(() => validateReceipt(JSON.stringify(value), names));
  }
  for (const raw of ['', '{', JSON.stringify(receipt()) + '{}', ' '.repeat(131073)]) assert.throws(() => validateReceipt(raw, names));
});

test('gate requires native exit, independent stopped identity, strict receipt and removal before passing', async () => {
  assert.equal(typeof runGate, 'function');
  const fake = dockerFixture();
  const result = await runGate({ execute: fake.execute, names });
  assert.equal(result.passed, true);
  assert.equal(result.nativeExit, 0);
  assert.equal(result.cleanup, true);
  assert.deepEqual(result.counts, { python: 42, node: 90 });
  assert.equal(result.image, image);
  assert.ok(fake.calls.some(args => args[0] === 'rm' && args.at(-1) === id));
  assert.equal(fake.calls.at(-1)[0], 'container');
});

test('native nonzero or timeout cannot be masked by a passing receipt or successful cleanup', async () => {
  assert.equal(typeof runGate, 'function');
  for (const patch of [{ code: 1 }, { code: 124 }, { code: null, signal: 'SIGKILL' }, { failure: 'deadline' }]) {
    const fake = dockerFixture((args, result) => args[0] === 'start' ? { ...result, ...patch } : result);
    const result = await runGate({ execute: fake.execute, names });
    assert.equal(result.passed, false); assert.equal(result.nativeExit, patch.code === undefined ? 0 : patch.code);
    assert.equal(result.cleanup, true);
  }
});

test('invalid independent identity, stopped state, OOM or runtime error fails after native exit zero', async () => {
  assert.equal(typeof runGate, 'function');
  for (const mutate of [r => { r.Id = 'c'.repeat(64); }, r => { r.Image = 'other'; }, r => { r.State.Running = true; },
    r => { r.State.Pid = 7; }, r => { r.State.ExitCode = 1; }, r => { r.State.OOMKilled = true; },
    r => { r.State.Error = 'error'; }, r => { r.State.Status = 'dead'; }]) {
    const fake = dockerFixture((args, result) => {
      if (args[0] !== 'inspect') return result;
      const rows = JSON.parse(result.stdout); mutate(rows[0]); return { ...result, stdout: JSON.stringify(rows) };
    });
    assert.equal((await runGate({ execute: fake.execute, names })).passed, false);
  }
});

test('cleanup removal, absence readback and ambiguous create failures cannot pass', async () => {
  assert.equal(typeof runGate, 'function');
  for (const operation of ['rm', 'container', 'create']) {
    const fake = dockerFixture((args, result) => args[0] === operation ? { ...result, code: 1, failure: 'deadline' } : result);
    const result = await runGate({ execute: fake.execute, names });
    assert.equal(result.passed, false);
    if (operation === 'create') assert.ok(fake.calls.some(args => args[0] === 'rm'), 'recover the owned identity after uncertain create');
    else assert.equal(result.cleanup, false);
  }
  const fake = dockerFixture((args, result) => args[0] === 'container' ? ok(id) : result);
  assert.equal((await runGate({ execute: fake.execute, names })).passed, false);
});

test('aborted or exhausted outer budget still attempts bounded owned cleanup and fails', async () => {
  assert.equal(typeof runGate, 'function');
  const controller = new AbortController();
  const fake = dockerFixture((args, result) => { if (args[0] === 'create') controller.abort(); return result; });
  const result = await runGate({ execute: fake.execute, names, signal: controller.signal });
  assert.equal(result.passed, false); assert.equal(result.cleanup, true);
  assert.ok(!fake.calls.some(args => args[0] === 'start'));
  let time = 0;
  const late = dockerFixture((args, result) => { if (args[0] === 'create') time = 390000; return result; });
  assert.equal((await runGate({ execute: late.execute, names, now: () => time })).passed, false);
});

test('bounded process runner caps combined output and escalates TERM to KILL on deadline', async () => {
  assert.equal(typeof boundedCommand, 'function');
  for (const overflow of [false, true]) {
    const child = new EventEmitter(); child.pid = 123; child.stdout = new PassThrough(); child.stderr = new PassThrough();
    const signals = [];
    const pending = boundedCommand('fake', [], { timeoutMs: 10, graceMs: 5, spawnProcess: () => child,
      killGroup: (_pid, signal) => { signals.push(signal); if (signal === 'SIGKILL') child.emit('close', null, signal); } });
    if (overflow) { child.stdout.write(Buffer.alloc(70000)); child.stderr.write(Buffer.alloc(70000)); }
    const result = await pending;
    assert.equal(result.failure, overflow ? 'output_limit' : 'deadline');
    assert.deepEqual(signals, ['SIGTERM', 'SIGKILL']);
    assert.ok(Buffer.byteLength(result.stdout) + Buffer.byteLength(result.stderr) <= 131072);
    assert.equal(result.signal, 'SIGKILL');
  }
});

test('successful native exit still rejects malformed receipts and missing runtime versions', async () => {
  for (const patch of [{ stdout: '' }, { stdout: '{}' }, { stdout: JSON.stringify(receipt()) + '{}' },
    { stdout: ' '.repeat(131073) }, { stderr: '' }, { stdout: JSON.stringify({ ...receipt(), passed: false }) }]) {
    const fake = dockerFixture((args, result) => args[0] === 'start' ? { ...result, ...patch } : result);
    const result = await runGate({ execute: fake.execute, names });
    assert.equal(result.passed, false); assert.equal(result.nativeExit, 0); assert.equal(result.cleanup, true);
  }
});

test('image, ambiguous create and inspection errors never imply absence or permit a passing gate', async () => {
  for (const operation of ['image', 'create', 'inspect']) {
    for (const patch of [{ code: 7 }, { stdout: 'malformed' }, { failure: 'output_limit' }]) {
      const fake = dockerFixture((args, result) => args[0] === operation ? { ...result, ...patch } : result);
      assert.equal((await runGate({ execute: fake.execute, names })).passed, false);
    }
  }
});

test('cancellation during cleanup cannot turn successful work into a green gate', async () => {
  const controller = new AbortController();
  const fake = dockerFixture((args, result) => { if (args[0] === 'rm') controller.abort(); return result; });
  const result = await runGate({ execute: fake.execute, names, signal: controller.signal });
  assert.equal(result.cleanup, true);
  assert.equal(result.passed, false);
});

test('an empty listing after an uncertain create cannot attest cleanup closure', async () => {
  const fake = dockerFixture((args, result) => {
    if (args[0] === 'create') return { ...result, code: null, failure: 'deadline' };
    if (args[0] === 'container') return ok('');
    return result;
  });
  const result = await runGate({ execute: fake.execute, names });
  assert.equal(result.passed, false);
  assert.equal(result.cleanup, false);
});

test('bounded process runner handles abort, spawn errors and a missing close without hanging', async () => {
  for (const mode of ['abort', 'spawn', 'no-close', 'leader-close']) {
    const child = new EventEmitter(); child.pid = 123; child.stdout = new PassThrough(); child.stderr = new PassThrough();
    const signals = [], controller = new AbortController();
    const pending = boundedCommand('fake', [], { timeoutMs: 10, graceMs: 5, signal: controller.signal,
      spawnProcess: () => child, killGroup: (_pid, signal) => {
        signals.push(signal);
        if (mode === 'leader-close' && signal === 'SIGTERM') child.emit('close', 0, null);
      } });
    if (mode === 'abort') controller.abort();
    if (mode === 'spawn') child.emit('error', new Error('spawn failed'));
    const result = await pending;
    assert.equal(result.failure, mode === 'abort' ? 'cancelled' : mode === 'spawn' ? 'spawn' : 'deadline');
    if (mode !== 'spawn') assert.deepEqual(signals, ['SIGTERM', 'SIGKILL']);
  }
});

function failedReceipt() {
  const value = receipt();
  value.passed = false;
  value.failurePhase = 'owner_contracts';
  value.failureCode = 'transport_contract_failed';
  value.tests.owner.passed = false;
  value.tests.owner.outcomes[0].outcome = 'failed';
  return value;
}

test('failed native receipt retains only pinned diagnostic fields while exit and cleanup stay negative', async () => {
  const value = failedReceipt();
  const sentinel = 'RAW_SENTINEL_secret_path_url_stack';
  value.message = sentinel;
  value.tests.owner.outcomes[0].type = sentinel;
  value.tests.owner.outcomes[0].error = { stack: sentinel };
  const fake = dockerFixture((args, result) => args[0] === 'start'
    ? { ...result, code: 1, stdout: JSON.stringify(value), stderr: result.stderr + sentinel } : result);
  const result = await runGate({ execute: fake.execute, names });
  assert.deepEqual(result.negativeDiagnostic, { receipt: 'complete', failurePhase: 'owner_contracts',
    failureCode: 'transport_contract_failed', failed: [{ suite: 'owner', name: names.node[0], outcome: 'failed' }] });
  assert.equal(result.nativeExit, 1); assert.equal(result.nativeSignal, null);
  assert.equal(result.counts, null); assert.equal(result.cleanup, true); assert.equal(result.passed, false);
  assert.doesNotMatch(JSON.stringify(result), /RAW_SENTINEL/);
});

test('negative receipt rejects malformed, unknown, duplicate, missing and oversized sources without partial diagnostics', async () => {
  const sentinel = 'RAW_SENTINEL';
  const malformed = ['', '{', JSON.stringify(failedReceipt()).slice(0, -1),
    sentinel + JSON.stringify(failedReceipt()), JSON.stringify(failedReceipt()) + '{}', ' '.repeat(131073)];
  const mutations = [r => { r.tests.owner.outcomes[0].test = sentinel; },
    r => { r.failurePhase = sentinel; }, r => { r.failureCode = sentinel; },
    r => { r.tests.owner.outcomes[1] = r.tests.owner.outcomes[0]; },
    r => { r.tests.owner.outcomes[0].outcome = sentinel; },
    r => { delete r.tests; }, r => { delete r.tests.owner.outcomes; },
    r => { r.tests.owner.outcomes.pop(); }, r => { r.tests.owner.testsRun = 91; },
    r => { r.tests.owner.outcomes.push(r.tests.owner.outcomes[0]); },
    r => { r.tests.owner.passed = 'false'; }, r => { r.tests.owner = null; },
    r => { r.tests.outcomes[0].test = sentinel; }, r => { r.tests.testsRun = 43; },
    ...[ ['schemaVersion', '1'], ['terminal', false], ['case', 'owner'], ['deterministic', 1], ['passed', true] ]
      .map(([key, value]) => r => { r[key] = value; })];
  const sources = [...malformed, ...mutations.map(mutate => { const value = failedReceipt(); mutate(value); return JSON.stringify(value); })];
  for (const stdout of sources) {
    const fake = dockerFixture((args, result) => args[0] === 'start' ? { ...result, code: 1, stdout } : result);
    const result = await runGate({ execute: fake.execute, names });
    assert.deepEqual(result.negativeDiagnostic, { receipt: 'unavailable' });
    assert.equal(result.passed, false); assert.equal(result.nativeExit, 1);
    assert.equal(result.counts, null); assert.equal(result.cleanup, true);
    assert.doesNotMatch(JSON.stringify(result), /RAW_SENTINEL/);
  }
});

test('negative diagnostics require exit one without runner failure and a failed complete receipt', async () => {
  for (const patch of [{ failure: 'output_limit' }, { failure: 'deadline' }, { failure: 'cancelled' },
    { failure: 'spawn' }, { failure: 'process_cleanup' }, { signal: 'SIGTERM' }, { code: 124 },
    { code: null }, { stderr: 'x'.repeat(131072) }, { stdout: JSON.stringify(receipt()) }]) {
    const fake = dockerFixture((args, result) => args[0] === 'start'
      ? { ...result, code: 1, stdout: JSON.stringify(failedReceipt()), ...patch } : result);
    const result = await runGate({ execute: fake.execute, names });
    assert.deepEqual(result.negativeDiagnostic, { receipt: 'unavailable' });
    assert.equal(result.passed, false); assert.equal(result.counts, null); assert.equal(result.cleanup, true);
  }
});

test('negative projection bounds all 132 pinned identities and keeps each reviewed nonpassed outcome', async () => {
  const value = failedReceipt();
  const outcomes = ['failed', 'error', 'skipped', 'expected_failure', 'unexpected_success', 'todo'];
  value.tests.passed = false;
  for (const summary of [value.tests, value.tests.owner]) {
    summary.outcomes.forEach((row, index) => { row.outcome = outcomes[index % outcomes.length]; });
  }
  for (const phase of ['python_contracts', 'owner_contracts', 'blocked_resolution_cancellation', 'cleanup']) {
    value.failurePhase = phase;
    const fake = dockerFixture((args, result) => args[0] === 'start'
      ? { ...result, code: 1, stdout: JSON.stringify(value) } : result);
    const result = await runGate({ execute: fake.execute, names });
    assert.equal(result.negativeDiagnostic.receipt, 'complete');
    assert.equal(result.negativeDiagnostic.failurePhase, phase);
    assert.equal(result.negativeDiagnostic.failed.length, 132);
    assert.ok(Buffer.byteLength(JSON.stringify(result.negativeDiagnostic)) <= 32768);
    assert.deepEqual(result.negativeDiagnostic.failed[0], { suite: 'python', name: names.python[0], outcome: 'failed' });
    assert.deepEqual(result.negativeDiagnostic.failed[42], { suite: 'owner', name: names.node[0], outcome: 'failed' });
    assert.equal(result.passed, false); assert.equal(result.counts, null);
  }
});


test('early failed Python receipts project only present complete summaries', async () => {
  const value = failedReceipt();
  value.failurePhase = 'python_contracts';
  delete value.tests.owner;
  value.tests.testsRun = 1;
  value.tests.passed = false;
  value.tests.outcomes = [{ test: names.python[0], outcome: 'error' }];
  const fake = dockerFixture((args, result) => args[0] === 'start'
    ? { ...result, code: 1, stdout: JSON.stringify(value) } : result);
  const result = await runGate({ execute: fake.execute, names });
  assert.deepEqual(result.negativeDiagnostic, { receipt: 'complete', failurePhase: 'python_contracts',
    failureCode: 'transport_contract_failed', failed: [{ suite: 'python', name: names.python[0], outcome: 'error' }] });
  assert.equal(result.counts, null); assert.equal(result.passed, false);
});

test('negative projection rejects its own byte overflow without returning a partial list', async () => {
  const value = failedReceipt();
  const longNames = { python: names.python.map(name => name + 'x'.repeat(300)), node: names.node.map(name => name + 'x'.repeat(300)) };
  for (const [summary, expected] of [[value.tests, longNames.python], [value.tests.owner, longNames.node]]) {
    summary.passed = false;
    summary.outcomes = expected.map(test => ({ test, outcome: 'failed' }));
  }
  assert.ok(Buffer.byteLength(JSON.stringify(value)) < 131072);
  const fake = dockerFixture((args, result) => args[0] === 'start'
    ? { ...result, code: 1, stdout: JSON.stringify(value) } : result);
  const result = await runGate({ execute: fake.execute, names: longNames });
  assert.deepEqual(result.negativeDiagnostic, { receipt: 'unavailable' });
  assert.equal(result.counts, null); assert.equal(result.cleanup, true); assert.equal(result.passed, false);
});
