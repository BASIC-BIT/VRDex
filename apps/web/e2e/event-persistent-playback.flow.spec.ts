import { test, expect } from "@playwright/test";
import path from "node:path";

test.beforeEach(async ({ page }) => {
  await page.route("https://stream.vrcdn.live/live/synthetic.live.ts", route => route.fulfill({ contentType: "video/mp2t", path: path.resolve("e2e/fixtures/persistent-synthetic.mpegts"), headers: { "access-control-allow-origin": "*" } }));
  await page.route("**/playwright-projection.json", route => route.fulfill({ json: { revoked: false } }));
});
for (const kind of ["managed", "direct", "sequence"]) test(`${kind}: real MPEG-TS survives inline, profile, history and layout changes @fixture`, async ({ page }, testInfo) => {
  await page.goto(`/playwright/event-persistent?kind=${kind}`);
  await page.getByRole("button", { name: "Play Harbor Sessions", exact: true }).click();
  const shell = page.getByRole("region", { name: "Event playback" });
  const video = shell.locator("video:not([hidden])");
  await expect.poll(() => video.evaluate(node => (node as HTMLVideoElement).currentTime)).toBeGreaterThan(0.1);
  await expect(shell).toHaveAttribute("data-presentation", "inline");
  await expect(page.getByRole("button", { name: "Play Harbor Sessions", exact: true })).toHaveCount(0);
  const original = await video.elementHandle();
  const parent = await video.evaluateHandle(node => node.parentElement);
  const time = await video.evaluate(node => (node as HTMLVideoElement).currentTime);
  await page.screenshot({ path: testInfo.outputPath(`${kind}-inline.png`) });
  await page.getByRole("link", { name: "Profile", exact: true }).click();
  await expect(shell).toHaveAttribute("data-presentation", "compact");
  expect(await video.evaluate((node, old) => node === old, original)).toBe(true);
  expect(await video.evaluate((node, old) => node.parentElement === old, parent)).toBe(true);
  await expect.poll(() => video.evaluate(node => (node as HTMLVideoElement).currentTime)).toBeGreaterThan(time + 0.3);
  await page.screenshot({ path: testInfo.outputPath(`${kind}-compact.png`) });
  await page.goBack(); await expect(shell).toHaveAttribute("data-presentation", "inline");
  await page.goForward(); await expect(shell).toHaveAttribute("data-presentation", "compact");
  await shell.getByRole("link", { name: "Return to Harbor Sessions" }).click();
  await expect(shell).toHaveAttribute("data-presentation", "inline");
  const beforeLayout = await video.evaluate(node => (node as HTMLVideoElement).currentTime);
  await page.getByRole("button", { name: "Toggle auth layout fixture" }).click();
  await expect(shell).toHaveAttribute("data-presentation", "compact");
  await page.getByRole("button", { name: "Toggle auth layout fixture" }).click();
  await expect(shell).toHaveAttribute("data-presentation", "inline");
  expect(await video.evaluate((node, old) => node === old, original)).toBe(true);
  await expect.poll(() => video.evaluate(node => (node as HTMLVideoElement).currentTime)).toBeGreaterThan(beforeLayout + 0.1);
  await expect(video).toHaveCount(1);
  await shell.getByRole("button", { name: "Close event playback" }).click();
  expect(await original!.evaluate(node => node.isConnected)).toBe(false);
  await expect(shell.locator("video")).toHaveCount(0);
});

test("replacement, repeated performer identity and route-away revocation @fixture", async ({ page }) => {
  await page.goto("/playwright/event-persistent?kind=sequence");
  await page.getByRole("button", { name: "Play Harbor Sessions", exact: true }).click();
  const shell = page.getByRole("region", { name: "Event playback" });
  const video = shell.locator("video:not([hidden])");
  await expect.poll(() => video.evaluate(node => (node as HTMLVideoElement).currentTime)).toBeGreaterThan(0.1);
  const first = await video.elementHandle();
  await shell.getByRole("combobox", { name: "Performer" }).selectOption("aurora-2");
  await expect(shell.getByRole("combobox", { name: "Performer" })).toHaveValue("aurora-2");
  await expect(shell.getByRole("link", { name: "Return to Harbor Sessions" })).toContainText("DJ Aurora • Encore");
  expect(await video.evaluate((node, old) => node === old, first)).toBe(true);
  await page.getByRole("link", { name: "Other event" }).click();
  expect(await video.evaluate((node, old) => node === old, first)).toBe(true);
  // Same-turn repeated explicit Play calls from the actual application button.
  await page.getByRole("button", { name: "Play Afterglow", exact: true }).evaluate(node => { (node as HTMLButtonElement).click(); (node as HTMLButtonElement).click(); (node as HTMLButtonElement).click(); });
  await expect(shell).toHaveAttribute("data-event-id", "b");
  await expect.poll(() => video.evaluate(node => (node as HTMLVideoElement).currentTime)).toBeGreaterThan(0.1);
  expect(await first!.evaluate(node => node.isConnected)).toBe(false);
  await expect(page.locator("video")).toHaveCount(1);
  await page.getByRole("link", { name: "Other event" }).click();
  await page.getByRole("button", { name: "Play Harbor Sessions", exact: true }).click();
  await expect(shell).toHaveAttribute("data-event-id", "a");
  await page.getByRole("link", { name: "Profile", exact: true }).click();
  await expect(shell).toHaveAttribute("data-presentation", "compact");
  await page.route("**/playwright-projection.json", route => route.fulfill({ json: { revoked: true } }));
  await expect(page.locator("[data-event-playback-mount] video")).toHaveCount(0);
  await expect(shell).toBeHidden();
});

