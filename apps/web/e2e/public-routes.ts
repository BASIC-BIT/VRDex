import { expect, type Locator, type Page, type TestInfo } from "@playwright/test";
import { mkdirSync } from "node:fs";
import path from "node:path";

const screenshotDir = path.join(process.cwd(), "playwright-artifacts", "screenshots");

export const visualProfilePaths = {
  personPath: "/playwright-dj-aurora",
  verifiedPersonPath: "/basicbit",
  communityPath: "/playwright-afterglow-social",
  worldPath: "/playwright-neon-harbor",
  eventPath: "/playwright-afterglow-harbor-sessions",
  eventWatchPath: "/playwright-afterglow-watch-room",
  lookupPath: "/lookup?q=lineup",
} as const;

export type CapturedRoute = {
  name: string;
  path: string;
  expectPage: (page: Page) => Promise<void>;
};

/**
 * Normalizes a page for screenshot capture: pinned theme, frozen clock, no
 * animations, transitions, caret, or Next.js dev overlay.
 *
 * `freezeClock` is separable because a signed-in Clerk page cannot take it.
 * Clerk's client SDK decides token freshness from `Date.now()`, so a page that
 * reports 2025-01-01 while holding a token minted today is making refresh
 * decisions against a clock nearly two years out. Convex validates `exp` server
 * side against real time regardless, so the two disagree — leave it on for
 * anonymous captures, off for authenticated ones.
 */
export async function prepareVisualPage(page: Page, options?: { freezeClock?: boolean }) {
  await page.addInitScript(({ freezeClock }: { freezeClock: boolean }) => {
    const storedTheme = window.localStorage.getItem("vrdex-theme");
    if (storedTheme !== "light" && storedTheme !== "dark") {
      window.localStorage.setItem("vrdex-theme", "light");
    }

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

    if (freezeClock) {
      globalThis.Date = FixedDate as DateConstructor;
    }

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
    const installVisualStyle = () => {
      if (!document.head || document.querySelector("[data-visual-test]")) {
        return;
      }

      document.head.appendChild(style);
    };

    installVisualStyle();
    document.addEventListener("DOMContentLoaded", installVisualStyle, { once: true });

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
    new MutationObserver(removeDevIndicators).observe(document, {
      childList: true,
      subtree: true,
    });
    window.setInterval(removeDevIndicators, 250);
  }, { freezeClock: options?.freezeClock ?? true });

  await page.emulateMedia({ colorScheme: "light", reducedMotion: "reduce" });
}

export async function waitForVisualReady(page: Page) {
  await page.waitForLoadState("domcontentloaded");
  await page.evaluate(async () => {
    if (document.fonts?.ready) {
      await document.fonts.ready;
    }
  });
}

export async function captureRouteScreenshot(
  page: Page,
  testInfo: TestInfo,
  name: string,
  // Painted over before the capture. Signed-in surfaces render a per-run
  // identity — the disposable account's email carries a `Date.now()` suffix — so
  // without this every screenshot differs from the last even when the UI has not
  // changed. That is noise in manual review and it makes the capture unusable as
  // a committed baseline, which is where these are meant to end up.
  options?: { mask?: Locator[] },
) {
  await waitForVisualReady(page);
  await page.evaluate(() => window.scrollTo(0, 0));

  const projectPrefix = testInfo.project.name.replace(/[^a-z0-9]+/gi, "-").toLowerCase();
  const fileName = `${projectPrefix}-${name}.png`;
  const screenshotPath = path.join(screenshotDir, fileName);

  mkdirSync(screenshotDir, { recursive: true });
  await page.screenshot({ path: screenshotPath, fullPage: true, mask: options?.mask });
  await testInfo.attach(fileName, { path: screenshotPath, contentType: "image/png" });
}

export async function expectHomePage(page: Page) {
  await expect(page.getByRole("heading", { name: "Search VRDex" })).toBeVisible();
  await expect(page.getByLabel("DJ name")).toBeVisible();
  await expect(page.getByRole("button", { name: "Toggle color theme" })).toBeVisible();
  await expect(page.getByText(/Start with a name, scene, world, genre, or event/i)).toHaveCount(0);
  await expect(page.getByText("Start with a name or genre.", { exact: true })).toHaveCount(0);
  // Checked on the busiest route, because the footer is the only thing that
  // makes support and the developer pages reachable at all. Both were orphans
  // before it, and losing it would put them straight back.
  await expectFooterReachesSupport(page);
}

