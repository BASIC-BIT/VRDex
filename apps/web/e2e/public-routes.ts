import { expect, type Page, type TestInfo } from "@playwright/test";
import { mkdirSync } from "node:fs";
import path from "node:path";

const screenshotDir = path.join(process.cwd(), "playwright-artifacts", "screenshots");

export const visualProfilePaths = {
  personPath: "/p/playwright-dj-aurora",
  communityPath: "/c/playwright-afterglow-social",
  worldPath: "/w/playwright-neon-harbor",
  eventPath: "/e/playwright-afterglow-harbor-sessions",
  eventWatchPath: "/e/playwright-afterglow-watch-room",
  lookupPath: "/lookup?q=lineup",
} as const;

export type CapturedRoute = {
  name: string;
  path: string;
  expectPage: (page: Page) => Promise<void>;
};

export async function prepareVisualPage(page: Page) {
  await page.addInitScript(() => {
    const fixedNow = Date.UTC(2025, 0, 1, 12, 0, 0);
    const NativeDate = Date;

    class FixedDate extends NativeDate {
      constructor();
      constructor(value: string | number | Date);
      constructor(
        year: number,
        monthIndex: number,
        date?: number,
        hours?: number,
        minutes?: number,
        seconds?: number,
        ms?: number,
      );
      constructor(
        ...args:
          | []
          | [string | number | Date]
          | [number, number, number?, number?, number?, number?, number?]
      ) {
        if (args.length === 0) {
          super(fixedNow);
          return;
        }

        super(...(args as [number, number, number?, number?, number?, number?, number?]));
      }

      static now() {
        return fixedNow;
      }
    }

    FixedDate.UTC = NativeDate.UTC;
    FixedDate.parse = NativeDate.parse;
    globalThis.Date = FixedDate as DateConstructor;

    const style = document.createElement("style");
    style.setAttribute("data-visual-test", "true");
    style.textContent = `
      *, *::before, *::after {
        animation-duration: 0s !important;
        animation-delay: 0s !important;
        transition-duration: 0s !important;
        transition-delay: 0s !important;
        transition-property: none !important;
      }
      html {
        scroll-behavior: auto !important;
      }
      body {
        caret-color: transparent !important;
      }
      nextjs-portal,
      [data-next-badge-root],
      [data-nextjs-toast],
      [data-nextjs-dialog-root],
      [data-nextjs-dev-tools-button],
      [aria-label*="Next.js"],
      body > *:has([aria-label*="Next.js"]),
      body > *:has([data-next-badge-root]),
      body > *:has([data-nextjs-dev-tools-button]),
      body > *:has(button[aria-label="Open issues overlay"]),
      body > *:has(button[aria-label="Collapse issues badge"]) {
        display: none !important;
      }
    `;
    document.head.appendChild(style);

    const removeDevIndicators = () => {
      const directSelectors = [
        "nextjs-portal",
        "[data-next-badge-root]",
        "[data-nextjs-dev-tools-button]",
        'iframe[title*="Next"]',
        'iframe[src*="next"]',
        '[aria-label*="Next.js"]',
      ];

      for (const selector of directSelectors) {
        for (const element of document.querySelectorAll(selector)) {
          element.remove();
        }
      }

      if (!document.body) {
        return;
      }

      for (const element of Array.from(document.body.children)) {
        const box = element.getBoundingClientRect();
        const style = window.getComputedStyle(element);
        const isBottomLeftDevBadge =
          (style.position === "fixed" || style.position === "sticky" || element.tagName === "IFRAME") &&
          box.left < 80 &&
          window.innerHeight - box.bottom < 80 &&
          box.width <= 96 &&
          box.height <= 96;
        const isSmallBottomLeftOverlay =
          box.left < 96 &&
          box.top > window.innerHeight - 140 &&
          box.width <= 160 &&
          box.height <= 160;

        if (isBottomLeftDevBadge || isSmallBottomLeftOverlay) {
          element.remove();
        }
      }
    };

    removeDevIndicators();
    new MutationObserver(removeDevIndicators).observe(document.documentElement, {
      childList: true,
      subtree: true,
    });
    window.setInterval(removeDevIndicators, 250);
  });

  await page.emulateMedia({ reducedMotion: "reduce" });
}

export async function waitForVisualReady(page: Page) {
  await page.waitForLoadState("domcontentloaded");
  await page.evaluate(async () => {
    if (document.fonts?.ready) {
      await document.fonts.ready;
    }
  });
}

