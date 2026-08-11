import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { describe, it } from "node:test";

import {
  HELD_ROUTE_SLUGS,
  LIVE_ROUTE_SLUGS,
  ROUTE_PREFIX_SLUGS,
  isLiveRouteSlug,
  isReservedSlug,
  isRoutePrefixSlug,
} from "../../convex/_globalSlugs";
import { isProtectedRoute } from "../../apps/web/src/lib/protected-route-redirect";

const appRoot = path.join(process.cwd(), "apps", "web", "src", "app");
const nextConfigPath = path.join(process.cwd(), "apps", "web", "next.config.ts");

/**
 * Profiles, worlds, and events render from the site root, so `/[slug]` is the last
 * route Next tries. Anything that resolves ahead of it wins: the day someone adds
 * `apps/web/src/app/pricing/page.tsx`, a profile slugged `pricing` stops resolving
 * and serves the pricing page instead.
 *
 * The four per-entity reserved lists this replaced had already drifted apart from
 * each other and from the real route tree. Prefixed URLs hid that. At the root it
 * would have been a live collision, so the catalog is checked against the
 * filesystem rather than maintained by memory.
 */

/** A directory that answers `/<name>` itself, rather than only `/<name>/...`. */
function servesItsOwnPath(directory: string, segment: string): boolean {
  const entries = fs.readdirSync(directory, { withFileTypes: true });

  const hasOwnEndpoint = entries.some(
    (entry) => entry.isFile() && /^(page|route)\.(tsx?|jsx?)$/.test(entry.name),
  );

  // `sign-in/[[...sign-in]]` is an *optional* catch-all, so it matches `/sign-in`
  // with no extra segment. A required `[...x]` catch-all does not.
  const hasOptionalCatchAll = entries.some(
    (entry) =>
      entry.isDirectory() &&
      entry.name.startsWith("[[...") &&
      fs
        .readdirSync(path.join(directory, entry.name))
        .some((child) => /^(page|route)\.(tsx?|jsx?)$/.test(child)),
  );

  // The middleware redirects these before routing reaches a page, so `/claim`
  // never falls through to `[slug]` for the anonymous visitor who is most of the
  // traffic to a public profile.
  return hasOwnEndpoint || hasOptionalCatchAll || isProtectedRoute(`/${segment}`);
}

/**
 * Top-level segments where `/<segment>` resolves to something other than `[slug]`.
 *
 * Route groups are traversed rather than skipped: `app/(marketing)/pricing/page.tsx`
 * adds no `(marketing)` segment but still serves `/pricing`.
 *
 * A directory alone is not enough. `app/developers/` holds `/developers/api` and
 * friends but no page of its own, so Next falls through to `[slug]` and
 * `/developers` genuinely resolves a profile. Treating those as live made the
 * support intake reject working URLs and made the audit tell operators to rename
 * entities that were fine.
 */
function servedRootSegments(directory: string): string[] {
  return fs
    .readdirSync(directory, { withFileTypes: true })
    .filter((entry) => entry.isDirectory())
    // Next.js private folders (`_components`) are not routable.
    .filter((entry) => !entry.name.startsWith("_"))
    // `.well-known` cannot collide: a slug can never contain a dot.
    .filter((entry) => !entry.name.startsWith("."))
    // `[slug]` is the resolver itself, not a name it has to avoid.
    .filter((entry) => !entry.name.startsWith("["))
    .flatMap((entry) => {
      const child = path.join(directory, entry.name);

      if (entry.name.startsWith("(")) {
        return servedRootSegments(child);
      }

      return servesItsOwnPath(child, entry.name) ? [entry.name] : [];
    });
}

/** Every top-level directory, served or not. All of them stay unassignable. */
function allRouteDirectories(directory: string): string[] {
  return fs
    .readdirSync(directory, { withFileTypes: true })
    .filter((entry) => entry.isDirectory())
    .filter((entry) => !entry.name.startsWith("_"))
    .filter((entry) => !entry.name.startsWith("."))
    .filter((entry) => !entry.name.startsWith("["))
    .flatMap((entry) =>
      entry.name.startsWith("(")
        ? allRouteDirectories(path.join(directory, entry.name))
        : [entry.name],
    );
}

