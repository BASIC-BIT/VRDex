import assert from "node:assert/strict";
import { mkdtempSync, mkdirSync, writeFileSync, readFileSync, rmSync, symlinkSync } from "node:fs";
import os from "node:os";
import path from "node:path";
import test from "node:test";

const modulePath = new URL("../../scripts/verify-event-broadcast-migration-local.mjs", import.meta.url);
let helper;
try { helper = await import(modulePath); } catch (error) { if (error.code !== "ERR_MODULE_NOT_FOUND") throw error; }
const requireHelper = () => { assert.ok(helper, "durable migration helper must exist"); return helper; };
const sha = "a".repeat(40);
const config = { ports: { cloud: 3210, site: 3211 }, backendVersion: "precompiled-2026-09-28-5c7cb5b", deploymentName: "anonymous-agent", adminKey: "private-admin", instanceSecret: "private-instance" };
const passed = { sourceSha: sha, backendVersion: config.backendVersion, runId: "ci-test", scope: "whole-flow", status: "passed", cleanup: { status: "passed" }, evidence: [{ label: "actual-admission", data: { passed: true } }] };

// Removing any preflight rejection must leave the caller's existing bytes intact.
test("fresh-state preflight rejects existing state and never deletes it", () => {
  const { preflightState } = requireHelper();
  for (const entry of [".convex", ".convex-home", ".convex-tmp", ".env.local", "apps/web/.env.local"]) {
    const root = mkdtempSync(path.join(os.tmpdir(), "migration-test-"));
    try {
      mkdirSync(path.dirname(path.join(root, entry)), { recursive: true });
      writeFileSync(path.join(root, entry), "unrelated");
      assert.throws(() => preflightState(root, { sourceSha: sha, ciRun: "12", ciAttempt: "1" }));
      assert.equal(readFileSync(path.join(root, entry), "utf8"), "unrelated");
    } finally { rmSync(root, { recursive: true }); }
  }
});

test("ownership is private, unique, source bound and cannot be reused", () => {
  const { preflightState, readOwnership } = requireHelper();
  const root = mkdtempSync(path.join(os.tmpdir(), "migration-test-"));
  try {
    const receipt = preflightState(root, { sourceSha: sha, ciRun: "12", ciAttempt: "1", prHead: "b".repeat(40) });
    assert.match(receipt.ownerId, /^[a-f0-9]{32}$/);
    assert.equal(readOwnership(root, { sourceSha: sha, ciRun: "12", ciAttempt: "1" }).prHead, "b".repeat(40));
    assert.throws(() => readOwnership(root, { sourceSha: "c".repeat(40), ciRun: "12", ciAttempt: "1" }));
    assert.throws(() => preflightState(root, { sourceSha: sha, ciRun: "12", ciAttempt: "1" }));
  } finally { rmSync(root, { recursive: true }); }
});

test("config requires exact local identity and never reports secret bytes", () => {
  const { validateConfig } = requireHelper();
  assert.equal(validateConfig(config), config);
  for (const changed of [{ ports: { cloud: 3212, site: 3211 } }, { deploymentName: "remote" }, { backendVersion: "latest" }, { adminKey: "" }]) {
    assert.throws(() => validateConfig({ ...config, ...changed }), error => !error.message.includes("private"));
  }
});

function phaseFixture(failAt) {
  const calls = [];
  const deps = {
    seed: async () => { calls.push("seed"); if (failAt === "seed") throw Error("secret"); return { communityId: "community-1", actor: { subject: "actor-1" } }; },
    bindOwner: actor => calls.push(["owner", actor]),
    cli: async (args, value) => {
      calls.push(["cli", args, value]);
      if (failAt === args[1] || (failAt === "second-set" && args[1] === "set" && args[2] === "VRDEX_EVENT_MEDIA_BRIDGE_TOKEN")) throw Error("secret");
      return args[0] === "data" ? "[]" : "";
    },
    runDriver: async input => { calls.push(["driver", input]); if (failAt === "driver") throw Error("secret"); return structuredClone(passed); },
    recover: async () => { calls.push("recover"); if (failAt === "recover") throw Error("secret"); return { deleted: 0 }; },
    saveDriver: receipt => calls.push(["saved", receipt]),
    removePrivateFile: () => calls.push("unlink"),
  };
  return { calls, deps };
}
const input = { runId: "ci-test", sourceSha: sha, backendVersion: config.backendVersion, bridgeToken: "private-bridge", admin: {}, owner: {} };

