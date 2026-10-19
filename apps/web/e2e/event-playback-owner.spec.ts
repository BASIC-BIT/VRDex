import { test, expect } from "@playwright/test";
function wave() {
  const samples = 48000 * 20; const buffer = Buffer.alloc(44 + samples * 2);
  buffer.write("RIFF"); buffer.writeUInt32LE(buffer.length - 8, 4); buffer.write("WAVEfmt ", 8); buffer.writeUInt32LE(16, 16); buffer.writeUInt16LE(1, 20); buffer.writeUInt16LE(1, 22); buffer.writeUInt32LE(48000, 24); buffer.writeUInt32LE(96000, 28); buffer.writeUInt16LE(2, 32); buffer.writeUInt16LE(16, 34); buffer.write("data", 36); buffer.writeUInt32LE(samples * 2, 40);
  for (let i = 0; i < samples; i++) buffer.writeInt16LE(Math.round(Math.sin(i * Math.PI * 880 / 48000) * 1000), 44 + i * 2);
  return buffer;
}
test("retains the actual playing media node across route navigation and replaces only on Play @fixture", async ({ page }, testInfo) => {
  await page.route("**/retained-test.wav?*", route => route.fulfill({ contentType: "audio/wav", body: wave() }));
  await page.goto("/playwright/event-playback");
  await page.getByRole("button", { name: "Play Event a", exact: true }).click();
  const video = page.locator("[data-event-playback-mount] video");
  await expect.poll(() => video.evaluate(node => (node as HTMLVideoElement).currentTime)).toBeGreaterThan(0.1);
  await page.screenshot({ path: testInfo.outputPath("retained-player.png") });
  const original = await video.elementHandle(); const time = await video.evaluate(node => (node as HTMLVideoElement).currentTime);
  await page.getByRole("link", { name: "Other event" }).click();
  await expect(page.getByRole("button", { name: "Play Event b", exact: true })).toBeVisible();
  expect(await video.evaluate((node, old) => node === old, original)).toBe(true);
  await expect.poll(() => video.evaluate(node => (node as HTMLVideoElement).currentTime)).toBeGreaterThan(time);
  await page.goBack(); await expect(page.getByRole("button", { name: "Play Event a", exact: true })).toBeVisible();
  expect(await video.evaluate((node, old) => node === old, original)).toBe(true);
  await page.goForward(); await page.getByRole("button", { name: "Play Event b", exact: true }).click();
  await expect(page.locator('[data-event-id="b"] video')).toHaveCount(1);
  expect(await original!.evaluate(node => node.isConnected)).toBe(false);
  await page.getByRole("button", { name: "Close event playback" }).click(); await expect(video).toHaveCount(0);
});

test("visible Twitch SDK player handles blocked playback, real controls and iframe disposal @fixture", async ({ page }, testInfo) => {
  await page.route("https://player.twitch.tv/js/embed/v1.js", route => route.fulfill({ contentType: "application/javascript", body: `
    window.sdkCalls = []; window.sdkLoads = (window.sdkLoads || 0) + 1;
    class Player {
      constructor(mount, options) { this.handlers = {}; this.blocked = true; window.sdkOptions = options;
        this.frame = document.createElement('iframe'); this.frame.width = '400'; this.frame.height = '300'; mount.append(this.frame);
        setTimeout(() => this.emit('ready'), 0);
      }
      addEventListener(name, fn) { this.handlers[name] = fn; }
      removeEventListener(name) { delete this.handlers[name]; }
      emit(name) { this.handlers[name]?.(); }
      play() { window.sdkCalls.push('play'); if (this.blocked) { this.blocked = false; this.emit('blocked'); } else this.emit('playing'); }
      pause() { window.sdkCalls.push('pause'); this.emit('pause'); }
      setMuted(value) { window.sdkCalls.push('muted:' + value); }
      setVolume(value) { window.sdkCalls.push('volume:' + value); }
    }
    Object.assign(Player, { READY: 'ready', PLAYING: 'playing', PAUSE: 'pause', OFFLINE: 'offline', PLAYBACK_BLOCKED: 'blocked' }); window.Twitch = { Player };
  ` }));
  await page.goto("/playwright/event-playback?kind=twitch");
  await page.getByRole("button", { name: "Play Event a", exact: true }).click();
  await expect(page.getByRole("button", { name: "Enable playback", exact: true })).toBeVisible();
  const frame = page.locator("[data-event-playback-mount] iframe"); await expect(frame).toBeVisible();
  await page.screenshot({ path: testInfo.outputPath("twitch-player.png") });
  const box = await frame.boundingBox(); expect(box!.width).toBeGreaterThanOrEqual(400); expect(box!.height).toBeGreaterThanOrEqual(300);
  expect(await page.evaluate(() => (window as unknown as { sdkOptions: { parent: string[] } }).sdkOptions.parent)).toEqual(["127.0.0.1"]);
  await page.getByRole("button", { name: "Enable playback", exact: true }).click();
  await page.getByRole("slider", { name: "Volume", exact: true }).fill("0.3");
  expect(await page.evaluate(() => (window as unknown as { sdkCalls: string[] }).sdkCalls)).toContain("volume:0.3");
  await page.getByRole("button", { name: "Mute", exact: true }).click();
  expect(await page.evaluate(() => (window as unknown as { sdkCalls: string[] }).sdkCalls)).toContain("muted:true");
  await page.getByRole("group", { name: "Event a controls" }).getByRole("button", { name: "Pause", exact: true }).click();
  expect(await page.evaluate(() => (window as unknown as { sdkCalls: string[] }).sdkCalls)).toContain("pause");
  await page.getByRole("button", { name: "Close event playback" }).click(); await expect(frame).toHaveCount(0);
});

