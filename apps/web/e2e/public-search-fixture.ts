import { randomUUID } from "node:crypto";
import { expect, test as base, type Page } from "@playwright/test";

type SearchProfile = { displayName: string; profilePath: string; website: string };
type SearchFixture = { query: string; profiles: SearchProfile[] };

export async function waitForPublicSearchHydration(page: Page) {
  // The SSR input accepts fill() before React installs its change handler.
  // Wait for this control, rather than treating the document load as hydration.
  await expect.poll(() => page.getByRole("combobox", { name: /Search/i }).evaluate((input) =>
    Object.keys(input).some((key) => {
      if (!key.startsWith("__reactProps$")) return false;
      const props: unknown = Reflect.get(input, key);
      return props !== null && typeof props === "object" && "onChange" in props
        && typeof props.onChange === "function" && "onKeyDown" in props
        && typeof props.onKeyDown === "function";
    }),
  ), { message: "Public search control has hydrated event handlers" }).toBe(true);
}

export const test = base.extend<{
  createSearchProfiles: (count: number) => Promise<SearchFixture>;
}>({
  createSearchProfiles: async ({ request, baseURL }, provide) => {
    const hostname = new URL(baseURL ?? "").hostname;
    if (!["127.0.0.1", "localhost", "[::1]"].includes(hostname)) {
      throw new Error("Public search fixtures require a local loopback target.");
    }
    const headers = { "x-vrdex-e2e-token": process.env.VRDEX_E2E_BROWSER_TOKEN ?? "local-playwright-token" };
    const runs: Array<{ runId: string; created: number }> = [];
    try {
      await provide(async (count) => {
        const query = `search${randomUUID().replaceAll("-", "").slice(0, 24)}`;
        const run = { runId: `playwright-${query}`, created: 0 };
        runs.push(run);
        const profiles: SearchProfile[] = [];
        for (let index = 0; index < count; index++) {
          const displayName = index === 0
            ? `Princess Starlight Interstellar Bassline Orchestra ${index}`
            : `Search Preview ${index}`;
          const website = `https://website.example.invalid/${query}/princess-starlight-interstellar-bassline-orchestra-${index}`;
          const response = await request.post("/api/e2e/profile-submissions", {
            headers,
            data: { runId: run.runId, profileType: "person", displayName, tags: [query],
              outboundLinks: [{ type: "website", url: website }] },
          });
          await expect(response).toBeOK();
          run.created++;
          const body: unknown = await response.json();
          if (!body || typeof body !== "object" || !("profilePath" in body) || typeof body.profilePath !== "string") {
            throw new Error("Profile submission did not return a canonical profile path.");
          }
          profiles.push({ displayName, profilePath: body.profilePath, website });
        }
        return { query, profiles };
      });
    } finally {
      for (const run of runs) {
        const cleanup = await request.delete("/api/e2e/profile-submissions", { headers, data: { runId: run.runId } });
        await expect(cleanup).toBeOK();
        expect(await cleanup.json()).toEqual({ deleted: run.created });
      }
    }
  },
});
