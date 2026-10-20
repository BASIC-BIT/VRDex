import { expect, test } from '@playwright/test';
import path from 'node:path';

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
