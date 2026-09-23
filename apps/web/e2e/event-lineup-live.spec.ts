import { chromium, firefox, expect, test, type Browser } from "@playwright/test";
import { pathToFileURL } from "node:url";
import path from "node:path";
for (const engine of [chromium, firefox]) {
 test(`@fixture product lineup lifecycle ${engine.name()}`, async ({baseURL},info)=>{
  test.skip(process.env.EVENT_PLAYBACK_PROOF!=="true","Opt-in local transport");
  test.setTimeout(240_000);
  const {startProofServer}=await (new Function("url","return import(url)"))(pathToFileURL(path.resolve("../../scripts/event-playback-proof.mjs")).href);
  const transport=await startProofServer();
  let browser:Browser|undefined;
  const diagnostics:unknown[]=[];
  const stats=async()=> (await fetch(`${transport.url}/stats`)).json();
  const control=(id:string,state:string)=>fetch(`${transport.url}/control?id=${id}&state=${state}`,{method:"POST"});
  try {
   browser=await engine.launch();
   const page=await browser.newPage();page.setDefaultTimeout(10000);
   const messages:string[]=[]; const pageErrors:string[]=[];
   page.on("console",message=>{if (["error","warning"].includes(message.type())) messages.push(message.text());});
   page.on("pageerror",error=>pageErrors.push(error.stack ?? error.message));
   await page.exposeBinding("recordLineupDiagnostic",(_source,entry)=>{diagnostics.push(entry);});
   await page.addInitScript(()=>{
    let stage="navigation";
    const details=(value:unknown)=>{
     if(value===null || typeof value!=="object")return {value:String(value)};
     const result:Record<string,string>={};
     for(const key of new Set([...Object.getOwnPropertyNames(value),"name","message","stack","code"])) {try{result[key]=String((value as Record<string,unknown>)[key]);}catch{result[key]="<unreadable>";}}
     return result;
    };
    const record=(type:string,detail:unknown)=>{void (window as unknown as {recordLineupDiagnostic:(entry:unknown)=>Promise<void>}).recordLineupDiagnostic({type,stage,at:performance.now(),url:location.href,detail}).catch(()=>{});};
    document.addEventListener("click",event=>{const target=(event.target as Element)?.closest("button");if(target){stage=target.getAttribute("aria-label")??target.textContent??"button";record("action",stage);}},true);
    document.addEventListener("change",event=>{const target=event.target as HTMLSelectElement;stage=(target.getAttribute("aria-label")??target.tagName)+":"+target.value;record("action",stage);},true);
    window.addEventListener("error",event=>record("error",{...details(event.error),message:event.message,filename:event.filename,lineno:event.lineno}));
    window.addEventListener("unhandledrejection",event=>record("unhandledrejection",details(event.reason)));
    window.addEventListener("unhandledrejection",event=>{
     let detail:string;try{detail=JSON.stringify(event.reason,Object.getOwnPropertyNames(event.reason??{}));}catch{detail=String(event.reason);}
     console.error("Unhandled rejection detail",detail);
    });
    const Native=window.AudioContext;
    const contexts:AudioContext[]=[];
    const gains:Array<{gain:GainNode;analyser:AnalyserNode}>=[];
    class ObservedContext extends Native {
     constructor(){super();contexts.push(this);}
     createGain(){const gain=super.createGain();const analyser=super.createAnalyser();gain.connect(analyser);gains.push({gain,analyser});return gain;}
    }
    Object.assign(window,{AudioContext:ObservedContext,lineupAudio:{contexts,gains}});
   });
   const goto=async(kind="audible")=>{
    await page.goto(`${baseURL}/playwright/event-lineup-live?transport=${encodeURIComponent(transport.url)}&kind=${kind}`);
    await expect(page.getByRole("button",{name:"Play Lineup live"})).toBeVisible();
    await expect.poll(async()=>(await stats()).active).toBe(0);
   };
   const current=()=>page.locator("[data-current]").getAttribute("data-current");
   const start=async()=>{await page.getByRole("button",{name:"Play Lineup live"}).click();await expect.poll(()=>page.locator("video:not([hidden])").evaluate(v=>(v as HTMLVideoElement).currentTime),{timeout:20000}).toBeGreaterThan(1);};
   await goto();
   await page.getByRole("button",{name:"Before event",exact:true}).click();
   await expect(page.getByRole("button",{name:"Play Lineup live"})).toHaveCount(0);
   expect((await stats()).active).toBe(0);
   await page.getByRole("button",{name:"Before window",exact:true}).click();
   await expect(page.getByRole("button",{name:"Play Lineup live"})).toBeVisible();
   expect((await stats()).active).toBe(0);
   expect(await page.locator("[data-following]").getAttribute("data-following")).toBe("true");
   await start();
   expect((await stats()).active).toBe(1);
   await page.getByRole("button",{name:"Eligible",exact:true}).click();
   await expect.poll(async()=>(await stats()).active).toBe(2);
   await expect.poll(()=>page.locator("video[hidden]").evaluate(v=>(v as HTMLVideoElement).currentTime),{timeout:20000}).toBeGreaterThan(1);
   expect(await current()).toBe("a");
   const audibleGains=await page.evaluate(()=>{
    const {gains}= (window as unknown as {lineupAudio:{gains:Array<{gain:GainNode}>}}).lineupAudio;
    return gains.map(({gain})=>gain.gain.value);
   });
   expect(audibleGains).toEqual([1,1,0]);
   await page.getByRole("button",{name:"Mute",exact:true}).click();
   expect(await page.evaluate(()=>{
    const {gains}=(window as unknown as {lineupAudio:{gains:Array<{analyser:AnalyserNode}>}}).lineupAudio;
    return gains.slice(0,2).map(({analyser})=>{const values=new Float32Array(analyser.fftSize);analyser.getFloatTimeDomainData(values);return 20*Math.log10(Math.max(Math.sqrt(values.reduce((s,v)=>s+v*v,0)/values.length),1e-12));});
   })).toEqual([expect.any(Number),expect.any(Number)]);
   await page.getByRole("slider",{name:"Volume"}).fill("0.25");
   await page.getByRole("button",{name:"After end",exact:true}).click();
   await page.waitForTimeout(1500);
   expect(await current()).toBe("a");
   await page.getByRole("button",{name:"Eligible",exact:true}).click();
   await page.getByRole("button",{name:"Pause",exact:true}).click();
   await expect.poll(async()=>(await stats()).active).toBe(1);
   await page.getByRole("button",{name:"Play",exact:true}).click();
   expect(await current()).toBe("a");
   await page.getByRole("button",{name:"replace",exact:true}).click();
   await expect.poll(current).toBe("a-new");
   await page.getByRole("button",{name:"hide",exact:true}).click();
   await expect.poll(async()=>(await stats()).active).toBe(0);
   await expect(page.getByRole("link",{name:"Public source"})).toHaveCount(0);
   const recoveryStatus=await page.getByRole("status").filter({hasText:"Stream unavailable"}).boundingBox();
   const recoveryControls=await page.getByRole("group",{name:"Lineup live controls"}).boundingBox();
   expect(recoveryStatus!.y+recoveryStatus!.height).toBeLessThan(recoveryControls!.y);
   await info.attach(`recovery-${engine.name()}.png`,{body:await page.screenshot({fullPage:true}),contentType:"image/png"});
   await page.setViewportSize({width:390,height:844});
   await info.attach(`recovery-mobile-${engine.name()}.png`,{body:await page.screenshot({fullPage:true}),contentType:"image/png"});
   await page.setViewportSize({width:1280,height:900});
   expect((await stats()).denied,"before silent case").toBe(0);
   await goto("silent");
   await start();
   await page.waitForTimeout(1300);
   expect(await current()).toBe("a");
   await control("next","offline");
   await page.getByRole("button",{name:"Eligible",exact:true}).click();
   await page.waitForTimeout(2500);
   expect(await current()).toBe("a");
   await control("next","online");
   await expect.poll(current,{timeout:25000}).toBe("b");
   await expect.poll(async()=>(await stats()).active).toBe(1);
   await page.getByRole("button",{name:"After end",exact:true}).click();
   await page.waitForTimeout(1300);
   expect(await current()).toBe("b");
   await page.getByRole("button",{name:"Full screen",exact:true}).click();
   await page.getByRole("button",{name:"Exit full screen",exact:true}).click();
   await expect.poll(()=>page.evaluate(()=>document.fullscreenElement===null)).toBe(true);
   const controls=await page.getByRole("group",{name:"Lineup live controls"}).boundingBox();
   const playerBox=await page.locator("[data-current]").boundingBox();
   expect(controls!.y).toBeGreaterThanOrEqual(playerBox!.y);
   expect(controls!.y+controls!.height).toBeLessThanOrEqual(playerBox!.y+playerBox!.height);
   await info.attach(`live-desktop-${engine.name()}.png`,{body:await page.screenshot({fullPage:true}),contentType:"image/png"});
   await page.setViewportSize({width:390,height:844});
   const mobileControls=await page.getByRole("group",{name:"Lineup live controls"}).boundingBox();
   const mobilePlayer=await page.locator("[data-current]").boundingBox();
   expect(mobileControls!.y+mobileControls!.height).toBeLessThanOrEqual(mobilePlayer!.y+mobilePlayer!.height);
   await info.attach(`live-mobile-${engine.name()}.png`,{body:await page.screenshot({fullPage:true}),contentType:"image/png"});
   expect(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth)).toBe(true);
   await page.getByRole("button",{name:"cancel",exact:true}).click();
   await expect.poll(async()=>(await stats()).active).toBe(0);
   await goto();await page.getByRole("button",{name:"After end",exact:true}).click();
   await expect(page.getByRole("button",{name:"Play Lineup live"})).toHaveCount(0);
   expect((await stats()).active).toBe(0);
   await goto();await start();
   await page.getByRole("combobox",{name:"Performer"}).selectOption("b");
   await expect.poll(current).toBe("b");
   expect(await page.locator("[data-following]").getAttribute("data-following")).toBe("false");
   await page.getByRole("button",{name:"Return to live"}).click();
   await expect.poll(current).toBe("a");
   await page.getByRole("button",{name:"duplicate",exact:true}).click();
   await expect.poll(async()=>(await stats()).active).toBe(0);
   await goto();await start();
   await control("current","short-drop");
   await page.waitForTimeout(1500);expect(await current()).toBe("a");
   await control("current","eof");
   await page.waitForTimeout(100);expect(await current()).toBe("a");
   await page.getByRole("button",{name:"unpublish",exact:true}).click();
   await expect.poll(async()=>(await stats()).active).toBe(0);
   for (const barrier of ["missing"]) {
    expect((await stats()).denied,"before silent case").toBe(0);
   await goto("silent");await start();
    await page.getByRole("button",{name:barrier,exact:true}).click();
    await page.getByRole("button",{name:"Eligible",exact:true}).click();
    await page.waitForTimeout(1800);expect(await current()).toBe("a");expect((await stats()).active).toBe(1);
    await page.getByRole("button",{name:"Unmount",exact:true}).click();
    await expect.poll(async()=>(await stats()).active).toBe(0);
   }
   await goto("quiet");await start();await page.getByRole("button",{name:"Eligible",exact:true}).click();
   await page.waitForTimeout(2200);expect(await current()).toBe("a");
   // Real context suspension must not accumulate silence or commit a transition.
   await page.evaluate(()=> (window as unknown as {lineupAudio:{contexts:AudioContext[]}}).lineupAudio.contexts[0].suspend());
   await page.waitForTimeout(1200);expect(await current()).toBe("a");
   await page.getByRole("button",{name:"Eligible",exact:true}).click();
   await page.getByRole("button",{name:"Pause",exact:true}).click();
   await page.getByRole("button",{name:"Play",exact:true}).click();
   await page.waitForTimeout(1200);expect(await current()).toBe("a");
   await goto("break");await start();await page.getByRole("button",{name:"Eligible",exact:true}).click();
   await expect.poll(()=>page.locator("video:not([hidden])").evaluate(v=>(v as HTMLVideoElement).currentTime)).toBeGreaterThan(3.2);
   expect(await current()).toBe("a");
   await expect.poll(current,{timeout:15000}).toBe("b");
   await goto();
   await page.evaluate(()=>{
    const play=HTMLMediaElement.prototype.play;let once=true;
    HTMLMediaElement.prototype.play=function(){if(once){once=false;return Promise.reject(new DOMException("Fixture rejection","NotAllowedError"));}return play.call(this);};
   });
   await page.getByRole("button",{name:"Play Lineup live"}).click();
   await expect(page.getByRole("button",{name:"Play",exact:true})).toBeVisible();
   await page.getByRole("button",{name:"Play",exact:true}).click();
   await expect.poll(()=>page.locator("video:not([hidden])").evaluate(v=>(v as HTMLVideoElement).currentTime),{timeout:20000}).toBeGreaterThan(1);
   // Invalidate a preparation before it can resolve or decode.
   await page.getByRole("button",{name:"Eligible",exact:true}).click();
   await page.getByRole("button",{name:"hide",exact:true}).click();
   await page.waitForTimeout(1500);expect((await stats()).active).toBe(0);
   await goto();await page.getByRole("button",{name:"Profile player",exact:true}).click();
   await page.getByRole("button",{name:"Play Profile stream"}).click();
   await expect.poll(()=>page.locator("video").evaluate(v=>(v as HTMLVideoElement).currentTime),{timeout:20000}).toBeGreaterThan(1);
   await page.getByRole("button",{name:"Mute",exact:true}).click();
   expect(await page.locator("video").evaluate(v=>(v as HTMLVideoElement).muted)).toBe(true);

   await page.goto("about:blank");
   await expect.poll(async()=>(await stats()).active).toBe(0);
   expect((await stats()).highWater).toBeLessThanOrEqual(2);
   expect((await stats()).denied,JSON.stringify(await stats())).toBe(0);
   await info.attach(`runtime-${engine.name()}.json`,{body:JSON.stringify({browser:browser.version(),stats:await stats(),messages,pageErrors}),contentType:"application/json"});
   expect(pageErrors).toEqual([]);
  } finally {try{await info.attach(`diagnostics-${engine.name()}.json`,{body:JSON.stringify(diagnostics,null,2),contentType:"application/json"});}finally{try{await browser?.close();}finally{await transport.close();}}}
 });
}






