import assert from "node:assert/strict";
import { it } from "node:test";
import { migrationInput } from "../../scripts/media-kit-publication-migration.mjs";
it("defaults bounded migration to dry-run and requires explicit apply", () => {
  assert.deepEqual(migrationInput([]), { operation: "convertBatch", input: { dryRun: true, cursor: null, limit: 40 } });
  assert.deepEqual(migrationInput(["--apply", "--limit", "1", "--cursor", "next"]), { operation: "convertBatch", input: { dryRun: false, cursor: "next", limit: 1 } });
  assert.throws(() => migrationInput(["--limit", "41"]));
  assert.throws(() => migrationInput(["--oops"]));
});
