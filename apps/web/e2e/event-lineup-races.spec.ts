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

test("@fixture pending final slot replacement survives pause before overtime connection",async({baseURL})=>{
 test.skip(process.env.EVENT_PLAYBACK_PROOF!=="true","Opt-in local transport");test.setTimeout(30000);
 const {startProofServer}=await(new Function("url","return import(url)"))(pathToFileURL(path.resolve("../../scripts/event-playback-proof.mjs")).href);
 const transport=await startProofServer();const browser=await chromium.launch();
 let releaseImport:()=>void=()=>{};
 try{
  const page=await browser.newPage();let pending=false;
  await page.route("**/*.js",async route=>{
   if(route.request().url().includes("mpegts")){pending=true;await new Promise<void>(resolve=>{releaseImport=resolve;});}
   await route.continue();
  });
  await page.goto(`${baseURL}/playwright/event-lineup-live?transport=${encodeURIComponent(transport.url)}`);
  await page.getByRole("button",{name:"Next slot",exact:true}).click();
  await page.getByRole("button",{name:"Play Lineup live"}).click();
  await expect.poll(()=>pending).toBe(true);
  await page.getByRole("button",{name:"replace",exact:true}).click();
  await expect(page.locator("[data-current]")).toHaveAttribute("data-current","b-new");

  await page.getByRole("button",{name:"After end",exact:true}).click();
  await page.getByRole("button",{name:"Pause",exact:true}).click();
  await page.getByRole("button",{name:"Play",exact:true}).click();
  await expect(page.locator("[data-current]")).toHaveAttribute("data-current","b-new");
  releaseImport();
  await expect.poll(()=>page.locator("video").evaluate(video=>(video as HTMLVideoElement).currentTime)).toBeGreaterThan(1);
  await expect(page.locator("video")).toHaveCount(1);
  await expect.poll(()=>page.locator("video").evaluate(video=>(video as HTMLVideoElement).paused)).toBe(false);
  expect((await(await fetch(`${transport.url}/stats`)).json()).opened).toBe(1);
 }finally{releaseImport();try{await browser.close();}finally{await transport.close();}}
});


for (const kind of ["silent", "audible"]) test(`@fixture ordered overlap ${kind} uses later boundary`, async ({baseURL}) => {
 test.skip(process.env.EVENT_PLAYBACK_PROOF!=="true","Opt-in local transport");test.setTimeout(45000);
 const {startProofServer}=await(new Function("url","return import(url)"))(pathToFileURL(path.resolve("../../scripts/event-playback-proof.mjs")).href);
 const transport=await startProofServer();const browser=await chromium.launch();
 try {
  const page=await browser.newPage();
  await page.goto(`${baseURL}/playwright/event-lineup-live?transport=${encodeURIComponent(transport.url)}&kind=${kind}`);
  await page.getByRole("button",{name:"overlap",exact:true}).click();
  await page.getByRole("button",{name:"Play Lineup live"}).click();
  await expect.poll(()=>page.locator("video").evaluate(v=>(v as HTMLVideoElement).currentTime)).toBeGreaterThan(1);
  await page.getByRole("button",{name:"Just before eligible",exact:true}).click();
  await page.waitForTimeout(1200);
  expect((await(await fetch(`${transport.url}/stats`)).json()).active).toBe(1);
  await page.getByRole("button",{name:"Exactly eligible",exact:true}).click();
  await expect.poll(async()=>(await(await fetch(`${transport.url}/stats`)).json()).opened).toBe(2);
  if(kind==="audible") {
   await page.waitForTimeout(1500);
   await expect(page.locator("[data-current]")).toHaveAttribute("data-current","a");
   await fetch(`${transport.url}/control?id=current&state=eof`,{method:"POST"});
  }
  await expect(page.locator("[data-current]")).toHaveAttribute("data-current","b",{timeout:20000});
  await page.getByRole("button",{name:"Unmount",exact:true}).click();
  await expect.poll(async()=>(await(await fetch(`${transport.url}/stats`)).json()).active).toBe(0);
 }finally{try{await browser.close();}finally{await transport.close();}}
});


