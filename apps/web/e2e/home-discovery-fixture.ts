import { expect, type Page } from "@playwright/test";
import {
  discoveryRotationKey,
  discoveryRotationScore,
} from "../src/lib/discovery/rotation";
import type { TimelineFixture } from "./home-timeline-fixture";
export {
  test,
  TIMELINE_NOW,
  changeTimelineFixture,
} from "./home-timeline-fixture";

export async function initializeDiscovery(
  page: Page,
  fixture: TimelineFixture,
  favoriteProfileIds = fixture.profileIds.slice(0, 2),
  theme: "dark" | "light" = "dark",
) {
  // Generated IDs enter the production tie hash. Choose a local test seed
  // that keeps the two fixed visual identities in a stable order.
  let seed = "";
  for (let attempt = 0; attempt < 10000; attempt++) {
    const candidate = `discovery-${attempt}`;
    const key = discoveryRotationKey({
      seed: candidate,
      localDate: "2026-10-26",
    });
    if (
      (fixture.eventIds.length < 2 ||
        discoveryRotationScore(key, fixture.eventIds[0]) <
          discoveryRotationScore(key, fixture.eventIds[1])) &&
      discoveryRotationScore(key, fixture.profileIds[0]) <
        discoveryRotationScore(key, fixture.profileIds[2])
    ) {
      seed = candidate;
      break;
    }
  }
  if (!seed) throw Error("No stable fixture rotation seed");
  await page.addInitScript(
    ({ favoriteProfileIds, seed, theme }) => {
      if (!sessionStorage.getItem("vrdex.discovery.session.v1"))
        sessionStorage.setItem("vrdex.discovery.session.v1", seed);
      if (!localStorage.getItem("vrdex.timeline.preferences.v1"))
        localStorage.setItem(
          "vrdex.timeline.preferences.v1",
          JSON.stringify({ version: 1, plan: [], favoriteProfileIds }),
        );
      localStorage.setItem("vrdex-theme", theme);
    },
    { favoriteProfileIds, seed, theme },
  );
}
export async function usableDiscovery(page: Page) {
  const discover = page.getByRole("region", { name: "Discover", exact: true });
  await discover.scrollIntoViewIfNeeded();
  await expect(
    discover.getByTestId("discovery-event-card").first(),
  ).toBeVisible({ timeout: 20000 });
  return discover;
}
const record = (value: unknown): value is Record<string, unknown> =>
  typeof value === "object" && value !== null && !Array.isArray(value);
/** Counts protocol registrations/revalidations, retaining no frames or arguments. */
export function observeDiscoveryQueries(page: Page) {
  const active = new Set<number>(),
    pending = new Set<number>();
  const counts: Record<string, number> = {};
  const seenArguments = new Set<string>();
  let repeatedArgumentsAdditions = 0,
    journalAdditions = 0;
  const favoriteLineupBounds = { maxEvents: 0, maxFavorites: 0, emptyRequests: 0 };
  let firstAddedAt: number | undefined;
  let maximumActive = 0,
    maximumPending = 0;
  page.on("websocket", (socket) => {
    // Count only Convex data sockets. HMR close events must not reset
    // discovery watcher counts during route changes.
    if (!/^\/api\/[^/]+\/sync$/.test(new URL(socket.url()).pathname)) return;
    socket.on("framesent", ({ payload }) => {
      const value: unknown = JSON.parse(String(payload));
      if (
        !record(value) ||
        value.type !== "ModifyQuerySet" ||
        !Array.isArray(value.modifications)
      )
        return;
      for (const item of value.modifications) {
        if (!record(item) || typeof item.queryId !== "number") continue;
        if (item.type === "Remove") {
          active.delete(item.queryId);
          pending.delete(item.queryId);
        }
        if (
          item.type === "Add" &&
          typeof item.udfPath === "string" &&
          item.udfPath.startsWith("homeDiscovery:")
        ) {
          if (item.udfPath === "homeDiscovery:favoriteLineup" && Array.isArray(item.args) && record(item.args[0])) {
            const args = item.args[0];
            if (Array.isArray(args.eventIds) && Array.isArray(args.favoriteProfileIds)) {
              favoriteLineupBounds.maxEvents = Math.max(favoriteLineupBounds.maxEvents, args.eventIds.length);
              favoriteLineupBounds.maxFavorites = Math.max(favoriteLineupBounds.maxFavorites, args.favoriteProfileIds.length);
              if (!args.eventIds.length || !args.favoriteProfileIds.length) favoriteLineupBounds.emptyRequests++;
            }
          }
          const identity = JSON.stringify([item.udfPath, item.args]);
          if (seenArguments.has(identity)) repeatedArgumentsAdditions++;
          else seenArguments.add(identity);
          if (item.journal !== undefined && item.journal !== null)
            journalAdditions++;
          firstAddedAt ??= performance.now();
          counts[item.udfPath] = (counts[item.udfPath] ?? 0) + 1;
          active.add(item.queryId);
          pending.add(item.queryId);
          maximumActive = Math.max(maximumActive, active.size);
          maximumPending = Math.max(maximumPending, pending.size);
        }
      }
    });
    socket.on("framereceived", ({ payload }) => {
      const value: unknown = JSON.parse(String(payload));
      if (
        record(value) &&
        value.type === "Transition" &&
        Array.isArray(value.modifications)
      )
        for (const item of value.modifications) {
          if (record(item) && typeof item.queryId === "number")
            pending.delete(item.queryId);
        }
    });
    socket.on("close", () => {
      active.clear();
      pending.clear();
    });
  });
  return {
    result: () => ({
      counts: { ...counts },
      favoriteLineupBounds: { ...favoriteLineupBounds },
      totalAdditions: Object.values(counts).reduce((a, b) => a + b, 0),
      active: active.size,
      pending: pending.size,
      maximumActive,
      maximumPending,
      firstAddedAt,
      repeatedArgumentsAdditions,
      firstTimeArgumentsAdditions: seenArguments.size,
      journalAdditions,
    }),
  };
}
/** Failure injection only: every successful payload still comes from local Convex. */
export async function discoveryTransportFailure(page: Page) {
  let fail = false;
  const queries = new Set<number>();
  await page.routeWebSocket("**/api/**/sync", (socket) => {
    const server = socket.connectToServer();
    socket.onMessage((message) => {
      const value: unknown = JSON.parse(String(message));
      if (
        record(value) &&
        value.type === "ModifyQuerySet" &&
        Array.isArray(value.modifications)
      )
        for (const item of value.modifications) {
          if (!record(item) || typeof item.queryId !== "number") continue;
          if (
            item.type === "Add" &&
            typeof item.udfPath === "string" &&
            item.udfPath.startsWith("homeDiscovery:")
          )
            queries.add(item.queryId);
          else if (item.type === "Remove") queries.delete(item.queryId);
        }
      server.send(message);
    });
    server.onMessage((message) => {
      const value: unknown = JSON.parse(String(message));
      if (
        fail &&
        record(value) &&
        value.type === "Transition" &&
        Array.isArray(value.modifications)
      ) {
        value.modifications = value.modifications.map((item) =>
          record(item) &&
          item.type === "QueryUpdated" &&
          typeof item.queryId === "number" &&
          queries.has(item.queryId)
            ? {
                type: "QueryFailed",
                queryId: item.queryId,
                errorMessage: "Injected discovery transport failure",
                errorData: null,
                logLines: [],
                journal: item.journal,
              }
            : item,
        );
        socket.send(JSON.stringify(value));
      } else socket.send(message);
    });
  });
  return {
    setFailure(value: boolean) {
      fail = value;
    },
  };
}
