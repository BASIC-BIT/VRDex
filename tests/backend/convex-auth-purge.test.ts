import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { describe, it } from "node:test";

import { CONVEX_AUTH_TABLES, USER_REFERENCES } from "../../convex/migrations";

const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..", "..");
const schema = readFileSync(path.join(repoRoot, "convex", "schema.ts"), "utf8");

/** Every `<field>: v.id("users")` and `v.optional(v.id("users"))`, by table. */
function userReferencesInSchema(): string[] {
  const tableStarts = [...schema.matchAll(/^ {2}(\w+): defineTable\(/gm)];
  const references: string[] = [];

  for (const [index, start] of tableStarts.entries()) {
    const table = start[1];
    const from = start.index ?? 0;
    const to = tableStarts[index + 1]?.index ?? schema.length;
    const body = schema.slice(from, to);

    for (const field of body.matchAll(/(\w+): v\.(?:optional\(v\.)?id\("users"\)/g)) {
      references.push(`${table}.${field[1]}`);
    }
  }

  return references.sort();
}

describe("Convex Auth purge", () => {
  // The purge deletes legacy `users` rows. Convex does not enforce referential
  // integrity, so a reference this list misses becomes a dangling id that still
  // reads as a valid `v.id("users")` and resolves to nothing — silent corruption
  // that surfaces much later as a null owner on someone's token or grant.
  //
  // This is the check that makes the hand-maintained list safe: adding a new
  // `v.id("users")` field to the schema fails here until the purge knows about it.
  it("checks every users reference in the schema", () => {
    const declared = new Set(USER_REFERENCES.map(([table, field]) => `${table}.${field}`));
    const purged = new Set<string>(CONVEX_AUTH_TABLES);

    const unchecked = userReferencesInSchema().filter(
      (reference) => !declared.has(reference) && !purged.has(reference.split(".")[0]),
    );

    assert.deepEqual(
      unchecked,
      [],
      `convex/migrations.ts USER_REFERENCES is missing ${unchecked.join(", ")}. ` +
        "Add each one, or the purge will delete a users row something still points at.",
    );
  });

  // The inverse. A stale entry is not corrupting, but it means the list has
  // drifted from the schema, and a list nobody trusts stops getting checked.
  it("does not name references the schema no longer has", () => {
    const inSchema = new Set(userReferencesInSchema());
    const stale = USER_REFERENCES.map(([table, field]) => `${table}.${field}`).filter(
      (reference) => !inSchema.has(reference),
    );

    assert.deepEqual(stale, [], `USER_REFERENCES names references that no longer exist: ${stale.join(", ")}`);
  });

  // The eight declarations the phase-two schema change removes. Clearing a table
  // the schema still declares is harmless; missing one blocks that change with a
  // populated-table rejection at deploy time, which is exactly the failure the
  // two-phase removal exists to avoid.
  it("clears every table the schema drop removes", () => {
    for (const table of [
      "authSessions",
      "authAccounts",
      "authRefreshTokens",
      "authVerificationCodes",
      "authVerifiers",
      "authRateLimits",
      "recentAuthChallenges",
      "e2eAuthCodes",
    ]) {
      assert.ok(
        (CONVEX_AUTH_TABLES as readonly string[]).includes(table),
        `${table} is declared in the phase-one block but the purge never clears it.`,
      );
    }
  });
});
