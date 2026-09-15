import {chromium,expect,test} from "@playwright/test";
import {pathToFileURL} from "node:url";
import path from "node:path";
for (const action of ["Pause", "hide", "Unmount"]) test(`@fixture ${action} invalidates pending initial transport`,async({baseURL})=>{
 test.skip(process.env.EVENT_PLAYBACK_PROOF!=="true","Opt-in local transport");test.setTimeout(45000);
 const {startProofServer}=await(new Function("url","return import(url)"))(pathToFileURL(path.resolve("../../scripts/event-playback-proof.mjs")).href);
 const transport=await startProofServer();const browser=await chromium.launch();
 try {
  const page=await browser.newPage();let delayed=false;
  await page.route("**/*.js",async route=>{
   if(route.request().url().includes("mpegts")){delayed=true;await new Promise(resolve=>setTimeout(resolve,800));}
   await route.continue();
  });
  await page.goto(`${baseURL}/playwright/event-lineup-live?transport=${encodeURIComponent(transport.url)}`);
  await page.getByRole("button",{name:"Play Lineup live"}).click();
  await page.getByRole("button",{name:action,exact:true}).click();
  await page.waitForTimeout(1500);
  expect(delayed).toBe(true);
  expect((await(await fetch(`${transport.url}/stats`)).json()).active).toBe(0);
 }finally{try{await browser.close();}finally{await transport.close();}}
});

for (const action of ["pause", "hide", "Unmount"]) test(`@fixture ${action} cancels source play waiting on audio context`, async ({baseURL}) => {
 test.skip(process.env.EVENT_PLAYBACK_PROOF!=="true","Opt-in local transport");
 const {startProofServer}=await(new Function("url","return import(url)"))(pathToFileURL(path.resolve("../../scripts/event-playback-proof.mjs")).href);
 const transport=await startProofServer(); const browser=await chromium.launch();
 try {
  const page=await browser.newPage();
  await page.addInitScript(()=>{
   const resume=AudioContext.prototype.resume;let calls=0;
   AudioContext.prototype.resume=function(){
    const pending=resume.call(this);
    if(++calls===2) return pending.then(()=>new Promise<void>(resolve=>{Object.assign(window,{finishSourceResume:resolve});}));
    return pending;
   };
  });
  await page.goto(`${baseURL}/playwright/event-lineup-live?transport=${encodeURIComponent(transport.url)}`);
  await page.getByRole("button",{name:"Play Lineup live"}).click();
  await page.waitForFunction(()=>"finishSourceResume" in window);
  await page.getByRole("button",{name:action==="pause"?"Pause":action,exact:true}).click();
  if(action!=="pause") await expect.poll(async()=>(await(await fetch(`${transport.url}/stats`)).json()).active).toBe(0);
  await page.evaluate(()=> (window as unknown as {finishSourceResume:()=>void}).finishSourceResume());
  await page.waitForTimeout(500);
  if(action!=="pause") {
   expect((await(await fetch(`${transport.url}/stats`)).json()).active).toBe(0);
   return;
  }
  expect(await page.locator("video").evaluate(video=>(video as HTMLVideoElement).paused)).toBe(true);
  await page.getByRole("button",{name:"Play",exact:true}).click();
  await expect.poll(()=>page.locator("video:not([hidden])").evaluate(video=>(video as HTMLVideoElement).currentTime)).toBeGreaterThan(0);
  await page.getByRole("button",{name:"Unmount",exact:true}).click();
  await expect.poll(async()=>(await(await fetch(`${transport.url}/stats`)).json()).active).toBe(0);
 }finally{try{await browser.close();}finally{await transport.close();}}
});

test("@fixture unmount releases a source with unresolved play completion",async({baseURL})=>{
 test.skip(process.env.EVENT_PLAYBACK_PROOF!=="true","Opt-in local transport");
 const {startProofServer}=await(new Function("url","return import(url)"))(pathToFileURL(path.resolve("../../scripts/event-playback-proof.mjs")).href);
 const transport=await startProofServer();const browser=await chromium.launch();
 try{
  const page=await browser.newPage();
  await page.addInitScript(()=>{
   const play=HTMLMediaElement.prototype.play;
   HTMLMediaElement.prototype.play=function(){return play.call(this).then(()=>new Promise<void>(resolve=>Object.assign(window,{finishPlay:resolve})));};
  });
  await page.goto(`${baseURL}/playwright/event-lineup-live?transport=${encodeURIComponent(transport.url)}`);
  await page.getByRole("button",{name:"Play Lineup live"}).click();
  await page.waitForFunction(()=>"finishPlay" in window);
  await page.getByRole("button",{name:"Unmount",exact:true}).click();
  await expect.poll(async()=>(await(await fetch(`${transport.url}/stats`)).json()).active).toBe(0);
  await page.evaluate(()=>(window as unknown as {finishPlay:()=>void}).finishPlay());
  await page.waitForTimeout(300);
  expect((await(await fetch(`${transport.url}/stats`)).json()).active).toBe(0);
 }finally{try{await browser.close();}finally{await transport.close();}}
});

test("@fixture stale initial context rejection preserves a newer Play",async({baseURL})=>{
 test.skip(process.env.EVENT_PLAYBACK_PROOF!=="true","Opt-in local transport");
 const {startProofServer}=await(new Function("url","return import(url)"))(pathToFileURL(path.resolve("../../scripts/event-playback-proof.mjs")).href);
 const transport=await startProofServer();const browser=await chromium.launch();
 try{
  const page=await browser.newPage();
  await page.addInitScript(()=>{
   const resume=AudioContext.prototype.resume;let first=true;
   AudioContext.prototype.resume=function(){if(first){first=false;return new Promise<void>((_,reject)=>Object.assign(window,{rejectInitialResume:()=>reject(new Error("Obsolete fixture request"))}));}return resume.call(this);};
  });
  await page.goto(`${baseURL}/playwright/event-lineup-live?transport=${encodeURIComponent(transport.url)}`);
  await page.getByRole("button",{name:"Play Lineup live"}).click();
  await page.waitForFunction(()=>"rejectInitialResume" in window);
  await page.getByRole("button",{name:"Play Lineup live"}).click();
  await expect.poll(()=>page.locator("video:not([hidden])").evaluate(video=>(video as HTMLVideoElement).currentTime)).toBeGreaterThan(0);
  await page.evaluate(()=>(window as unknown as {rejectInitialResume:()=>void}).rejectInitialResume());
  await expect(page.getByRole("button",{name:"Pause",exact:true})).toBeVisible();
 }finally{try{await browser.close();}finally{await transport.close();}}
});