test("real phase orchestration binds manifest actor/community and preserves whole driver receipt", async () => {
  const { executePhase } = requireHelper();
  const { calls, deps } = phaseFixture();
  const result = await executePhase(input, deps);
  assert.equal(result.status, "passed");
  assert.deepEqual(calls.find(c => c[0] === "owner"), ["owner", { subject: "actor-1" }]);
  const registry = calls.find(c => c[0] === "cli" && c[1][2] === "VRDEX_VRCDN_OUTPUT_ACCOUNTS_JSON");
  assert.deepEqual(JSON.parse(registry[2]), [{ key: "local-rehearsal", label: "Local rehearsal", credentialRef: "local-rehearsal/output", ownerCommunityProfileId: "community-1", playbackLinks: [] }]);
  assert.deepEqual(calls.find(c => c[0] === "driver")[1], input);
  assert.deepEqual(calls.find(c => c[0] === "saved")[1], passed);
  assert.equal(calls.at(-1), "unlink");
});

test("every partial setup and cleanup failure stays failed and attempts all cleanup", async () => {
  const { executePhase } = requireHelper();
  for (const failAt of ["seed", "second-set", "driver", "recover", "remove"]) {
    const { calls, deps } = phaseFixture(failAt);
    const result = await executePhase(input, deps);
    assert.equal(result.status, "failed", failAt);
    assert.ok(calls.includes("recover"), failAt);
    assert.ok(calls.some(c => c[0] === "cli" && c[1][0] === "data"), failAt);
    assert.equal(calls.filter(c => c[0] === "cli" && c[1][1] === "remove").length, 2, failAt);
    assert.equal(calls.at(-1), "unlink", failAt);
    assert.ok(!JSON.stringify(result).includes("secret"));
  }
});

test("historical-only, dirty cleanup, wrong source and nonempty manifest cannot pass", async () => {
  const { executePhase } = requireHelper();
  for (const changed of [{ scope: "migration" }, { status: "failed" }, { sourceSha: "b".repeat(40) }, { cleanup: { status: "failed" } }]) {
    const { deps } = phaseFixture();
    deps.runDriver = async () => ({ ...passed, ...changed });
    assert.equal((await executePhase(input, deps)).status, "failed");
  }
  const { deps } = phaseFixture();
  deps.cli = async args => args[0] === "data" ? '[{"_id":"leftover"}]' : "";
  assert.equal((await executePhase(input, deps)).status, "failed");
});

test("owned closure escalates TERM to KILL and never signals another group", async () => {
  const { closeOwnedGroup } = requireHelper();
  let now = 0, alive = true;
  const signals = [];
  const result = await closeOwnedGroup({ pid: 100, start: "123", group: 100 }, 5000, {
    now: () => now,
    view: () => alive ? [{ pid: 100, start: "123", group: 100, state: "S" }] : [],
    listeners: () => [],
    signal: (group, signal) => { signals.push([group, signal]); if (signal === "SIGKILL") alive = false; },
    pause: async ms => { now += ms; },
  });
  assert.equal(result.passed, true);
  assert.deepEqual(signals, [[100, "SIGTERM"], [100, "SIGKILL"]]);
  assert.ok(now <= 5000);
});

