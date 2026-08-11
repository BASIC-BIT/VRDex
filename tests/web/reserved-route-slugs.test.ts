import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { describe, it } from "node:test";

import { RESERVED_ROUTE_SLUGS, isReservedSlug } from "../../convex/_globalSlugs";

const appRoot = path.join(process.cwd(), "apps", "web", "src", "app");

/**
 * Profiles, worlds, and events render from the site root, so `/[slug]` is the last
 * route Next tries. A static segment always wins over it -- which means the day
 * someone adds `apps/web/src/app/pricing/`, an existing profile whose slug is
 * `pricing` silently stops resolving and serves the pricing page instead.
 *
 * The four per-entity reserved lists this replaced had already drifted apart from
 * each other and from the real route tree: none of them held `lookup`, `submit`,
 * `claim`, `discover`, `developers`, `handoff`, `mcp`, `oauth`, `time`, or
 * `deployment`, all of which were live routes. Prefixed URLs hid that. At the root
 * it would have been a live collision.
 *
 * So the list is checked against the filesystem rather than maintained by memory.
 */
describe("reserved route slugs", () => {
  it("reserves every top-level route segment the app serves", () => {
    const routeSegments = fs
      .readdirSync(appRoot, { withFileTypes: true })
      .filter((entry) => entry.isDirectory())
      // Next.js private folders (`_components`) are not routable.
      .filter((entry) => !entry.name.startsWith("_"))
      // `.well-known` cannot collide: a slug can never contain a dot.
      .filter((entry) => !entry.name.startsWith("."))
      // Route groups add no URL segment.
      .filter((entry) => !entry.name.startsWith("("))
      // `[slug]` is the resolver itself, not a name it has to avoid.
      .filter((entry) => !entry.name.startsWith("["))
      .map((entry) => entry.name);

    // Nothing to check against would make this pass vacuously.
    assert.ok(routeSegments.length > 5, "expected to find the app's route directories");

    assert.deepEqual(
      routeSegments.filter((segment) => !isReservedSlug(segment)),
      [],
      "add these to RESERVED_ROUTE_SLUGS in convex/_globalSlugs.ts -- a slug matching a real route resolves to the route, not to its owner",
    );
  });

  it("keeps the reserved list itself assignable-shaped and unique", () => {
    const duplicates = RESERVED_ROUTE_SLUGS.filter(
      (slug, index) => RESERVED_ROUTE_SLUGS.indexOf(slug) !== index,
    );

    assert.deepEqual(duplicates, []);
  });
});
