import { expect, type Page, type TestInfo } from "@playwright/test";
import { mkdirSync } from "node:fs";
import path from "node:path";

const screenshotDir = path.join(process.cwd(), "playwright-artifacts", "screenshots");

export const visualProfilePaths = {
  personPath: "/p/playwright-dj-aurora",
  communityPath: "/c/playwright-afterglow-social",
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
  await expect(page.getByRole("heading", { name: /Profiles, communities/i })).toBeVisible();
}

export async function expectSubmitPage(page: Page) {
  await expect(page.getByRole("heading", { name: /Add a missing VRChat scene profile/i })).toBeVisible();
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
  await expect(page.getByText(/Community submitted/i)).toBeVisible();
}

export async function expectCommunityProfilePage(page: Page) {
  await expect(page.getByRole("heading", { name: "Afterglow Social" })).toBeVisible();
  await expect(page.getByText("Club night", { exact: true }).first()).toBeVisible();
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
];
