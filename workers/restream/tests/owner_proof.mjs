/** Run the same owner, decoder timing, and renderer regressions on the image's Node runtime. */
import { run } from "node:test";
import { pathToFileURL } from "node:url";
import { nativeFailureType } from "../../../scripts/event-marker-native132-receipt.mjs";
export async function summarizeOwnerProof(events) {
  const outcomes = [];
  let overflow = false;
  for await (const event of events) {
    if (!["test:pass", "test:fail"].includes(event.type)) continue;
    if (outcomes.length >= 90) {
      overflow = true;
      continue;
    }
    const data = event.data;
    const name =
      typeof data.name === "string" &&
      /^[A-Za-z0-9 ,'/\-]{1,180}$/.test(data.name)
        ? data.name
        : "invalid_test_identifier";
    const cause = data.details?.error?.cause;
    const type = event.type === "test:fail" && !data.skip && !data.todo
      ? nativeFailureType(cause?.code) ?? nativeFailureType(cause?.message)
      : undefined;
    outcomes.push({
      test: name,
      outcome: data.skip
        ? "skipped"
        : data.todo
          ? "todo"
          : event.type === "test:pass"
            ? "passed"
            : "failed",
      ...(type === undefined ? {} : { type }),
    });
  }
  return {
    testsRun: outcomes.length,
    outcomes,
    passed:
      !overflow &&
      outcomes.length === 90 &&
      outcomes.every(
        (row) =>
          row.outcome === "passed" && row.test !== "invalid_test_identifier",
      ),
  };
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  console.log(JSON.stringify(await summarizeOwnerProof(run({
    files: [
      "tests/backend/event-twitch-input.test.ts",
      "tests/backend/event-broadcast-renderer.test.ts",
      "tests/native/event-media-timing.test.mjs",
      "tests/scripts/event-capacity-output-contracts.test.mjs",
    ],
    execArgv: ["--experimental-strip-types"],
    timeout: 90000,
    concurrency: 1,
  }))));
}