test("reused leader identity or remaining listener fails closure without unrelated kill", async () => {
  const { closeOwnedGroup } = requireHelper();
  const signals = [];
  const result = await closeOwnedGroup({ pid: 100, start: "123", group: 100 }, 5000, {
    now: () => 0,
    view: () => [{ pid: 100, start: "999", group: 100, state: "S" }],
    listeners: () => [3210], signal: (...args) => signals.push(args), pause: async () => {},
  });
  assert.equal(result.passed, false);
  assert.deepEqual(signals, []);
});

test("sanitized log collector stores bounded metadata only and fails on combined overflow", () => {
  const { createLogCapture } = requireHelper();
  const logs = createLogCapture();
  logs.add("stdout", Buffer.from("admin-secret\n"));
  logs.add("stderr", Buffer.from("bridge-secret\n"));
  assert.ok(!JSON.stringify(logs.receipt()).includes("secret"));
  logs.add("stdout", Buffer.alloc(128 * 1024));
  assert.equal(logs.receipt().overflow, true);
  assert.ok(Buffer.byteLength(JSON.stringify(logs.receipt())) < 2048);
});

test("native timeout cannot wait forever for inherited pipe EOF", async () => {
  const { runNative } = requireHelper();
  assert.equal(typeof runNative, "function");
  const { EventEmitter } = await import("node:events");
  const child = new EventEmitter();
  child.stdout = new EventEmitter(); child.stderr = new EventEmitter(); child.stdin = new EventEmitter();
  child.stdin.end = () => {};
  const signals = []; child.kill = signal => signals.push(signal);
  const timers = [];
  const process = runNative("fixed", [], { deadline: 10000 }, {
    spawn: () => child, now: () => 0,
    setTimeout: (fn, ms) => { timers.push({ fn, ms }); return timers.length; }, clearTimeout: () => {},
  });
  assert.equal(timers[0].ms, 9000);
  timers[0].fn();
  timers[1].fn();
  const result = await process.done;
  assert.equal(result.close, false);
  assert.equal(result.timedOut, true);
  assert.deepEqual(signals, ["SIGTERM", "SIGKILL"]);
});

test("exit without close does not supply native success and output overflow is fatal", async () => {
  const { runNative } = requireHelper();
  assert.equal(typeof runNative, "function");
  const { EventEmitter } = await import("node:events");
  const child = new EventEmitter();
  child.stdout = new EventEmitter(); child.stderr = new EventEmitter(); child.stdin = new EventEmitter();
  child.stdin.end = () => {}; const signals = []; child.kill = signal => signals.push(signal);
  const timers = [];
  const native = runNative("fixed", [], { deadline: 10000 }, {
    spawn: () => child, now: () => 0, setTimeout: fn => { timers.push(fn); return timers.length; }, clearTimeout: () => {},
  });
  child.emit("exit", 0, null);
  child.stdout.emit("data", Buffer.alloc(128 * 1024 + 1));
  child.emit("close", 0, null);
  const result = await native.done;
  assert.equal(result.overflow, true);
  assert.deepEqual(signals, ["SIGKILL"]);
});

test("artifact completeness rejects missing proof and symlink sources", () => {
  const { stageArtifacts } = requireHelper();
  const root = mkdtempSync(path.join(os.tmpdir(), "migration-test-"));
  try {
    const directory = path.join(root, "artifacts/event-broadcast-migration-local");
    mkdirSync(directory, { recursive: true });
    writeFileSync(path.join(directory, "result.json"), "{}");
    assert.equal(stageArtifacts(root, root).complete, false);
    for (const name of ["preflight", "group", "runtime", "driver", "phase", "phase-native", "parent-native", "work-group", "recovery"]) writeFileSync(path.join(directory, `${name}.json`), "{}");
    assert.equal(stageArtifacts(root, root).complete, true);
    rmSync(path.join(directory, "result.json"));
    symlinkSync(path.join(directory, "driver.json"), path.join(directory, "result.json"));
    assert.equal(stageArtifacts(root, root).complete, false);
  } finally { rmSync(root, { recursive: true }); }
});