export async function captureRouteScreenshot(page: Page, testInfo: TestInfo, name: string) {
  await waitForVisualReady(page);

  const projectPrefix = testInfo.project.name.replace(/[^a-z0-9]+/gi, "-").toLowerCase();
  const fileName = `${projectPrefix}-${name}.png`;
  const screenshotPath = path.join(screenshotDir, fileName);

  mkdirSync(screenshotDir, { recursive: true });
  await page.screenshot({ path: screenshotPath, fullPage: true });
  await testInfo.attach(fileName, { path: screenshotPath, contentType: "image/png" });
}

export async function expectHomePage(page: Page) {
  await expect(page.getByRole("heading", { name: /Find what's happening in VRChat/i })).toBeVisible();
  await expect(page.getByRole("button", { name: /Search VRDex/i })).toBeVisible();
  await expect(page.getByRole("heading", { name: /Upcoming events/i })).toBeVisible();
  await expect(page.getByRole("heading", { name: "Worlds hosting events soon" })).toBeVisible();
  await expect(page.getByRole("heading", { name: "Neon Harbor", exact: true })).toBeVisible();
  await expect(page.getByRole("link", { name: /Afterglow Harbor Sessions/i }).first()).toBeVisible();
}

export async function expectSearchPage(page: Page) {
  await expect(page.getByRole("heading", { name: /Results for aurora/i })).toBeVisible();
  await expect(page.getByRole("button", { name: /Search VRDex/i })).toBeVisible();
  await expect(page.getByRole("link", { name: /DJ Aurora/i }).first()).toBeVisible();
  await expect(page.locator('[title="Logo"]').first()).toBeVisible();
  await expect(page.getByRole("heading", { name: /Upcoming events/i })).toHaveCount(0);
}

export async function expectLookupPage(page: Page) {
  await expect(page.getByRole("heading", { name: /DJ link lookup/i })).toBeVisible();
  await expect(page.getByLabel("DJ name")).toBeVisible();
  await expect(page.getByRole("link", { name: "BASICBIT", exact: true })).toBeVisible();
  await expect(page.getByRole("link", { name: "Princess Starlight Interstellar Bassline Orchestra", exact: true })).toBeVisible();
  await expect(page.getByRole("link", { name: "Velvet Circuit", exact: true })).toBeVisible();
  await expect(page.getByRole("link", { name: "Moth", exact: true })).toBeVisible();
  await expect(page.getByRole("link", { name: "Website: basicbit.net", exact: true })).toBeVisible();
  await expect(page.getByRole("link", { name: "Website: example.invalid", exact: true }).first()).toBeVisible();
  await expect(page.getByText("Genres:", { exact: true })).toHaveCount(0);
  await expect(page.getByText("Claimed", { exact: true })).toHaveCount(0);
  await expect(page.getByText("Software Dev | 3D Designer | VRDJ", { exact: true })).toHaveCount(0);
  await expect(page.getByText("Multigenre DJ but I really love DnB <3", { exact: true })).toHaveCount(0);
  await expect(page.getByRole("link", { name: "Open profile", exact: true })).toHaveCount(0);
}

export async function expectSubmitPage(page: Page) {
  await expect(page.getByRole("heading", { name: /Add a missing VRChat scene profile/i })).toBeVisible();
  await expect(page.getByRole("heading", { name: "Sign-in required" })).toBeVisible();
}

export async function expectSignInPage(page: Page) {
  await expect(page.getByRole("heading", { name: /Sign in to claim and manage profiles/i })).toBeVisible();
  await expect(page.getByRole("button", { name: "Continue with Discord" })).toBeVisible();
  await expect(page.getByRole("button", { name: "Continue with Google" })).toBeVisible();
  await expect(page.getByLabel("Email")).toBeVisible();
  await expect(page.getByLabel("Password")).toBeVisible();
}

export async function expectAccountPage(page: Page) {
  await expect(page.getByRole("heading", { name: /Your VRDex account and claim readiness/i })).toBeVisible();
  await expect(page.getByRole("heading", { name: "Not signed in" })).toBeVisible();
  await expect(page.getByRole("link", { name: "Sign in" }).last()).toBeVisible();
}

export async function expectAppearancePage(page: Page) {
  await expect(page.getByRole("heading", { name: /Shape your public profile presentation/i })).toBeVisible();
  await expect(page.getByRole("heading", { name: "Profile picture shape and border" })).toBeVisible();
  await expect(page.getByRole("heading", { name: "Public page order" })).toBeVisible();
  await expect(page.getByLabel("Avatar roundedness")).toBeVisible();
  await expect(page.getByText("Demo mode is live-only", { exact: false })).toBeVisible();
}

export async function expectPrivacyPage(page: Page) {
  await expect(page.getByRole("heading", { name: /Control what your claimed profiles show/i })).toBeVisible();
  await expect(page.getByRole("heading", { name: "Field visibility" })).toBeVisible();
  await expect(page.getByLabel("Bio visibility")).toBeVisible();
  await expect(page.getByText("Current settings", { exact: true })).toBeVisible();
  await expect(page.getByText("Demo mode is live-only", { exact: false })).toBeVisible();
}

export async function expectSuppressionPage(page: Page) {
  await expect(page.getByRole("heading", { name: /Request review of a public listing/i })).toBeVisible();
  await expect(page.getByLabel("Request type")).toBeVisible();
  await expect(page.getByLabel("Profile slug")).toBeVisible();
  await expect(page.getByRole("button", { name: "Submit request" })).toBeVisible();
}

export async function expectNewEventPage(page: Page) {
  await expect(page.getByRole("heading", { name: /Add a VRDex event/i })).toBeVisible();
  await expect(page.getByRole("heading", { name: "Sign-in required" })).toBeVisible();
  await expect(page.getByText(/event mutations and form are wired/i)).toBeVisible();
}

export async function expectEditEventPage(page: Page) {
  await expect(page.getByRole("heading", { name: /Update Afterglow Harbor Sessions/i })).toBeVisible();
  await expect(page.getByRole("link", { name: "View event" })).toBeVisible();
  await expect(page.getByRole("heading", { name: "Sign-in required" })).toBeVisible();
}

export async function expectServerStatusPage(page: Page) {
  await expect(page.getByRole("heading", { name: /First server-side App Router read path/i })).toBeVisible();
  await expect(page.getByText(/Server read reached Convex/i)).toBeVisible();
}

export async function expectDeploymentPage(page: Page) {
  await expect(page.getByRole("heading", { name: /Initial Vercel deployment baseline/i })).toBeVisible();
  await expect(page.getByText(/Deployment facts/i)).toBeVisible();
}

export async function expectDeveloperApiPage(page: Page) {
  await expect(page.getByRole("heading", { name: /VRDex Public API/i })).toBeVisible();
  await expect(page.getByRole("link", { name: "OpenAPI JSON" })).toBeVisible();
  await expect(page.getByRole("link", { name: "OpenAPI YAML" })).toBeVisible();
  await expect(page.getByRole("link", { name: "Developer tokens" })).toBeVisible();
  await expect(page.getByRole("link", { name: "OAuth apps" })).toBeVisible();
  await expect(page.getByText("operations", { exact: false })).toBeVisible();
  await expect(page.getByText("/api/v0/search", { exact: true })).toBeVisible();
  await expect(page.getByText("/api/v0/openapi.json", { exact: true })).toBeVisible();
  await expect(page.getByText("/api/v0/openapi.yaml", { exact: true })).toBeVisible();
  await expect(page.getByText("/api/v0/worlds/{slug}/events", { exact: true })).toBeVisible();
}

export async function expectDeveloperTokensPage(page: Page) {
  await expect(page.getByRole("heading", { name: "Developer tokens" })).toBeVisible();
  await expect(page.getByRole("link", { name: "API reference" })).toBeVisible();
  await expect(page.getByRole("link", { name: "OAuth apps" })).toBeVisible();
  await expect(page.getByRole("heading", { name: "Sign in required" })).toBeVisible();
  await expect(page.getByRole("link", { name: "Sign in" })).toBeVisible();
}

export async function expectOAuthAppsPage(page: Page) {
  await expect(page.getByRole("heading", { name: "OAuth apps" })).toBeVisible();
  await expect(page.getByRole("link", { name: "Developer tokens" })).toBeVisible();
  await expect(page.getByRole("link", { name: "API reference" })).toBeVisible();
  await expect(page.getByRole("heading", { name: "Sign in required" })).toBeVisible();
  await expect(page.getByRole("link", { name: "Sign in" })).toBeVisible();
}

export async function expectOAuthAuthorizeProblemPage(page: Page) {
  await expect(page.getByRole("heading", { name: "Authorization request failed" })).toBeVisible();
  await expect(page.getByRole("link", { name: "API docs" })).toBeVisible();
  await expect(page.getByText(/response_type/i)).toBeVisible();
}

export async function expectPersonProfilePage(page: Page) {
  await expect(page.getByRole("heading", { name: "DJ Aurora" })).toBeVisible();
  await expect(page.getByText(/Jan 1, 2025/i)).toBeVisible();
  await expect(page.getByText(/Source:/i)).toHaveCount(0);
  await expect(page.getByRole("heading", { name: "Upcoming events" })).toBeVisible();
  await expect(page.getByRole("heading", { name: "Afterglow Harbor Sessions" })).toBeVisible();
  await expect(page.getByText(/Creator links/i)).toBeVisible();
  await expect(page.getByText("VRChat profile", { exact: true })).toBeVisible();
  await expect(page.getByText("DJ Aurora SoundCloud", { exact: true })).toBeVisible();
  await expect(page.getByRole("heading", { name: "Media kit" })).toBeVisible();
  await expect(page.getByRole("link", { name: /Primary logo/i })).toBeVisible();
  await expect(page.getByRole("link", { name: /Download logos zip/i })).toBeVisible();
  await expect(page.getByRole("heading", { name: "Worlds" })).toBeVisible();
  await expect(page.getByRole("link", { name: /Neon Harbor/i })).toBeVisible();
}

export async function expectCommunityProfilePage(page: Page) {
  await expect(page.getByRole("heading", { name: "Afterglow Social" })).toBeVisible();
  await expect(page.getByRole("heading", { name: "Hosted events" })).toBeVisible();
  await expect(page.getByRole("heading", { name: "Afterglow Harbor Sessions" })).toBeVisible();
  await expect(page.getByText("Club night", { exact: true }).first()).toBeVisible();
  await expect(page.getByText("Afterglow event archive", { exact: true })).toBeVisible();
  await expect(page.getByText("World Author", { exact: true })).toBeVisible();
}

export async function expectEventPage(page: Page) {
  await expect(page.getByRole("heading", { name: "Afterglow Harbor Sessions" })).toBeVisible();
  await expect(page.getByText("When", { exact: true })).toBeVisible();
  await expect(page.getByText("Doors open", { exact: true }).first()).toBeVisible();
  await expect(page.getByText(/Jun 15, 2:00 AM UTC/i).first()).toBeVisible();
  await expect(page.getByText(/Your time/i)).toHaveCount(0);
  await expect(page.getByText("Place", { exact: true })).toBeVisible();
  await expect(page.getByText("Set times", { exact: true })).toBeVisible();
  const isMobile = (page.viewportSize()?.width ?? 0) < 640;
  const setTimes = page.locator("section").filter({ hasText: "Set times" });

  if (isMobile) {
    await expect(page.getByRole("columnheader", { name: "Artist" })).toHaveCount(0);
    await expect(setTimes.getByText("2:00 AM - 2:45 AM", { exact: true }).first()).toBeVisible();
    await expect(setTimes.getByText("House", { exact: true }).first()).toBeVisible();
  } else {
    const setTimesTable = page.getByRole("table");
    await expect(setTimesTable.getByRole("columnheader", { name: "Artist" })).toBeVisible();
    await expect(setTimesTable.getByRole("columnheader", { name: "Style(s)" })).toBeVisible();
    await expect(setTimesTable.getByRole("cell", { name: "2:00 AM - 2:45 AM" })).toBeVisible();
    await expect(setTimesTable.getByRole("cell", { name: "House" })).toBeVisible();
  }

  await expect(page.getByText("Lineup", { exact: true })).toBeVisible();
  await expect(page.getByRole("link", { name: "DJ Aurora", exact: true }).first()).toBeVisible();
  await expect(page.getByText("Neon Harbor", { exact: true })).toBeVisible();
  await expect(page.getByRole("link", { name: /Add to calendar/i })).toHaveAttribute(
    "href",
    "/e/playwright-afterglow-harbor-sessions/calendar.ics",
  );
  await expect(page.getByText("Afterglow watch link", { exact: true })).toBeVisible();
  await expect(page.getByText("Watch now", { exact: true })).toHaveCount(0);
}

export async function expectEventWatchPage(page: Page) {
  await expect(page.getByRole("heading", { name: "Afterglow Watch Room" })).toBeVisible();
  await expect(page.getByRole("heading", { name: "Event stream" })).toBeVisible();
  await expect(page.locator('video[title="VRCDN stream for Event stream"]')).toBeVisible();
  await expect(page.getByRole("link", { name: "Open stream" }).first()).toHaveAttribute(
    "href",
    "https://vrcdn.live/playwright-afterglow-watch-room",
  );
  await expect(page.getByText("YouTube archive link", { exact: true })).toBeVisible();
  await expect(page.getByText("Twitch channel link", { exact: true })).toBeVisible();
}

export async function expectVrcdnMediaLinkPreviewPage(page: Page) {
  await expect(page.getByRole("heading", { name: "VRCDN media-link input" })).toBeVisible();
  await expect(page.getByText("https://stream.vrcdn.live/live/basicbit.live.ts", { exact: true })).toBeVisible();
  await expect(page.getByText("Quest MPEG-TS", { exact: true })).toBeVisible();
  await expect(page.getByText("PC RTSPT", { exact: true })).toBeVisible();
  await expect(page.getByRole("link", { name: "Open preview" })).toHaveAttribute("href", "https://vrcdn.live/basicbit");
  await expect(page.getByRole("button", { name: "Copy" })).toHaveCount(2);
}

export async function expectWorldProfilePage(page: Page) {
  await expect(page.getByRole("heading", { name: "Neon Harbor", exact: true })).toBeVisible();
  await expect(page.getByText(/World profile/i)).toHaveCount(0);
  await expect(page.getByText(/wrld_/i)).toHaveCount(0);
  await expect(page.getByText(/Neon Harbor mixes warm booth lighting/i)).toBeVisible();
  await expect(page.getByText(/Events at this world/i)).toBeVisible();
  await expect(page.getByRole("heading", { name: "Afterglow Harbor Sessions" })).toBeVisible();
  await expect(page.getByRole("heading", { name: "Neon Harbor Opening Night" })).toBeVisible();
}

export const capturedRoutes: CapturedRoute[] = [
  {
    name: "home",
    path: "/",
    expectPage: expectHomePage,
  },
  {
    name: "submit",
    path: "/submit",
    expectPage: expectSubmitPage,
  },
  {
    name: "sign-in",
    path: "/sign-in",
    expectPage: expectSignInPage,
  },
  {
    name: "account-signed-out",
    path: "/account",
    expectPage: expectAccountPage,
  },
  {
    name: "appearance-demo",
    path: "/account/appearance",
    expectPage: expectAppearancePage,
  },
  {
    name: "privacy-demo",
    path: "/account/privacy",
    expectPage: expectPrivacyPage,
  },
  {
    name: "search",
    path: "/search?q=aurora",
    expectPage: expectSearchPage,
  },
  {
    name: "lookup",
    path: visualProfilePaths.lookupPath,
    expectPage: expectLookupPage,
  },
  {
    name: "privacy-suppression",
    path: "/privacy/suppression",
    expectPage: expectSuppressionPage,
  },
  {
    name: "event-new-signed-out",
    path: "/events/new",
    expectPage: expectNewEventPage,
  },
  {
    name: "event-edit-signed-out",
    path: "/events/playwright-afterglow-harbor-sessions/edit",
    expectPage: expectEditEventPage,
  },
  {
    name: "server-status",
    path: "/server-status",
    expectPage: expectServerStatusPage,
  },
  {
    name: "deployment",
    path: "/deployment",
    expectPage: expectDeploymentPage,
  },
  {
    name: "developer-api",
    path: "/developers/api",
    expectPage: expectDeveloperApiPage,
  },
  {
    name: "developer-tokens-signed-out",
    path: "/developers/tokens",
    expectPage: expectDeveloperTokensPage,
  },
  {
    name: "developer-oauth-apps-signed-out",
    path: "/developers/apps",
    expectPage: expectOAuthAppsPage,
  },
  {
    name: "oauth-authorize-invalid",
    path: "/oauth/authorize",
    expectPage: expectOAuthAuthorizeProblemPage,
  },
  {
    name: "person-profile",
    path: visualProfilePaths.personPath,
    expectPage: expectPersonProfilePage,
  },
  {
    name: "community-profile",
    path: visualProfilePaths.communityPath,
    expectPage: expectCommunityProfilePage,
  },
  {
    name: "world-profile",
    path: visualProfilePaths.worldPath,
    expectPage: expectWorldProfilePage,
  },
  {
    name: "event-profile",
    path: visualProfilePaths.eventPath,
    expectPage: expectEventPage,
  },
  {
    name: "event-watch-surface",
    path: visualProfilePaths.eventWatchPath,
    expectPage: expectEventWatchPage,
  },
  {
    name: "vrcdn-media-link-preview",
    path: "/playwright/vrcdn-media-links",
    expectPage: expectVrcdnMediaLinkPreviewPage,
  },
];

export const productionSmokeRoutes: CapturedRoute[] = capturedRoutes.filter((route) =>
  ["submit", "sign-in", "privacy-suppression", "event-new-signed-out", "server-status", "deployment"].includes(
    route.name,
  ),
);
