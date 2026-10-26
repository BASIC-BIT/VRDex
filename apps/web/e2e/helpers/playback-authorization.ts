import type { Page } from "@playwright/test";
import { playbackFixtureEvent } from "../../src/app/playwright/event-playback/fixture-state";

/** Supply only the invented UI fixture identities; real backend queries fall through. */
export async function playbackAuthorization(page: Page, twitch = false) {
  const reads: string[] = [];
  let revoked = false;
  const convexUrl = process.env.PLAYWRIGHT_CONVEX_URL ?? "http://127.0.0.1:3210";
  await page.route(`${convexUrl}/api/query`, async route => {
    const body: unknown = route.request().postDataJSON();
    if (!body || typeof body !== "object" || !("path" in body) || body.path !== "events:getPublicBySlug" || !("args" in body) || !Array.isArray(body.args)) {
      await route.fallback();
      return;
    }
    const args: unknown = body.args[0];
    if (!args || typeof args !== "object" || !("slug" in args) || (args.slug !== "a" && args.slug !== "b")) {
      await route.fallback();
      return;
    }
    reads.push(args.slug);
    await route.fulfill({ json: { status: "success", value: revoked ? null : playbackFixtureEvent(args.slug, twitch, Date.now() - 1000) } });
  });
  return { reads, revoke() { revoked = true; } };
}
