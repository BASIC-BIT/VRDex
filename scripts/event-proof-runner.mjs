import { spawn, execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { mkdtemp, readFile, writeFile, lstat } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { pathToFileURL } from 'node:url';
import { verifyProgramPackets } from './event-proof-metrics.mjs';

export const ARTIFACT_ROOT = 's3://vrdex-restream-worker-079358094174-artifacts/synthetic-benchmarks';
export function proofStart(runId, mode) {
    if (!/^[a-zA-Z0-9][a-zA-Z0-9_-]{0,95}$/.test(runId ?? '') || !['synthetic', 'vrcdn-rehearsal'].includes(mode)) throw Error('Invalid proof start');
    console.log(JSON.stringify({ event: 'proof-start', runId, mode, startedAt: new Date().toISOString() }));
}
const ARTIFACTS = ['primary.ts', 'optional-before.ts', 'optional-after.ts', 'program.ts', 'result.json', 'samples.ndjson', 'rehearsal.json'];
/** Strings and arbitrary property names never cross the diagnostic boundary. */
export function numericDiagnostics(value, depth = 0) {
    if (depth > 8) return undefined;
    if (typeof value === 'boolean') return value;
    if (typeof value === 'number') return Number.isFinite(value) ? value : undefined;
    if (Array.isArray(value)) return value.slice(0, 2048).map(item => numericDiagnostics(item, depth + 1)).filter(item => item !== undefined);
    if (!value || typeof value !== 'object') return undefined;
    return Object.fromEntries(Object.entries(value).slice(0, 256).filter(([key]) => /^[a-zA-Z][a-zA-Z0-9_]{0,63}$/.test(key) && !/secret|credential|token|password|url|error|message|diagnostic/i.test(key)).map(([key, item]) => [key, numericDiagnostics(item, depth + 1)]).filter(([, item]) => item !== undefined));
}
export function syntheticEnvironment(env, directoryPrefix) {
    const result = { PROOF_SECONDS: '120', PROOF_DIRECTORY_PREFIX: directoryPrefix };
    for (const key of ['PATH', 'LANG', 'NODE_ENV']) if (env[key]) result[key] = env[key];
    return result;
}
/** Ignore payloads. Count bytes only, and terminate a detached process group. */
export function runBounded({ command, args, env, timeoutMs = 180000, signal, spawnProcess = spawn, killGroup = (pid, value) => process.kill(pid, value) }) {
    return new Promise(resolveResult => {
        let child, deadline, escalation, completed = false, forcedCode, stdoutBytes = 0, stderrBytes = 0, markerTail = '';
        const diagnostics = {};
        const kill = value => { if (child?.pid) { try { killGroup(-child.pid, value); } catch { /* Already exited. */ } } };
        const finish = (code, childSignal) => {
            if (completed) return;
            completed = true;
            clearTimeout(deadline); clearTimeout(escalation); signal?.removeEventListener('abort', abort);
            // A child can exit while its FFmpeg descendants remain alive.
            kill('SIGKILL');
            resolveResult({ exitCode: forcedCode ?? (Number.isInteger(code) ? code : 1), signaled: Boolean(childSignal), timedOut: forcedCode === 124, aborted: forcedCode === 130, stdoutBytes, stderrBytes, ...diagnostics });
        };
        const terminate = code => {
            if (forcedCode !== undefined || completed) return;
            forcedCode = code; kill('SIGTERM');
            escalation = setTimeout(() => { kill('SIGKILL'); finish(code); }, 5000);
        };
        const abort = () => terminate(130);
        if (signal?.aborted) { forcedCode = 130; finish(130); return; }
        try { child = spawnProcess(command, args, { env, detached: true, stdio: ['ignore', 'pipe', 'pipe'] }); }
        catch { finish(1); return; }
        child.stdout?.on('data', chunk => { stdoutBytes = Math.min(Number.MAX_SAFE_INTEGER, stdoutBytes + chunk.length); });
        child.stderr?.on('data', chunk => {
            stderrBytes = Math.min(Number.MAX_SAFE_INTEGER, stderrBytes + chunk.length);
            const markers = {
                renderClockBudgetExceeded: 'Program render clock exceeded its processing budget',
                missingAdvancingOutput: 'primary progress at',
                packetContinuityFailed: 'primary packets continuous across optional failure',
                requiredSenderRestarted: 'primary never restarted',
                optionalRecoveryFailed: 'optional recovered',
            };
            // Examine bounded pieces plus overlap, retaining at most 128 bytes.
            for (let offset = 0; offset < chunk.length; offset += 1024) {
                const text = markerTail + chunk.subarray(offset, offset + 1024).toString('utf8');
                for (const [name, marker] of Object.entries(markers)) if (text.includes(marker)) diagnostics[name] = true;
                markerTail = text.slice(-128);
            }
        });
        child.once('error', () => finish(1)); child.once('close', finish);
        signal?.addEventListener('abort', abort, { once: true });
        deadline = setTimeout(() => terminate(124), timeoutMs);
    });
}
async function uploadPrivate(file, target, { signal } = {}) {
    await promisify(execFile)('aws', ['s3', 'cp', file, target, '--region', 'us-east-1', '--sse', 'AES256', '--only-show-errors', '--cli-connect-timeout', '2', '--cli-read-timeout', '5'], { timeout: 12000, maxBuffer: 16384, signal });
}
/** Packet parsing runs in its own process group so a stuck ffprobe is killable. */
export async function verifyRecording(file, { signal } = {}) {
    const resultFile = `${file}.packets.json`;
    const result = await runBounded({ command: process.execPath, args: [new URL(import.meta.url).pathname, 'verify'], env: { PATH: process.env.PATH, PROOF_VERIFY_INPUT: file, PROOF_VERIFY_RESULT: resultFile }, timeoutMs: 8000, signal });
    if (result.exitCode !== 0) throw Error('Bounded packet verification failed');
    const info = await lstat(resultFile);
    if (!info.isFile() || info.size > 65536) throw Error('Invalid packet verification result');
    return JSON.parse(await readFile(resultFile, 'utf8'));
}
/** Called after media teardown. No recursive upload and no raw stdout/stderr. */
export async function finalizeArtifacts({ directory, exitCode, runId, artifactRoot = ARTIFACT_ROOT, upload = uploadPrivate, signal }) {
    if (!/^[a-zA-Z0-9][a-zA-Z0-9_-]{0,95}$/.test(runId ?? '') || artifactRoot !== ARTIFACT_ROOT) throw Error('Invalid private artifact configuration');
    const safeDirectory = await mkdtemp(join(tmpdir(), 'event-proof-safe-'));
    let uploaded = 0, uploadFailures = 0;
    for (const name of ARTIFACTS) {
        if (signal?.aborted) break;
        try {
            const file = join(directory, name), info = await lstat(file);
            if (!info.isFile() || info.isSymbolicLink() || info.size > (name.endsWith('.ts') ? 100 * 1024 * 1024 : 1024 * 1024)) continue;
            let safeFile = file;
            if (!name.endsWith('.ts')) {
                const raw = await readFile(file, 'utf8');
                const value = name.endsWith('.ndjson') ? raw.split('\n').filter(Boolean).slice(0, 2048).map(line => numericDiagnostics(JSON.parse(line))) : numericDiagnostics(JSON.parse(raw));
                safeFile = join(safeDirectory, name);
                await writeFile(safeFile, JSON.stringify(value), { mode: 0o600 });
            }
            await upload(safeFile, `${artifactRoot}/${runId}/${name}`, { signal }); uploaded++;
        } catch (error) { if (error.code !== 'ENOENT') uploadFailures++; }
    }
    const status = { exitCode: exitCode || (signal?.aborted ? 130 : uploadFailures ? 1 : 0), aborted: signal?.aborted === true, uploaded, uploadFailures };
    const statusFile = join(safeDirectory, 'status.json');
    await writeFile(statusFile, JSON.stringify(status), { mode: 0o600 });
    // Failure status is a small bounded cleanup write even after cancellation.
    // If interruption arrives during that write, supersede its earlier snapshot.
    try { await upload(statusFile, `${artifactRoot}/${runId}/status.json`); } catch { status.uploadFailures++; status.exitCode ||= 1; }
    const interruptedDuringStatus = signal?.aborted === true && !status.aborted;
    status.aborted ||= signal?.aborted === true;
    status.exitCode = exitCode || (status.aborted ? 130 : status.uploadFailures ? 1 : 0);
    await writeFile(statusFile, JSON.stringify(status), { mode: 0o600 });
    if (interruptedDuringStatus) {
        try { await upload(statusFile, `${artifactRoot}/${runId}/status.json`); } catch { status.uploadFailures++; }
    }
    return status;
}
/** Both CLIs preserve workload failure and observe interruption through upload. */
export async function finalizeProof({ directory, exitCode, env, signal, finalize = finalizeArtifacts }) {
    let status;
    try { status = await finalize({ directory, exitCode, runId: env.VRDEX_PROOF_RUN_ID, artifactRoot: env.VRDEX_RESTREAM_ARTIFACT_S3_URI, signal }); }
    catch { status = { exitCode: 1, uploadFailures: 1 }; }
    return { ...status, aborted: status.aborted === true || signal?.aborted === true, exitCode: exitCode || (signal?.aborted ? 130 : status.exitCode) };
}
export async function runSynthetic({ env = process.env, signal, run = runBounded, finalize = finalizeArtifacts } = {}) {
    if (!/^[a-zA-Z0-9][a-zA-Z0-9_-]{0,95}$/.test(env.VRDEX_PROOF_RUN_ID ?? '') || env.VRDEX_RESTREAM_ARTIFACT_S3_URI !== ARTIFACT_ROOT) throw Error('Invalid private artifact configuration');
    const directory = await mkdtemp(join(tmpdir(), 'event-synthetic-'));
    // Existing proof creates its own directory with mkdtemp; a fixed prefix lets
    // this parent find only its own workload's artifacts after process teardown.
    const prefix = join(directory, 'output-');
    proofStart(env.VRDEX_PROOF_RUN_ID, 'synthetic');
    const result = await run({ command: process.execPath, args: [resolve('scripts/event-output-local-proof.mjs')], env: syntheticEnvironment(env, prefix), signal });
    const { readdir } = await import('node:fs/promises');
    const entries = (await readdir(directory)).filter(name => name.startsWith('output-'));
    const proofDirectory = entries.length === 1 ? join(directory, entries[0]) : directory;
    await writeFile(join(proofDirectory, 'rehearsal.json'), JSON.stringify(result), { mode: 0o600 });
    return finalizeProof({ directory: proofDirectory, exitCode: result.exitCode, env, signal, finalize });
}
if (process.argv[1] && import.meta.url === pathToFileURL(resolve(process.argv[1])).href) {
    const abort = new AbortController();
    const shutdown = () => abort.abort();
    process.once('SIGTERM', shutdown); process.once('SIGINT', shutdown);
    try {
        if (process.argv.length !== 3) throw Error('Explicit proof command required');
        if (process.argv[2] === 'verify') {
            const input = process.env.PROOF_VERIFY_INPUT, output = process.env.PROOF_VERIFY_RESULT;
            if (!input?.startsWith('/tmp/event-vrcdn-rehearsal-') || !input.endsWith('/program.ts') || output !== `${input}.packets.json`) throw Error('Invalid packet verification input');
            const verified = await verifyProgramPackets(input);
            await writeFile(output, JSON.stringify(verified), { mode: 0o600 });
        } else if (process.argv[2] === 'synthetic') {
            const result = await runSynthetic({ signal: abort.signal });
            console.log(JSON.stringify(result)); process.exitCode = result.exitCode;
        } else throw Error('Explicit proof command required');
    } catch { console.error('Event proof runner failed'); process.exitCode = 1; }
    finally { process.removeListener('SIGTERM', shutdown); process.removeListener('SIGINT', shutdown); }
}
