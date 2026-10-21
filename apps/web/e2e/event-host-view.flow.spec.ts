import { expect, test } from '@playwright/test';
const path='/playwright-afterglow-social/events/playwright-event-host-view/host';
test('host links remain usable during slow and unavailable status checks @flow @fixture',async({page},info)=>{
 await page.addInitScript(()=>{Object.defineProperty(navigator,'clipboard',{value:{writeText:async(value:string)=>{sessionStorage.setItem('copied',value)}}});});
 let release:()=>void=()=>{};
 const held=new Promise<void>(resolve=>{release=resolve});
 await page.route('**/host/status',async route=>{await held;await route.fulfill({json:{'vrcdn:aurora':{state:'unavailable',observedAt:Date.now()}}});});
 await page.goto(path);
 await expect(page.getByRole('heading',{name:'Host view'})).toBeVisible();
 await expect(page.getByRole('button',{name:'Copy PC',exact:true}).first()).toBeVisible();
 await page.getByRole('button',{name:'Copy PC',exact:true}).first().click();
 await expect.poll(()=>page.evaluate(()=>sessionStorage.getItem('copied'))).toContain('vrcdn');
 await page.getByRole('button',{name:'Copy Quest',exact:true}).first().click();
 await expect.poll(()=>page.evaluate(()=>sessionStorage.getItem('copied'))).toContain('.live.ts');
 expect(await page.locator('video,audio,iframe').count()).toBe(0);
 release();
 await expect(page.getByText('Unavailable',{exact:true}).first()).toBeVisible();
 expect(await page.evaluate(()=>document.documentElement.scrollWidth<=window.innerWidth)).toBe(true);
 await page.screenshot({path:info.outputPath('event-host-view.png'),fullPage:true});
 await expect(page.getByText('Other links',{exact:true})).toHaveCount(2);
 await page.getByText('Other links',{exact:true}).first().click();
 await expect(page.getByRole('button',{name:'Copy Twitch',exact:true}).first()).toBeVisible();
 await page.getByText('URLs',{exact:true}).first().click();
 await expect(page.getByText('PC: rtspt://stream.vrcdn.live/live/dj-aurora',{exact:true}).first()).toBeVisible();
});
test('unpublished or mismatched event host and status are not public @flow @fixture',async({request})=>{
 for(const suffix of ['/host','/host/status']) {
  const result=await request.get(`/wrong-community/events/playwright-event-host-view${suffix}`);
  expect(result.status()).toBe(404);
  if(suffix.endsWith('/status')) expect(await result.json()).toEqual({});
 }
});

test('status endpoint returns only public observations for an event with no public sources @flow @fixture', async({request})=>{
 const result=await request.get('/playwright-afterglow-social/events/playwright-date-only-event/host/status?url=https://example.invalid/private');
 expect(result.status()).toBe(200);
 expect(await result.json()).toEqual({});
});
test('source-live labels remain independent from scheduled and selected source @flow @fixture',async({page},info)=>{
 await page.route('**/host/status',route=>route.fulfill({json:{
  'vrcdn:dj-aurora':{state:'live',observedAt:Date.now()},
  'vrcdn:suggested-aurora':{state:'live',observedAt:Date.now()},
  'twitch:dj_aurora':{state:'offline',observedAt:Date.now()},
 }}));
 await page.goto(path);
 await expect(page.getByText('Live now',{exact:true})).toHaveCount(4);
 await expect(page.getByText('Offline',{exact:true})).toHaveCount(2);
 await expect(page.getByText(/Selected source/)).toHaveCount(1);
 await expect(page.getByText(/Scheduled now/)).toHaveCount(1);
 expect(await page.locator('video,audio,iframe').count()).toBe(0);
 await page.screenshot({path:info.outputPath('event-host-live.png'),fullPage:true});
});

test('preview is explicit, muted, singular and disposed on close @flow @fixture', async({page},info)=>{
 let mediaRequests=0;
 await page.route('**/host/status',route=>route.fulfill({json:{}}));
 await page.route('https://stream.vrcdn.live/**',async route=>{
  mediaRequests++;
  await new Promise(resolve=>setTimeout(resolve,500));
  await route.fulfill({status:200,contentType:'video/mp2t',body:Buffer.alloc(188*10,0x47)}).catch(()=>{});
 });
 await page.goto(path);
 expect(await page.locator('video,audio,iframe').count()).toBe(0);
 expect(mediaRequests).toBe(0);
 await page.getByRole('button',{name:'Preview',exact:true}).first().click();
 await expect(page.locator('video')).toHaveCount(1);
 expect(await page.locator('video').evaluate(video=>video instanceof HTMLVideoElement && video.muted)).toBe(true);
 await expect.poll(()=>mediaRequests).toBeGreaterThan(0);
 await page.screenshot({path:info.outputPath('event-host-preview.png'),fullPage:true});
 await page.getByRole('button',{name:'Preview',exact:true}).first().click();
 await expect(page.locator('video')).toHaveCount(1);
 expect(await page.locator('video').evaluate(video=>video instanceof HTMLVideoElement && video.muted)).toBe(true);
 await page.getByRole('button',{name:'Close preview',exact:true}).click();
 await expect(page.locator('video')).toHaveCount(0);
 const otherLinks=page.getByText('Other links',{exact:true}).first();
 await otherLinks.click();
 await otherLinks.locator('..').getByRole('button',{name:'Preview',exact:true}).click();
 await expect(page.locator('video')).toHaveCount(1);
 await otherLinks.click();
 await expect(page.locator('video')).toHaveCount(0);
});

for (const partial of [false,true]) test(`R8 ${partial?'partial':'unprobed'} statuses preserve controls @flow @fixture`,async({page},info)=>{
 await page.addInitScript(()=>{Object.defineProperty(navigator,'clipboard',{value:{writeText:async(value:string)=>{sessionStorage.setItem('copied',value)}}});});
 await page.route('**/host/status',route=>route.fulfill({json:partial?{
  'vrcdn:dj-aurora':{state:'unavailable',observedAt:Date.now()},
  'twitch:dj_aurora':{state:'offline',observedAt:Date.now()},
  'vrcdn:suggested-aurora':{state:'live',observedAt:Date.now()-61000},
 }: {}}));
 await page.goto(path);
 await page.getByText('Other links',{exact:true}).first().click();
 await expect(page.getByText('Unknown',{exact:true})).toHaveCount(partial?2:6);
 if(partial){await expect(page.getByText('Unavailable',{exact:true})).toHaveCount(2);await expect(page.getByText('Offline',{exact:true})).toHaveCount(2);}
 await expect(page.getByText(/Selected source/)).toHaveCount(1);
 await expect(page.getByText(/Scheduled now/)).toHaveCount(1);
 for(const label of ['PC','Quest']){await page.getByRole('button',{name:`Copy ${label}`,exact:true}).first().click();await expect.poll(()=>page.evaluate(()=>sessionStorage.getItem('copied'))).toContain(label==='Quest'?'.live.ts':'rtspt://');}
 await expect(page.getByRole('button',{name:'Preview',exact:true}).first()).toBeVisible();
 expect(await page.locator('video,audio,iframe').count()).toBe(0);
 expect(await page.evaluate(()=>document.documentElement.scrollWidth<=window.innerWidth)).toBe(true);
 await page.screenshot({path:info.outputPath(`r8-host-${partial?'partial':'unprobed'}.png`),fullPage:true});
});
