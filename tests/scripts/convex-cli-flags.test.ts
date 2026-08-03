import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import path from "node:path";
import { describe, it } from "node:test";

import {
  CONVEX_CLI_COMMANDS,
  CONVEX_CLI_KNOWN_SAFE_FLAGS,
  CONVEX_TARGET_SELECTOR_FLAGS,
} from "../../scripts/convex-target";

const repoRoot = path.resolve(import.meta.dirname, "..", "..");
const convexCliPath = path.join(repoRoot, "node_modules", "convex", "bin", "main.js");

function advertisedFlags(command: string) {
  const result = spawnSync(process.execPath, [convexCliPath, command, "--help"], {
    encoding: "utf8",
    windowsHide: true,
  });

  assert.equal(result.status, 0, `convex ${command} --help failed`);

  return [...new Set(result.stdout.match(/--[a-z][a-z-]*/g) ?? [])];
}

describe("convex cli deployment selectors", () => {
  // The selector denylist was wrong twice when written from memory: it carried
  // --deployment, which the CLI does not have, and omitted --deployment-name
  // and --env-file, which it does. This asserts against the installed CLI so a
  // flag added by a future release has to be classified rather than silently
  // becoming a way to redirect a command past its chosen target.
  // Inspecting only `run` is what let --preview-create through: it belongs to
  // `deploy`. Every subcommand cx can forward is swept.
  it("classifies every flag the installed CLI advertises", () => {
    const classified = new Set([...CONVEX_TARGET_SELECTOR_FLAGS, ...CONVEX_CLI_KNOWN_SAFE_FLAGS]);
    const unclassified = [
      ...new Set(CONVEX_CLI_COMMANDS.flatMap((command) => advertisedFlags(command))),
    ]
      .filter((flag) => !classified.has(flag))
      .sort();

    assert.deepEqual(
      unclassified,
      [],
      `Unclassified convex flags: ${unclassified.join(", ")}. ` +
        "Add each to CONVEX_TARGET_SELECTOR_FLAGS if it can change which deployment is " +
        "reached, or to CONVEX_CLI_KNOWN_SAFE_FLAGS if it cannot.",
    );
  });

  it("rejects every selector the CLI documents", () => {
    const selectors = [
      "--prod",
      "--preview-name",
      "--preview-create",
      "--deployment-name",
      "--env-file",
      "--url",
    ];
    const documented = [
      ...new Set(CONVEX_CLI_COMMANDS.flatMap((command) => advertisedFlags(command))),
    ].filter((flag) => selectors.includes(flag));

    // Guards the guard: if none matched, the help output shape changed and the
    // sweep above would be vacuously passing.
    assert.ok(documented.length >= 4, `only found ${documented.length} known selectors`);

    for (const flag of documented) {
      assert.ok(
        CONVEX_TARGET_SELECTOR_FLAGS.includes(flag),
        `${flag} selects a deployment but is not rejected`,
      );
    }
  });
});
