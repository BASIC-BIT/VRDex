import assert from "node:assert/strict";
import { test } from "node:test";
import { readFileSync } from "node:fs";
import { verifyRuntimePlan } from "../../packages/media-relay/src/verification/terraform-plan";
const fixture = () =>
  JSON.parse(
    readFileSync(
      new URL("../fixtures/media-relay/planned-runtime.json", import.meta.url),
      "utf8",
    ),
  );
test("production Terraform structured config parses at runtime with only named provider unknowns filled", () => {
  const result = verifyRuntimePlan(fixture());
  assert.equal(result.workers, 2);
  assert.equal(result.substitutions.length, 9);
  for (const mutate of [
    (p: any) =>
      (p.after.gateway.origins = Array(21).fill("https://app.invalid")),
    (p: any) =>
      (p.after.workers["0"].binding.allocation.evidenceId = "invalid spaces"),
    (p: any) => {
      delete p.after.gateway.globalSourceCap;
      p.after_unknown.gateway.globalSourceCap = true;
    },
    (p: any) => {
      delete p.after.workers["0"].binding.maxSources;
      p.after_unknown.workers["0"].binding.maxSources = true;
    },
  ]) {
    const plan = fixture();
    mutate(plan);
    assert.throws(() => verifyRuntimePlan(plan));
  }
});
