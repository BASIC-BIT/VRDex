import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { describe, it } from "node:test";

import { LIVE_ROUTE_SLUGS, isLiveRouteSlug, isReservedSlug } from "../../convex/_globalSlugs";

const appRoot = path.join(process.cwd(), "apps", "web", "src", "app");
const nextConfigPath = path.join(process.cwd(), "apps", "web", "next.config.ts");

/**
 * Profiles, worlds, and events render from the site root, so `/[slug]` is the last
 * route Next tries. Anything that resolves ahead of it wins -- which means the day
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

/**
 * Top-level URL segments the app serves.
 *
 * Route groups are traversed rather than skipped. `app/(marketing)/pricing/page.tsx`
 * adds no `(marketing)` segment to the URL but still serves `/pricing`, so skipping
 * the group would have let a shadowing route land while this test stayed green.
 */
function routeSegmentsIn(directory: string): string[] {
  return fs
    .readdirSync(directory, { withFileTypes: true })
    .filter((entry) => entry.isDirectory())
    // Next.js private folders (`_components`) are not routable.
    .filter((entry) => !entry.name.startsWith("_"))
    // `.well-known` cannot collide: a slug can never contain a dot.
    .filter((entry) => !entry.name.startsWith("."))
    // `[slug]` is the resolver itself, not a name it has to avoid.
    .filter((entry) => !entry.name.startsWith("["))
    .flatMap((entry) =>
      entry.name.startsWith("(")
        ? routeSegmentsIn(path.join(directory, entry.name))
        : [entry.name],
    );
}

/**
 * First path segments of configured rewrites.
 *
 * A `beforeFiles` rewrite runs ahead of the filesystem, so it shadows a slug even
 * though no directory exists for it. `/ingest/:path*` proxies to PostHog, and a
 * profile slugged `ingest` would have its own subpaths swallowed by analytics.
 */
function rewriteSegments(): string[] {
  const config = fs.readFileSync(nextConfigPath, "utf8");

  return [...config.matchAll(/source:\s*"\/([^/":]+)/g)].map((match) => match[1] as string);
}

describe("reserved route slugs", () => {
  it("reserves every top-level route segment the app serves", () => {
    const routeSegments = routeSegmentsIn(appRoot);

    // Nothing to check against would make this pass vacuously.
    assert.ok(routeSegments.length > 5, "expected to find the app's route directories");

    assert.deepEqual(
      routeSegments.filter((segment) => !isLiveRouteSlug(segment)),
      [],
      "add these to LIVE_ROUTE_SLUGS in convex/_globalSlugs.ts -- a slug matching a real route resolves to the route, not to its owner",
    );
  });

  it("reserves every configured rewrite prefix", () => {
    const segments = rewriteSegments();

    assert.ok(segments.length > 0, "expected to find rewrites in next.config.ts");

    assert.deepEqual(
      segments.filter((segment) => !isLiveRouteSlug(segment)),
      [],
      "add these to LIVE_ROUTE_SLUGS -- a beforeFiles rewrite runs ahead of the filesystem and shadows a slug with no directory to show for it",
    );
  });

  it("claims no live route that the app does not actually serve", () => {
    // The read paths trust this list to mean "a real page answers here". A name
    // held for a page we have not built belongs in FUTURE_ROUTE_SLUGS: listing it
    // as live made the support intake reject a pasted link to a profile that
    // exists, which is how `basicbit` broke.
    const served = new Set([...routeSegmentsIn(appRoot), ...rewriteSegments()]);

    assert.deepEqual(
      LIVE_ROUTE_SLUGS.filter((slug) => !served.has(slug)),
      [],
      "move these to FUTURE_ROUTE_SLUGS -- nothing serves them, so they shadow nothing",
    );
  });

  it("keeps held names unassignable without treating them as live routes", () => {
    for (const held of ["pricing", "about", "basicbit", "basic"]) {
      assert.equal(isReservedSlug(held), true, `${held} should stay unassignable`);
      assert.equal(isLiveRouteSlug(held), false, `${held} is not a route`);
    }
  });
});
