import { chromium, firefox, expect, test, type Page, type Browser } from "@playwright/test";
// The proof server is deliberately a Node script, outside the application bundle.
import { pathToFileURL } from "node:url";
import path from "node:path";

type Sample = { at: number; kind: string; db: number; outputDb: number; time: number; valid: boolean; silenceMs: number; gap: number; failureMs: number; failed: boolean; eof: boolean; ended: boolean; bufferedSeconds: number };
type Snapshot = { current: string; nextReady: boolean; connections: number; rejected: boolean; samples: Sample[]; context: string };
const read = async (page: Page): Promise<Snapshot> => JSON.parse(await page.getByTestId("snapshot").innerText());
const click = (page: Page, name: string) => page.getByRole("button", { name, exact: true }).click();
const latest = async (page: Page) => (await read(page)).samples.at(-1)!;

for (const engine of [chromium, firefox]) {
  test(`@fixture MPEG-TS analyser and switching proof ${engine.name()}`, async ({ baseURL }, info) => {
    test.skip(process.env.EVENT_PLAYBACK_PROOF !== "true", "Opt-in FFmpeg transport experiment; see engineering proof note.");
    test.setTimeout(180_000);
    const { startProofServer } = await (new Function("url", "return import(url)"))(pathToFileURL(path.resolve("../../scripts/event-playback-proof.mjs")).href);
    const transport = await startProofServer();
    let browser: Browser | undefined;
    const stats = async () => (await fetch(`${transport.url}/stats`)).json();
    const control = (state: string) => fetch(`${transport.url}/control?id=next&state=${state}`, { method: "POST" });
    const evidence: Record<string, unknown> = { engine: engine.name() };
    try {
      browser = await engine.launch();
      evidence.browser = browser.version();
      const page = await browser.newPage();
      await page.goto(`${baseURL}/playwright/event-lineup-proof?transport=${encodeURIComponent(transport.url)}`);
      await expect(page.getByRole("button", { name: "Start audible", exact: true })).toBeVisible();
      expect((await stats()).opened).toBe(0);
      await click(page, "Prepare next");
      expect((await stats()).opened).toBe(0);
      await click(page, "Start audible");
      await expect.poll(async () => (await latest(page))?.db, { timeout: 20_000 }).toBeGreaterThan(-30);
      evidence.audible = await latest(page);
      await click(page, "Volume 25%");
      await expect.poll(async () => (await latest(page)).outputDb, { timeout: 5000 }).toBeLessThan(-30);
      evidence.volumeQuarter = await latest(page);
      expect((await latest(page)).db).toBeGreaterThan(-30);
      await click(page, "Mute");
      await expect.poll(async () => (await latest(page)).outputDb).toBeLessThan(-100);
      evidence.muted = await latest(page);
      expect((await latest(page)).db).toBeGreaterThan(-30);
      expect((await latest(page)).silenceMs).toBe(0);
      await click(page, "Pause");
      await expect.poll(async () => (await latest(page)).valid).toBe(false);
      await click(page, "Resume");
      await expect.poll(async () => (await latest(page)).valid).toBe(true);
      await click(page, "Suspend context");
      await expect.poll(async () => (await read(page)).context).toBe("suspended");
      expect((await latest(page)).silenceMs).toBe(0);
      await click(page, "Resume");
      await expect.poll(async () => (await latest(page)).valid).toBe(true);
      await click(page, "Mute");
      await click(page, "Start quiet");
      await expect.poll(async () => { const s = await latest(page); return s?.kind === "quiet" && s.valid && s.db > -90 && s.db < -65; }, { timeout: 20_000 }).toBe(true);
      // Collect a full second to distinguish a quiet tone from AAC encoded digital silence.
      const quietStart = (await latest(page)).at;
      await expect.poll(async () => (await latest(page)).at - quietStart).toBeGreaterThan(1200);
      evidence.quiet = (await read(page)).samples.filter(s => s.kind === "quiet" && s.valid);
      expect((evidence.quiet as Sample[]).every(s => s.silenceMs === 0)).toBe(true);
      await click(page, "Start silent");
      await expect.poll(async () => (await latest(page))?.silenceMs, { timeout: 20_000 }).toBeGreaterThanOrEqual(1000);
      evidence.connectedSilence = await latest(page);
      if (engine.name() === "chromium") {
        const cdp = await page.context().newCDPSession(page);
        const frozenAt = (await latest(page)).at;
        await cdp.send("Page.setWebLifecycleState", { state: "frozen" });
        await new Promise(resolve => setTimeout(resolve, 1200));
        await cdp.send("Page.setWebLifecycleState", { state: "active" });
        evidence.frozenResume = (await read(page)).samples.filter(s => s.at > frozenAt).slice(0, 3);
        await cdp.detach();
      }
      // A real foreground main-thread delay must discard accumulated silence.
      const delayedAt = await page.evaluate(() => {
        const at = performance.now();
        while (performance.now() - at < 700) { /* controlled scheduling delay */ }
        return at;
      });
      await expect.poll(async () => (await read(page)).samples.some(s => s.at > delayedAt && s.gap > 500)).toBe(true);
      const delayedSample = (await read(page)).samples.find(s => s.at > delayedAt && s.gap > 500)!;
      expect(delayedSample.valid).toBe(false);
      expect(delayedSample.silenceMs).toBe(0);
      evidence.delayedSample = delayedSample;
      const otherPage = await browser.newPage();
      await otherPage.goto("about:blank");
      await otherPage.bringToFront();
      const visibility = await page.evaluate(() => document.visibilityState);
      evidence.backgroundVisibility = visibility;
      if (visibility === "hidden") {
        await expect.poll(async () => (await latest(page)).valid).toBe(false);
        expect((await latest(page)).silenceMs).toBe(0);
      }
      await page.bringToFront();
      await otherPage.close();
      await expect.poll(async () => (await latest(page)).valid).toBe(true);
      expect((await stats()).active).toBe(1);
      await click(page, "Pause");
      await expect.poll(async () => (await latest(page)).silenceMs).toBe(0);
      await click(page, "Resume");
      await expect.poll(async () => (await latest(page)).silenceMs, { timeout: 10_000 }).toBeGreaterThanOrEqual(1000);
      await control("offline");
      await click(page, "Prepare next");
      await expect.poll(async () => (await read(page)).connections).toBe(2);
      expect((await read(page)).nextReady).toBe(false);
      await click(page, "Switch");
      expect((await read(page)).current).toBe("silent");
      await control("online");
      await click(page, "Prepare next");
      await expect.poll(async () => (await read(page)).nextReady, { timeout: 20_000 }).toBe(true);
      evidence.nextPrepared = { snapshot: await latest(page), stats: await stats() };
      expect((await latest(page)).outputDb).toBeLessThan(-100);
      const switchedAt = await page.evaluate(() => performance.now());
      await click(page, "Switch");
      await expect.poll(async () => (await latest(page)).outputDb, { timeout: 5000 }).toBeGreaterThan(-45);
      evidence.switchDelayMs = (await latest(page)).at - switchedAt;
      await expect.poll(async () => (await stats()).active).toBe(1);
      await fetch(`${transport.url}/control?id=next&state=offline`, { method: "POST" });
      await expect.poll(async () => (await stats()).active).toBe(0);
      // Broken transport invalidates observation even if buffered samples remain audible.
      await expect.poll(async () => (await latest(page)).valid, { timeout: 15_000 }).toBe(false);
      evidence.disconnected = await latest(page);
      await click(page, "Start audible");
      await expect.poll(async () => (await latest(page)).valid, { timeout: 20_000 }).toBe(true);
      evidence.recovered = await latest(page);
      const shortDropAt = await page.evaluate(() => performance.now());
      await fetch(transport.url + "/control?id=current&state=short-drop", { method: "POST" });
      await expect.poll(async () => (await stats()).interruptions.at(-1)?.resumedAt).toBeTruthy();
      await expect.poll(async () => (await latest(page)).at - shortDropAt).toBeGreaterThan(1200);
      const shortDropSamples = (await read(page)).samples.filter(s => s.at > shortDropAt);
      const interruption = (await stats()).interruptions.at(-1);
      expect(interruption.resumedAt - interruption.startedAt).toBeLessThan(1000);
      expect(shortDropSamples.every(s => s.failureMs < 1000)).toBe(true);
      expect((await latest(page)).failureMs).toBe(0);
      expect((await latest(page)).valid).toBe(true);
      expect((await read(page)).current).toBe("audible");
      evidence.shortDrop = { interruption, samples: shortDropSamples };
      await fetch(transport.url + "/control?id=current&state=eof", { method: "POST" });
      await expect.poll(async () => (await stats()).active).toBe(0);
      await expect.poll(async () => (await latest(page)).eof).toBe(true);
      evidence.cleanEof = { observed: await latest(page), stats: await stats() };
      // Clean HTTP EOF is transport state; it cannot identify broadcaster completion.
      expect((await latest(page)).failed).toBe(false);
      expect((await read(page)).current).toBe("audible");
      const eofAt = (await latest(page)).at;
      await expect.poll(async () => (await latest(page)).at - eofAt).toBeGreaterThan(1200);
      evidence.afterEof = await latest(page);
      await click(page, "Stop");
      await expect.poll(async () => (await stats()).active).toBe(0);
      await click(page, "Reject next play");
      await click(page, "Start audible");
      await expect.poll(async () => (await read(page)).rejected).toBe(true);
      await click(page, "Resume");
      await expect.poll(async () => (await latest(page)).valid, { timeout: 20_000 }).toBe(true);
      await click(page, "Start break");
      await expect.poll(async () => { const samples = (await read(page)).samples; return samples.some(s => s.kind === "break" && s.silenceMs >= 1000); }, { timeout: 25_000 }).toBe(true);
      evidence.breakSamples = (await read(page)).samples.filter(s => s.kind === "break");
      const shortBreak = (evidence.breakSamples as Sample[]).filter(s => s.time >= 2 && s.time < 4);
      expect(shortBreak.length).toBeGreaterThan(5);
      expect(shortBreak.every(s => s.silenceMs < 1000)).toBe(true);
      await click(page, "Stop");
      await expect.poll(async () => (await stats()).active).toBe(0);
      await click(page, "Baseline");
      await page.getByRole("button", { name: "Play Unmodified player" }).click();
      await expect.poll(() => page.locator("video").evaluate(v => (v as HTMLVideoElement).currentTime), { timeout: 20_000 }).toBeGreaterThan(1);
      evidence.baselineProgress = await page.locator("video").evaluate(v => ({ time: (v as HTMLVideoElement).currentTime, volume: (v as HTMLVideoElement).volume, muted: (v as HTMLVideoElement).muted }));
      await page.getByRole("button", { name: "Mute", exact: true }).last().click();
      expect(await page.locator("video").evaluate(v => (v as HTMLVideoElement).muted)).toBe(true);
      await page.getByRole("button", { name: "Unmute", exact: true }).click();
      expect(await page.locator("video").evaluate(v => (v as HTMLVideoElement).muted)).toBe(false);
      await page.getByRole("slider", { name: "Volume" }).fill("0.25");
      expect(await page.locator("video").evaluate(v => (v as HTMLVideoElement).volume)).toBe(0.25);
      await info.attach(`proof-${engine.name()}.png`, { body: await page.screenshot(), contentType: "image/png" });
      await page.goto("about:blank");
      await expect.poll(async () => (await stats()).active).toBe(0);
      evidence.finalStats = await stats();
      expect((await stats()).highWater).toBe(2);
      expect((await stats()).denied).toBe(0);
    } finally {
      try {
        await info.attach(`proof-${engine.name()}.json`, { body: JSON.stringify(evidence, null, 2), contentType: "application/json" });
      } finally {
        try { await browser?.close(); } finally { await transport.close(); }
      }
    }
  });
}