test("existing backend CI pins both phases, preserves canonical checks and uploads explicit proof on failure", async () => {
  const { parse } = await import("yaml");
  const workflow = parse(readFileSync(new URL("../../.github/workflows/baseline-checks.yml", import.meta.url), "utf8"));
  const job = workflow.jobs["verify-backend-local"];
  assert.equal(job["timeout-minutes"], 10);
  assert.equal(job.env?.CONVEX_LOCAL_BACKEND_VERSION, "precompiled-2026-09-28-5c7cb5b");
  const commands = job.steps.map(step => step.run);
  assert.ok(commands.indexOf("node scripts/verify-event-broadcast-migration-local.mjs preflight") < commands.indexOf("pnpm verify:backend:local"));
  assert.equal(commands.filter(command => command === "git diff --exit-code -- convex/_generated").length, 2);
  const rehearsal = job.steps.find(step => step.id === "migration");
  assert.equal(rehearsal["timeout-minutes"], 6);
  assert.equal(rehearsal.run, "node --import tsx scripts/verify-event-broadcast-migration-local.mjs run");
  assert.equal(rehearsal["continue-on-error"], undefined);
  const artifact = job.steps.find(step => step.uses === "actions/upload-artifact@v7");
  assert.equal(artifact.if, "${{ always() && steps.migration.outcome != 'skipped' && steps.migration-evidence.outputs.upload-path != '' }}");
  assert.equal(artifact.with["retention-days"], 7);
  assert.equal(artifact.with["if-no-files-found"], "error");
  assert.equal(artifact.with.path, "${{ steps.migration-evidence.outputs.upload-path }}");
  const selection = job.steps.find(step => step.id === "migration-evidence");
  assert.equal(selection.if, "${{ always() && steps.migration.outcome != 'skipped' }}");
  assert.equal(selection.run, "node scripts/verify-event-broadcast-migration-local.mjs check-artifacts");
});

test("final acceptance requires every native, closure, runtime and whole-flow proof", () => {
  const { acceptEvidence } = requireHelper();
  assert.equal(typeof acceptEvidence, "function");
  const native = { code: 0, signal: null, close: true, timedOut: false, overflow: false, logs: { overflow: false } };
  const proof = { cancelled: false, closure: { passed: true }, native, generated: native, logs: { overflow: false }, deadline: 20000 };
  const evidence = { phase: { status: "passed", logs: { overflow: false } }, phaseNative: native, parentNative: native, driver: passed, runtime: { binarySha256: "c".repeat(64) } };
  assert.equal(acceptEvidence(proof, evidence, input, 10000), true);
  for (const part of ["phase", "phaseNative", "parentNative", "driver", "runtime"]) {
    assert.equal(acceptEvidence(proof, { ...evidence, [part]: undefined }, input, 10000), false, part);
  }
  for (const changed of [{ closure: null }, { cancelled: true }, { native: { ...native, close: false } }, { generated: { ...native, code: 1 } }, { logs: { overflow: true } }]) {
    assert.equal(acceptEvidence({ ...proof, ...changed }, evidence, input, 10000), false);
  }
  assert.equal(acceptEvidence(proof, evidence, input, 20001), false);
});

test("late startup cannot spend the cleanup and physical-closure reserve on driver work", () => {
  const { requireDriverBudget } = requireHelper();
  assert.equal(typeof requireDriverBudget, "function");
  assert.doesNotThrow(() => requireDriverBudget(330000, 54999));
  assert.throws(() => requireDriverBudget(330000, 55001));
});

