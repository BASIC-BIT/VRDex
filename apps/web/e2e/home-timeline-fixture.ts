import { randomUUID } from "node:crypto";
import { test as base, expect } from "@playwright/test";
import { withTimelineFixtureLease } from "./home-timeline-lease";
export const TIMELINE_NOW = Date.UTC(2026, 9, 26, 21, 30);
export type TimelineFixture = {
  runId: string;
  eventIds: string[];
  slotIds: string[];
  profileIds: string[];
};
export const test = base.extend<{
  timelineFixture: TimelineFixture;
  timelineScenario:
    | "default"
    | "prefetch"
    | "detail"
    | "discovery"
    | "discovery-dense"
    | "discovery-sparse"
    | "discovery-clubs"
    | "timeline-visual"
    | "short-sets";
  timelineStartAt: number;
}>({
  timelineScenario: ["default", { option: true }],
  timelineStartAt: [TIMELINE_NOW - 30 * 60000, { option: true }],
  page: async ({ page, timelineFixture, request }, provide, info) => {
    const diagnostics: { kind: string; message: string }[] = [];
    const capture = (kind: string, message: string) => {
      if (diagnostics.length < 50)
        diagnostics.push({ kind, message: message.slice(0, 2000) });
    };
    page.on("pageerror", (error) =>
      capture("pageerror", error.stack ?? error.message),
    );
    page.on("console", (message) => {
      if (message.type() === "error") capture("console", message.text());
    });
    page.on("requestfailed", (request) => {
      const url = new URL(request.url());
      capture(
        "requestfailed",
        `${url.origin}${url.pathname}: ${request.failure()?.errorText ?? "unknown"}`,
      );
    });
    const runtimeDiagnostics =
      process.env.VRDEX_E2E_BOOT_DIAGNOSTICS === "true"
        ? await page.context().newCDPSession(page)
        : null;
    if (runtimeDiagnostics) {
      await runtimeDiagnostics.send("Runtime.enable");
      runtimeDiagnostics.on(
        "Runtime.exceptionThrown",
        ({ exceptionDetails: d }) => {
          capture(
            "exception-location",
            JSON.stringify({
              text: d.text,
              url: d.url,
              scriptId: d.scriptId,
              line: d.lineNumber,
              column: d.columnNumber,
              description: d.exception?.description,
            }),
          );
          const scriptId = d.scriptId;
          if (scriptId)
            void (async () => {
              // Enable the debugger after a fault, preserving normal bootstrap timing.
              await runtimeDiagnostics.send("Debugger.enable");
              const { scriptSource } = await runtimeDiagnostics.send(
                "Debugger.getScriptSource",
                { scriptId },
              );
              const lines = scriptSource.split("\n");
              const line = lines[d.lineNumber] ?? lines[0] ?? "";
              capture(
                "exception-source",
                JSON.stringify({
                  bytes: scriptSource.length,
                  lines: lines.length,
                  excerpt: line.slice(
                    Math.max(0, d.columnNumber - 500),
                    d.columnNumber + 500,
                  ),
                }),
              );
            })().catch((error) => capture("diagnostic-error", String(error)));
        },
      );
    }
    // Only the run-owned image URL is bridged to original local artwork.
    // Public event/profile query responses always come from the real backend.
    const artwork = await request.get(
      "/api/e2e/fixture-assets/fixture-prism-timeline-logo",
    );
    await expect(artwork).toBeOK();
    const artworkBody = await artwork.body();
    await page
      .context()
      .route(
        `https://timeline-artwork.invalid/${timelineFixture.runId}/prism.svg`,
        async (route) => {
          await route.fulfill({
            body: artworkBody,
            contentType: "image/svg+xml",
          });
        },
      );
    try {
      await provide(page);
    } finally {
      if (info.status !== info.expectedStatus) {
        const documentState = await page
          .evaluate(() => ({
            readyState: document.readyState,
            visibility: document.visibilityState,
            hasFocus: document.hasFocus(),
            scheduleState:
              document
                .querySelector('[aria-label="Schedule data state"]')
                ?.getAttribute("data-state") ?? null,
            scripts: [...document.scripts].map((script) =>
              script.src ? new URL(script.src).pathname : "inline",
            ),
          }))
          .catch(() => null);
        await info.attach("home-browser-diagnostics.json", {
          body: JSON.stringify({ diagnostics, documentState }, null, 2),
          contentType: "application/json",
        });
      }
      await runtimeDiagnostics?.detach().catch(() => {});
    }
  },
  timelineFixture: [
    async (
      { request, baseURL, timelineScenario, timelineStartAt },
      provide,
    ) => {
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
      // Keep every derived profile slug inside the canonical 64-character limit.
      const runId = `playwright-timeline-${randomUUID().replaceAll("-", "").slice(0, 24)}`;
      await withTimelineFixtureLease(
        process.env.PLAYWRIGHT_CONVEX_URL ??
          process.env.CONVEX_URL ??
          "http://127.0.0.1:3210",
        async (blockAfterCleanupFailure) => {
          try {
            const response = await request.post("/api/e2e/home-timeline", {
              headers,
              data:
                timelineScenario === "prefetch"
                  ? {
                      runId,
                      startAt: Date.UTC(2026, 9, 26),
                      scenario: "prefetch",
                    }
                  : {
                      runId,
                      startAt: timelineStartAt,
                      ...(timelineScenario === "detail" ||
                      timelineScenario === "timeline-visual" ||
                      timelineScenario === "short-sets" ||
                      timelineScenario.startsWith("discovery")
                        ? { scenario: timelineScenario }
                        : {}),
                    },
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
            try {
              const cleanup = await request.delete("/api/e2e/home-timeline", {
                headers,
                data: { runId },
              });
              await expect(cleanup).toBeOK();
              const counts: unknown = await cleanup.json();
              // A disconnected POST can commit after DELETE reads zero. Only
              // exact owned cleanup proves the attempted create is cleared.
              expect(counts).toEqual({
                events:
                  timelineScenario === "timeline-visual"
                    ? 10
                    : timelineScenario === "discovery-dense"
                      ? 246
                      : timelineScenario === "discovery-sparse"
                        ? 1
                        : timelineScenario === "discovery" ||
                            timelineScenario === "discovery-clubs"
                          ? 2
                          : 8,
                profiles:
                  timelineScenario === "timeline-visual"
                    ? 5
                    : timelineScenario === "discovery-clubs"
                      ? 32
                      : timelineScenario === "discovery-dense"
                        ? 8
                        : timelineScenario.startsWith("discovery")
                          ? 4
                          : timelineScenario === "detail"
                            ? 3
                            : 2,
                slots:
                  timelineScenario === "timeline-visual"
                    ? 10
                    : timelineScenario === "discovery-dense"
                      ? 5
                      : timelineScenario === "discovery-sparse"
                        ? 1
                        : timelineScenario === "discovery" ||
                            timelineScenario === "discovery-clubs"
                          ? 2
                          : timelineScenario === "detail"
                            ? 87
                            : 8,
                ...(timelineScenario === "detail" ? { lineupEntries: 2 } : {}),
              });
            } catch (error) {
              blockAfterCleanupFailure();
              throw error;
            }
          }
        },
        { runId },
      );
    },
    { timeout: 150_000 },
  ],
});

export async function changeTimelineFixture(
  request: import("@playwright/test").APIRequestContext,
  fixture: TimelineFixture,
  eventIndex: number,
  state: "cancelled" | "hidden" | "recreate-slot" | "suppress-host",
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
