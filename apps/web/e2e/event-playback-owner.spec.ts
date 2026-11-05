import { test, expect } from "@playwright/test";
import { playbackAuthorization } from "./helpers/playback-authorization";
function wave() {
  const samples = 48000 * 20; const buffer = Buffer.alloc(44 + samples * 2);
  buffer.write("RIFF"); buffer.writeUInt32LE(buffer.length - 8, 4); buffer.write("WAVEfmt ", 8); buffer.writeUInt32LE(16, 16); buffer.writeUInt16LE(1, 20); buffer.writeUInt16LE(1, 22); buffer.writeUInt32LE(48000, 24); buffer.writeUInt32LE(96000, 28); buffer.writeUInt16LE(2, 32); buffer.writeUInt16LE(16, 34); buffer.write("data", 36); buffer.writeUInt32LE(samples * 2, 40);
  for (let i = 0; i < samples; i++) buffer.writeInt16LE(Math.round(Math.sin(i * Math.PI * 880 / 48000) * 1000), 44 + i * 2);
  return buffer;
}
test("retains the actual playing media node across route navigation and replaces only on Play @flow @fixture", async ({ page }, testInfo) => {
  const authorization = await playbackAuthorization(page);
  await page.route("https://stream.vrcdn.live/live/*.webm", route => route.fulfill({ contentType: "audio/wav", body: wave() }));
  await page.goto("/playwright/event-playback");
  await page.getByRole("button", { name: "Play Event a", exact: true }).click();
  const video = page.locator("[data-event-playback-mount] video");
  await expect.poll(() => video.evaluate(node => (node as HTMLVideoElement).currentTime)).toBeGreaterThan(0.1);
  await expect.poll(() => authorization.reads).toContain("a");
  await page.screenshot({ path: testInfo.outputPath("retained-player.png") });
  const original = await video.elementHandle(); const time = await video.evaluate(node => (node as HTMLVideoElement).currentTime);
  await page.getByRole("link", { name: "Other event" }).click();
  await expect(page.getByRole("button", { name: "Play Event b", exact: true })).toBeVisible();
  expect(await video.evaluate((node, old) => node === old, original)).toBe(true);
  await expect.poll(() => video.evaluate(node => (node as HTMLVideoElement).currentTime)).toBeGreaterThan(time);
  await page.goBack(); await expect(page.locator('[data-event-playback-inline="a"]')).toBeVisible();
  expect(await video.evaluate((node, old) => node === old, original)).toBe(true);
  await page.goForward(); await page.getByRole("button", { name: "Play Event b", exact: true }).click();
  await expect(page.locator('[data-event-id="b"] video')).toHaveCount(1);
  expect(await original!.evaluate(node => node.isConnected)).toBe(false);
  await page.getByRole("button", { name: "Close event playback" }).click(); await expect(video).toHaveCount(0);
});

test("authorization refresh revokes the actual playing fixture node @flow @fixture", async ({ page }) => {
  await page.clock.install();
  const authorization = await playbackAuthorization(page);
  await page.route("https://stream.vrcdn.live/live/*.webm", route => route.fulfill({ contentType: "audio/wav", body: wave() }));
  await page.goto("/playwright/event-playback");
  await page.getByRole("button", { name: "Play Event a", exact: true }).click();
  const video = page.locator("[data-event-playback-mount] video");
  await expect.poll(() => video.evaluate(node => node instanceof HTMLVideoElement && !node.paused && node.currentTime > 0)).toBe(true);
  await expect.poll(() => authorization.reads).toEqual(["a"]);
  const original = await video.elementHandle();
  authorization.revoke();
  await page.clock.fastForward(15_000);
  await expect.poll(() => authorization.reads).toEqual(["a", "a"]);
  await expect(video).toHaveCount(0);
  expect(await original!.evaluate(node => node.isConnected)).toBe(false);
  await expect(page.getByRole("region", { name: "Event playback", exact: true })).toBeHidden();
});