// The supervisor must quiesce the workload, recover logical state, then release run-sh.
test("interrupted work recovers after seed, first binding and driver before backend release", async () => {
  const { supervisePhase, executeRecovery } = requireHelper();
  assert.equal(typeof supervisePhase, "function");
  for (const stage of ["seed", "first-binding", "driver", "work-crash"]) {
    const calls = [stage];
    let stopped = false;
    const recoveryDeps = {
      recover: async () => { assert.ok(stopped); calls.push("fixture-cleanup"); },
      cli: async args => { assert.ok(stopped); calls.push(args[0] === "data" ? "manifest-empty" : `remove-${args[2]}`); return "[]"; },
      removePrivateFile: () => calls.push("remove-envfile"),
    };
    const result = await supervisePhase(330000, {
      now: () => 1000, cancelled: () => stage !== "work-crash", closed: () => stage === "work-crash", pause: async () => {},
      stopWork: async () => { calls.push("work-group-close"); stopped = true; return { passed: true }; },
      nativeResult: async () => ({ code: 1, signal: null, close: true }),
      phaseProof: () => null,
      recover: deadline => { assert.equal(deadline, 310000); return executeRecovery(recoveryDeps); },
      saveRecovery: result => calls.push(["persist-recovery", result]),
    });
    calls.push("backend-group-close");
    assert.equal(result.status, "failed");
    assert.equal(result.recovery.status, "passed");
    assert.deepEqual(calls.slice(1, 7), ["work-group-close", "fixture-cleanup", "manifest-empty", "remove-VRDEX_VRCDN_OUTPUT_ACCOUNTS_JSON", "remove-VRDEX_EVENT_MEDIA_BRIDGE_TOKEN", "remove-envfile"]);
    assert.equal(calls.at(-2)[0], "persist-recovery");
    assert.equal(calls.at(-1), "backend-group-close");
  }
});

test("interruption recovery persists every failed cleanup attempt before backend release", async () => {
  const { supervisePhase, executeRecovery } = requireHelper();
  assert.equal(typeof supervisePhase, "function");
  const calls = [];
  let saved;
  const result = await supervisePhase(330000, {
    now: () => 270000, cancelled: () => true, closed: () => false, pause: async () => {},
    stopWork: async () => ({ passed: true }), nativeResult: async () => ({ code: null, signal: "SIGKILL", close: true }), phaseProof: () => null,
    recover: () => executeRecovery({ recover: async () => { calls.push("rpc"); throw Error("secret"); }, cli: async args => { calls.push(args); throw Error("secret"); }, removePrivateFile: () => { calls.push("unlink"); } }),
    saveRecovery: proof => { saved = proof; },
  });
  assert.equal(calls.length, 5);
  assert.equal(result.status, "failed");
  assert.equal(saved.status, "failed");
  assert.equal(saved.fixtureCleanup, false);
  assert.equal(saved.manifestEmpty, false);
  assert.ok(!JSON.stringify(saved).includes("secret"));
});

test("safe upload staging excludes rejected source links while retaining failure evidence", () => {
  const { stageArtifacts } = requireHelper();
  assert.equal(typeof stageArtifacts, "function");
  const root = mkdtempSync(path.join(os.tmpdir(), "migration-stage-test-"));
  try {
    const source = path.join(root, "artifacts/event-broadcast-migration-local");
    mkdirSync(source, { recursive: true });
    writeFileSync(path.join(root, "private-config"), "private-admin-secret");
    writeFileSync(path.join(source, "result.json"), '{"status":"failed"}');
    symlinkSync(path.join(root, "private-config"), path.join(source, "driver.json"));
    const selection = stageArtifacts(root, root);
    assert.equal(selection.complete, false);
    assert.ok(!selection.selected.includes("driver.json"));
    assert.equal(readFileSync(path.join(selection.directory, "result.json"), "utf8"), '{"status":"failed"}');
    assert.ok(readFileSync(path.join(selection.directory, "selection.json"), "utf8").includes('"complete": false'));
    assert.ok(!readFileSync(path.join(selection.directory, "selection.json"), "utf8").includes("private-admin-secret"));
    assert.throws(() => readFileSync(path.join(selection.directory, "driver.json")));
    rmSync(source, { recursive: true });
    symlinkSync(path.dirname(source), source);
    const rejected = stageArtifacts(root, root);
    assert.equal(rejected.complete, false);
    assert.deepEqual(rejected.selected, []);
    assert.ok(readFileSync(path.join(rejected.directory, "selection.json"), "utf8"));
  } finally { rmSync(root, { recursive: true }); }
});