export async function expectDiscoveryPage(page: Page) {
  await expect(page.getByRole("heading", { name: /Discover VR/i })).toBeVisible();
  await expect(page.getByRole("button", { name: /Search VRDex/i })).toBeVisible();
  await expect(page.getByRole("button", { name: "Toggle color theme" })).toBeVisible();
  await expect(page.getByRole("heading", { name: /Upcoming events/i })).toBeVisible();
  await expect(page.getByRole("heading", { name: "Featured worlds" })).toBeVisible();
  await expect(page.getByRole("heading", { name: "Neon Harbor", exact: true })).toBeVisible();
  await expect(page.getByRole("link", { name: /Afterglow Harbor Sessions/i }).first()).toBeVisible();
  await expect(page.getByLabel("Verified profile").first()).toBeVisible();
  await expect(page.getByRole("heading", { name: "Featured", exact: true })).toHaveCount(0);
}

export async function expectSearchPage(page: Page) {
  await expect(page.getByRole("heading", { name: "Search VRDex" })).toBeVisible();
  await expect(page.getByRole("heading", { name: /Results for aurora/i })).toBeVisible();
  await expect(page.getByRole("button", { name: /Search VRDex/i })).toBeVisible();
  await expect(page.getByRole("link", { name: /DJ Aurora/i }).first()).toBeVisible();
  await expect(page.locator('[title="Logo"]').first()).toBeVisible();
  await expect(page.getByRole("heading", { name: /Upcoming events/i })).toHaveCount(0);
}

