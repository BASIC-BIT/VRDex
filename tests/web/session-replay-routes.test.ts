import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { describe, it } from "node:test";

const appRoot = path.join(process.cwd(), "apps", "web", "src", "app");

/**
 * Route groups whose pages render data the viewer's account can see but the
 * public cannot.
 *
 * Session replay records every route (product decision, 2026-07-27) and is kept
 * safe by masking. `maskAllInputs` masks input *values* only — not rendered
 * text and not `<option>` labels — so a private display name, headline, avatar
 * alt text, proof code, or bearer-token path segment reaches PostHog unless the
 * surface is blocked.
 *
 * Four separate leaks on these routes reached review one at a time, each fix
 * covering exactly the element reported while the next unmarked surface leaked
 * identically. This list is the mechanism that replaces that loop: adding a
 * private route group without a blocking layout fails here rather than in
 * production.
 */
const PRIVATE_ROUTE_GROUPS = [
  "account",
  "claim",
  "developers",
  // Shared authoring implementation and the old `/events/new` entry point. The
  // live create and edit pages are community-scoped and mark themselves.
  "events",
  "handoff",
  "lookup",
  "oauth",
  // The one page whose purpose is collecting a narrative: which account someone
  // lost, why a listing is really about them, and links to whatever proves it.
  // A textarea's value is masked, so nothing leaks on today's markup; that is
  // the objection. Masking would be the only thing between a replay session and
  // an ownership dispute.
  "support",
  // The parser echoes the user's expression back as model-derived clarification
  // and failure text.
  "time",
] as const;

/**
 * Route groups whose pages render nothing the public cannot already see.
 *
 * Listed rather than assumed: the check below requires every route group to
 * appear in exactly one of these two lists, so a new one cannot be added
 * without someone deciding which it is. Naming a group here is that decision,
 * and it is the failure mode this file exists to prevent — five leaks reached
 * review one surface at a time, and each fix covered only the surface reported.
 */
const PUBLIC_ROUTE_GROUPS = [
  // Public profiles and worlds use root slugs. Event display is nested below a
  // community, while event authoring marks its private region directly.
  "[slug]",
  "auth",
  "deployment",
  "discover",
  "discovery",
  "l",
  // Fixture routes, and 404 in production unless explicitly enabled.
  "playwright",
  "privacy",
  "search",
  "sign-in",
  "sign-up",
  "submit",
] as const;

describe("session replay route blocking", () => {
  // The list above only helps for routes somebody remembered to add to it.
  // `/time` and the event editor were both missed, and both leaked. Every route
  // group that renders a page has to be classified one way or the other before
  // it can ship.
  it("classifies every route group as private or public", () => {
    const groups = fs
      .readdirSync(appRoot, { withFileTypes: true })
      .filter((entry) => entry.isDirectory())
      // Next.js private folders are not routable.
      .filter((entry) => !entry.name.startsWith("_"))
      // Route handlers, not rendered pages: nothing for replay to capture.
      .filter((entry) =>
        fs.existsSync(path.join(appRoot, entry.name, "page.tsx")) ||
        fs
          .readdirSync(path.join(appRoot, entry.name), { recursive: true })
          .some((child) => String(child).endsWith("page.tsx")),
      )
      .map((entry) => entry.name);
    const classified = new Set<string>([...PRIVATE_ROUTE_GROUPS, ...PUBLIC_ROUTE_GROUPS]);

    assert.deepEqual(
      groups.filter((group) => !classified.has(group)),
      [],
      "add the route group to PRIVATE_ROUTE_GROUPS (with a blocking layout) or to PUBLIC_ROUTE_GROUPS",
    );
  });

  for (const group of PRIVATE_ROUTE_GROUPS) {
    it(`blocks /${group} from replay at the layout`, () => {
      const layoutPath = path.join(appRoot, group, "layout.tsx");

      assert.ok(
        fs.existsSync(layoutPath),
        `apps/web/src/app/${group}/layout.tsx must exist so the whole route is blocked from replay`,
      );
      assert.match(
        fs.readFileSync(layoutPath, "utf8"),
        /data-ph-no-capture/,
        `apps/web/src/app/${group}/layout.tsx must carry data-ph-no-capture`,
      );
    });
  }

  // Private data also renders on *public* routes, where a layout cannot reach
  // it: seed suggestions on `/` and `/search`. Those need the marker on the
  // component, and this pins the ones that have it so a refactor cannot quietly
  // drop it.
  const COMPONENT_BLOCKED = ["apps/web/src/app/_components/lookup-search-box.tsx"] as const;

  const PAGE_BLOCKED = [
    "apps/web/src/app/events/event-edit-page.tsx",
    "apps/web/src/app/events/event-editor-page.tsx",
  ] as const;

  for (const file of COMPONENT_BLOCKED) {
    it(`keeps the private region in ${file.split("/").pop()} blocked`, () => {
      assert.match(
        fs.readFileSync(path.join(process.cwd(), file), "utf8"),
        /data-ph-no-capture/,
        `${file} renders non-public data on a public route and must block it`,
      );
    });
  }

  for (const file of PAGE_BLOCKED) {
    it(`keeps the private region in ${file.split("/").pop()} blocked`, () => {
      assert.match(
        fs.readFileSync(path.join(process.cwd(), file), "utf8"),
        /data-ph-no-capture/,
        `${file} renders private event-authoring data on a community route and must block it`,
      );
    });
  }

  // The selector the layouts rely on has to stay the one PostHog is configured
  // to block; renaming it in one place and not the other fails silently.
  it("uses the configured block selector", async () => {
    const { SESSION_REPLAY_MASKED_SELECTOR } = await import(
      "../../apps/web/src/lib/posthog"
    );

    assert.ok(SESSION_REPLAY_MASKED_SELECTOR.includes("[data-ph-no-capture]"));
  });
});