test("@fixture failed final reconnect retains overtime selection across pause", async ({baseURL}) => {
 test.skip(process.env.EVENT_PLAYBACK_PROOF!=="true","Opt-in local transport");test.setTimeout(45000);
 const {startProofServer}=await(new Function("url","return import(url)"))(pathToFileURL(path.resolve("../../scripts/event-playback-proof.mjs")).href);
 const transport=await startProofServer();const browser=await chromium.launch();
 try {
  const page=await browser.newPage();
  await page.addInitScript(()=>{
   const create=AudioContext.prototype.createMediaElementSource;
   Object.assign(window,{rejectReconnect:false});
   AudioContext.prototype.createMediaElementSource=function(video){
    if((window as unknown as {rejectReconnect:boolean}).rejectReconnect) throw new Error("Fixture reconnect unavailable");
    return create.call(this,video);
   };
  });
  await page.goto(`${baseURL}/playwright/event-lineup-live?transport=${encodeURIComponent(transport.url)}`);
  await page.getByRole("button",{name:"Next slot",exact:true}).click();
  await page.getByRole("button",{name:"Play Lineup live"}).click();
  await expect.poll(()=>page.locator("video").evaluate(v=>(v as HTMLVideoElement).currentTime)).toBeGreaterThan(1);
  await page.getByRole("button",{name:"After end",exact:true}).click();
  await page.evaluate(()=>Object.assign(window,{rejectReconnect:true}));
  await fetch(`${transport.url}/control?id=next&state=eof`,{method:"POST"});
  await expect(page.locator("video")).toHaveCount(0,{timeout:20000});
  await page.getByRole("button",{name:"Pause",exact:true}).click();
  await page.getByRole("button",{name:"Play",exact:true}).click();
  await expect(page.locator("[data-current]")).toHaveAttribute("data-current","b");
  await page.evaluate(()=>Object.assign(window,{rejectReconnect:false}));
  await expect.poll(()=>page.locator("video").evaluate(v=>(v as HTMLVideoElement).currentTime),{timeout:15000}).toBeGreaterThan(1);
  await page.getByRole("button",{name:"hide",exact:true}).click();
  await expect(page.locator("video")).toHaveCount(0);
  await page.getByRole("button",{name:"Play",exact:true}).click();
  await expect(page.locator("[data-current]")).not.toHaveAttribute("data-current","b");
  await page.waitForTimeout(1200);
  expect((await(await fetch(`${transport.url}/stats`)).json()).active).toBe(0);
 }finally{try{await browser.close();}finally{await transport.close();}}
});

test("@fixture revoked source cancels a pending viewer resume", async ({baseURL}) => {
 test.skip(process.env.EVENT_PLAYBACK_PROOF!=="true","Opt-in local transport");test.setTimeout(30000);
 const {startProofServer}=await(new Function("url","return import(url)"))(pathToFileURL(path.resolve("../../scripts/event-playback-proof.mjs")).href);
 const transport=await startProofServer();const browser=await chromium.launch();
 try {
  const page=await browser.newPage();
  await page.addInitScript(()=>{
   const resume=AudioContext.prototype.resume;
   Object.assign(window,{holdResume:false});
   AudioContext.prototype.resume=function(){
    const pending=resume.call(this);
    if((window as unknown as {holdResume:boolean}).holdResume) {
     Object.assign(window,{holdResume:false});
     return pending.then(()=>new Promise<void>(resolve=>Object.assign(window,{finishViewerResume:resolve})));
    }
    return pending;
   };
  });
  await page.goto(`${baseURL}/playwright/event-lineup-live?transport=${encodeURIComponent(transport.url)}`);
  await page.getByRole("button",{name:"Play Lineup live"}).click();
  await expect.poll(()=>page.locator("video").evaluate(v=>(v as HTMLVideoElement).currentTime)).toBeGreaterThan(1);
  await page.getByRole("button",{name:"Pause",exact:true}).click();
  await page.evaluate(()=>Object.assign(window,{holdResume:true}));
  await page.getByRole("button",{name:"Play",exact:true}).click();
  await page.waitForFunction(()=>"finishViewerResume" in window);
  await page.getByRole("button",{name:"swap-source",exact:true}).click();
  await expect(page.locator("video")).toHaveCount(0);
  await page.evaluate(()=>(window as unknown as {finishViewerResume:()=>void}).finishViewerResume());
  await page.waitForTimeout(1200);
  await expect(page.getByRole("button",{name:"Play",exact:true})).toBeVisible();
  expect((await(await fetch(`${transport.url}/stats`)).json()).opened).toBe(1);
  await page.getByRole("button",{name:"Play",exact:true}).click();
  await expect.poll(()=>page.locator("video").evaluate(v=>(v as HTMLVideoElement).currentTime)).toBeGreaterThan(1);
  expect((await(await fetch(`${transport.url}/stats`)).json()).opened).toBe(2);
 }finally{try{await browser.close();}finally{await transport.close();}}
});