test("explicit legacy/profile playback hands off both directions while browsing stays passive @fixture", async ({ page }) => {
  await page.route("**/retained-test.wav?*", route => route.fulfill({ contentType: "audio/wav", body: wave() }));
  await page.route("**/profile.live.ts", () => {});
  await page.route("**/preview.live.ts", () => {});
  await page.route("https://clips.twitch.tv/**", route => route.fulfill({ contentType: "text/html", body: "<button>Play</button>" }));
  await page.route("https://www.youtube-nocookie.com/**", route => route.fulfill({ contentType: "text/html", body: "<button>Play</button>" }));
  await page.goto("/playwright/event-playback");
  await page.getByRole("button", { name: "Play Event a", exact: true }).click();
  const retained = page.locator("[data-event-playback-mount] video");
  await expect.poll(() => retained.evaluate(node => (node as HTMLVideoElement).paused)).toBe(false);
  await expect(page.locator('iframe[title="YouTube player for Legacy"]')).toHaveCount(0);
  await page.getByRole("button", { name: "Play YouTube player for Legacy", exact: true }).click();
  await expect.poll(() => retained.evaluate(node => (node as HTMLVideoElement).paused)).toBe(true);
  const frame = page.locator('iframe[title="YouTube player for Legacy"]'); await expect(frame).toHaveCount(1);
  await page.getByRole("button", { name: "Play Event a", exact: true }).click(); await expect(frame).toHaveCount(0);
  await expect.poll(() => retained.evaluate(node => (node as HTMLVideoElement).paused)).toBe(false);
  await page.getByRole("button", { name: "Play Twitch player for Clip", exact: true }).click();
  await expect.poll(() => retained.evaluate(node => (node as HTMLVideoElement).paused)).toBe(true);
  await expect(page.locator('iframe[title="Twitch player for Clip"]')).toHaveCount(1);
  await page.getByRole("button", { name: "Play Event a", exact: true }).click();
  await expect(page.locator('iframe[title="Twitch player for Clip"]')).toHaveCount(0);
  await page.getByRole("button", { name: "Play Preview", exact: true }).click();
  await expect(page.locator('video[aria-label="Preview"]')).toHaveCount(1);
  expect(await page.locator('video[aria-label="Preview"]').evaluate(node => (node as HTMLVideoElement).muted)).toBe(true);
  await expect.poll(() => retained.evaluate(node => (node as HTMLVideoElement).paused)).toBe(false);
  await page.getByRole("button", { name: "Play Profile", exact: true }).click();
  await expect(page.locator('video[aria-label="Profile"]')).toHaveCount(1);
  await expect.poll(() => retained.evaluate(node => (node as HTMLVideoElement).paused)).toBe(true);
  await page.getByRole("button", { name: "Play Event a", exact: true }).click();
  await expect(page.locator('video[aria-label="Profile"]')).toHaveCount(0);
  await page.getByRole("button", { name: "Close event playback" }).click();
});
