import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { readFile, access } from 'node:fs/promises';
import test from 'node:test';

const read = path => readFile(new URL('../../' + path, import.meta.url), 'utf8');
const native = 'tests/native/event-media-timing.test.mjs';
const host = 'tests/scripts/event-media-timing.test.mjs';

test('all 46 timing cases move byte-identically and leave the full host test command intact', async () => {
  assert.equal(await access(new URL('../../' + native, import.meta.url)).then(() => true, () => false), true, 'native suite must exist');
  assert.equal(await access(new URL('../../' + host, import.meta.url)).then(() => true, () => false), false);
  assert.equal(createHash('sha256').update(await read(native)).digest('hex'), '52bd209c12e9f50b0b2dc4e213da09ee90f648d0a9c22f24fec5896d8e74806e');
  const pkg = JSON.parse(await read('package.json'));
  assert.equal(pkg.scripts['test:scripts'], 'node --import tsx --test tests/scripts/**/*.test.ts tests/scripts/*.test.mjs');
  assert.equal(pkg.scripts['verify:vrdex-mcp'], 'pnpm typecheck:vrdex-mcp && pnpm test:vrdex-mcp && pnpm test:scripts && pnpm smoke:mcp-compat && pnpm check:mcp-client-matrix');
});

test('the owner keeps all four files, 90 outcomes and its original serialization and timeouts', async () => {
  const owner = await read('workers/restream/tests/owner_proof.mjs');
  const files = [...owner.matchAll(/"(tests\/[^\"]+)"/g)].map(match => match[1]);
  assert.deepEqual(files, ['tests/backend/event-twitch-input.test.ts', 'tests/backend/event-broadcast-renderer.test.ts', native, 'tests/scripts/event-capacity-output-contracts.test.mjs']);
  assert.match(owner, /timeout: 90000/); assert.match(owner, /concurrency: 1/);
  assert.match(owner, /outcomes.length === 90/); assert.match(owner, /--experimental-strip-types/);
  const gate = await read('scripts/event-twitch-input-proof.mjs');
  assert.match(gate, /timeoutMs: 240000/); assert.match(gate, /timeoutMs: 120000/);
  assert.match(gate, /request.case === "all" \? 42/);
  const manifest = JSON.parse(await read('workers/restream/packaging-manifest.json'));
  assert.equal(manifest.includes(host), false);
  for (const file of files) assert.equal(manifest.filter(path => path === file).length, 1, file);
});

test('every PR path retains unconditional setup, build and full native gate in the existing required job', async () => {
  const workflow = await read('.github/workflows/baseline-checks.yml');
  const job = workflow.split('  restream-local-checks:\n')[1].split('\n  build-web:')[0];
  assert.match(job, /timeout-minutes: 20/);
  const steps = job.split('      - name: ').slice(1);
  const named = name => steps.find(step => step.startsWith(name + '\n'));
  for (const name of ['Setup pnpm', 'Setup Node.js', 'Check native CI contracts', 'Build hosted restream worker image', 'Run required native transport gate']) {
    const step = named(name); assert.ok(step, name);
    assert.doesNotMatch(step, /\n        if:|continue-on-error/);
  }
  const gate = named('Run required native transport gate');
  assert.match(gate, /timeout-minutes: 7/);
  assert.match(gate, /node \.github\/scripts\/restream-native.mjs/);
  assert.equal(steps.indexOf(gate), steps.indexOf(named('Build hosted restream worker image')) + 1);
  assert.match(named('Build hosted restream worker image'), /docker build -f workers\/restream\/Dockerfile -t vrdex-restream-worker:ci \./);
  assert.match(workflow.split('  build-web:')[1].split('    steps:')[0], /- restream-local-checks/);
  assert.match(workflow, /run: pnpm verify:vrdex-mcp/);
});

test('name manifest is independent F1 evidence with 132 unique identities and the original wall-rate contract', async () => {
  const names = JSON.parse(await read('.github/scripts/restream-native-names.json'));
  assert.equal(names.sourceRevision, 'f1c49529af964696d82aaf4c9e3bb5d90b69053e');
  assert.equal(names.sourceReceiptSha256, 'cd2827502ef78e9667a7e93e1513e696b3d9f475300633980397e010eb671bd0');
  assert.equal(names.python.length, 42); assert.equal(new Set(names.python).size, 42);
  assert.equal(names.node.length, 90); assert.equal(new Set(names.node).size, 90);
  assert.equal(names.node.filter(name => name === 'real buffered decoder advances source media at wall rate without a test pacing override').length, 1);
});
