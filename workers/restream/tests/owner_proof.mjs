/** Run the same owner, decoder timing, and renderer regressions on the image's Node runtime. */
import { run } from "node:test";
const outcomes = [];
let overflow = false;
for await (const event of run({
  files: [
    "tests/backend/event-twitch-input.test.ts",
    "tests/backend/event-broadcast-renderer.test.ts",
    "tests/scripts/event-media-timing.test.mjs",
    "tests/scripts/event-capacity-output-contracts.test.mjs",
  ],
  execArgv: ["--experimental-strip-types"],
  timeout: 90000,
  concurrency: 1,
})) {
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
  outcomes.push({
    test: name,
    outcome: data.skip
      ? "skipped"
      : data.todo
        ? "todo"
        : event.type === "test:pass"
          ? "passed"
          : "failed",
  });
}
console.log(
  JSON.stringify({
    testsRun: outcomes.length,
    outcomes,
    passed:
      !overflow &&
      outcomes.length === 90 &&
      outcomes.every(
        (row) =>
          row.outcome === "passed" && row.test !== "invalid_test_identifier",
      ),
  }),
);
