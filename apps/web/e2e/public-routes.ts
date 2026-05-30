import { expect, type Page, type TestInfo } from "@playwright/test";
import { mkdirSync } from "node:fs";
import path from "node:path";

const screenshotDir = path.join(process.cwd(), "playwright-artifacts", "screenshots");

export const visualProfilePaths = {
  personPath: "/p/playwright-dj-aurora",
  communityPath: "/c/playwright-afterglow-social",
  worldPath: "/w/playwright-neon-harbor",
  eventPath: "/e/playwright-afterglow-harbor-sessions",
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
  await expect(page.getByRole("heading", { name: /Find what is happening/i })).toBeVisible();
  await expect(page.getByRole("button", { name: /Search VRDex/i })).toBeVisible();
  await expect(page.getByRole("heading", { name: "Worlds hosting events soon" })).toBeVisible();
  await expect(page.getByRole("heading", { name: "Neon Harbor", exact: true })).toBeVisible();
  await expect(page.getByRole("link", { name: /Afterglow Harbor Sessions/i }).first()).toBeVisible();
}

export async function expectDiscoverPage(page: Page) {
  await expect(page.getByRole("heading", { name: /Find the night/i })).toBeVisible();
  await expect(page.getByRole("button", { name: /Search VRDex/i })).toBeVisible();
  await expect(page.getByRole("heading", { name: /Events worth checking first/i })).toBeVisible();
  await expect(page.getByRole("link", { name: /Afterglow Harbor Sessions/i }).first()).toBeVisible();
  await expect(page.getByRole("link", { name: /DJ Aurora/i })).toBeVisible();
}

export async function expectSearchPage(page: Page) {
  await expect(page.getByRole("heading", { name: /Find the night/i })).toBeVisible();
  await expect(page.getByRole("button", { name: /Search VRDex/i })).toBeVisible();
  await expect(page.getByRole("link", { name: /DJ Aurora/i }).first()).toBeVisible();
  await expect(page.getByRole("link", { name: /Neon Harbor/i }).first()).toBeVisible();
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

export async function expectPersonProfilePage(page: Page) {
  await expect(page.getByRole("heading", { name: "DJ Aurora" })).toBeVisible();
  await expect(page.getByText(/Source: Community submitted on Jan 1, 2025/i)).toBeVisible();
  await expect(page.getByRole("heading", { name: /Where this profile appears next/i })).toBeVisible();
  await expect(page.getByRole("heading", { name: "Afterglow Harbor Sessions" })).toBeVisible();
  await expect(page.getByText(/Creator links/i)).toBeVisible();
  await expect(page.getByText("DJ Aurora Ko-fi", { exact: true })).toBeVisible();
  await expect(page.getByText(/World credits/i)).toBeVisible();
  await expect(page.getByRole("link", { name: /Neon Harbor Media Credit A/i })).toBeVisible();
}

export async function expectCommunityProfilePage(page: Page) {
  await expect(page.getByRole("heading", { name: "Afterglow Social" })).toBeVisible();
  await expect(page.getByRole("heading", { name: /Upcoming community events/i })).toBeVisible();
  await expect(page.getByRole("heading", { name: "Afterglow Harbor Sessions" })).toBeVisible();
  await expect(page.getByText("Club night", { exact: true }).first()).toBeVisible();
  await expect(page.getByText("Afterglow event archive", { exact: true })).toBeVisible();
  await expect(page.getByText("World Author", { exact: true })).toBeVisible();
}

export async function expectEventPage(page: Page) {
  await expect(page.getByRole("heading", { name: "Afterglow Harbor Sessions" })).toBeVisible();
  await expect(page.getByText(/People associated with this event/i)).toBeVisible();
  await expect(page.getByText("DJ Aurora", { exact: true })).toBeVisible();
  await expect(page.getByText("Neon Harbor", { exact: true })).toBeVisible();
  await expect(page.getByText("Fixture watch link", { exact: true })).toBeVisible();
}

export async function expectWorldProfilePage(page: Page) {
  await expect(page.getByRole("heading", { name: "Neon Harbor", exact: true })).toBeVisible();
  await expect(page.getByText(/World profile/i)).toBeVisible();
  await expect(page.getByText(/Fixture owner-authored metadata/i)).toBeVisible();
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
    name: "discover",
    path: "/discover?q=afterglow",
    expectPage: expectDiscoverPage,
  },
  {
    name: "search-compat",
    path: "/search?q=aurora",
    expectPage: expectSearchPage,
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
];

export const productionSmokeRoutes: CapturedRoute[] = capturedRoutes.filter((route) =>
  ["submit", "sign-in", "privacy-suppression", "event-new-signed-out", "server-status", "deployment"].includes(
    route.name,
  ),
);
