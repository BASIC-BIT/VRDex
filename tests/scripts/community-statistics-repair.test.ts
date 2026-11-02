import assert from "node:assert/strict";
import { test } from "node:test";
import {
  parseRepairArgs,
  validateRepairManifest,
} from "../../scripts/repair-community-statistics.mjs";
test("repair CLI requires an explicit target, mode and reviewed inventory", () => {
  assert.throws(() => parseRepairArgs([]), /target/);
  assert.throws(
    () => parseRepairArgs(["--target", "prod", "--mode", "apply"]),
    /inventory/,
  );
  assert.throws(
    () =>
      parseRepairArgs([
        "--target",
        "prod",
        "--mode",
        "apply",
        "--inventory",
        "reviewed.json",
        "--unexpected",
        "x",
      ]),
    /Unknown/,
  );
  assert.equal(
    parseRepairArgs([
      "--target",
      "prod",
      "--mode",
      "apply",
      "--inventory",
      "reviewed.json",
    ]).mode,
    "apply",
  );
});
test("a reviewed repair manifest cannot expand to another deployment or target range", () => {
  const manifest = {
    inventoryId: "one",
    deployment: "prod:one",
    integrationId: "integration",
    startAt: 0,
    endAt: 3600000,
    version: "community-telemetry-v2",
    previewed: true,
    targets: [
      {
        grain: "hour",
        bucketStartAt: 0,
        bucketEndAt: 3600000,
        status: "ready",
      },
    ],
  };
  assert.doesNotThrow(() => validateRepairManifest(manifest, "prod:one"));
  assert.throws(
    () => validateRepairManifest(manifest, "prod:other"),
    /deployment/,
  );
  assert.throws(
    () =>
      validateRepairManifest(
        {
          ...manifest,
          targets: [{ ...manifest.targets[0], bucketEndAt: 7200000 }],
        },
        "prod:one",
      ),
    /scope/,
  );
  assert.throws(
    () => validateRepairManifest({ ...manifest, previewed: false }, "prod:one"),
    /dry run/,
  );
  assert.throws(
    () =>
      validateRepairManifest(
        {
          ...manifest,
          targets: [{ ...manifest.targets[0], status: "blocked" }],
        },
        "prod:one",
      ),
    /blocked/,
  );
});