export async function expectLookupPage(page: Page) {
  await expect(page.getByRole("heading", { name: "Search VRDex" })).toBeVisible();
  await expect(page.getByRole("link", { name: "DJ links" })).toHaveAttribute("aria-current", "page");
  await expect(page.getByLabel("DJ name")).toBeVisible();
  await expect(page.getByRole("button", { name: "Toggle color theme" })).toBeVisible();
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

export async function expectPrivateSeedLookupPage(page: Page) {
  const privateResult = page.locator(".lookup-result-card.ph-no-capture:visible");

  await expect(page.getByRole("heading", { name: "Search VRDex" })).toBeVisible();
  await expect(privateResult).toHaveCount(1);
  await expect(privateResult.getByText("DJ Northstar", { exact: true })).toBeVisible();
  await expect(privateResult.getByText("Northstar", { exact: true })).toBeVisible();
  await expect(privateResult).not.toContainText(/Private seed|NWinn|Source|Reviewed|Freshness|Jul 9, 2026|Checked Jul 8, 2026/);
  await expect(privateResult.getByRole("link", { name: "Twitch: dj-northstar" })).toBeVisible();
  await expect(privateResult.getByRole("link", { name: "VRChat profile: vrchat.com" })).toBeVisible();
  await expect(page.getByRole("link", { name: "Open profile", exact: true })).toHaveCount(0);
}

export async function expectSubmitPage(page: Page) {
  await expectProtectedRouteRedirect(page, "/submit");
}

export async function expectSignInPage(page: Page) {
  // Only the heading belongs to VRDex now. The provider buttons and the
  // email/password fields are rendered by Clerk's own `<SignIn />`, and asserting
  // a vendor's DOM would break on any upstream markup change. Which of Clerk's UI
  // or the unconfigured-environment notice appears depends on whether the
  // environment has Clerk credentials, so neither is asserted here; the callers
  // that care about reaching this page already check the URL.
  await expect(page.getByRole("heading", { name: "Sign in", exact: true })).toBeVisible();
}

async function expectProtectedRouteRedirect(page: Page, returnTo: string) {
  await expect(page).toHaveURL((url) =>
    url.pathname === "/sign-in" && url.searchParams.get("returnTo") === returnTo,
  );
  await expectSignInPage(page);
}

export async function expectHandoffPage(page: Page) {
  await expect(page.getByRole("heading", { name: "DJ Aurora" })).toBeVisible();
  await expect(page.getByRole("heading", { name: "Choose the details to keep" })).toBeVisible();
  await expect(page.getByLabel("Include Display name")).toBeChecked();
  await expect(page.getByRole("button", { name: "Take ownership" })).toBeVisible();
}

export async function expectAccountPage(page: Page) {
  await expectProtectedRouteRedirect(page, "/account");
}

export async function expectAppearancePage(page: Page) {
  await expect(page.getByRole("heading", { name: "Personalization", exact: true })).toBeVisible();
  await expect(page.getByRole("link", { name: "Privacy", exact: true })).toBeVisible();
  await expect(page.getByRole("heading", { name: "Profile picture shape and border" })).toBeVisible();
  await expect(page.getByRole("heading", { name: "Supporting section order" })).toBeVisible();
  await expect(page.getByLabel("Avatar roundedness")).toBeVisible();
}

export async function expectPrivacyPage(page: Page) {
  await expect(page.getByRole("heading", { name: "Privacy", exact: true })).toBeVisible();
  await expect(page.getByRole("link", { name: "Personalization", exact: true })).toBeVisible();
  await expect(page.getByRole("heading", { name: "Field visibility" })).toBeVisible();
  await expect(page.getByLabel("Bio visibility")).toBeVisible();
  await expect(page.getByText("Current settings", { exact: true })).toBeVisible();
}

export async function expectSupportPage(page: Page) {
  await expect(page.getByRole("heading", { name: "Tell us what you need." })).toBeVisible();
  await expect(page.getByLabel("Request type")).toBeVisible();
  await expect(page.getByLabel("Profile", { exact: true })).toBeVisible();
  // A name-only opt-out with no type makes the acceptance resolver scan people
  // *and* communities, so this field is what stops one accepted request from
  // retracting every namesake of both kinds.
  await expect(page.getByLabel("Is this a person or a community?")).toBeVisible();
  await expect(page.getByLabel("Message")).toBeVisible();
  await expect(page.getByRole("button", { name: "Send request" })).toBeVisible();
  // The two suppression topics live in the same selector as the rest. They are
  // the reason this route replaced `/privacy/suppression` rather than sitting
  // beside it, so their absence would mean the fold silently came undone.
  await expect(
    page.getByRole("option", { name: "I own this listing and want it opted out" }),
  ).toHaveCount(1);
  await expect(
    page.getByRole("option", { name: "This unclaimed listing needs safety review" }),
  ).toHaveCount(1);
}

/**
 * The old address, which is in the production smoke set and in whatever
 * bookmarks and operator replies already carry it. It has to land on the folded
 * form with its topic chosen, not on a 404.
 */
export async function expectSuppressionPage(page: Page) {
  await expect(page).toHaveURL((url) =>
    url.pathname === "/support" && url.searchParams.get("topic") === "owner_opt_out",
  );
  await expect(page.getByLabel("Request type")).toHaveValue("owner_opt_out");
  await expectSupportPage(page);
}

/**
 * A bare `/support` opens with nothing chosen.
 *
 * The claim page's footer offers transfer, recovery, and dispute in one
 * sentence, so a link that preselected any of the three filed the other two
 * under the wrong heading. This is what stops that from coming back.
 */
export async function expectSupportPageWithNoTopicChosen(page: Page) {
  await expect(page.getByLabel("Request type")).toHaveValue("");
  await expect(page.getByRole("button", { name: "Send request" })).toBeDisabled();
  await expectSupportPage(page);
}

export async function expectFooterReachesSupport(page: Page) {
  const footer = page.getByRole("navigation", { name: "Site" });

  await expect(footer.getByRole("link", { name: "Contact" })).toHaveAttribute("href", "/support");
  await expect(footer.getByRole("link", { name: "Developers" })).toHaveAttribute(
    "href",
    "/developers/api",
  );
}

export async function expectNewEventPage(page: Page) {
  await expectProtectedRouteRedirect(page, "/events/new");
}

export async function expectEditEventPage(page: Page) {
  await expectProtectedRouteRedirect(page, "/events/playwright-afterglow-harbor-sessions/edit");
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
  await expectProtectedRouteRedirect(page, "/developers/tokens");
}

export async function expectOAuthAppsPage(page: Page) {
  await expectProtectedRouteRedirect(page, "/developers/apps");
}

export async function expectOAuthAuthorizeProblemPage(page: Page) {
  await expect(page.getByRole("heading", { name: "Authorization request failed" })).toBeVisible();
  await expect(page.getByRole("link", { name: "API docs" })).toBeVisible();
  await expect(page.getByText(/response_type/i)).toBeVisible();
}

export async function expectPersonProfilePage(page: Page) {
  await expect(page.getByRole("heading", { name: "DJ Aurora" })).toBeVisible();
  const profileCard = page.getByRole("region", { name: "DJ Aurora" });
  const ownershipAction = page.getByRole("complementary", { name: "Profile ownership" });
  const claimLink = ownershipAction.getByRole("link", { name: "Claim profile" });
  await expect(ownershipAction.getByText("Is this your profile?", { exact: true })).toBeVisible();
  await expect(claimLink).toHaveAttribute("href", "/claim/playwright-dj-aurora?source=profile");
  await expect(ownershipAction.getByRole("link", { name: "Suggest an edit" })).toHaveAttribute(
    "href",
    "/playwright-dj-aurora/edit",
  );
  await expect(ownershipAction.getByRole("link", { name: "Add media" })).toHaveCount(0);
  await expect(profileCard.getByRole("link", { name: "Claim profile" })).toHaveCount(0);
  expect(await claimLink.evaluate((element) => element.scrollWidth <= element.clientWidth)).toBe(true);
  await expect(page.getByText("Melodic house DJ playing warm, vocal-led sets across VRChat club nights.")).toBeVisible();
  await expect(page.getByText("Known for sunrise handoffs, soft-focus visuals, and long blends that keep the room moving.")).toHaveCount(0);
  await expect(page.getByText(/Jan 1, 2025/i)).toHaveCount(0);
  await expect(page.getByText(/Source:/i)).toHaveCount(0);
  await expect(page.getByRole("heading", { name: "Upcoming events" })).toBeVisible();
  await expect(page.getByRole("heading", { name: "Afterglow Harbor Sessions" })).toBeVisible();
  await expect(page.getByRole("heading", { name: "Links" })).toBeVisible();
  await expect(page.getByText(/Creator links/i)).toHaveCount(0);
  await expect(page.getByText("VRChat profile", { exact: true })).toBeVisible();
  await expect(page.getByText("DJ Aurora SoundCloud", { exact: true })).toBeVisible();
  await expect(page.getByRole("heading", { name: "Watch" })).toBeVisible();
  // One badge per provider. The fixture is live on Twitch and on VRCDN, so a
  // single-match assertion would pass with either one of them missing.
  const liveBadges = page.getByText("Live now", { exact: true });
  await expect(liveBadges).toHaveCount(2);
  await expect(liveBadges.first()).toBeVisible();
  await expect(liveBadges.last()).toBeVisible();
  await expect(page.getByRole("link", { name: /Watch on Twitch/i })).toBeVisible();
  await expect(page.getByText("Quest (MPEG-TS)", { exact: true })).toBeVisible();
  await expect(page.getByText("PC (RTSPT)", { exact: true })).toBeVisible();
  await expect(page.getByText("https://stream.vrcdn.live/live/dj-aurora.live.ts", { exact: true })).toBeVisible();
  await expect(page.getByText("rtspt://stream.vrcdn.live/live/dj-aurora", { exact: true })).toBeVisible();
  // Live in this fixture, so the player is offered. It has to stay a control
  // rather than a connection: nothing may reach VRCDN until a viewer presses
  // it, or every visitor spends one of the operator's capped viewer slots.
  await expect(page.getByRole("button", { name: "Play VRCDN" })).toBeVisible();
  await expect(page.locator("video")).toHaveCount(0);
  await expect(page.getByRole("button", { name: "Copy Discord" })).toBeVisible();
  await expect(page.getByRole("heading", { name: "Media kit" })).toBeVisible();
  await expect(page.getByRole("link", { name: /Primary logo/i })).toBeVisible();
  await expect(page.getByRole("link", { name: /Download logos/i })).toBeVisible();
  await expect(page.getByRole("heading", { name: "Worlds" })).toBeVisible();
  await expect(page.getByRole("link", { name: /Neon Harbor/i })).toBeVisible();
}

export async function expectProfileEditSignedOutPage(page: Page) {
  await expect(page.getByRole("heading", { name: "Edit profile" })).toBeVisible();
  await expect(page.getByRole("heading", { name: "Sign-in required" })).toBeVisible();
  await expect(
    page.locator('a[href="/sign-in?returnTo=%2Fplaywright-dj-aurora%2Fedit"]'),
  ).toHaveText("Sign in");
}

export async function expectVerifiedPersonProfilePage(page: Page) {
  await expect(page.getByRole("heading", { name: "BASICBIT" })).toBeVisible();
  await expect(page.getByRole("complementary", { name: "Profile ownership" })).toHaveCount(0);
  await expect(page.getByRole("link", { name: "Claim profile" })).toHaveCount(0);
  await expect(page.getByLabel("Verified profile")).toBeVisible();
  await expect(page.getByText("Multigenre DJ but I really love DnB <3", { exact: true })).toBeVisible();
  await expect(page.getByText(/Public lookup seed for validating operator workflows/i)).toHaveCount(0);
  await expect(page.getByRole("button", { name: "Copy Discord" })).toBeVisible();
  await expect(page.getByText("https://stream.vrcdn.live/live/basicbit.live.ts", { exact: true })).toBeVisible();
  await expect(page.getByText("rtspt://stream.vrcdn.live/live/basicbit", { exact: true })).toBeVisible();
  // No liveness for this fixture, so no player is offered at all. The copy rows
  // above still carry the stream; only the watch control is withheld.
  await expect(page.getByRole("button", { name: /^Play / })).toHaveCount(0);
}

export async function expectCommunityProfilePage(page: Page) {
  await expect(page.getByRole("heading", { name: "Afterglow Social" })).toBeVisible();
  const profileCard = page.getByRole("region", { name: "Afterglow Social" });
  const ownershipAction = page.getByRole("complementary", { name: "Profile ownership" });
  const claimLink = ownershipAction.getByRole("link", { name: "Claim profile" });
  await expect(ownershipAction.getByText("Manage this community?", { exact: true })).toBeVisible();
  await expect(claimLink).toHaveAttribute("href", "/claim/playwright-afterglow-social?source=profile");
  await expect(profileCard.getByRole("link", { name: "Claim profile" })).toHaveCount(0);
  expect(await claimLink.evaluate((element) => element.scrollWidth <= element.clientWidth)).toBe(true);
  await expect(page.getByRole("heading", { name: "Hosted events" })).toBeVisible();
  await expect(page.getByRole("heading", { name: "Afterglow Harbor Sessions" })).toBeVisible();
  await expect(page.getByText("A warm VRChat club night for music-first communities.", { exact: true })).toBeVisible();
  await expect(page.getByText(/Club night \/ Global \/ Music \/ Dancing/i)).toHaveCount(0);
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
    "/playwright-afterglow-harbor-sessions/calendar.ics",
  );
  await expect(page.getByRole("link", { name: "Edit event" })).toHaveAttribute(
    "href",
    "/events/playwright-afterglow-harbor-sessions/edit",
  );
  await expect(page.getByText("Afterglow watch link", { exact: true })).toBeVisible();
  await expect(
    page.locator('a[href="https://stream.vrcdn.live/live/playwright-afterglow-harbor-sessions.live.ts"]'),
  ).toBeVisible();
  await expect(page.getByText("Watch now", { exact: true })).toHaveCount(0);
}

