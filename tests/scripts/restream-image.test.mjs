import test from 'node:test';
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { spawnSync } from 'node:child_process';
import { mkdir, mkdtemp, readFile, readdir, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { parse } from 'yaml';

const sha = 'a'.repeat(40), digest = `sha256:${'b'.repeat(64)}`;
const repository = '079358094174.dkr.ecr.us-east-1.amazonaws.com/vrdex-restream-worker';
const files = JSON.parse(await readFile('workers/restream/packaging-manifest.json', 'utf8'));

// Only Docker and AWS are faked. Bash, jq, file-type checks and sha256sum run on
// the host, against real files copied from the requested-source fixture.
const fakeCli = String.raw`
import { appendFileSync, lstatSync, readdirSync, rmSync, writeFileSync } from 'node:fs';
import { spawnSync } from 'node:child_process';
import { join } from 'node:path';
const [tool, ...args] = process.argv.slice(2), env = process.env;
appendFileSync(join(env.FIXTURE, 'calls.jsonl'), JSON.stringify([tool, ...args]) + '\n');
const option = name => args[args.indexOf(name) + 1];
const finish = value => { if (value !== undefined) process.stdout.write(value + '\n'); process.exit(0); };
if (tool === 'aws' && args[0] === 'ecr') {
  if (args[1] === 'get-login-password') finish('fake-password');
  if (args[1] === 'describe-images') {
    if (option('--output') === 'text') finish(env.POST_DIGEST || env.DIGEST);
    const images = env.MODE === 'fresh' ? [] : [{ tags: ['proof-' + env.RELEASE_SHA], digest: env.DIGEST }];
    if (env.MODE === 'duplicate') images.push(images[0]);
    finish(JSON.stringify(images));
  }
}
if (tool === 'docker') {
  if (['login', 'build', 'pull', 'push'].includes(args[0])) finish();
  if (args[0] === 'image' && args[1] === 'inspect') finish(env.LABEL || env.RELEASE_SHA);
  if (args[0] === 'create') { writeFileSync(join(env.FIXTURE, 'container'), 'stopped'); finish('fixture-container'); }
  if (args[0] === 'rm') {
    if (args.length !== 2 || args[1] !== 'fixture-container') throw Error('cleanup must remove only its own container');
    const snapshot = [];
    const walk = (directory, prefix = '') => {
      for (const name of readdirSync(directory)) {
        const path = join(directory, name), stat = lstatSync(path), relative = join(prefix, name);
        snapshot.push({ path: relative, size: stat.size, file: stat.isFile() });
        if (stat.isDirectory()) walk(path, relative);
      }
    };
    walk(join(env.FIXTURE, 'temporary'));
    writeFileSync(join(env.FIXTURE, 'temporary-snapshot.json'), JSON.stringify(snapshot));
    if (env.DOCKER_RM_FAILURE === 'true') process.exit(17);
    rmSync(join(env.FIXTURE, 'container'), { force: true }); finish();
  }
  if (args[0] === 'run') {
    if (env.RUN_FAILURE === 'true') process.exit(9);
    finish();
  }
}
if (tool === 'rm') {
  if (env.TEMP_RM_FAILURE === 'true') process.exit(19);
  process.exit(spawnSync('/usr/bin/rm', args, { stdio: 'inherit' }).status ?? 1);
}
throw Error('Unexpected CLI invocation: ' + JSON.stringify([tool, ...args]));
`;

const archiveFixture = String.raw`
import io, json, os, pathlib, sys, tarfile
_, requested_source, target = sys.argv[1:]
fixture = pathlib.Path(os.environ['FIXTURE'])
with (fixture / 'calls.jsonl').open('a') as calls:
    calls.write(json.dumps(['docker', *sys.argv[1:]], separators=(',', ':')) + '\n')
source_name = requested_source.split(':/app/')[1] if ':/app/' in requested_source else ''
if not source_name or not (fixture / 'container').exists():
    raise RuntimeError('invalid stopped-container copy')
if target != '-':
    raise RuntimeError('copy fixture expects a tar stream')
source = fixture / 'image' / source_name
kind = os.environ['BAD_KIND'] if os.environ['BAD_FILE'] == source_name else ''
if kind == 'copy-failure':
    sys.exit(7)
with tarfile.open(fileobj=sys.stdout.buffer, mode='w|', format=tarfile.USTAR_FORMAT) as archive:
    if kind in ('directory', 'aggregate'):
        entry = tarfile.TarInfo(source.name)
        entry.type = tarfile.DIRTYPE
        archive.addfile(entry)
        for index in range(110 if kind == 'aggregate' else 1):
            content = bytes(131072)
            entry = tarfile.TarInfo(source.name + '/nested-' + str(index))
            entry.size = len(content)
            archive.addfile(entry, io.BytesIO(content))
    elif kind == 'symlink':
        entry = tarfile.TarInfo(source.name)
        entry.type, entry.linkname = tarfile.SYMTYPE, '/outside-canary'
        archive.addfile(entry)
    elif kind == 'oversize':
        content = source.read_bytes() + b'x'
        entry = tarfile.TarInfo(source.name)
        entry.size = len(content)
        archive.addfile(entry, io.BytesIO(content))
    else:
        archive.add(source, arcname='../outside-canary' if kind == 'wrong-path' else source.name, recursive=False)
        if kind == 'multiple':
            archive.add(source, arcname='extra-canary', recursive=False)
`;

async function publish(options = {}) {
  const directory = await mkdtemp(join(tmpdir(), 'restream-image-test-'));
  try {
    for (const subdirectory of ['bin', 'image', 'provenance', 'temporary']) await mkdir(join(directory, subdirectory));
    const expected = [];
    for (const file of files) {
      const content = await readFile(file);
      expected.push(`${createHash('sha256').update(content).digest('hex')}  ${file}`);
      for (const prefix of ['', 'image/']) {
        await mkdir(dirname(join(directory, prefix, file)), { recursive: true });
        const value = Buffer.from(content);
        if (options.badFile === file && prefix && options.badKind === 'hash') value[0] ^= 1;
        await writeFile(join(directory, prefix, file), value);
      }
    }
    await writeFile(join(directory, 'provenance/source-sha.txt'), `${sha}\n`);
    await writeFile(join(directory, 'fake-cli.mjs'), fakeCli);
    await writeFile(join(directory, 'archive.py'), archiveFixture);
    for (const tool of ['docker', 'aws', 'rm']) await writeFile(join(directory, 'bin', tool), tool === 'docker'
      ? `#!/bin/sh\nif [ "$1" = cp ]; then exec python3 '${directory}/archive.py' "$@"; fi\nexec '${process.execPath}' '${directory}/fake-cli.mjs' docker "$@"\n`
      : `#!/bin/sh\nexec '${process.execPath}' '${directory}/fake-cli.mjs' ${tool} "$@"\n`, { mode: 0o755 });
    const workflow = parse(await readFile('.github/workflows/restream-image.yml', 'utf8'));
    const step = workflow.jobs.image.steps.find(value => value.name === 'Build and publish immutable image');
    const result = spawnSync('bash', ['-c', step.run], {
      cwd: directory, encoding: 'utf8', timeout: 30000,
      env: { ...process.env, PATH: `${directory}/bin:${process.env.PATH}`, TMPDIR: join(directory, 'temporary'), FIXTURE: directory,
        AWS_REGION: 'us-east-1', ECR_REPOSITORY: 'vrdex-restream-worker', REPOSITORY_URI: repository,
        RELEASE_SHA: sha, IMAGE_TAG: `proof-${sha}`, DIGEST: options.digest ?? digest, POST_DIGEST: options.postDigest ?? '',
        MODE: options.mode ?? 'existing', LABEL: options.label ?? '', BAD_FILE: options.badFile ?? '', BAD_KIND: options.badKind ?? '', RUN_FAILURE: String(options.runFailure ?? false), DOCKER_RM_FAILURE: String(options.dockerRmFailure ?? false), TEMP_RM_FAILURE: String(options.tempRmFailure ?? false) },
    });
    assert.equal(result.error, undefined);
    const calls = (await readFile(join(directory, 'calls.jsonl'), 'utf8')).trim().split('\n').map(line => JSON.parse(line));
    const provenance = {};
    for (const file of await readdir(join(directory, 'provenance'))) provenance[file] = await readFile(join(directory, 'provenance', file), 'utf8');
    assert.equal((await readdir(directory)).includes('container'), options.dockerRmFailure ?? false, 'stopped container removal state');
    const temporary = await readdir(join(directory, 'temporary'));
    if (!options.tempRmFailure) assert.deepEqual(temporary, [], 'host extraction directory must be removed');
    const snapshot = (await readdir(directory)).includes('temporary-snapshot.json') ? JSON.parse(await readFile(join(directory, 'temporary-snapshot.json'), 'utf8')) : [];
    return { ...result, calls, provenance, snapshot, temporary, expected: `${expected.join('\n')}\n` };
  } finally {
    await rm(directory, { recursive: true, force: true });
  }
}

const dockerCalls = result => result.calls.filter(call => call[0] === 'docker');
function assertNoPublication(result) {
  assert.ok(!dockerCalls(result).some(call => ['push', 'tag', 'start', 'exec'].includes(call[1])));
}

test('immutable tag recovery regenerates provenance without a previous artifact or push', async () => {
  const result = await publish();
  assert.equal(result.status, 0, result.stderr + result.stdout);
  assertNoPublication(result);
  const calls = dockerCalls(result);
  assert.deepEqual(calls.find(call => call[1] === 'pull'), ['docker', 'pull', '--platform', 'linux/amd64', `${repository}@${digest}`]);
  assert.ok(!calls.some(call => call[1] === 'build'));
  assert.equal(calls.filter(call => call[1] === 'cp').length, files.length);
  assert.ok(calls.findIndex(call => call[1] === 'run') > calls.findLastIndex(call => call[1] === 'cp'));
  for (const call of calls.filter(call => ['create', 'run'].includes(call[1]))) assert.ok(call.includes(`${repository}@${digest}`));
  assert.equal(result.provenance['actual-runtime.sha256'], result.expected);
  assert.equal(result.provenance['expected-runtime.sha256'], result.expected);
  assert.equal(result.provenance['image-source-label.txt'], `${sha}\n`);
  assert.equal(result.provenance['image-uri.txt'], `${repository}@${digest}\n`);
  assert.equal(result.provenance['image-reused.txt'], 'true\n');
  assert.equal(result.provenance['source-sha.txt'], `${sha}\n`);
});

test('every packaged source mismatch blocks recovery before image execution', async () => {
  for (const badFile of files) {
    const result = await publish({ badFile, badKind: 'hash' });
    assert.notEqual(result.status, 0, badFile);
    assert.equal(dockerCalls(result).filter(call => call[1] === 'cp').length, files.length, badFile);
    assertNoPublication(result);
    assert.ok(!dockerCalls(result).some(call => call[1] === 'run'), badFile);
    assert.equal(result.provenance['image-uri.txt'], undefined);
  }
});

test('recovery rejects source labels, duplicate or malformed digests before image execution', async () => {
  for (const options of [{ label: 'c'.repeat(40) }, { label: `${sha}\n` }, { mode: 'duplicate' }, { digest: 'None' }, { digest: '' }]) {
    const result = await publish(options);
    assert.notEqual(result.status, 0);
    assertNoPublication(result);
    assert.ok(!dockerCalls(result).some(call => call[1] === 'run'));
    assert.equal(result.provenance['image-uri.txt'], undefined);
  }
});

test('nonregular copied sources and copy failures fail closed and clean up', async () => {
  for (const badKind of ['symlink', 'directory', 'copy-failure']) {
    const result = await publish({ badFile: files.at(-1), badKind });
    assert.notEqual(result.status, 0);
    assertNoPublication(result);
    assert.ok(dockerCalls(result).some(call => call[1] === 'cp' && call[2].endsWith(files.at(-1))));
    assert.ok(dockerCalls(result).some(call => call[1] === 'rm'));
    assert.ok(!dockerCalls(result).some(call => call[1] === 'run'));
  }
});

test('fresh publication verifies all host sources and runtime before pushing and records actual digest', async () => {
  const result = await publish({ mode: 'fresh' });
  assert.equal(result.status, 0, result.stderr + result.stdout);
  const calls = dockerCalls(result);
  assert.ok(calls.some(call => call[1] === 'build'));
  assert.ok(!calls.some(call => call[1] === 'pull'));
  assert.equal(calls.filter(call => call[1] === 'cp').length, files.length);
  assert.ok(calls.findIndex(call => call[1] === 'run') > calls.findLastIndex(call => call[1] === 'cp'));
  assert.ok(calls.findIndex(call => call[1] === 'push') > calls.findLastIndex(call => call[1] === 'run'));
  assert.equal(calls.filter(call => call[1] === 'push').length, 1);
  assert.equal(result.provenance['actual-runtime.sha256'], result.expected);
  assert.equal(result.provenance['image-reused.txt'], 'false\n');
  assert.equal(result.provenance['image-uri.txt'], `${repository}@${digest}\n`);
});

test('fresh verification failure prevents push and invalid post-push digest prevents provenance', async () => {
  for (const options of [{ badFile: files[0], badKind: 'hash' }, { label: 'c'.repeat(40) }, { runFailure: true }]) {
    const result = await publish({ mode: 'fresh', ...options });
    assert.notEqual(result.status, 0);
    assertNoPublication(result);
  }
  const result = await publish({ mode: 'fresh', postDigest: 'None' });
  assert.notEqual(result.status, 0);
  assert.equal(result.provenance['image-uri.txt'], undefined);
});


test('copy archives are bounded before extraction and accept only one expected regular file', async () => {
  for (const badKind of ['directory', 'aggregate', 'multiple', 'oversize', 'wrong-path']) {
    const result = await publish({ badFile: files.at(-1), badKind });
    assert.notEqual(result.status, 0, badKind);
    assertNoPublication(result);
    assert.ok(!dockerCalls(result).some(call => call[1] === 'run'), badKind);
    const copies = dockerCalls(result).filter(call => call[1] === 'cp');
    assert.ok(copies.every(call => call[3] === '-'), 'copy must stream a tar archive instead of recursively extracting to disk');
    assert.ok(!result.snapshot.some(entry => /nested-|extra-canary|outside-canary/.test(entry.path)), badKind);
    assert.ok(result.snapshot.filter(entry => entry.path.endsWith('.tar')).every(entry => entry.size <= 10 * 1024 * 1024), badKind);
    if (badKind === 'aggregate') assert.ok(result.snapshot.some(entry => entry.path.endsWith('.tar') && entry.size === 10 * 1024 * 1024), 'aggregate archive limit must be exercised');
  }
});

test('cleanup failures fail the workflow and still attempt both removals', async () => {
  for (const options of [{ dockerRmFailure: true }, { tempRmFailure: true }]) {
    const result = await publish(options);
    assert.equal(result.status, options.dockerRmFailure ? 17 : 19);
    assertNoPublication(result);
    assert.ok(dockerCalls(result).some(call => call[1] === 'rm'));
    assert.ok(result.calls.some(call => call[0] === 'rm'), 'temporary cleanup must run after container removal failure');
  }
  const result = await publish({ runFailure: true, dockerRmFailure: true, tempRmFailure: true });
  assert.equal(result.status, 9, 'cleanup must preserve the original failure');
  assert.ok(result.calls.some(call => call[0] === 'rm'));
});
