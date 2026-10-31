import { readFileSync } from "node:fs";
import { verifyRuntimePlan } from "../packages/media-relay/src/verification/terraform-plan";
const path = process.argv[2];
if (!path)
  throw Error(
    "Supply terraform test -json -verbose output from a mock-provider plan",
  );
const entry = readFileSync(path, "utf8")
  .trim()
  .split("\n")
  .map((line) => JSON.parse(line))
  .find((row) => row["@testrun"] === "enabled_private_scoped" && row.test_plan);
if (!entry) throw Error("Missing enabled plan output");
console.log(
  JSON.stringify(
    verifyRuntimePlan(entry.test_plan.output_changes.runtime_config_review),
    null,
    2,
  ),
);