export async function expectEventWatchPage(page: Page) {
  await expect(page.getByRole("heading", { name: "Afterglow Watch Room" })).toBeVisible();
  await expect(page.getByRole("heading", { name: "Event stream" })).toBeVisible();
  // Offered, not connected. The player attaches to VRCDN only once a viewer
  // presses play, so there is no `video` on the page until it is used -- which
  // is what keeps a scheduled event's watch page from spending a viewer slot
  // per visitor.
  //
  // Deliberately not clicked through: this runs inside the snapshot spec too,
  // so a click would put a real connection to `stream.vrcdn.live` into CI and
  // capture a connecting player as the baseline.
  await expect(
    page.getByRole("button", { name: "Play VRCDN stream for Event stream" }),
  ).toBeVisible();
  await expect(page.locator("video")).toHaveCount(0);
  // No open affordance for a VRCDN stream, because there is nowhere to open: the
  // service publishes no page for one. The player above is the whole surface.
  // This used to assert an `https://vrcdn.live/<id>` href, which answered 404.
  await expect(page.getByRole("link", { name: "Open stream" })).toHaveCount(0);
  await expect(page.getByText("YouTube archive link", { exact: true })).toBeVisible();
  await expect(page.getByText("Twitch channel link", { exact: true })).toBeVisible();
}

