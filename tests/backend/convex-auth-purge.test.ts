import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { describe, it } from "node:test";

import { CONVEX_AUTH_TABLES, USER_REFERENCES } from "../../convex/migrations";

const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..", "..");
const schema = readFileSync(path.join(repoRoot, "convex", "schema.ts"), "utf8");

// Whitespace-tolerant on purpose. The tight version matched only the one-line
// form, so a `v.optional(` wrapped across lines — which prettier will produce as
// soon as a field name is long enough — would vanish from the derived set and
// let the exhaustiveness check below pass while `USER_REFERENCES` was missing a
// field. A guard whose whole job is to make a hand-maintained list safe must not
// silently narrow what it looks at.
const USER_REFERENCE_PATTERN = /(\w+)\s*:\s*v\.(?:optional\(\s*v\.)?id\(\s*"users"\s*\)/g;

/** Every `<field>: v.id("users")` and `v.optional(v.id("users"))`, by table. */
export function userReferencesIn(source: string): string[] {
  const tableStarts = [...source.matchAll(/^ {2}(\w+): defineTable\(/gm)];
  const references: string[] = [];

  for (const [index, start] of tableStarts.entries()) {
    const table = start[1];
    const from = start.index ?? 0;
    const to = tableStarts[index + 1]?.index ?? source.length;
    const body = source.slice(from, to);

    for (const field of body.matchAll(USER_REFERENCE_PATTERN)) {
      references.push(`${table}.${field[1]}`);
    }
  }

  return references.sort();
}

function userReferencesInSchema(): string[] {
  return userReferencesIn(schema);
}

/** `.index("name", ["col", ...])` declarations for one table. */
function indexesOf(table: string): Map<string, string[]> {
  const tableStarts = [...schema.matchAll(/^ {2}(\w+): defineTable\(/gm)];
  const found = new Map<string, string[]>();

  for (const [index, start] of tableStarts.entries()) {
    if (start[1] !== table) {
      continue;
    }

    const body = schema.slice(start.index ?? 0, tableStarts[index + 1]?.index ?? schema.length);

    for (const declaration of body.matchAll(/\.index\("([^"]+)", \[([^\]]+)\]\)/g)) {
      found.set(
        declaration[1],
        declaration[2].split(",").map((column) => column.trim().replace(/"/g, "")),
      );
    }
  }

  return found;
}

describe("Convex Auth purge", () => {
  // The guard's own guard. Every other test here derives its expectations from
  // this parser, so a form it fails to see is invisible to all of them at once —
  // the schema grows a reference, nothing reports it, and the purge deletes a
  // row that still has one. Each shape below is a real thing prettier emits.
  it("sees every shape a users reference is written in", () => {
    const sample = [
      '  someTable: defineTable({',
      '    plain: v.id("users"),',
      '    inlineOptional: v.optional(v.id("users")),',
      '    wrappedOptional: v.optional(',
      '      v.id("users"),',
      '    ),',
      '    spacedCall: v.id( "users" ),',
      '    notAUser: v.id("profiles"),',
      '  }),',
      '  nextTable: defineTable({',
      '    alsoMine: v.id("users"),',
      '  }),',
    ].join("\n");

    assert.deepEqual(userReferencesIn(sample), [
      "nextTable.alsoMine",
      "someTable.inlineOptional",
      "someTable.plain",
      "someTable.spacedCall",
      "someTable.wrappedOptional",
    ]);
  });

  // The purge deletes legacy `users` rows. Convex does not enforce referential
  // integrity, so a reference this list misses becomes a dangling id that still
  // reads as a valid `v.id("users")` and resolves to nothing — silent corruption
  // that surfaces much later as a null owner on someone's token or grant.
  //
  // This is the check that makes the hand-maintained list safe: adding a new
  // `v.id("users")` field to the schema fails here until the purge knows about it.
  // The purge narrows `ctx.db.query(table)` to probe these by name, because a
  // union of table names collapses the valid index names to the ones every table
  // shares. That trade is only safe if the pairing is checked somewhere, and
  // here is somewhere: a name that does not exist, or one whose leading column is
  // not this field, throws mid-purge or silently matches on the wrong column.
  it("names an index that exists and leads with the field it probes", () => {
    for (const [table, field, index] of USER_REFERENCES) {
      if (index === null) {
        continue;
      }

      const columns = indexesOf(table).get(index);

      assert.ok(columns, `${table} has no index named ${index}, so the purge would throw probing it.`);
      assert.equal(
        columns[0],
        field,
        `${table}.${index} leads with ${columns[0]}, not ${field}. An equality on the wrong leading column matches the wrong rows.`,
      );
    }
  });

  // The inverse of the entry above: a field that *does* have a usable index but
  // is listed as null gets a full table scan it does not need. Harmless on a
  // bounded table, and a transaction-limit failure on one that grows per request.
  it("uses an index wherever the schema offers one", () => {
    const missed = USER_REFERENCES.filter(([table, field, index]) => {
      if (index !== null) {
        return false;
      }

      return [...indexesOf(table).values()].some((columns) => columns[0] === field);
    }).map(([table, field]) => `${table}.${field}`);

    assert.deepEqual(missed, [], `these could use an index but are scanned: ${missed.join(", ")}`);
  });

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
