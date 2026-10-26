import assert from 'node:assert/strict';
const BYTE_CAP=128*1024;
export function validateReceipt(raw, names) {
  assert.ok(Buffer.byteLength(raw) <= BYTE_CAP, 'receipt byte limit');
  const receipt = JSON.parse(raw); // Exactly one complete JSON document.
  for (const [key, value] of Object.entries({ schemaVersion: 1, terminal: true, passed: true, case: 'all', deterministic: true })) {
    assert.equal(receipt[key], value, key);
  }
  assert.ok(!Object.hasOwn(receipt, 'failurePhase') && !Object.hasOwn(receipt, 'failureCode'), 'failure fields');
  for (const [summary, expected, count] of [[receipt.tests, names.python, 42], [receipt.tests?.owner, names.node, 90]]) {
    assert.equal(summary.testsRun, count);
    assert.equal(summary.passed, true);
    assert.equal(expected.length, count);
    assert.equal(new Set(expected).size, count, 'expected identities must be unique');
    assert.equal(summary.outcomes.length, count);
    for (const outcome of summary.outcomes) {
      assert.deepEqual(Object.keys(outcome).sort(), ['outcome', 'test']);
      assert.equal(outcome.outcome, 'passed');
    }
    assert.deepEqual(summary.outcomes.map(row => row.test).sort(), [...expected].sort(), 'required identities');
  }
  assert.ok(Number.isFinite(receipt.tests.cancellationMs) && receipt.tests.cancellationMs >= 0 && receipt.tests.cancellationMs <= 1500, 'cancellation bound');
  assert.equal(receipt.cleanup.closed, true);
  assert.equal(receipt.cleanup.liveChildren, 0);
  assert.equal(receipt.cleanup.liveGroups, 0);
  return { python: 42, node: 90 };
}
