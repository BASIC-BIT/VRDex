import assert from "node:assert/strict";
import { it } from "node:test";
import { spawnSync } from "node:child_process";
import { fileURLToPath } from "node:url";
import { migrationInput } from "../../scripts/media-kit-publication-migration.mjs";
it("defaults bounded migration to dry-run and requires explicit apply", () => {
  assert.deepEqual(migrationInput([]), { operation: "convertBatch", input: { dryRun: true, cursor: null, limit: 40 } });
  assert.deepEqual(migrationInput(["--apply", "--limit", "1", "--cursor", "next"]), { operation: "convertBatch", input: { dryRun: false, cursor: "next", limit: 1 } });
  assert.throws(() => migrationInput(["--limit", "41"]));
  assert.throws(() => migrationInput(["--oops"]));
});
it("malformed apply commands exit before target resolution or a Convex subprocess", () => {
  const script = fileURLToPath(new URL("../../scripts/media-kit-publication-migration.mjs", import.meta.url));
  for (const option of ["--target", "--cursor", "--limit", "--correction-file"]) {
    const result = spawnSync(process.execPath, ["--import", "tsx", script, option, "--apply"], { encoding: "utf8", windowsHide: true });
    assert.equal(result.status, 1);
    assert.match(result.stderr, new RegExp(`Missing value for ${option}`));
    assert.equal(result.stdout, "");
    assert.doesNotMatch(result.stderr, /convex .*\(.*\), (dry-run|apply)/);
  }
});
it("rejects every supplied value option without a nonempty value before choosing an operation", () => {
  for (const option of ["--target", "--cursor", "--limit", "--correction-file"]) {
    for (const args of [[option], [option, "--apply"], ["--apply", option], [option, ""], [option, "   ", "--apply"], [`${option}=`, "--apply"], [`${option}=--apply`]]) {
      assert.throws(() => migrationInput(args), undefined, JSON.stringify(args));
    }
  }
  for (const args of [["--apply", "--apply"], ["--cursor", "next", "--cursor", "again"], ["--target", "dev", "--target=prod"], ["--oops", "--apply"], ["--limit=1", "--apply"]]) assert.throws(() => migrationInput(args));
});