test("geometry, fullscreen, keyboard and all themes @fixture", async ({ page }, testInfo) => {
  await page.goto("/playwright/event-persistent");
  await page.getByRole("button", { name: "Play Harbor Sessions", exact: true }).click();
  const shell = page.getByRole("region", { name: "Event playback" });
  const video = shell.locator("video");
  await expect.poll(() => video.evaluate(node => (node as HTMLVideoElement).currentTime)).toBeGreaterThan(0.1);
  await expect(shell.getByRole("button", { name: "Pause", exact: true })).toBeFocused();
  const node = await video.elementHandle();
  for (const theme of ["dark", "light"]) {
    await page.evaluate(theme => document.documentElement.dataset.theme = theme, theme);
    await page.screenshot({ path: testInfo.outputPath(`${theme}-inline.png`) });
    await page.evaluate(() => window.scrollTo(0, 600));
    await expect(shell).toHaveAttribute("data-presentation", "compact");
    const box = await shell.boundingBox(); const viewport = page.viewportSize()!;
    expect(box!.x).toBeGreaterThanOrEqual(0); expect(box!.y).toBeGreaterThanOrEqual(0);
    expect(box!.x + box!.width).toBeLessThanOrEqual(viewport.width);
    expect(box!.y + box!.height).toBeLessThanOrEqual(viewport.height);
    await page.screenshot({ path: testInfo.outputPath(`${theme}-compact.png`) });
    await page.evaluate(() => window.scrollTo(0, 0));
    await expect(shell).toHaveAttribute("data-presentation", "inline");
  }
  const slot = await page.locator('[data-event-playback-inline="a"]').boundingBox(); const box = await shell.boundingBox();
  expect(Math.abs(slot!.x - box!.x)).toBeLessThan(2); expect(Math.abs(slot!.width - box!.width)).toBeLessThan(2);
  await shell.getByRole("button", { name: "Full screen", exact: true }).click();
  await expect.poll(() => page.evaluate(() => document.fullscreenElement?.getAttribute("aria-label"))).toBe("Event playback");
  await page.screenshot({ path: testInfo.outputPath("fullscreen.png") });
  await shell.getByRole("button", { name: "Exit full screen", exact: true }).click();
  expect(await video.evaluate((current, old) => current === old, node)).toBe(true);
  await shell.getByRole("button", { name: "Mute", exact: true }).focus();
  await page.keyboard.press("Enter");
  expect(await video.evaluate(node => (node as HTMLVideoElement).muted)).toBe(true);
  await shell.getByRole("button", { name: "Close event playback" }).focus();
  await page.keyboard.press("Enter");
  await expect(video).toHaveCount(0);
});

