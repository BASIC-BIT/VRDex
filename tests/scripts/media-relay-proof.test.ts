import assert from "node:assert/strict";
import { test } from "node:test";
import { parseProofArgs, runProof } from "../../scripts/media-relay-proof";
import { controlCommand } from "../../scripts/media-relay-control";
test("proof defaults local and rejects malformed, unbounded and unapproved hosted targets", async () => {
  assert.equal(parseProofArgs([]).target, "local");
  for (const args of [
    ["--target"],
    ["--target", "prod"],
    ["--sources", "0"],
    ["--duration", "999999"],
    ["--bitrate", "0"],
    ["--deadline", "0"],
    ["--target", "local", "--target", "hosted"],
    ["--wat", "1"],
  ])
    assert.throws(() => parseProofArgs(args));
  await assert.rejects(
    runProof(parseProofArgs(["--target", "hosted"])),
    /approved|hosted/i,
  );
});
test("operator commands require explicit target and accept no credential or environment override", () => {
  for (const args of [
    [],
    ["disable"],
    ["--target", "wrong", "disable"],
    ["--target", "local", "disable", "--credential", "gateway"],
    ["--target", "prod", "disable", "--url", "http://localhost"],
  ])
    assert.throws(() => controlCommand(args));
  assert.deepEqual(controlCommand(["--target", "local", "disable"]), {
    target: "local",
    fn: "mediaRelayOperations:setRelayEnabled",
    args: { enabled: false },
  });
});
import { mkdtemp, readFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
test(
  "local proof measures real multi-source recovery and cleans children without provider calls",
  { timeout: 45000 },
  async () => {
    const output = await mkdtemp(join(tmpdir(), "relay-proof-test-"));
    try {
      const evidence = await runProof(
        parseProofArgs([
          "--sources",
          "2",
          "--duration",
          "30",
          "--deadline",
          "40",
          "--output",
          output,
        ]),
      );
      assert.equal(evidence.target, "local");
      assert.equal(evidence.providerCalls, 0);
      assert.equal(evidence.cleanup.childrenAlive, 0);
      assert.equal(evidence.cleanup.scratchBytes, 0);
      assert.ok(evidence.metrics.maxActiveSources >= 2);
      assert.ok(evidence.metrics.cpuSeconds > 0);
      assert.ok(evidence.metrics.memoryPeakBytes > 0);
      assert.ok(evidence.metrics.diskPeakBytes > 0);
      assert.ok(evidence.metrics.partialDiskPeakBytes >= 0);
      assert.equal(evidence.partialDiskBoundVerified, false);
      assert.ok(evidence.metrics.videoBytes > evidence.metrics.audioBytes);
      assert.ok(evidence.metrics.reconnects >= 2);
      assert.ok(evidence.metrics.recoveredSources === 2);
      assert.ok(evidence.metrics.queuePeak > 0);
      assert.ok(evidence.metrics.storageOperations.PUT > 0);
      assert.ok(evidence.metrics.uploadCacheHits > 0);
      assert.ok(evidence.metrics.coldStartupMs > 0);
      assert.ok(evidence.metrics.warmStartupMs > 0);
      assert.deepEqual(evidence.failures, []);
      assert.equal(
        JSON.parse(await readFile(join(output, "evidence.json"), "utf8"))
          .releaseEligible,
        false,
      );
    } finally {
      await rm(output, { recursive: true, force: true });
    }
  },
);
test(
  "deadline failure still emits cleanup evidence and reaps its children",
  { timeout: 15000 },
  async () => {
    const output = await mkdtemp(join(tmpdir(), "relay-proof-deadline-"));
    try {
      const evidence = await runProof(
        parseProofArgs([
          "--duration",
          "16",
          "--deadline",
          "1",
          "--output",
          output,
        ]),
      );
      assert.ok(evidence.failures.includes("deadline exceeded"));
      assert.equal(evidence.cleanup.childrenAlive, 0);
      assert.equal(evidence.cleanup.scratchBytes, 0);
    } finally {
      await rm(output, { recursive: true, force: true });
    }
  },
);
test(
  "late keyframes withhold completed uploads and cannot establish a partial-disk bound",
  { timeout: 30000 },
  async () => {
    const output = await mkdtemp(join(tmpdir(), "relay-proof-pressure-"));
    try {
      const evidence = await runProof(
        parseProofArgs([
          "--sources",
          "2",
          "--bitrate",
          "8000000",
          "--keyframe",
          "60",
          "--duration",
          "12",
          "--deadline",
          "25",
          "--output",
          output,
        ]),
      );
      assert.ok(evidence.metrics.upstreamBytes > 20000000);
      assert.ok(evidence.metrics.diskPeakBytes > 0);
      assert.ok(
        evidence.metrics.partialDiskPeakBytes >=
          evidence.metrics.tmpDiskPeakBytes,
      );
      assert.equal(evidence.metrics.storageOperations.PUT, 0);
      assert.ok(evidence.failures.includes("not all sources became ready"));
      assert.equal(evidence.partialDiskBoundVerified, false);
      assert.equal(evidence.cleanup.childrenAlive, 0);
      assert.equal(evidence.cleanup.scratchBytes, 0);
    } finally {
      await rm(output, { recursive: true, force: true });
    }
  },
);

import { spawn } from "node:child_process";
import { once } from "node:events";
import { mkdir, readdir, writeFile } from "node:fs/promises";
import { setTimeout as delay } from "node:timers/promises";
for (const signal of ["SIGINT", "SIGTERM"] as const) {
  test(`actual proof CLI forwards ${signal} and reaps detached proof`, { timeout: 15000 }, async () => {
    const root = await mkdtemp(join(tmpdir(), "relay-interrupt-test-"));
    const child = spawn(process.execPath, ["--import", "tsx", "scripts/media-relay-proof.ts", "--duration", "60", "--deadline", "70", "--output", join(root, "out")], { env: { ...process.env, TMPDIR: root }, stdio: "ignore" });
    const closed = once(child, "close");
    try {
      for (let i = 0; i < 100 && !(await readdir(root)).some(n => n.startsWith("relay-proof-work-")); i++) await delay(50);
      await delay(500);
      child.kill(signal);
      await Promise.race([closed, delay(8000).then(() => { throw Error("CLI failed to reap within bound"); })]);
      assert.deepEqual((await readdir(root)).filter(n => n.startsWith("relay-proof-work-")), []);
      const evidence = JSON.parse(await readFile(join(root, "out/evidence.json"), "utf8"));
      assert.ok(evidence.failures.includes("operator interrupted"));
      assert.equal(evidence.cleanup.childrenAlive, 0);
    } finally {
      child.kill("SIGKILL");
      // On RED, terminate only this test's detached descendant via its unique output argument.
      const { execFileSync } = await import("node:child_process");
      const rows = execFileSync("ps", ["-eo", "pid,args"], { encoding: "utf8" }).split("\n");
      for (const row of rows) if (row.includes("verification/main.ts") && row.includes(root)) {
        const pid = Number(row.trim().split(/\s/)[0]);
        try { process.kill(-pid, "SIGTERM"); } catch {}
      }
      await delay(500);
      await rm(root, { recursive: true, force: true });
    }
  });
}
test("post-scratch output setup failure cleans owned scratch", async () => {
  const root = await mkdtemp(join(tmpdir(), "relay-setup-test-"));
  await mkdir(join(root, "tmp"));
  await writeFile(join(root, "file"), "not a directory");
  const child = spawn(process.execPath, ["--import", "tsx", "scripts/media-relay-proof.ts", "--output", join(root, "file/out")], { env: { ...process.env, TMPDIR: join(root, "tmp") }, stdio: "ignore" });
  try {
    const [code] = await once(child, "close");
    assert.equal(code, 1);
    assert.deepEqual((await readdir(join(root, "tmp"))).filter(n => n.startsWith("relay-proof-work-")), []);
  } finally { await rm(root, { recursive: true, force: true }); }
});

test("post-scratch getconf failure cleans owned scratch", async () => {
  const { chmod } = await import("node:fs/promises");
  const root = await mkdtemp(join(tmpdir(), "relay-getconf-test-"));
  await mkdir(join(root, "bin"));
  await writeFile(join(root, "bin/getconf"), "#!/bin/sh\nexit 7\n");
  await chmod(join(root, "bin/getconf"), 0o755);
  const child = spawn(process.execPath, ["--import", "tsx", "scripts/media-relay-proof.ts", "--output", join(root, "out")], { env: { ...process.env, TMPDIR: root, PATH: `${join(root, "bin")}:${process.env.PATH}` }, stdio: "ignore" });
  try {
    const [code] = await once(child, "close");
    assert.equal(code, 1);
    assert.deepEqual((await readdir(root)).filter(n => n.startsWith("relay-proof-work-")), []);
  } finally { await rm(root, { recursive: true, force: true }); }
});