for (const engine of [chromium, firefox]) {
 test(`@fixture product failure recovery and event-stream mode ${engine.name()}`,async({baseURL},info)=>{
  test.skip(process.env.EVENT_PLAYBACK_PROOF!=="true","Opt-in local transport");test.setTimeout(150000);
  const {startProofServer}=await (new Function("url","return import(url)"))(pathToFileURL(path.resolve("../../scripts/event-playback-proof.mjs")).href);
  const transport=await startProofServer();let browser:Browser|undefined;
  const stats=async()=> (await fetch(`${transport.url}/stats`)).json();
  const control=(id:string,state:string)=>fetch(`${transport.url}/control?id=${id}&state=${state}`,{method:"POST"});
  const messages:string[]=[];
  const evidence:Record<string,unknown>={messages};
  try {
   browser=await engine.launch();const page=await browser.newPage();page.setDefaultTimeout(10000);
   page.on("console",message=>{if(["error","warning"].includes(message.type()))messages.push(message.text());});
   page.on("pageerror",error=>messages.push("PAGEERROR: "+error.message));
   page.on("requestfailed",request=>messages.push("REQUEST: "+request.url()+" "+request.failure()?.errorText));
   const goto=async()=>{await page.goto(`${baseURL}/playwright/event-lineup-live?transport=${encodeURIComponent(transport.url)}`);await expect(page.getByRole("button",{name:"Play Lineup live"})).toBeVisible();await expect.poll(async()=>(await stats()).active).toBe(0);};
   const current=()=>page.locator("[data-current]").getAttribute("data-current");
   await goto();await page.getByRole("button",{name:"Play Lineup live"}).click();
   await expect.poll(()=>page.locator("video:not([hidden])").evaluate(v=>(v as HTMLVideoElement).currentTime),{timeout:20000}).toBeGreaterThan(1);
   await control("current","offline");
   await expect(page.getByRole("status").filter({hasText:"Stream unavailable"})).toBeVisible({timeout:15000});
   expect(await current()).toBe("a");
   await control("current","online");
   await expect.poll(()=>page.locator("video:not([hidden])").evaluate(v=>(v as HTMLVideoElement).currentTime),{timeout:25000}).toBeGreaterThan(1);
   await page.getByRole("button",{name:"Eligible",exact:true}).click();
   await expect.poll(()=>page.locator("video[hidden]").evaluate(v=>(v as HTMLVideoElement).currentTime),{timeout:15000}).toBeGreaterThan(1);
   if(engine.name()==="chromium") {
    const cdp=await page.context().newCDPSession(page);
    try {
     const {windowId}=await cdp.send("Browser.getWindowForTarget");
     await cdp.send("Browser.setWindowBounds",{windowId,bounds:{windowState:"minimized"}});
     evidence.minimizedVisibility=await page.evaluate(()=>document.visibilityState);
     await new Promise(resolve=>setTimeout(resolve,1200));
     evidence.currentWhileMinimized=await current();
     await cdp.send("Browser.setWindowBounds",{windowId,bounds:{windowState:"normal"}});
    } catch(error){evidence.minimizeUnavailable=String(error);}finally{await cdp.detach();}
   } else {
    const other=await browser.newPage();await other.bringToFront();evidence.otherTabVisibility=await page.evaluate(()=>document.visibilityState);await page.bringToFront();await other.close();
   }
   await control("current","offline");
   await expect.poll(current,{timeout:20000}).toBe("b");
   await page.getByRole("button",{name:"After end",exact:true}).click();
   await page.getByRole("button",{name:"Pause",exact:true}).click();
   await page.getByRole("button",{name:"Play",exact:true}).click();
   expect(await current()).toBe("b");
   await control("next","offline");await page.waitForTimeout(2500);expect(await current()).toBe("b");
   await page.getByRole("button",{name:"Unmount",exact:true}).click();await expect.poll(async()=>(await stats()).active).toBe(0);
   await control("current","online");await control("next","online");
   await goto();
   // The actual event-stream path resolves the canonical VRCDN URL. Only this
   // test maps that fetch to loopback; it never contacts a live provider.
   await page.evaluate(url=>{
    const original=window.fetch;
    window.fetch=(input,init)=>original(typeof input==="string" && input==="https://stream.vrcdn.live/live/fixture.live.ts" ? url : input,init);
   }, `${transport.url}/audible.live.ts?id=event`);
   await page.getByRole("button",{name:"event-stream",exact:true}).click();
   await page.getByRole("button",{name:"Play VRCDN stream for Event stream"}).click();
   await expect.poll(()=>page.locator("video").evaluate(v=>(v as HTMLVideoElement).currentTime),{timeout:20000}).toBeGreaterThan(1);
   await page.getByRole("button",{name:"Pause",exact:true}).click();
   expect(await page.locator("video").evaluate(v=>(v as HTMLVideoElement).paused)).toBe(true);
   await page.getByRole("button",{name:"Unmount",exact:true}).click();await expect.poll(async()=>(await stats()).active).toBe(0);
   evidence.stats=await stats();expect((await stats()).denied).toBe(0);
   expect(messages.filter(message=>message.startsWith("PAGEERROR:"))).toEqual([]);
  }finally{try{await info.attach(`recovery-background-${engine.name()}.json`,{body:JSON.stringify(evidence,null,2),contentType:"application/json"});await browser?.close();}finally{await transport.close();}}
 });
}

