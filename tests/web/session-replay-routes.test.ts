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
  "handoff",
  "lookup",
  "oauth",
] as const;

describe("session replay route blocking", () => {
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

  // The selector the layouts rely on has to stay the one PostHog is configured
  // to block; renaming it in one place and not the other fails silently.
  it("uses the configured block selector", async () => {
    const { SESSION_REPLAY_MASKED_SELECTOR } = await import(
      "../../apps/web/src/lib/posthog"
    );

    assert.equal(SESSION_REPLAY_MASKED_SELECTOR, "[data-ph-no-capture]");
  });
});
