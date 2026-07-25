import { expect, test, type Page } from "@playwright/test";

type Theme = "dark" | "light";

type ThemeSample = {
  elapsed: number;
  heading: string;
  mutedText: string;
  transitionActive: boolean;
};

async function setTheme(page: Page, theme: Theme) {
  await page.evaluate(async (nextTheme) => {
    window.localStorage.setItem("vrdex-theme", nextTheme);
    document.documentElement.dataset.theme = nextTheme;
    document.documentElement.style.colorScheme = nextTheme;
    void document.documentElement.offsetWidth;
    await new Promise<void>((resolve) => requestAnimationFrame(() => resolve()));
    await new Promise<void>((resolve) => requestAnimationFrame(() => resolve()));
  }, theme);
}

async function themeColors(page: Page, theme: Theme) {
  return await page.evaluate((nextTheme) => {
    const heading = document.querySelector("h1");
    const mutedText = document.querySelector(".text-muted");

    if (!(heading instanceof HTMLElement) || !(mutedText instanceof HTMLElement)) {
      throw new Error("Theme transition color targets were not rendered.");
    }

    document.documentElement.dataset.theme = nextTheme;
    document.documentElement.style.colorScheme = nextTheme;

    return {
      heading: getComputedStyle(heading).color,
      mutedText: getComputedStyle(mutedText).color,
    };
  }, theme);
}

async function sampleThemeTransition(page: Page): Promise<ThemeSample[]> {
  return await page.evaluate(async () => {
    const heading = document.querySelector("h1");
    const mutedText = document.querySelector(".text-muted");
    const toggle = document.querySelector('button[aria-label="Toggle color theme"]');

    if (
      !(heading instanceof HTMLElement) ||
      !(mutedText instanceof HTMLElement) ||
      !(toggle instanceof HTMLButtonElement)
    ) {
      throw new Error("Theme transition sample targets were not rendered.");
    }

    const renderedHeading = heading;
    const renderedMutedText = mutedText;
    const startedAt = performance.now();
    const samples: ThemeSample[] = [];

    return await new Promise<ThemeSample[]>((resolve) => {
      function sample() {
        const elapsed = performance.now() - startedAt;
        samples.push({
          elapsed,
          heading: getComputedStyle(renderedHeading).color,
          mutedText: getComputedStyle(renderedMutedText).color,
          transitionActive: document.documentElement.dataset.themeTransition === "true",
        });

        if (elapsed >= 800) {
          resolve(samples);
          return;
        }

        requestAnimationFrame(sample);
      }

      requestAnimationFrame(sample);
      toggle.click();
    });
  });
}

function rgbDistance(color: string, target: string) {
  const channels = (value: string) => value.match(/\d+(?:\.\d+)?/g)?.slice(0, 3).map(Number);
  const actualChannels = channels(color);
  const targetChannels = channels(target);

  if (!actualChannels || !targetChannels) {
    throw new Error(`Expected RGB colors, received ${color} and ${target}.`);
  }

  return Math.hypot(...actualChannels.map((channel, index) => channel - targetChannels[index]));
}

function expectContinuousFinalColor(samples: ThemeSample[], key: "heading" | "mutedText", target: string) {
  const distances = samples.map((sample) => rgbDistance(sample[key], target));

  for (let index = 1; index < distances.length; index += 1) {
    expect(
      distances[index],
      `${key} moved away from its final color at ${samples[index].elapsed.toFixed(1)}ms`,
    ).toBeLessThanOrEqual(distances[index - 1] + 2);
  }

  expect(distances.at(-1), `${key} did not settle on its final color`).toBeLessThanOrEqual(2);
}

function expectIntermediateColor(
  samples: ThemeSample[],
  key: "heading" | "mutedText",
  initial: string,
  target: string,
) {
  expect(
    samples.some((sample) => rgbDistance(sample[key], initial) > 2 && rgbDistance(sample[key], target) > 2),
    `${key} did not interpolate between its initial and final colors`,
  ).toBe(true);
}

for (const initialTheme of ["light", "dark"] as const) {
  test(`${initialTheme} theme reaches its opposite without a terminal text-color reset`, async ({ page }) => {
    await page.emulateMedia({ colorScheme: initialTheme, reducedMotion: "no-preference" });
    await page.goto("/sign-in");
    await setTheme(page, initialTheme);

    const initialColors = await themeColors(page, initialTheme);
    const targetTheme = initialTheme === "light" ? "dark" : "light";
    const targetColors = await themeColors(page, targetTheme);
    await setTheme(page, initialTheme);

    const samples = await sampleThemeTransition(page);

    expectIntermediateColor(samples, "heading", initialColors.heading, targetColors.heading);
    expectIntermediateColor(samples, "mutedText", initialColors.mutedText, targetColors.mutedText);
    expectContinuousFinalColor(samples, "heading", targetColors.heading);
    expectContinuousFinalColor(samples, "mutedText", targetColors.mutedText);
    expect(samples.some((sample) => !sample.transitionActive)).toBe(true);
    await expect(page.locator("html")).toHaveAttribute("data-theme", targetTheme);
    expect(await page.evaluate(() => window.localStorage.getItem("vrdex-theme"))).toBe(targetTheme);
  });
}

test("reduced motion applies the final theme without color interpolation", async ({ page }) => {
  await page.emulateMedia({ colorScheme: "light", reducedMotion: "reduce" });
  await page.goto("/sign-in");
  await setTheme(page, "light");

  const targetColors = await themeColors(page, "dark");
  await setTheme(page, "light");
  await page.getByRole("button", { name: "Toggle color theme" }).click();

  await expect(page.locator("h1")).toHaveCSS("color", targetColors.heading);
  await expect(page.locator(".text-muted").first()).toHaveCSS("color", targetColors.mutedText);
});