test("supported Twitch SDK stays visible at 400px and disposes on shrink @fixture", async ({ page }, testInfo) => {
  await page.route("https://player.twitch.tv/js/embed/v1.js", route => route.fulfill({ contentType: "application/javascript", body: `
    window.sdkCalls = [];
    class Player {
      constructor(mount, options) { this.handlers = {}; window.sdkOptions = options;
        this.frame = document.createElement('iframe'); this.frame.style.width = '100%'; this.frame.height = '300';
        this.frame.srcdoc = '<body style="margin:0;background:#251c37;color:white;display:grid;place-items:center;height:100vh;font:16px sans-serif">Twitch SDK fixture</body>';
        mount.append(this.frame); setTimeout(() => this.emit('ready'), 0);
      }
      addEventListener(name, fn) { this.handlers[name] = fn; }
      removeEventListener(name) { delete this.handlers[name]; }
      emit(name) { this.handlers[name]?.(); }
      play() { window.sdkCalls.push('play'); this.emit('playing'); }
      pause() { window.sdkCalls.push('pause'); this.emit('pause'); }
      setMuted(value) { window.sdkCalls.push('muted:' + value); }
      setVolume(value) { window.sdkCalls.push('volume:' + value); }
    }
    Object.assign(Player, { READY: 'ready', PLAYING: 'playing', PAUSE: 'pause', OFFLINE: 'offline', PLAYBACK_BLOCKED: 'blocked' }); window.Twitch = { Player };
  ` }));
  await page.setViewportSize({ width: 400, height: 850 });
  await page.goto("/playwright/event-persistent?kind=twitch");
  await page.getByRole("button", { name: "Play Harbor Sessions", exact: true }).click();
  const shell = page.getByRole("region", { name: "Event playback" });
  const iframe = shell.locator("iframe");
  await expect(iframe).toBeVisible();
  const first = await iframe.elementHandle();
  const box = await iframe.boundingBox();
  expect(box!.width).toBeGreaterThanOrEqual(400); expect(box!.height).toBeGreaterThanOrEqual(300);
  expect(box!.x).toBeGreaterThanOrEqual(0); expect(box!.x + box!.width).toBeLessThanOrEqual(400);
  await page.getByRole("link", { name: "Profile", exact: true }).click();
  expect(await iframe.evaluate((node, old) => node === old, first)).toBe(true);
  await page.screenshot({ path: testInfo.outputPath("twitch-400.png") });
  await page.setViewportSize({ width: 375, height: 812 });
  await expect(iframe).toHaveCount(0);
  await expect(shell.getByRole("link", { name: "Open stream" })).toHaveAttribute("href", "https://www.twitch.tv/monstercat");
  expect(await page.evaluate(() => (window as unknown as { sdkCalls: string[] }).sdkCalls)).toContain("pause");
  const fallback = await shell.boundingBox(); expect(fallback!.x).toBeGreaterThanOrEqual(0); expect(fallback!.x + fallback!.width).toBeLessThanOrEqual(375);
  await expect(shell.getByRole("status")).toHaveText("External playback");
  await page.screenshot({ path: testInfo.outputPath("twitch-narrow-fallback.png") });
  await page.setViewportSize({ width: 430, height: 900 });
  await expect(iframe).toHaveCount(0);
  await shell.getByRole("button", { name: "Play", exact: true }).click();
  await expect(iframe).toBeVisible();
  expect(await first!.evaluate(node => node.isConnected)).toBe(false);
  await page.setViewportSize({ width: 844, height: 390 });
  await expect(iframe).toHaveCount(0);
  await expect(shell.getByRole("link", { name: "Open stream" })).toBeVisible();
  await shell.getByRole("button", { name: "Close event playback" }).click();
  await expect(iframe).toHaveCount(0);
});

test("compact media remains reachable at small mobile sizes @fixture", async ({ page }, testInfo) => {
  await page.goto("/playwright/event-persistent");
  await page.getByRole("button", { name: "Play Harbor Sessions", exact: true }).click();
  const shell = page.getByRole("region", { name: "Event playback" });
  const video = shell.locator("video");
  await expect.poll(() => video.evaluate(node => (node as HTMLVideoElement).currentTime)).toBeGreaterThan(0.1);
  const original = await video.elementHandle();
  await page.getByRole("link", { name: "Profile", exact: true }).click();
  for (const width of [320, 360, 430]) {
    await page.setViewportSize({ width, height: 740 });
    for (const theme of ["dark", "light"]) {
      await page.evaluate(theme => document.documentElement.dataset.theme = theme, theme);
      await expect(shell.getByRole("button", { name: "Close event playback" })).toBeInViewport();
      const box = await shell.boundingBox();
      expect(box!.x).toBeGreaterThanOrEqual(0); expect(box!.x + box!.width).toBeLessThanOrEqual(width);
      expect(await video.evaluate((node, old) => node === old, original)).toBe(true);
      await page.screenshot({ path: testInfo.outputPath(`${theme}-${width}-compact.png`) });
    }
  }
});

test("returning inline near the document end preserves scroll and media @fixture", async ({ page }) => {
  await page.goto("/playwright/event-persistent");
  await page.getByRole("button", { name: "Play Harbor Sessions", exact: true }).click();
  const shell = page.getByRole("region", { name: "Event playback" });
  const video = shell.locator("video");
  await expect.poll(() => video.evaluate(node => (node as HTMLVideoElement).currentTime)).toBeGreaterThan(0.1);
  const original = await video.elementHandle();
  await page.evaluate(() => window.scrollTo(0, document.documentElement.scrollHeight));
  await expect(shell).toHaveAttribute("data-presentation", "compact");
  await page.locator("[data-fixture-tail]").evaluate(node => node.remove());
  await page.locator('[data-event-playback-inline="a"]').evaluate(node => node.scrollIntoView({ block: "end" }));
  await expect(shell).toHaveAttribute("data-presentation", "inline");
  const scroll = await page.evaluate(() => window.scrollY);
  await page.evaluate(async () => { for (let i = 0; i < 8; i++) await new Promise(requestAnimationFrame); });
  expect(await page.evaluate(() => window.scrollY)).toBe(scroll);
  expect(await video.evaluate((node, old) => node === old, original)).toBe(true);
  await expect(shell).toHaveAttribute("data-presentation", "inline");
});