test("visible Twitch SDK player handles blocked playback, real controls and iframe disposal @flow @fixture", async ({ page }, testInfo) => {
  const authorization = await playbackAuthorization(page, true);
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
  await expect.poll(() => authorization.reads).toContain("a");
  const frame = page.locator("[data-event-playback-mount] iframe"); await expect(frame).toBeVisible();
  await page.screenshot({ path: testInfo.outputPath("twitch-player.png") });
  const box = await frame.boundingBox(); expect(box!.width).toBeGreaterThanOrEqual(400); expect(box!.height).toBeGreaterThanOrEqual(300);
  expect(await page.evaluate(() => (window as unknown as { sdkOptions: { parent: string[] } }).sdkOptions.parent)).toEqual([new URL(page.url()).hostname]);
  await page.getByRole("button", { name: "Enable playback", exact: true }).click();
  await page.getByRole("slider", { name: "Volume", exact: true }).fill("0.3");
  expect(await page.evaluate(() => (window as unknown as { sdkCalls: string[] }).sdkCalls)).toContain("volume:0.3");
  await page.getByRole("button", { name: "Mute", exact: true }).click();
  expect(await page.evaluate(() => (window as unknown as { sdkCalls: string[] }).sdkCalls)).toContain("muted:true");
  await page.getByRole("group", { name: "Event a controls" }).getByRole("button", { name: "Pause", exact: true }).click();
  expect(await page.evaluate(() => (window as unknown as { sdkCalls: string[] }).sdkCalls)).toContain("pause");
  await page.getByRole("button", { name: "Close event playback" }).click(); await expect(frame).toHaveCount(0);
});

test("explicit legacy/profile playback hands off both directions while browsing stays passive @flow @fixture", async ({ page }) => {
  const authorization = await playbackAuthorization(page);
  await page.route("https://stream.vrcdn.live/live/*.webm", route => route.fulfill({ contentType: "audio/wav", body: wave() }));
  await page.route("**/profile.live.ts", () => {});
  await page.route("**/preview.live.ts", () => {});
  await page.route("https://clips.twitch.tv/**", route => route.fulfill({ contentType: "text/html", body: "<button>Play</button>" }));
  await page.route("https://www.youtube-nocookie.com/**", route => route.fulfill({ contentType: "text/html", body: "<button>Play</button>" }));
  await page.goto("/playwright/event-playback");
  await page.getByRole("button", { name: "Play Event a", exact: true }).click();
  const retained = page.locator("[data-event-playback-mount] video");
  await expect.poll(() => retained.evaluate(node => (node as HTMLVideoElement).paused)).toBe(false);
  await expect.poll(() => authorization.reads).toContain("a");
  await expect(page.locator('iframe[title="YouTube player for Legacy"]')).toHaveCount(0);
  await page.getByRole("button", { name: "Play YouTube player for Legacy", exact: true }).click();
  await expect.poll(() => retained.evaluate(node => (node as HTMLVideoElement).paused)).toBe(true);
  const frame = page.locator('iframe[title="YouTube player for Legacy"]'); await expect(frame).toHaveCount(1);
  await page.getByRole("group", { name: "Event a controls" }).getByRole("button", { name: "Play", exact: true }).click(); await expect(frame).toHaveCount(0);
  await expect.poll(() => retained.evaluate(node => (node as HTMLVideoElement).paused)).toBe(false);
  await page.getByRole("button", { name: "Play Twitch player for Clip", exact: true }).click();
  await expect.poll(() => retained.evaluate(node => (node as HTMLVideoElement).paused)).toBe(true);
  await expect(page.locator('iframe[title="Twitch player for Clip"]')).toHaveCount(1);
  await page.getByRole("group", { name: "Event a controls" }).getByRole("button", { name: "Play", exact: true }).click();
  await expect(page.locator('iframe[title="Twitch player for Clip"]')).toHaveCount(0);
  await page.getByRole("button", { name: "Play Preview", exact: true }).click();
  await expect(page.locator('video[aria-label="Preview"]')).toHaveCount(1);
  expect(await page.locator('video[aria-label="Preview"]').evaluate(node => (node as HTMLVideoElement).muted)).toBe(true);
  await expect.poll(() => retained.evaluate(node => (node as HTMLVideoElement).paused)).toBe(false);
  await page.getByRole("button", { name: "Play Profile", exact: true }).click();
  await expect(page.locator('video[aria-label="Profile"]')).toHaveCount(1);
  await expect.poll(() => retained.evaluate(node => (node as HTMLVideoElement).paused)).toBe(true);
  await page.getByRole("group", { name: "Event a controls" }).getByRole("button", { name: "Play", exact: true }).click();
  await expect(page.locator('video[aria-label="Profile"]')).toHaveCount(0);
  await page.getByRole("button", { name: "Close event playback" }).click();
});

