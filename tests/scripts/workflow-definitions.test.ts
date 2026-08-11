import assert from "node:assert/strict";
import { readFile, readdir } from "node:fs/promises";
import { describe, it } from "node:test";

import { parse as parseYaml } from "yaml";

/**
 * GitHub validates workflow syntax at dispatch time, not in any check we run,
 * so a malformed workflow ships green and only fails when somebody tries to use
 * it. Deleting a `workflow_dispatch` input left its `default:` line behind
 * once, which turned the staging deploy into an invalid workflow that every
 * check still passed over.
 */
describe("workflow definitions", () => {
  it("parses every workflow and defines every dispatch input as a mapping", async () => {
    const directory = ".github/workflows";
    const files = (await readdir(directory)).filter((name) => /\.ya?ml$/.test(name));

    assert.ok(files.length > 0, "No workflow files were found.");

    for (const file of files) {
      const source = await readFile(`${directory}/${file}`, "utf8");
      let document: unknown;

      try {
        document = parseYaml(source);
      } catch (error) {
        assert.fail(`${file} is not valid YAML: ${(error as Error).message}`);
      }

      // `on` is the YAML 1.1 boolean `true`, which the parser may hand back
      // under either key depending on the schema in force.
      const triggers = (document as Record<string, unknown>)?.on
        ?? (document as Record<string, unknown>)?.["true"];
      const dispatch = (triggers as Record<string, unknown> | undefined)?.workflow_dispatch;
      const inputs = (dispatch as Record<string, unknown> | undefined)?.inputs;

      if (inputs === undefined || inputs === null) {
        continue;
      }

      assert.equal(
        typeof inputs === "object" && !Array.isArray(inputs),
        true,
        `${file} declares workflow_dispatch.inputs that is not a mapping.`,
      );

      for (const [name, definition] of Object.entries(inputs as Record<string, unknown>)) {
        assert.equal(
          definition !== null && typeof definition === "object" && !Array.isArray(definition),
          true,
          `${file} input "${name}" is not an input definition mapping.`,
        );
        assert.equal(
          typeof (definition as Record<string, unknown>).type === "string",
          true,
          `${file} input "${name}" is missing a type.`,
        );
      }
    }
  });
});
