import { randomUUID } from "node:crypto";
import { test as base, expect } from "@playwright/test";
export const TIMELINE_NOW = Date.UTC(2026, 9, 26, 21, 30);
export type TimelineFixture = {
  runId: string;
  eventIds: string[];
  slotIds: string[];
  profileIds: string[];
};
export const test = base.extend<{
  timelineFixture: TimelineFixture;
  timelineScenario: "default" | "prefetch";
}>({
  timelineScenario: ["default", { option: true }],
  timelineFixture: async ({ request, baseURL, timelineScenario }, provide) => {
    if (
      !["127.0.0.1", "localhost", "[::1]"].includes(
        new URL(baseURL ?? "").hostname,
      )
    )
      throw Error("Timeline fixtures require loopback");
    const headers = {
      "x-vrdex-e2e-token":
        process.env.VRDEX_E2E_BROWSER_TOKEN ?? "local-playwright-token",
    };
    const runId = `playwright-timeline-${randomUUID()}`;
    try {
      const response = await request.post("/api/e2e/home-timeline", {
        headers,
        data:
          timelineScenario === "prefetch"
            ? { runId, startAt: Date.UTC(2026, 9, 26), scenario: "prefetch" }
            : { runId, startAt: TIMELINE_NOW - 30 * 60000 },
      });
      await expect(response).toBeOK();
      const value: unknown = await response.json();
      if (
        !value ||
        typeof value !== "object" ||
        !("eventIds" in value) ||
        !Array.isArray(value.eventIds) ||
        !value.eventIds.every((id) => typeof id === "string") ||
        !("slotIds" in value) ||
        !Array.isArray(value.slotIds) ||
        !value.slotIds.every((id) => typeof id === "string") ||
        !("profileIds" in value) ||
        !Array.isArray(value.profileIds) ||
        !value.profileIds.every((id) => typeof id === "string")
      )
        throw Error("Invalid timeline fixture result");
      await provide({
        runId,
        eventIds: value.eventIds,
        slotIds: value.slotIds,
        profileIds: value.profileIds,
      });
    } finally {
      const cleanup = await request.delete("/api/e2e/home-timeline", {
        headers,
        data: { runId },
      });
      await expect(cleanup).toBeOK();
      expect(await cleanup.json()).toEqual({
        events: 8,
        profiles: 2,
        slots: 8,
      });
    }
  },
});

export async function changeTimelineFixture(
  request: import("@playwright/test").APIRequestContext,
  fixture: TimelineFixture,
  eventIndex: number,
  state: "cancelled" | "hidden",
) {
  const result = await request.patch("/api/e2e/home-timeline", {
    headers: {
      "x-vrdex-e2e-token":
        process.env.VRDEX_E2E_BROWSER_TOKEN ?? "local-playwright-token",
    },
    data: { runId: fixture.runId, eventIndex, state },
  });
  await expect(result).toBeOK();
}
