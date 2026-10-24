/** Fixed Linux CI owner. Imports are inert; only explicit CLI modes run processes. */
import { spawn, spawnSync } from "node:child_process";
import { createHash, randomBytes } from "node:crypto";
import { appendFileSync, closeSync, constants, fstatSync, lstatSync, mkdirSync, mkdtempSync, openSync, readFileSync, readdirSync, readlinkSync, realpathSync, rmSync, writeFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";

export const BACKEND_VERSION = "precompiled-2026-09-28-5c7cb5b";
const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const SCRIPT = "scripts/verify-event-broadcast-migration-local.mjs";
const PRIVATE = ".migration-local-owner";
const ARTIFACT = "artifacts/event-broadcast-migration-local";
const BINDINGS = ["VRDEX_VRCDN_OUTPUT_ACCOUNTS_JSON", "VRDEX_EVENT_MEDIA_BRIDGE_TOKEN"];
const STATE = [".convex", ".convex-home", ".convex-tmp", ".env.local", "apps/web/.env.local"];
const digest = bytes => createHash("sha256").update(bytes).digest("hex");
const pause = ms => new Promise(resolve => setTimeout(resolve, ms));
const fail = () => { throw Error("Local migration boundary rejected."); };
const check = condition => { if (!condition) fail(); };
const json = file => JSON.parse(readFileSync(file, "utf8"));
const privateDir = root => path.join(root, PRIVATE);
const artifactDir = root => path.join(root, ARTIFACT);
function writeJson(file, value) { writeFileSync(file, JSON.stringify(value, null, 2) + "\n", { mode: 0o600 }); }
function present(file) { try { lstatSync(file); return true; } catch (e) { if (e.code === "ENOENT") return false; throw e; } }
function regular(file, cap) {
  const stat = lstatSync(file);
  check(stat.isFile() && !stat.isSymbolicLink() && stat.size <= cap);
  return stat;
}
function noLinks(root, relative) {
  let current = root;
  for (const part of relative.split("/")) {
    current = path.join(current, part);
    if (present(current)) check(!lstatSync(current).isSymbolicLink());
  }
}
function identity() {
  const result = spawnSync("git", ["rev-parse", "HEAD"], { cwd: ROOT, encoding: "utf8", timeout: 1000, maxBuffer: 4096 });
  check(result.status === 0 && /^[a-f0-9]{40}\n?$/.test(result.stdout));
  return { sourceSha: result.stdout.trim(), ciRun: process.env.GITHUB_RUN_ID ?? "", ciAttempt: process.env.GITHUB_RUN_ATTEMPT ?? "", prHead: process.env.MIGRATION_PR_HEAD_SHA || null };
}
export function preflightState(root, id) {
  check(/^[a-f0-9]{40}$/.test(id.sourceSha) && /^\d+$/.test(id.ciRun) && /^\d+$/.test(id.ciAttempt));
  check(!id.prHead || /^[a-f0-9]{40}$/.test(id.prHead));
  for (const entry of [...STATE, PRIVATE, ARTIFACT]) { noLinks(root, entry); check(!present(path.join(root, entry))); }
  const receipt = { schemaVersion: 1, ...id, ownerId: randomBytes(16).toString("hex"), root: realpathSync(root), backendVersion: BACKEND_VERSION };
  mkdirSync(privateDir(root), { mode: 0o700 });
  writeJson(path.join(privateDir(root), "ownership.json"), receipt);
  mkdirSync(artifactDir(root), { recursive: true, mode: 0o700 });
  writeJson(path.join(artifactDir(root), "preflight.json"), { ...receipt, root: undefined });
  return receipt;
}
export function readOwnership(root, id) {
  noLinks(root, `${PRIVATE}/ownership.json`);
  const stat = regular(path.join(privateDir(root), "ownership.json"), 4096);
  check((stat.mode & 0o077) === 0);
  const receipt = json(path.join(privateDir(root), "ownership.json"));
  check(receipt.root === realpathSync(root) && receipt.sourceSha === id.sourceSha && receipt.ciRun === id.ciRun && receipt.ciAttempt === id.ciAttempt && receipt.backendVersion === BACKEND_VERSION && /^[a-f0-9]{32}$/.test(receipt.ownerId));
  for (const entry of [...STATE, PRIVATE, ARTIFACT]) noLinks(root, entry);
  return receipt;
}
export function validateConfig(config) {
  check(config?.ports?.cloud === 3210 && config?.ports?.site === 3211 && config.backendVersion === BACKEND_VERSION && config.deploymentName === "anonymous-agent");
  check(typeof config.adminKey === "string" && config.adminKey.length > 0 && config.adminKey.length < 4096 && !/[\r\n]/.test(config.adminKey));
  return config;
}
function loadConfig() {
  noLinks(ROOT, ".convex/local/default/config.json");
  regular(path.join(ROOT, ".convex/local/default/config.json"), 16384);
  return validateConfig(json(path.join(ROOT, ".convex/local/default/config.json")));
}
export function createLogCapture(limit = 128 * 1024) {
  const streams = { stdout: { bytes: 0, hash: createHash("sha256") }, stderr: { bytes: 0, hash: createHash("sha256") } };
  let bytes = 0, overflow = false;
  return {
    add(stream, chunk) {
      bytes += chunk.length;
      if (bytes > limit) { overflow = true; return; }
      streams[stream].bytes += chunk.length;
      streams[stream].hash.update(chunk);
    },
    receipt() { return { policy: "raw output discarded; byte counts and hashes only", bytes, overflow, streams: Object.fromEntries(Object.entries(streams).map(([key, value]) => [key, { bytes: value.bytes, sha256: value.hash.copy().digest("hex") }])) }; },
  };
}
function driverPassed(receipt, input) {
  return receipt?.status === "passed" && receipt.scope === "whole-flow" && receipt.cleanup?.status === "passed" && receipt.sourceSha === input.sourceSha && receipt.backendVersion === input.backendVersion && receipt.runId === input.runId;
}
export async function executeRecovery(deps) {
  const proof = { status: "failed", fixtureCleanup: false, manifestEmpty: false, bindingsRemoved: {}, privateFileRemoved: false };
  try { await deps.recover(); proof.fixtureCleanup = true; } catch { /* Continue every cleanup boundary. */ }
  try { const rows = JSON.parse(await deps.cli(["data", "localEventBroadcastRehearsals", "--limit", "1", "--format", "json"])); proof.manifestEmpty = Array.isArray(rows) && rows.length === 0; } catch { /* retained below */ }
  for (const name of BINDINGS) {
    try { await deps.cli(["env", "remove", name]); proof.bindingsRemoved[name] = true; } catch { proof.bindingsRemoved[name] = false; }
  }
  try { deps.removePrivateFile(); proof.privateFileRemoved = true; } catch { /* retained below */ }
  if (cleanupPassed(proof)) proof.status = "passed";
  return proof;
}
function cleanupPassed(proof) {
  return proof?.fixtureCleanup && proof.manifestEmpty && BINDINGS.every(name => proof.bindingsRemoved?.[name]) && proof.privateFileRemoved;
}
/** Keep run-sh (and therefore the backend) alive until interrupted work is recovered. */
export async function supervisePhase(deadline, deps) {
  while (!deps.closed() && !deps.cancelled() && deps.now() < deadline - 65_000) await deps.pause(25);
  const interrupted = deps.cancelled() || !deps.closed();
  const workClosure = await deps.stopWork();
  const nativeResult = await deps.nativeResult();
  let phaseProof;
  try { phaseProof = deps.phaseProof(); } catch { /* Missing phase proof needs independent recovery. */ }
  let recovery;
  if (cleanupPassed(phaseProof)) recovery = { ...phaseProof, status: "passed", independent: false };
  else {
    try { recovery = { ...await deps.recover(deadline - 20_000), independent: true }; }
    catch { recovery = { status: "failed", independent: true, fixtureCleanup: false, manifestEmpty: false, bindingsRemoved: {}, privateFileRemoved: false }; }
  }
  deps.saveRecovery(recovery);
  const passed = !interrupted && !deps.cancelled() && workClosure.passed && nativeResult.code === 0 && nativeResult.close && !nativeResult.signal && !nativeResult.timedOut && !nativeResult.overflow && phaseProof?.status === "passed" && recovery.status === "passed";
  return { status: passed ? "passed" : "failed", interrupted, workClosure, nativeResult, recovery };
}
/** Dependency boundary is the real HTTP/CLI/file I/O; production driver is unchanged. */
export async function executePhase(input, deps) {
  const proof = { status: "failed", driver: false, fixtureCleanup: false, manifestEmpty: false, bindingsRemoved: {}, privateFileRemoved: false };
  try {
    const manifest = await deps.seed();
    check(typeof manifest.communityId === "string" && manifest.actor);
    deps.bindOwner(manifest.actor);
    await deps.cli(["env", "set", BINDINGS[0]], JSON.stringify([{ key: "local-rehearsal", label: "Local rehearsal", credentialRef: "local-rehearsal/output", ownerCommunityProfileId: manifest.communityId, playbackLinks: [] }]));
    await deps.cli(["env", "set", BINDINGS[1]], input.bridgeToken);
    const receipt = await deps.runDriver(input);
    deps.saveDriver(receipt);
    proof.driver = driverPassed(receipt, input);
  } catch { /* Errors may contain credentials or returned backend data. */ }
  finally {
    const recovery = await executeRecovery(deps);
    Object.assign(proof, recovery);
  }
  proof.status = "failed";
  if (proof.driver && proof.fixtureCleanup && proof.manifestEmpty && BINDINGS.every(name => proof.bindingsRemoved[name]) && proof.privateFileRemoved) proof.status = "passed";
  return proof;
}

// /proc contains identity and socket metadata; never read cmdline or environ.
function processView() {
  const result = [];
  for (const entry of readdirSync("/proc")) {
    if (!/^\d+$/.test(entry)) continue;
    try {
      const raw = readFileSync(`/proc/${entry}/stat`, "utf8");
      const fields = raw.slice(raw.lastIndexOf(")") + 2).split(" ");
      result.push({ pid: Number(entry), state: fields[0], parent: Number(fields[1]), group: Number(fields[2]), start: fields[19] });
    } catch (error) { if (!["ENOENT", "ESRCH"].includes(error.code)) throw error; }
  }
  return result;
}
function listeners() {
  const ports = new Set();
  for (const file of ["/proc/net/tcp", "/proc/net/tcp6"]) {
    for (const line of readFileSync(file, "utf8").trim().split("\n").slice(1)) {
      const fields = line.trim().split(/\s+/);
      const port = Number.parseInt(fields[1].split(":")[1], 16);
      if (fields[3] === "0A" && [3210, 3211].includes(port)) ports.add(port);
    }
  }
  return [...ports];
}
const processOps = { now: Date.now, view: processView, listeners, pause, signal: (group, signal) => { try { process.kill(-group, signal); } catch (error) { if (error.code !== "ESRCH") throw error; } } };
export async function closeOwnedGroup(owner, deadline, ops = processOps) {
  const proof = { passed: false, term: false, kill: false, remaining: [], listeners: [] };
  const members = () => {
    const rows = ops.view();
    const leader = rows.find(row => row.pid === owner.pid);
    if (leader && (leader.start !== owner.start || leader.group !== owner.group)) fail();
    return rows.filter(row => row.group === owner.group && row.state !== "Z");
  };
  try {
    check(owner.pid > 1 && owner.group === owner.pid);
    if (members().length) {
      ops.signal(owner.group, "SIGTERM"); proof.term = true;
      const termDeadline = Math.min(deadline, ops.now() + 1000);
      while (ops.now() < termDeadline && members().length) await ops.pause(Math.min(50, termDeadline - ops.now()));
    }
    if (members().length) { ops.signal(owner.group, "SIGKILL"); proof.kill = true; }
    while (ops.now() < deadline && members().length) await ops.pause(Math.min(50, deadline - ops.now()));
    proof.remaining = members().map(({ pid, start, group }) => ({ pid, start, group }));
    proof.listeners = ops.listeners();
    proof.passed = proof.remaining.length === 0 && proof.listeners.length === 0;
  } catch { /* Failed identity or observation is not closure. */ }
  return proof;
}
function cleanEnv(extra = {}) {
  // Allowlist, never propagate provider, hosted deployment, NODE_OPTIONS or user startup hooks.
  return { PATH: process.env.PATH, HOME: path.join(ROOT, ".convex-home"), CI: "true", LANG: "C.UTF-8", CONVEX_AGENT_MODE: "anonymous", CONVEX_LOCAL_BACKEND_VERSION: BACKEND_VERSION, GITHUB_RUN_ID: process.env.GITHUB_RUN_ID, GITHUB_RUN_ATTEMPT: process.env.GITHUB_RUN_ATTEMPT, MIGRATION_PR_HEAD_SHA: process.env.MIGRATION_PR_HEAD_SHA, ...extra };
}
export function runNative(command, args, { env = cleanEnv(), stdin, deadline, detached = false, capture = false, logs, holdInput = false } = {}, ops = { spawn, now: Date.now, setTimeout, clearTimeout }) {
  check(deadline > ops.now());
  const child = ops.spawn(command, args, { cwd: ROOT, env, detached, stdio: ["pipe", "pipe", "pipe"] });
  let stdout = "", size = 0, timedOut = false, overflow = false;
  const collect = (name, chunk) => {
    logs?.add(name, chunk);
    size += chunk.length;
    overflow ||= size > 128 * 1024 || Boolean(logs?.receipt().overflow);
    if (capture && name === "stdout" && !overflow) stdout += chunk.toString("utf8");
    if (overflow) child.kill("SIGKILL");
  };
  child.stdout.on("data", chunk => collect("stdout", chunk));
  child.stderr.on("data", chunk => collect("stderr", chunk));
  child.stdin.on("error", () => {});
  if (!holdInput) child.stdin.end(stdin);
  let settle, settled = false;
  const done = new Promise(resolve => { settle = resolve; });
  const finish = (code, signal, close) => {
    if (settled) return;
    settled = true;
    ops.clearTimeout(termTimer); ops.clearTimeout(killTimer);
    settle({ code, signal, close, timedOut, overflow, stdout });
  };
  // Termination and native EOF observation share the caller's original deadline.
  const termTimer = ops.setTimeout(() => { timedOut = true; child.kill("SIGTERM"); }, Math.max(0, deadline - ops.now() - 1000));
  const killTimer = ops.setTimeout(() => { timedOut = true; child.kill("SIGKILL"); finish(null, "SIGKILL", false); }, Math.max(0, deadline - ops.now()));
  child.on("error", () => {});
  child.on("close", (code, signal) => finish(code, signal, true));
  return { child, done };
}
const native = runNative;
function requireNative(result) { check(result.code === 0 && !result.signal && result.close && !result.timedOut && !result.overflow); }
function binaryFile() { return path.join(ROOT, ".convex-home", ".cache", "convex", "binaries", BACKEND_VERSION, "convex-local-backend"); }
function verifyRuntime() {
  const expected = realpathSync(binaryFile());
  const rows = processView();
  const owned = json(path.join(privateDir(ROOT), "group.json"));
  const backend = rows.filter(row => row.group === owned.group).find(row => { try { return readlinkSync(`/proc/${row.pid}/exe`) === expected; } catch { return false; } });
  check(backend);
  return { backendVersion: BACKEND_VERSION, binarySha256: digest(readFileSync(expected)), backend: { pid: backend.pid, start: backend.start, group: backend.group }, convexCliVersion: json(path.join(ROOT, "node_modules/convex/package.json")).version, nodeVersion: process.version, nodeSha256: digest(readFileSync(process.execPath)), platform: process.platform, architecture: process.arch };
}
export function requireDriverBudget(deadline, now = Date.now()) {
  // 210s unchanged driver + 5s workload closure + 40s recovery + 20s backend closure/diff.
  check(deadline - now >= 275_000);
}
async function work() {
  const authorization = await new Promise(resolve => { let value = ""; process.stdin.on("data", bytes => { value += bytes; if (value.length > 128) process.exit(1); }); process.stdin.on("end", () => resolve(value.trim())); });
  const owned = json(path.join(privateDir(ROOT), "work-group.json"));
  const self = processView().find(row => row.pid === process.pid);
  check(self && self.pid === owned.pid && self.start === owned.start && self.group === owned.group && authorization === owned.ownerId);
  const id = identity();
  const ownership = readOwnership(ROOT, id);
  const timing = json(path.join(privateDir(ROOT), "attempt.json"));
  check(timing.ownerId === ownership.ownerId && Date.now() < timing.deadline - 285_000);
  const config = loadConfig();
  const artifact = artifactDir(ROOT);
  writeJson(path.join(artifact, "runtime.json"), verifyRuntime());
  const envfile = path.join(privateDir(ROOT), "loopback.env");
  writeFileSync(envfile, `CONVEX_SELF_HOSTED_URL=http://127.0.0.1:3210\nCONVEX_SELF_HOSTED_ADMIN_KEY=${config.adminKey}\n`, { mode: 0o600, flag: "wx" });
  const bridgeToken = randomBytes(32).toString("hex");
  const logs = createLogCapture(30 * 1024);
  const cliStatuses = [];
  let proof;
  try {
    const [{ ConvexHttpClient }, { makeFunctionReference }, { runMigrationRehearsal }] = await Promise.all([import("convex/browser"), import("convex/server"), import("./event-broadcast-migration-rehearsal.ts")]);
    const fetchBounded = (url, options) => fetch(url, { ...options, signal: AbortSignal.timeout(Math.max(1, Math.min(10_000, timing.deadline - 20_000 - Date.now()))) });
    const admin = new ConvexHttpClient("http://127.0.0.1:3210", { fetch: fetchBounded, logger: false });
    const owner = new ConvexHttpClient("http://127.0.0.1:3210", { fetch: fetchBounded, logger: false });
    admin.setAdminAuth(config.adminKey);
    const runId = `ci-${ownership.ownerId.slice(0, 24)}`;
    const input = { admin, owner, bridgeToken, runId, sourceSha: id.sourceSha, backendVersion: BACKEND_VERSION };
    const cli = async (args, value) => {
      const result = await native(path.join(ROOT, "node_modules/.bin/convex"), [...args, "--env-file", envfile], { stdin: value === undefined ? undefined : `${value}\n`, deadline: Math.min(Date.now() + 10_000, timing.deadline - 20_000), capture: args[0] === "data", logs }).done;
      cliStatuses.push({ operation: args.slice(0, 3), code: result.code, signal: result.signal, close: result.close, timedOut: result.timedOut, overflow: result.overflow });
      requireNative(result); return result.stdout;
    };
    proof = await executePhase(input, {
      seed: () => admin.mutation(makeFunctionReference("localEventBroadcastRehearsal:seed"), { runId }),
      bindOwner: actor => owner.setAdminAuth(config.adminKey, actor),
      cli, runDriver: input => { requireDriverBudget(timing.deadline); return runMigrationRehearsal(input); },
      recover: () => admin.mutation(makeFunctionReference("localEventBroadcastRehearsal:cleanup"), { runId }),
      saveDriver: receipt => {
        let bytes = JSON.stringify(receipt);
        for (const secret of [config.adminKey, config.instanceSecret, bridgeToken].filter(Boolean)) bytes = bytes.split(secret).join("[redacted]");
        check(Buffer.byteLength(bytes) <= 512 * 1024);
        writeFileSync(path.join(artifact, "driver.json"), bytes + "\n", { mode: 0o600 });
      },
      removePrivateFile: () => { rmSync(envfile); check(!present(envfile)); },
    });
  } finally {
    if (present(envfile)) rmSync(envfile);
    writeJson(path.join(artifact, "phase.json"), { ...(proof ?? { status: "failed" }), cliStatuses, logs: logs.receipt() });
  }
  check(proof?.status === "passed" && !logs.receipt().overflow);
}
async function recover() {
  const ownership = readOwnership(ROOT, identity());
  const timing = json(path.join(privateDir(ROOT), "attempt.json"));
  check(timing.ownerId === ownership.ownerId);
  const deadline = timing.deadline - 20_000;
  const config = loadConfig(), envfile = path.join(privateDir(ROOT), "recovery.env");
  const logs = createLogCapture(30 * 1024), cliStatuses = [];
  let proof = { status: "failed" };
  try {
    writeFileSync(envfile, `CONVEX_SELF_HOSTED_URL=http://127.0.0.1:3210\nCONVEX_SELF_HOSTED_ADMIN_KEY=${config.adminKey}\n`, { mode: 0o600, flag: "wx" });
    const [{ ConvexHttpClient }, { makeFunctionReference }] = await Promise.all([import("convex/browser"), import("convex/server")]);
    const fetchBounded = (url, options) => { check(Date.now() < deadline); return fetch(url, { ...options, signal: AbortSignal.timeout(Math.max(1, Math.min(10_000, deadline - Date.now()))) }); };
    const admin = new ConvexHttpClient("http://127.0.0.1:3210", { fetch: fetchBounded, logger: false });
    admin.setAdminAuth(config.adminKey);
    proof = await executeRecovery({
      recover: () => admin.mutation(makeFunctionReference("localEventBroadcastRehearsal:cleanup"), { runId: `ci-${ownership.ownerId.slice(0, 24)}` }),
      cli: async args => {
        const result = await native(path.join(ROOT, "node_modules/.bin/convex"), [...args, "--env-file", envfile], { deadline: Math.min(Date.now() + 10_000, deadline), capture: args[0] === "data", logs }).done;
        cliStatuses.push({ operation: args.slice(0, 3), ...result, stdout: undefined });
        requireNative(result); return result.stdout;
      },
      removePrivateFile: () => {
        for (const name of ["loopback.env", "recovery.env"]) rmSync(path.join(privateDir(ROOT), name), { force: true });
        check(!present(envfile) && !present(path.join(privateDir(ROOT), "loopback.env")));
      },
    });
  } finally {
    rmSync(envfile, { force: true });
    writeJson(path.join(artifactDir(ROOT), "recovery.json"), { ...proof, cliStatuses, logs: logs.receipt() });
  }
  check(proof.status === "passed" && !logs.receipt().overflow);
}
async function phase() {
  const ownership = readOwnership(ROOT, identity());
  const timing = json(path.join(privateDir(ROOT), "attempt.json"));
  check(timing.ownerId === ownership.ownerId);
  const logs = createLogCapture(2 * 1024);
  let workClosed = false;
  const task = native(process.execPath, ["--import", "tsx", SCRIPT, "work"], { deadline: timing.deadline - 60_000, detached: true, holdInput: true, logs });
  task.done.then(() => { workClosed = true; });
  let owned;
  try {
    const row = processView().find(row => row.pid === task.child.pid);
    check(row && row.group === task.child.pid);
    owned = { pid: row.pid, group: row.group, start: row.start, ownerId: ownership.ownerId };
    writeJson(path.join(privateDir(ROOT), "work-group.json"), owned);
    writeJson(path.join(artifactDir(ROOT), "work-group.json"), owned);
    task.child.stdin.end(`${ownership.ownerId}\n`);
  } catch { task.child.kill("SIGKILL"); throw Error("Workload ownership rejected."); }
  const result = await supervisePhase(timing.deadline, {
    now: Date.now, pause, closed: () => workClosed,
    cancelled: () => present(path.join(privateDir(ROOT), "cancel.json")),
    stopWork: () => closeOwnedGroup(owned, Math.min(Date.now() + 5000, timing.deadline - 60_000), { ...processOps, listeners: () => [] }),
    nativeResult: () => task.done,
    phaseProof: () => json(path.join(artifactDir(ROOT), "phase.json")),
    recover: async deadline => {
      const recoveryNative = await native(process.execPath, [SCRIPT, "recover"], { deadline, logs }).done;
      let recoveryProof = { status: "failed" };
      try { recoveryProof = json(path.join(artifactDir(ROOT), "recovery.json")); } catch { /* retain negative */ }
      try { requireNative(recoveryNative); } catch { recoveryProof.status = "failed"; }
      return { ...recoveryProof, native: { ...recoveryNative, stdout: undefined } };
    },
    saveRecovery: proof => writeJson(path.join(artifactDir(ROOT), "recovery.json"), proof),
  });
  writeJson(path.join(artifactDir(ROOT), "phase-native.json"), { ...result.nativeResult, stdout: undefined, workClosure: result.workClosure, interrupted: result.interrupted, logs: logs.receipt() });
  check(result.status === "passed");
}
async function group() {
  // No backend can be spawned until outer owner has persisted this group's /proc identity.
  const authorization = await new Promise(resolve => { let value = ""; process.stdin.on("data", bytes => { value += bytes; if (value.length > 128) process.exit(1); }); process.stdin.on("end", () => resolve(value.trim())); });
  const ownership = readOwnership(ROOT, identity());
  check(authorization === ownership.ownerId);
  const timing = json(path.join(privateDir(ROOT), "attempt.json"));
  check(timing.ownerId === ownership.ownerId);
  const self = processView().find(row => row.pid === process.pid);
  const owned = json(path.join(privateDir(ROOT), "group.json"));
  check(self && self.pid === owned.pid && self.start === owned.start && self.group === owned.group);
  const logs = createLogCapture(64 * 1024);
  const { done } = native(process.execPath, ["scripts/run-convex-local.mjs", "dev", "--local", "--once", "--tail-logs", "disable", "--local-backend-version", BACKEND_VERSION, "--run-sh", `node --import tsx ${SCRIPT} phase`], { deadline: timing.deadline - 15_000, logs });
  const result = await done;
  writeJson(path.join(artifactDir(ROOT), "parent-native.json"), { ...result, stdout: undefined, logs: logs.receipt() });
  requireNative(result);
}
export function acceptEvidence(proof, evidence, input, now) {
  try {
    check(!proof.cancelled && now < proof.deadline && proof.closure?.passed && !proof.logs.overflow);
    requireNative(proof.native); requireNative(evidence.phaseNative); requireNative(evidence.parentNative); requireNative(proof.generated);
    check(!evidence.phaseNative.logs.overflow && !evidence.parentNative.logs.overflow && evidence.phase.status === "passed" && !evidence.phase.logs.overflow && driverPassed(evidence.driver, input) && /^[a-f0-9]{64}$/.test(evidence.runtime.binarySha256));
    return true;
  } catch { return false; }
}
async function run() {
  const started = Date.now(), deadline = started + 330_000;
  const id = identity(), ownership = readOwnership(ROOT, id), artifact = artifactDir(ROOT);
  check(!present(path.join(privateDir(ROOT), "attempt.json")));
  writeJson(path.join(privateDir(ROOT), "attempt.json"), { ownerId: ownership.ownerId, started, deadline });
  const proof = { status: "failed", ...id, ownerId: ownership.ownerId, backendVersion: BACKEND_VERSION, started, deadline, closure: null, generated: null };
  writeJson(path.join(artifact, "result.json"), proof);
  let child, childClosed = false, nativeStatus = null, owner, cancelled = false, finalProof = false;
  const logs = createLogCapture(2 * 1024);
  const cancel = () => {
    cancelled = true; proof.cancelled = true; proof.status = "failed"; process.exitCode = 1;
    if (finalProof) { try { writeJson(path.join(artifact, "result.json"), proof); } catch { /* Native failure remains authoritative. */ } }
  };
  process.on("SIGTERM", cancel); process.on("SIGINT", cancel);
  try {
    check(process.platform === "linux" && listeners().length === 0);
    loadConfig();
    child = spawn(process.execPath, [SCRIPT, "group"], { cwd: ROOT, env: cleanEnv(), detached: true, stdio: ["pipe", "pipe", "pipe"] });
    child.on("error", () => {}); child.stdin.on("error", () => {});
    child.stdout.on("data", bytes => logs.add("stdout", bytes));
    child.stderr.on("data", bytes => logs.add("stderr", bytes));
    child.on("close", (code, signal) => { childClosed = true; nativeStatus = { code, signal, close: true }; });
    check(child.pid > 1);
    const row = processView().find(row => row.pid === child.pid);
    check(row && row.group === child.pid);
    owner = { pid: row.pid, group: row.group, start: row.start };
    writeJson(path.join(privateDir(ROOT), "group.json"), owner);
    writeJson(path.join(artifact, "group.json"), owner);
    child.stdin.end(`${ownership.ownerId}\n`);
    while (!childClosed && Date.now() < deadline - 15_000) {
      if ((cancelled || logs.receipt().overflow) && !present(path.join(privateDir(ROOT), "cancel.json"))) writeJson(path.join(privateDir(ROOT), "cancel.json"), { ownerId: ownership.ownerId });
      await pause(50);
    }
  } catch { if (child && !owner) child.kill("SIGKILL"); /* Unreleased child cannot spawn backend. */ }
  finally {
    try {
      if (present(path.join(privateDir(ROOT), "work-group.json"))) {
        const workOwner = json(path.join(privateDir(ROOT), "work-group.json"));
        check(workOwner.ownerId === ownership.ownerId);
        proof.workClosure = await closeOwnedGroup(workOwner, Math.min(Date.now() + 2000, deadline - 13_000), { ...processOps, listeners: () => [] });
      }
    } catch { proof.workClosure = { passed: false }; }
    if (owner) proof.closure = await closeOwnedGroup(owner, Math.min(Date.now() + 5000, deadline - 10_000));
    while (child && !childClosed && Date.now() < deadline - 10_000) await pause(25);
    proof.native = nativeStatus; proof.logs = logs.receipt(); proof.cancelled = cancelled;
    // Final generated check runs only after physical closure and within the original ceiling.
    if (proof.closure?.passed && childClosed) {
      const diff = await native("git", ["diff", "--exit-code", "--", "convex/_generated"], { deadline: Math.min(Date.now() + 9000, deadline - 500), logs }).done;
      proof.generated = { code: diff.code, signal: diff.signal, close: diff.close, timedOut: diff.timedOut, overflow: diff.overflow };
    }
    try {
      const phaseProof = json(path.join(artifact, "phase.json"));
      const phaseNative = json(path.join(artifact, "phase-native.json"));
      const parentNative = json(path.join(artifact, "parent-native.json"));
      const driver = json(path.join(artifact, "driver.json"));
      const runtime = json(path.join(artifact, "runtime.json"));
      const recovery = json(path.join(artifact, "recovery.json"));
      check(recovery.status === "passed" && proof.workClosure?.passed);
      const input = { sourceSha: id.sourceSha, backendVersion: BACKEND_VERSION, runId: `ci-${ownership.ownerId.slice(0, 24)}` };
      proof.logs = logs.receipt();
      check(acceptEvidence(proof, { phase: phaseProof, phaseNative, parentNative, driver, runtime }, input, Date.now()));
      proof.status = "passed";
    } catch { /* Missing artifacts, native exits, admission or closure can never pass. */ }
    // Owned database/cache remain excluded from artifacts and are disposed with the job.
    // Recursive deletion here could exceed the absolute cutoff; no unrelated state is removed.
    try {
      readOwnership(ROOT, id);
      check(json(path.join(privateDir(ROOT), "attempt.json")).ownerId === ownership.ownerId);
      for (const name of ["loopback.env", "recovery.env"]) rmSync(path.join(privateDir(ROOT), name), { force: true });
      proof.privateFileRemoved = ["loopback.env", "recovery.env"].every(name => !present(path.join(privateDir(ROOT), name)));
    } catch { proof.privateFileRemoved = false; proof.status = "failed"; }
    proof.logs = logs.receipt();
    proof.finished = Date.now();
    if (proof.finished >= deadline || cancelled) proof.status = "failed";
    proof.cancelled = cancelled;
    finalProof = true;
    writeJson(path.join(artifact, "result.json"), proof);
    // Deliver signals queued during synchronous proof I/O before making acceptance final.
    await pause(0);
    proof.finished = Date.now(); proof.cancelled = cancelled;
    if (cancelled || proof.finished >= deadline) proof.status = "failed";
    writeJson(path.join(artifact, "result.json"), proof);
    // Keep the latch until process exit: a later signal also changes native exit and proof.
  }
  check(proof.status === "passed");
}
const EXPECTED_ARTIFACTS = ["preflight.json", "result.json", "group.json", "runtime.json", "driver.json", "phase.json", "phase-native.json", "parent-native.json", "work-group.json", "recovery.json"];
export function stageArtifacts(root, stagingParent) {
  const directory = mkdtempSync(path.join(realpathSync(stagingParent), "migration-proof-"));
  const selected = [], rejected = [];
  let safeDirectory = true;
  try { noLinks(root, ARTIFACT); check(lstatSync(artifactDir(root)).isDirectory()); } catch { safeDirectory = false; }
  for (const name of EXPECTED_ARTIFACTS) {
    let descriptor;
    try {
      check(safeDirectory);
      descriptor = openSync(path.join(artifactDir(root), name), constants.O_RDONLY | constants.O_NOFOLLOW | constants.O_NONBLOCK);
      const stat = fstatSync(descriptor), cap = name === "driver.json" ? 512 * 1024 + 1 : 128 * 1024;
      check(stat.isFile() && stat.nlink === 1 && stat.size <= cap);
      const bytes = readFileSync(descriptor);
      check(bytes.length <= cap);
      JSON.parse(bytes.toString("utf8"));
      writeFileSync(path.join(directory, name), bytes, { flag: "wx", mode: 0o600 });
      selected.push(name);
    } catch { rejected.push(name); }
    finally { if (descriptor !== undefined) closeSync(descriptor); }
  }
  const complete = rejected.length === 0;
  writeJson(path.join(directory, "selection.json"), { schemaVersion: 1, complete, selected, rejected });
  return { directory, complete, selected, rejected };
}
async function main() {
  const mode = process.argv[2];
  if (mode === "preflight") { check(process.platform === "linux" && listeners().length === 0); preflightState(ROOT, identity()); }
  else if (mode === "check-artifacts") {
    const selection = stageArtifacts(ROOT, process.env.RUNNER_TEMP);
    check(!/[\r\n]/.test(selection.directory));
    appendFileSync(process.env.GITHUB_OUTPUT, `upload-path=${selection.directory}\n`);
    check(selection.complete);
  }
  else if (mode === "run") await run();
  else if (mode === "group") await group();
  else if (mode === "phase") await phase();
  else if (mode === "recover") await recover();
  else if (mode === "work") await work();
  else fail();
}
if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  main().catch(() => { process.stderr.write("Local migration failed; inspect safe CI evidence.\n"); process.exitCode = 1; });
}
