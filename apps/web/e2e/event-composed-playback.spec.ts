import { expect, test } from '@playwright/test';
import path from 'node:path';
import { pathToFileURL } from 'node:url';

for (const mode of ['sequence', 'event-stream']) test(`composed public page retains ${mode} playback after consumer unmount @fixture`, async ({ page, baseURL }) => {
  test.setTimeout(45000);
  // Checked-in generated MPEG-TS uses the production loader/MSE decoder without
  // requiring an FFmpeg binary in the default browser CI lane.
  const transport = 'http://127.0.0.1:6799';
  let opened = 0;
  const serve = async (route: import('@playwright/test').Route) => {
    opened++;
    await route.fulfill({ contentType: 'video/mp2t', path: path.resolve('e2e/fixtures/persistent-synthetic.mpegts'), headers: { 'access-control-allow-origin': '*' } });
  };
  await page.route(`${transport}/**`, serve);
  await page.route('https://stream.vrcdn.live/live/fixture.live.ts', serve);
  try {
    await page.goto(`${baseURL}/playwright/event-lineup-live?composed&transport=${encodeURIComponent(transport)}`);
    if (mode === 'event-stream') {
      await page.getByRole('button', { name: 'event-stream', exact: true }).click();
    }
    await expect(page.locator('video')).toHaveCount(0);
    await page.getByRole('button', { name: 'Play Lineup live', exact: true }).click();
    const video = page.locator('video:not([hidden])');
    await expect.poll(() => video.evaluate(node => (node as HTMLVideoElement).currentTime), { timeout: 20000 }).toBeGreaterThan(1);
    await expect(page.locator('video')).toHaveCount(1);
    expect(opened).toBe(1);
    const original = await video.elementHandle();
    const before = await video.evaluate(node => (node as HTMLVideoElement).currentTime);
    await page.getByRole('button', { name: 'Unmount', exact: true }).click();
    await expect(page.locator('[data-event-playback-inline]')).toHaveCount(0);
    await expect.poll(() => video.evaluate(node => (node as HTMLVideoElement).currentTime)).toBeGreaterThan(before + 1);
    expect(await video.evaluate((node, previous) => node === previous, original)).toBe(true);
    await page.getByRole('button', { name: 'Close event playback', exact: true }).click();
    await expect(page.locator('video')).toHaveCount(0);
    expect(await original!.evaluate(node => node.isConnected)).toBe(false);
    expect(opened).toBe(1);
  } finally { await page.goto('about:blank'); }
});


test('composed retained sequence prepares early and keeps uncalibrated silence until eligible failure @fixture', async ({ page, baseURL }) => {
  test.skip(process.env.EVENT_PLAYBACK_PROOF !== 'true', 'Opt-in real loopback MPEG-TS transport');
  test.setTimeout(90000);
  const { startProofServer } = await (new Function('url', 'return import(url)'))(pathToFileURL(path.resolve('../../scripts/event-playback-proof.mjs')).href);
  const transport = await startProofServer();
  const control = (state: string) => fetch(`${transport.url}/control?id=current&state=${state}`, { method: 'POST' });
  await page.addInitScript(() => {
    const Native = window.AudioContext;
    const observations: Array<{ video: HTMLMediaElement; analyser: AnalyserNode }> = [];
    class Context extends Native {
      sourceVideo?: HTMLMediaElement;
      createMediaElementSource(video: HTMLMediaElement) { this.sourceVideo = video; return super.createMediaElementSource(video); }
      createAnalyser() { const analyser = super.createAnalyser(); if (this.sourceVideo) observations.push({ video: this.sourceVideo, analyser }); return analyser; }
    }
    Object.assign(window, { AudioContext: Context, composedAudio: observations });
  });
  try {
    await page.goto(`${baseURL}/playwright/event-lineup-live?composed&kind=silent&transport=${encodeURIComponent(transport.url)}`);
    await page.getByRole('button', { name: 'Play Lineup live', exact: true }).click();
    const current = page.locator('video:not([hidden])');
    const selection = page.getByRole('combobox', { name: 'Performer', exact: true });
    await expect.poll(() => current.evaluate(v => (v as HTMLVideoElement).currentTime), { timeout: 20000 }).toBeGreaterThan(1);
    await page.getByRole('button', { name: 'Eligible', exact: true }).click();
    await expect.poll(() => page.locator('video[hidden]').evaluate(v => (v as HTMLVideoElement).currentTime), { timeout: 20000 }).toBeGreaterThan(1);
    await control('offline');
    await expect(page.getByRole('status').filter({ hasText: 'Stream unavailable' })).toBeVisible({ timeout: 20000 });
    await expect(selection).toHaveValue('a');
    await expect(page.locator('video[hidden]')).toHaveCount(1);
    await control('online');
    await expect.poll(() => current.evaluate(v => (v as HTMLVideoElement).currentTime), { timeout: 25000 }).toBeGreaterThan(1);
    await page.getByRole('button', { name: 'Boundary', exact: true }).click();
    const before = await current.evaluate(v => (v as HTMLVideoElement).currentTime);
    await expect.poll(() => current.evaluate(v => (v as HTMLVideoElement).currentTime)).toBeGreaterThan(before + 1.5);
    const rms = await page.evaluate(() => {
      const observations = (window as unknown as { composedAudio: Array<{ video: HTMLMediaElement; analyser: AnalyserNode }> }).composedAudio;
      const active = observations.findLast(({ video }) => video.isConnected && !video.hidden)!;
      const samples = new Float32Array(active.analyser.fftSize); active.analyser.getFloatTimeDomainData(samples);
      return Math.sqrt(samples.reduce((sum, value) => sum + value * value, 0) / samples.length);
    });
    expect(rms).toBeLessThan(0.000001);
    await expect(selection).toHaveValue('a');
    await control('offline');
    await expect(selection).toHaveValue('b', { timeout: 20000 });
    await expect.poll(() => current.evaluate(v => (v as HTMLVideoElement).currentTime)).toBeGreaterThan(1);
    await page.getByRole('button', { name: 'Close event playback', exact: true }).click();
    await expect(page.locator('video')).toHaveCount(0);
    await expect.poll(async () => (await (await fetch(`${transport.url}/stats`)).json()).active).toBe(0);
  } finally { await page.goto('about:blank'); await transport.close(); }
});
