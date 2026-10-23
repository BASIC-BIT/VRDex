import assert from "node:assert/strict";
import test from "node:test";
import { spawnSync } from "node:child_process";
import { mkdtemp, writeFile, rm } from "node:fs/promises";

async function summary(body) {
  const directory = await mkdtemp("/tmp/event-proof-summary-");
  try {
    await writeFile(
      `${directory}/noisy_contract.py`,
      `import os, sys, unittest\nclass Contract(unittest.TestCase):\n${body}\n`,
    );
    const child = spawnSync(
      "python3",
      ["-m", "workers.restream.tests.proof_suite", "noisy_contract"],
      {
        env: { ...process.env, PYTHONPATH: directory },
        timeout: 10000,
        maxBuffer: 262144,
        encoding: "utf8",
      },
    );
    assert.equal(child.status, 0);
    assert.equal(child.stderr, "");
    assert(!child.stdout.includes("secret-provider-text"));
    return JSON.parse(child.stdout);
  } finally {
    await rm(directory, { recursive: true, force: true });
  }
}
test("named summary isolates noisy Python and subprocess output without swallowing failure", async () => {
  const value = await summary(
    `    def test_noisy(self):\n        print('TWITCH_BUFFER_FACTS {}')\n        print('secret-provider-text', file=sys.stderr)\n        os.write(1, b'secret-provider-text')\n        os.write(2, b'secret-provider-text')\n        self.fail('secret-provider-text')`,
  );
  assert.equal(value.testsRun, 1);
  assert.equal(value.passed, false);
  assert.deepEqual(value.outcomes, [
    {
      test: "noisy_contract.Contract.test_noisy",
      outcome: "failed",
      type: "AssertionError",
    },
  ]);
});
test("required skipped, expected-failure, unexpected-success and failed subtests are explicit failures", async () => {
  const value = await summary(
    `    @unittest.skip('secret-provider-text')\n    def test_skip(self): pass\n    @unittest.expectedFailure\n    def test_expected(self): self.fail('secret-provider-text')\n    @unittest.expectedFailure\n    def test_unexpected(self): pass\n    def test_subtest(self):\n        with self.subTest(url='secret-provider-text'):\n            self.fail('secret-provider-text')`,
  );
  assert.equal(value.testsRun, 4);
  assert.equal(value.passed, false);
  assert.deepEqual(value.outcomes.map((x) => x.outcome).sort(), [
    "expected_failure",
    "failed",
    "skipped",
    "unexpected_success",
  ]);
});
test("clean named summary retains success", async () => {
  const value = await summary('    def test_ok(self): print("noise")');
  assert.equal(value.passed, true);
  assert.equal(value.testsRun, 1);
  assert.equal(value.outcomes[0].outcome, "passed");
});

import { createPublicObservations } from "../../scripts/event-public-input-proof.mjs";
import { parseNamedSummary } from "../../scripts/event-twitch-input-proof.mjs";
test("public startup diagnostics retain typed acquisition and decoder facts without provider text", () => {
  let now = 10;
  const observations = createPublicObservations(
    ["source-0", "source-1"],
    () => now,
  );
  observations.state("source-0", {
    kind: "acquiring",
    url: "secret-provider-text",
  });
  now = 20;
  observations.state("source-0", { kind: "unavailable", reason: "tls_denied" });
  observations.state("source-1", {
    kind: "unavailable",
    reason: "secret-provider-text",
  });
  observations.decoder({
    sourceId: "source-0",
    ready: false,
    error: "secret-provider-text",
  });
  const before = observations.snapshot();
  assert.equal(before.realAdMarkersObserved, false);
  assert.equal(before.sources["source-0"].latest.reason, "tls_denied");
  assert.equal(
    before.sources["source-1"].latest.reason,
    "provider_unavailable",
  );
  assert.equal(before.sources["source-0"].decoder.observed, true);
  assert.equal(before.sources["source-1"].decoder.observed, false);
  for (let i = 0; i < 200; i++)
    observations.state("source-1", { kind: "ad_wait" });
  observations.decoder({ sourceId: "source-0", ready: true });
  observations.decoder({ sourceId: "source-0", ready: false });
  const value = observations.snapshot();
  assert.equal(value.realAdMarkersObserved, true);
  assert.equal(value.realAdPlaybackObserved, false);
  assert.equal(value.sources["source-1"].counts.ad_wait, 200);
  assert.equal(value.sources["source-1"].events.length, 128);
  assert.equal(value.sources["source-1"].droppedEvents, 73);
  assert.equal(value.sources["source-0"].decoder.losses, 1);
  assert(!JSON.stringify(value).includes("secret-provider-text"));
});
test("summary boundary rejects missing counts and never treats required skips as passing", () => {
  const encode = (value) => Buffer.from(JSON.stringify(value));
  const okay = {
    testsRun: 1,
    passed: true,
    outcomes: [{ test: "contract", outcome: "passed" }],
  };
  assert.equal(parseNamedSummary(encode(okay)).passed, true);
  assert.equal(parseNamedSummary(encode(okay), 9).passed, false);
  assert.throws(() => parseNamedSummary(encode({ ...okay, testsRun: 2 })));
  assert.throws(() =>
    parseNamedSummary(
      Buffer.from("TWITCH_BUFFER_FACTS {}\n" + JSON.stringify(okay)),
    ),
  );
  assert.throws(() =>
    parseNamedSummary(
      encode({
        ...okay,
        outcomes: [{ ...okay.outcomes[0], url: "secret-provider-text" }],
      }),
    ),
  );
  for (const outcome of [
    "skipped",
    "expected_failure",
    "unexpected_success",
    "todo",
    "error",
    "failed",
  ]) {
    assert.equal(
      parseNamedSummary(
        encode({ ...okay, outcomes: [{ test: "contract", outcome }] }),
      ).passed,
      false,
    );
  }
});

test("class setup failure emits a sanitized terminal outcome", async () => {
  const value = await summary(
    '    @classmethod\n    def setUpClass(cls): raise RuntimeError("secret-provider-text")\n    def test_never(self): pass',
  );
  assert.equal(value.passed, false);
  assert.equal(value.testsRun, 1);
  assert.equal(value.outcomes[0].outcome, "error");
  assert.equal(value.outcomes[0].type, "RuntimeError");
});