/**
 * First path segments of configured rewrites.
 *
 * A `beforeFiles` rewrite runs ahead of the filesystem, so it shadows a slug with
 * no directory to show for it. `/ingest/:path*` proxies to PostHog.
 */
function rewriteSegments(): string[] {
  const config = fs.readFileSync(nextConfigPath, "utf8");
  const rewritesAt = config.indexOf("async rewrites()");

  assert.notEqual(rewritesAt, -1, "expected a rewrites() block in next.config.ts");

  // Scoped to `rewrites()`. `headers()` matches on a `source:` too, and adding a
  // header to `/api/v0/:path*` does not make `/api` resolve anywhere new.
  return [...config.slice(rewritesAt).matchAll(/source:\s*"\/([^/":]+)/g)].map(
    (match) => match[1] as string,
  );
}

describe("reserved route slugs", () => {
  it("treats every served root path as a live route", () => {
    const served = servedRootSegments(appRoot);

    assert.ok(served.length > 5, "expected to find the app's served root paths");

    assert.deepEqual(
      served.filter((segment) => !isLiveRouteSlug(segment)),
      [],
      "add these to LIVE_ROUTE_SLUGS -- a slug matching a served route resolves to the route, not to its owner",
    );
  });

  it("reserves every configured rewrite prefix as live", () => {
    const segments = rewriteSegments();

    assert.ok(segments.length > 0, "expected to find rewrites in next.config.ts");

    assert.deepEqual(
      segments.filter((segment) => !isLiveRouteSlug(segment)),
      [],
      "add these to LIVE_ROUTE_SLUGS -- a beforeFiles rewrite runs ahead of the filesystem",
    );
  });

  it("keeps every route directory unassignable, served or not", () => {
    assert.deepEqual(
      allRouteDirectories(appRoot).filter((segment) => !isReservedSlug(segment)),
      [],
      "add these to LIVE_ROUTE_SLUGS, ROUTE_PREFIX_SLUGS, or HELD_ROUTE_SLUGS",
    );
  });

  it("catalogs every directory-only prefix as a route prefix", () => {
    // These do not shadow `/<name>`, but a profile holding one loses its own
    // `/<name>/edit` to that directory's routes. `slugAudit` reads this catalog to
    // report exactly that, so a prefix missing here is a migration it stays quiet
    // about.
    const served = new Set(servedRootSegments(appRoot));
    const directoryOnly = allRouteDirectories(appRoot).filter((segment) => !served.has(segment));

    assert.ok(directoryOnly.length > 0, "expected some directory-only prefixes");

    assert.deepEqual(
      directoryOnly.filter((segment) => !isRoutePrefixSlug(segment)),
      [],
      "add these to ROUTE_PREFIX_SLUGS -- the audit reports nested-route collisions from that catalog",
    );

    // And nothing claims to be a prefix that is not one.
    assert.deepEqual(
      ROUTE_PREFIX_SLUGS.filter((slug) => !directoryOnly.includes(slug)),
      [],
      "remove these from ROUTE_PREFIX_SLUGS -- no directory owns their nested routes",
    );
  });

  it("claims no live route that nothing actually serves", () => {
    // The read paths trust this list to mean "a real page answers here". Listing a
    // name that resolves through `[slug]` made the support intake throw away the
    // identifier on disputes about profiles that exist.
    const served = new Set([...servedRootSegments(appRoot), ...rewriteSegments()]);

    assert.deepEqual(
      LIVE_ROUTE_SLUGS.filter((slug) => !served.has(slug)),
      [],
      "move these to HELD_ROUTE_SLUGS -- nothing serves them, so they shadow nothing",
    );
  });

  it("keeps held names unassignable without treating them as live routes", () => {
    for (const held of ["pricing", "about", "basicbit", "basic", "developers", "events"]) {
      assert.equal(isReservedSlug(held), true, `${held} should stay unassignable`);
      assert.equal(isLiveRouteSlug(held), false, `${held} is not a served root path`);
    }

    // The two catalogs are disjoint, so a name cannot be quietly both.
    const live = new Set<string>(LIVE_ROUTE_SLUGS);
    assert.deepEqual(HELD_ROUTE_SLUGS.filter((slug) => live.has(slug)), []);
  });
});
