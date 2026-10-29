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
          "16",
          "--deadline",
          "30",
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
