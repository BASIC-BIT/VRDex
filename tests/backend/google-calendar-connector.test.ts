import assert from "node:assert/strict";
import { describe, it } from "node:test";
import schemaModule from "../../convex/schema";
const schema = (schemaModule as unknown as { default?: typeof schemaModule }).default ?? schemaModule;

describe("staging import removal", () => {
  it("drops the callerless calendar staging tables", () => {
    for (const table of ["eventImportBatches", "eventImportCandidates", "eventImportCandidateFields"]) {
      assert.equal(table in schema.tables, false, table);
    }
  });
});