// Evaluate the real outer owner with only process/filesystem/native boundaries replaced.
async function fakeOuterRun(signal, at, workStage = "driver") {
  const { EventEmitter } = await import("node:events");
  const { default: vm } = await import("node:vm");
  const source = readFileSync(modulePath, "utf8");
  const body = source.slice(source.indexOf("async function run() {"), source.indexOf("const EXPECTED_ARTIFACTS"));
  const ownerId = "b".repeat(32);
  const events = new EventEmitter(), child = new EventEmitter();
  child.pid = 100; child.stdin = new EventEmitter(); child.stdin.end = () => {};
  child.stdout = new EventEmitter(); child.stderr = new EventEmitter(); child.kill = () => {};
  const good = { code: 0, signal: null, close: true, timedOut: false, overflow: false, logs: { overflow: false } };
  const files = new Map([
    ["phase.json", { status: "passed", logs: { overflow: false } }], ["phase-native.json", good], ["parent-native.json", good],
    ["driver.json", { ...passed, runId: `ci-${ownerId.slice(0, 24)}` }], ["runtime.json", { binarySha256: "c".repeat(64) }],
    ["recovery.json", { status: "passed" }], ["work-group.json", { ownerId, pid: 200, group: 200, start: "234" }],
  ]);
  let delivered = false, closed = false, clock = 1000;
  const calls = [];
  let workSignalSent = false;
  const deliver = stage => { if (!delivered && signal && stage === at) { delivered = true; events.emit(signal); } };
  const context = {
    Date: { now: () => clock }, ROOT: "/fake-root", SCRIPT: "fixed", BACKEND_VERSION: config.backendVersion, path,
    identity: () => ({ sourceSha: sha }), readOwnership: () => ({ ownerId }), artifactDir: () => "/artifact", privateDir: () => "/private",
    present: file => ["work-group.json", "cancel.json"].includes(path.basename(file)) && files.has(path.basename(file)), processOps: {}, check: x => { if (!x) throw Error("rejected"); },
    writeJson: (file, data) => { if (path.basename(file) === "result.json" && data.finished) deliver("proof-write"); files.set(path.basename(file), structuredClone(data)); },
    json: file => files.get(path.basename(file)), process: Object.assign(events, { platform: "linux", execPath: "/fake-node" }),
    createLogCapture: () => ({ add() {}, receipt: () => ({ overflow: false }) }), listeners: () => [], loadConfig() {}, cleanEnv: () => ({}), spawn: () => child,
    processView: () => [{ pid: 100, group: 100, start: "123" }],
    pause: async () => {
      if (!closed && at === "work") {
        if (!workSignalSent) { workSignalSent = true; calls.push(workStage); deliver("work"); return; }
        assert.ok(files.has("cancel.json"), "outer must request recovery before group closure");
        await helper.supervisePhase(330000, {
          now: () => 1000, pause: async () => {}, closed: () => false, cancelled: () => true,
          stopWork: async () => { calls.push("stop-work"); return { passed: true }; },
          nativeResult: async () => ({ ...good, code: null, signal: "SIGTERM" }), phaseProof: () => null,
          recover: () => helper.executeRecovery({
            recover: async () => { calls.push("fixture-cleanup"); },
            cli: async args => { calls.push(args[0] === "data" ? "manifest-empty" : `remove-${args[2]}`); return "[]"; },
            removePrivateFile: () => calls.push("remove-envfile"),
          }),
          saveRecovery: proof => { calls.push("persist-recovery"); files.set("recovery.json", proof); },
        });
        closed = true; child.emit("close", 1, null);
      } else if (!closed) { closed = true; child.emit("close", 0, null); }
      else { if (at === "deadline") clock = 331001; deliver("final-yield"); }
    },
    closeOwnedGroup: async owner => { calls.push(owner.pid === 100 ? "backend-group-close" : "work-group-close"); deliver("closure"); return { passed: true }; },
    native: () => { deliver("generated"); return { done: Promise.resolve(good) }; },
    acceptEvidence: helper.acceptEvidence, rmSync: () => {},
  };
  vm.createContext(context);
  const run = vm.runInContext(body + "\nrun", context);
  let rejected = false;
  try { await run(); } catch { rejected = true; }
  if (at === "after-return") deliver("after-return");
  return { delivered, rejected, proof: files.get("result.json"), calls, exitCode: context.process.exitCode };
}