for (const engine of [chromium, firefox]) {
 test(`@fixture prepared playback rejection recovery ${engine.name()}`, async ({ baseURL }, info) => {
  test.skip(process.env.EVENT_PLAYBACK_PROOF !== "true", "Opt-in local transport");
  test.setTimeout(120_000);
  const { startProofServer } = await (new Function("url", "return import(url)"))(pathToFileURL(path.resolve("../../scripts/event-playback-proof.mjs")).href);
  const transport = await startProofServer();
  let browser: Browser | undefined;
  try {
   browser = await engine.launch();
   const page = await browser.newPage({ viewport: { width: 1280, height: 900 } });
   const errors: string[] = [];
   page.on("pageerror", error => errors.push(error.message));
   await page.addInitScript(() => {
    const probe = { attempts: 0, enabled: false, gains: [] as GainNode[] };
    const Native = window.AudioContext;
    class Context extends Native {
     createGain() { const gain = super.createGain(); probe.gains.push(gain); return gain; }
    }
    const play = HTMLMediaElement.prototype.play;
    HTMLMediaElement.prototype.play = function () {
     if (this.hidden) {
      probe.attempts++;
      if (!probe.enabled) return Promise.reject(new DOMException("Prepared source fixture rejection", "NotAllowedError"));
     }
     return play.call(this);
    };
    document.addEventListener("click", event => {
     if ((event.target as Element)?.closest("button")?.textContent === "Enable playback") probe.enabled = true;
    }, true);
    Object.assign(window, { AudioContext: Context, preparedProbe: probe });
   });
   await page.goto(`${baseURL}/playwright/event-lineup-live?transport=${encodeURIComponent(transport.url)}`);
   await page.getByRole("button", { name: "Play Lineup live" }).click();
   const current = page.locator("video:not([hidden])");
   await expect.poll(() => current.evaluate(video => (video as HTMLVideoElement).currentTime), { timeout: 20000 }).toBeGreaterThan(1);
   await page.getByRole("button", { name: "Eligible", exact: true }).click();
   const enable = page.getByRole("button", { name: "Enable next performer playback", exact: true });
   await expect(enable).toBeVisible();
   const before = await current.evaluate(video => (video as HTMLVideoElement).currentTime);
   await page.waitForTimeout(2500);
   expect(await current.evaluate(video => (video as HTMLVideoElement).currentTime)).toBeGreaterThan(before);
   expect(await page.locator("[data-current]").getAttribute("data-current")).toBe("a");
   expect(await page.evaluate(() => {
    const probe = (window as unknown as { preparedProbe: { attempts: number; gains: GainNode[] } }).preparedProbe;
    return { attempts: probe.attempts, gains: probe.gains.map(gain => gain.gain.value) };
   })).toEqual({ attempts: 1, gains: [1, 1, 0] });
   for (const [name, width, height] of [["desktop", 1280, 900], ["mobile", 390, 844]] as const) {
    await page.setViewportSize({ width, height });
    await expect(enable).toBeVisible();
    const button = await enable.boundingBox();
    const player = await page.locator("[data-current]").boundingBox();
    expect(button!.y).toBeGreaterThanOrEqual(player!.y);
    expect(button!.y + button!.height).toBeLessThanOrEqual(player!.y + player!.height);
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
    const screenshot = info.outputPath(`prepared-rejection-${name}-${engine.name()}.png`);
    await page.screenshot({ path: screenshot, fullPage: true });
    await info.attach(`prepared-rejection-${name}`, { path: screenshot, contentType: "image/png" });
   }
   await enable.click();
   await expect(enable).toHaveCount(0);
   await expect.poll(() => page.locator("video[hidden]").evaluate(video => (video as HTMLVideoElement).currentTime), { timeout: 20000 }).toBeGreaterThan(1);
   expect(await page.locator("[data-current]").getAttribute("data-current")).toBe("a");
   expect(await page.evaluate(() => (window as unknown as { preparedProbe: { gains: GainNode[] } }).preparedProbe.gains.map(gain => gain.gain.value))).toEqual([1, 1, 0]);
   await current.evaluate(video => (video as HTMLVideoElement).pause());
   await expect(page.locator("[data-current]")).toHaveAttribute("data-current", "b", { timeout: 15000 });
   expect(await page.evaluate(() => (window as unknown as { preparedProbe: { attempts: number; gains: GainNode[] } }).preparedProbe.attempts)).toBe(2);
   expect(await page.evaluate(() => (window as unknown as { preparedProbe: { gains: GainNode[] } }).preparedProbe.gains.map(gain => gain.gain.value))).toEqual([1, 0, 1]);
   await page.getByRole("button", { name: "Unmount", exact: true }).click();
   await expect.poll(async () => (await (await fetch(`${transport.url}/stats`)).json()).active).toBe(0);
   expect(errors).toEqual([]);
   await info.attach("transport-stats", { body: JSON.stringify(await (await fetch(`${transport.url}/stats`)).json()), contentType: "application/json" });
  } finally { await browser?.close(); await transport.close(); }
 });
}