export async function expectVrcdnMediaLinkPreviewPage(page: Page) {
  await expect(page.getByRole("heading", { name: "VRCDN media-link input" })).toBeVisible();
  await expect(page.getByText("https://stream.vrcdn.live/live/basicbit.live.ts", { exact: true })).toBeVisible();
  await expect(page.getByText("Quest MPEG-TS", { exact: true })).toBeVisible();
  await expect(page.getByText("PC RTSPT", { exact: true })).toBeVisible();
  await expect(page.getByRole("link", { name: "Open preview" })).toHaveAttribute(
    "href",
    "https://panel.vrcdn.live/preview/basicbit",
  );
  await expect(page.getByRole("button", { name: "Copy" })).toHaveCount(2);
}

export async function expectCommunityTelemetryPage(page: Page) {
  await expect(page.getByRole("heading", { name: "The Faceless telemetry" })).toBeVisible();
  await expect(page.getByText("54", { exact: true }).first()).toBeVisible();
  await expect(page.getByRole("img", { name: /Population over time/ })).toBeVisible();
  await expect(page.getByRole("img", { name: /Active instances over time/ })).toBeVisible();
  await expect(page.getByRole("img", { name: /Group members over time/ })).toBeVisible();
  await expect(page.getByRole("img", { name: /wrld_faceless instance population/ })).toBeVisible();
  await expect(page.getByRole("heading", { name: "Coverage" })).toBeVisible();
  await expect(page.getByRole("heading", { name: "Public stats" })).toBeVisible();
  await expect(page.getByRole("checkbox")).toHaveCount(5);
  await expect(page.getByRole("heading", { name: "Event associations" })).toBeVisible();
  await expect(page.getByRole("button", { name: "Confirm" })).toHaveCount(2);
  const chartRange = page.getByRole("combobox", { name: "Chart range" });
  await chartRange.focus();
  await page.keyboard.press("End");
  await expect(chartRange).toHaveValue("720");
  await page.keyboard.press("Home");
  await expect(chartRange).toHaveValue("24");
  const overflows = await page.evaluate(() => document.documentElement.scrollWidth > document.documentElement.clientWidth);
  expect(overflows).toBe(false);
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
    name: "discovery",
    path: "/discovery",
    expectPage: expectDiscoveryPage,
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
    name: "handoff-ready",
    path: "/handoff/playwright-ready",
    expectPage: expectHandoffPage,
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
    name: "lookup-private-seed",
    path: "/lookup?q=nwinn",
    expectPage: expectPrivateSeedLookupPage,
  },
  {
    name: "support",
    path: "/support",
    expectPage: expectSupportPageWithNoTopicChosen,
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
    name: "verified-person-profile",
    path: visualProfilePaths.verifiedPersonPath,
    expectPage: expectVerifiedPersonProfilePage,
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
  {
    name: "community-telemetry",
    path: "/playwright/community-telemetry",
    expectPage: expectCommunityTelemetryPage,
  },
];

export const productionSmokeRoutes: CapturedRoute[] = capturedRoutes.filter((route) =>
  // `privacy-suppression` stays alongside `support`: it is now a redirect, and
  // the redirect is the part that keeps every bookmark and operator reply
  // already carrying that address out of a 404.
  ["submit", "sign-in", "support", "privacy-suppression", "event-new-signed-out"].includes(
    route.name,
  ),
);
