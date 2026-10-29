import { expect, test } from "@playwright/test";

for (const story of ["media-vrcdn-player-controls--native-video", "media-vrcdn-player-controls--audio-only", "media-persistent-event-player--compact", "media-persistent-event-player--profile-audio"]) {
  test(`${story} mode controls fit and work by keyboard @storybook-visual`, async ({ page }, info) => {
    await page.goto(`/iframe.html?id=${story}&viewMode=story`);
    const mode = page.getByRole("group", { name: "Playback mode", exact: true });
    await expect(mode).toBeVisible();
    const audio = mode.getByRole("button", { name: "Audio only", exact: true });
    await audio.focus(); await page.keyboard.press("Enter"); await expect(audio).toHaveAttribute("aria-pressed", "true");
    const video = mode.getByRole("button", { name: "Video", exact: true });
    await video.focus(); await page.keyboard.press("Space"); await expect(video).toHaveAttribute("aria-pressed", "true");
    await audio.click();
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
    for (const button of [audio, video]) { const box = await button.boundingBox(); expect(box!.height).toBeGreaterThanOrEqual(44); expect(box!.width).toBeGreaterThanOrEqual(44); }
    const pip = page.getByRole("button", { name: "Picture in picture", exact: true });
    if (await pip.count()) await expect(pip).toBeDisabled();
    const screenshot = info.outputPath(`${story}-${info.project.name}.png`);
    await page.screenshot({ path: screenshot, fullPage: true }); await info.attach("native-controls", { path: screenshot, contentType: "image/png" });
  });
}