test('operator preview retains rename ownership, gates replacements until Monitor, and close retains paused program @flow @fixture',async({page},info)=>{
 const authorization=await playbackAuthorization(page);
 await page.route('https://stream.vrcdn.live/live/*.webm',route=>route.fulfill({contentType:'audio/wav',body:wave()}));
 await page.route('https://player.twitch.tv/js/embed/v1.js',route=>route.fulfill({contentType:'application/javascript',body:`
 window.previewCalls=[];
 class Player {
  constructor(mount,options){this.handlers={};window.previewMuted=options.muted;window.previewCalls.push('initial:'+options.muted);const frame=document.createElement('iframe');frame.width='400';frame.height='300';frame.srcdoc='<button>Provider control</button>';mount.append(frame);setTimeout(()=>this.emit('ready'),0);}
  addEventListener(event,callback){this.handlers[event]=callback;}removeEventListener(event){delete this.handlers[event];}emit(event){this.handlers[event]?.();}
  play(){window.previewCalls.push('play');this.emit('playing');}pause(){window.previewCalls.push('pause');}
  setMuted(value){window.previewMuted=value;window.previewCalls.push('muted:'+value);if(!value)window.programPausedAtUnmute=document.querySelector('[data-event-playback-mount] video')?.paused;}
  setVolume(){}
 }
 Object.assign(Player,{READY:'ready',PLAYING:'playing',PAUSE:'pause',OFFLINE:'offline',PLAYBACK_BLOCKED:'blocked'});window.Twitch={Player};
 `}));
 await page.goto('/playwright/event-playback');
 await page.getByRole('button',{name:'Play Event a',exact:true}).click();
 const program=page.locator('[data-event-playback-mount] video');
 await expect.poll(()=>program.evaluate(node=>(node as HTMLVideoElement).paused)).toBe(false);
 await expect.poll(()=>authorization.reads).toContain('a');
 const original=await program.elementHandle();
 await page.getByRole('button',{name:'Operator preview',exact:true}).click();
 const preview=page.getByRole('region',{name:/^Preview (Operator preview|Renamed preview)$/});
 await preview.scrollIntoViewIfNeeded();
 const availableWidth=await preview.locator('[aria-label="Local preview player"]').evaluate(node=>node.getBoundingClientRect().width);
 if(info.project.name==='desktop-chromium')
  expect(availableWidth, 'Desktop preview must exercise Monitor, focus and replacement assertions').toBeGreaterThanOrEqual(400);
 if(availableWidth<400){
  await expect(preview.getByRole('link',{name:'Open',exact:true})).toBeVisible();
  await expect(preview.locator('iframe')).toHaveCount(0);
  await expect(preview.getByRole('button',{name:'Monitor',exact:true})).toBeDisabled();
 } else {
  await expect(preview.locator('iframe')).toBeVisible();
  await expect(preview.locator('[aria-label="Local preview player"]')).toHaveAttribute('inert','');
  await expect(preview.locator('[aria-label="Local preview player"]')).toHaveCSS('pointer-events','none');
  await expect.poll(()=>program.evaluate(node=>(node as HTMLVideoElement).paused)).toBe(false);
  expect(await page.evaluate(()=>(window as unknown as {previewCalls:string[]}).previewCalls)).toContain('initial:true');
  await preview.getByRole('button',{name:'Monitor',exact:true}).focus();await page.keyboard.press('Tab');
  await expect(preview.getByRole('button',{name:'Close preview',exact:true})).toBeFocused();
  await page.keyboard.press('Tab');
  expect(await page.evaluate(()=>document.activeElement?.tagName)).not.toBe('IFRAME');
  await preview.scrollIntoViewIfNeeded();
  await expect(preview.locator('iframe')).toBeVisible();
  await expect(preview.locator('[aria-label="Local preview player"]')).toHaveAttribute('inert','');
  await expect(preview.locator('[aria-label="Local preview player"]')).toHaveCSS('pointer-events','none');
  expect(await page.evaluate(()=>(window as unknown as {previewMuted:boolean}).previewMuted)).toBe(true);
  await expect(preview.getByRole('button',{name:'Monitor',exact:true})).toBeEnabled();
  await expect.poll(()=>program.evaluate(node=>(node as HTMLVideoElement).paused)).toBe(false);
  await preview.getByRole('button',{name:'Monitor',exact:true}).click();
  expect(await page.evaluate(()=>(window as unknown as {programPausedAtUnmute:boolean}).programPausedAtUnmute)).toBe(true);
  await expect(preview.locator('[aria-label="Local preview player"]')).not.toHaveAttribute('inert','');
  await page.screenshot({path:info.outputPath('task8-preview-monitor.png')});
  const monitoredFrame = await preview.locator('iframe').elementHandle();
  const callsBeforeRename = await page.evaluate(() => (window as unknown as { previewCalls: string[] }).previewCalls);
  await page.getByRole('button', { name: 'Rename preview', exact: true }).click();
  await expect(preview.getByRole('heading', { name: 'Renamed preview', exact: true })).toBeVisible();
  expect(await preview.locator('iframe').evaluate((node, previous) => node === previous, monitoredFrame)).toBe(true);
  expect(await page.evaluate(() => (window as unknown as { previewCalls: string[] }).previewCalls)).toEqual(callsBeforeRename);
  await page.getByRole('group', { name: 'Event a controls' }).getByRole('button', { name: 'Play', exact: true }).click();
  await expect(preview.locator('iframe')).toHaveCount(0);
  await expect(preview.locator('[aria-label="Local preview player"]')).toHaveAttribute('inert', '');
  const callsBeforeMonitor = await page.evaluate(() => (window as unknown as { previewCalls: string[] }).previewCalls.filter(call => call === 'muted:false').length);
  await preview.getByRole('button', { name: 'Monitor', exact: true }).click();
  await expect(preview.locator('iframe')).toBeVisible();
  await expect.poll(() => page.evaluate(() => (window as unknown as { previewCalls: string[] }).previewCalls.filter(call => call === 'muted:false').length)).toBe(callsBeforeMonitor + 1);
  expect(await page.evaluate(() => (window as unknown as { programPausedAtUnmute: boolean }).programPausedAtUnmute)).toBe(true);
  const callsBeforeReplace = await page.evaluate(() => (window as unknown as { previewCalls: string[] }).previewCalls.filter(call => call === 'muted:false').length);
  await page.getByRole('button', { name: 'Replace preview', exact: true }).click();
  await expect(preview.locator('iframe')).toBeVisible();
  const playerMount = preview.locator('[aria-label="Local preview player"]');
  await expect(playerMount).toHaveAttribute('inert', '');
  await expect(playerMount).toHaveCSS('pointer-events', 'none');
  expect(await page.evaluate(() => (window as unknown as { previewMuted: boolean }).previewMuted)).toBe(true);
  expect(await page.evaluate(() => (window as unknown as { previewCalls: string[] }).previewCalls.filter(call => call === 'muted:false').length)).toBe(callsBeforeReplace);
  await preview.getByRole('button', { name: 'Monitor', exact: true }).focus();
  await page.keyboard.press('Tab');
  await expect(preview.getByRole('button', { name: 'Close preview', exact: true })).toBeFocused();
  await page.keyboard.press('Tab');
  expect(await page.evaluate(() => document.activeElement?.tagName)).not.toBe('IFRAME');
  await preview.scrollIntoViewIfNeeded();
  await expect(preview.locator('iframe')).toBeVisible();
  await expect(playerMount).toHaveAttribute('inert', '');
  await expect(playerMount).toHaveCSS('pointer-events', 'none');
  expect(await page.evaluate(() => (window as unknown as { previewMuted: boolean }).previewMuted)).toBe(true);
  await expect(preview.getByRole('button', { name: 'Monitor', exact: true })).toBeEnabled();
  await page.getByRole('group', { name: 'Event a controls' }).getByRole('button', { name: 'Play', exact: true }).click();
  await expect.poll(() => program.evaluate(node => (node as HTMLVideoElement).paused)).toBe(false);
  await expect(preview.locator('iframe')).toBeVisible();
  expect(await page.evaluate(() => (window as unknown as { previewMuted: boolean }).previewMuted)).toBe(true);
  await preview.getByRole('button', { name: 'Monitor', exact: true }).click();
  expect(await page.evaluate(() => (window as unknown as { programPausedAtUnmute: boolean }).programPausedAtUnmute)).toBe(true);
  const viewport=page.viewportSize()!;
  await page.setViewportSize({width:399,height:viewport.height});
  await expect(preview.locator('iframe')).toHaveCount(0);
  await expect(preview.getByRole('link',{name:'Open',exact:true})).toBeVisible();
  await expect.poll(()=>program.evaluate(node=>(node as HTMLVideoElement).paused)).toBe(true);
  const unmuteCount=await page.evaluate(()=>(window as unknown as {previewCalls:string[]}).previewCalls.filter(call=>call==='muted:false').length);
  await page.setViewportSize(viewport);await preview.scrollIntoViewIfNeeded();
  await expect(preview.locator('iframe')).toBeVisible();
  await expect(preview.locator('[aria-label="Local preview player"]')).toHaveAttribute('inert','');
  expect(await page.evaluate(()=>(window as unknown as {previewCalls:string[]}).previewCalls.filter(call=>call==='muted:false').length)).toBe(unmuteCount);
  await page.evaluate(()=>window.scrollTo(0,0));
  await expect(preview.locator('iframe')).toHaveCount(0);
  await preview.scrollIntoViewIfNeeded();await expect(preview.locator('iframe')).toBeVisible();
 }
 await preview.getByRole('button',{name:'Close preview',exact:true}).click();
 await expect(preview).toHaveCount(0);
 expect(await program.evaluate((node,old)=>node===old,original)).toBe(true);
 if(availableWidth>=400)await expect.poll(()=>program.evaluate(node=>(node as HTMLVideoElement).paused)).toBe(true);
 await page.getByRole('link',{name:'Other event',exact:true}).click();
 expect(await program.evaluate((node,old)=>node===old,original)).toBe(true);
});

for(const width of [399,400])test(`operator Twitch fallback uses real available width at viewport ${width} @flow @fixture`,async({page},info)=>{
 await page.setViewportSize({width,height:800});
 let sdkLoads=0;await page.route('https://player.twitch.tv/js/embed/v1.js',route=>{sdkLoads++;return route.abort();});
 await page.goto('/playwright/event-playback');
 await page.getByRole('button',{name:'Operator preview',exact:true}).click();
 const preview=page.getByRole('region',{name:'Preview Operator preview'});await preview.scrollIntoViewIfNeeded();
 await expect(preview.getByRole('link',{name:'Open',exact:true})).toBeVisible();
 await expect(preview.locator('iframe')).toHaveCount(0);expect(sdkLoads).toBe(0);
 expect(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth)).toBe(true);
 await page.screenshot({path:info.outputPath(`task8-twitch-fallback-${width}.png`)});
});