test("both cancellation signals remain authoritative through closure, generated diff and proof writing", async () => {
  const control = await fakeOuterRun(null, null);
  assert.equal(control.proof.status, "passed");
  for (const signal of ["SIGTERM", "SIGINT"]) for (const at of ["closure", "generated", "proof-write", "final-yield"]) {
    const result = await fakeOuterRun(signal, at);
    assert.ok(result.delivered, `${signal} ${at}`);
    assert.equal(result.proof.status, "failed", `${signal} ${at}`);
    assert.equal(result.proof.cancelled, true, `${signal} ${at}`);
    assert.equal(result.rejected, true, `${signal} ${at}`);
  }
});


test("outer cancellation waits for persisted recovery after partial setup and active driver", async () => {
  for (const signal of ["SIGTERM", "SIGINT"]) for (const stage of ["seed", "first-binding", "driver"]) {
    const result = await fakeOuterRun(signal, "work", stage);
    assert.equal(result.proof.status, "failed");
    assert.equal(result.proof.cancelled, true);
    assert.equal(result.rejected, true);
    assert.ok(result.calls.indexOf("persist-recovery") < result.calls.indexOf("backend-group-close"));
    for (const operation of ["stop-work", "fixture-cleanup", "manifest-empty", "remove-VRDEX_VRCDN_OUTPUT_ACCOUNTS_JSON", "remove-VRDEX_EVENT_MEDIA_BRIDGE_TOKEN", "remove-envfile"]) assert.ok(result.calls.includes(operation), operation);
  }
});

test("phase supervision accepts only a closed workload with complete cleanup", async () => {
  const clean = { status: "passed", fixtureCleanup: true, manifestEmpty: true, bindingsRemoved: { VRDEX_VRCDN_OUTPUT_ACCOUNTS_JSON: true, VRDEX_EVENT_MEDIA_BRIDGE_TOKEN: true }, privateFileRemoved: true };
  for (const changed of [{}, { close: false }, { code: 1 }]) {
    const result = await helper.supervisePhase(330000, {
      now: () => 1000, pause: async () => {}, closed: () => true, cancelled: () => false,
      stopWork: async () => ({ passed: true }), nativeResult: async () => ({ code: 0, signal: null, close: true, ...changed }),
      phaseProof: () => clean, recover: () => { throw Error("unexpected recovery"); }, saveRecovery: () => {},
    });
    assert.equal(result.status, Object.keys(changed).length ? "failed" : "passed");
    assert.equal(result.recovery.independent, false);
  }
});


test("final proof yield cannot pass after deadline or lose a signal before process exit", async () => {
  const expired = await fakeOuterRun(null, "deadline");
  assert.equal(expired.proof.status, "failed");
  assert.equal(expired.rejected, true);
  for (const signal of ["SIGTERM", "SIGINT"]) {
    const cancelled = await fakeOuterRun(signal, "after-return");
    assert.equal(cancelled.proof.status, "failed");
    assert.equal(cancelled.proof.cancelled, true);
    assert.equal(cancelled.exitCode, 1);
  }
});
