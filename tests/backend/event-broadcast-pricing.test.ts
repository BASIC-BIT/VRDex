import assert from "node:assert/strict";
import { test } from "node:test";

const rates = () => import("../../workers/restream/broadcast-rates.mjs");
const key = {
  region: "us-east-1",
  os: "linux",
  architecture: "x86_64",
  purchaseModel: "on_demand",
};
test("allocation sets dated compute price regardless of utilization", async () => {
  const { estimateComputeRate } = await rates();
  const allocation = { cpuUnits: 4096, memoryMiB: 8192 };
  const idle = estimateComputeRate({ ...key, allocation, cpuUsagePercent: 0 });
  const busy = estimateComputeRate({
    ...key,
    allocation,
    cpuUsagePercent: 100,
  });
  assert.deepEqual(idle, busy);
  assert.ok(idle && Math.abs(idle.usdPerHour - 0.19748) < 1e-10);
  assert.deepEqual(Object.keys(idle).sort(), [
    "currency",
    "rateDate",
    "scope",
    "usdPerHour",
  ]);
  assert.equal(idle.currency, "USD");
  assert.equal(idle.scope, "cpu_memory");
  assert.equal(idle.rateDate, "2026-10-22");
  const large = estimateComputeRate({
    ...key,
    allocation: { cpuUnits: 8192, memoryMiB: 16384 },
  });
  assert.ok(large && Math.abs(large.usdPerHour - 0.39496) < 1e-10);
});
test("unknown, mismatched and invalid rate keys never guess a price", async () => {
  const { estimateComputeRate } = await rates();
  const input = { ...key, allocation: { cpuUnits: 4096, memoryMiB: 8192 } };
  for (const patch of [
    { region: "eu-west-1" },
    { os: "windows" },
    { architecture: "arm64" },
    { purchaseModel: "spot" },
    { purchaseModel: undefined },
    { os: undefined },
    { allocation: undefined },
    { allocation: { cpuUnits: 0, memoryMiB: 8192 } },
    { allocation: { cpuUnits: NaN, memoryMiB: 8192 } },
    { allocation: { cpuUnits: 4096, memoryMiB: -1 } },
    { allocation: { cpuUnits: 4096, memoryMiB: 1.5 } },
  ]) {
    assert.equal(estimateComputeRate({ ...input, ...patch }), undefined);
  }
});
