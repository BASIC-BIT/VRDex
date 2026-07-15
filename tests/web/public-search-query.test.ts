import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, it } from "node:test";

import { publicSearchBackendFilters } from "../../apps/web/src/lib/server/public-search-query";

const repositoryRoot = resolve(import.meta.dirname, "../..");

function source(path: string) {
  return readFileSync(resolve(repositoryRoot, path), "utf8");
}

describe("public search backend query boundaries", () => {
  it("maps profile subtypes into backend filters before result limiting", () => {
    assert.deepEqual(publicSearchBackendFilters("person"), {
      entityType: "profile",
      profileType: "person",
    });
    assert.deepEqual(publicSearchBackendFilters("community"), {
      entityType: "profile",
      profileType: "community",
    });
    assert.deepEqual(publicSearchBackendFilters("profile"), { entityType: "profile" });
    assert.deepEqual(publicSearchBackendFilters("world"), { entityType: "world" });
    assert.deepEqual(publicSearchBackendFilters("all"), {});
  });

  it("uses the dedicated bounded upcoming-events query from REST and MCP", () => {
    const route = source("apps/web/src/app/api/v0/events/upcoming/route.ts");
    const mcp = source("apps/web/src/lib/server/vrdex-mcp.ts");
    const search = source("convex/search.ts");

    assert.match(route, /api\.search\.listUpcomingEvents, \{ now: Date\.now\(\), limit \}/);
    assert.match(mcp, /api\.search\.listUpcomingEvents, \{ now: now\(\), limit: cappedLimit \}/);
    assert.match(search, /export const listUpcomingEvents = query\(/);
    assert.match(search, /listUpcomingEventDocuments\(ctx, now, limit\)/);
  });
});
