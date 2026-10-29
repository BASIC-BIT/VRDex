import { test, expect } from "@playwright/test";
import { spawn, type ChildProcess } from "node:child_process";
import { once } from "node:events";
import path from "node:path";

test.describe.configure({ mode: "serial" });
let child: ChildProcess;
let origin: string;
let diagnostic = "";
async function api(route: string, body?: object) {
  const response = await fetch(`${origin}/${route}`, body ? { method: "POST", body: JSON.stringify(body) } : {});
  const value = await response.json();
  expect(response.ok, JSON.stringify(value)).toBe(true);
  return value;
}
test.beforeEach(async ({ page }) => {
  test.skip(process.env.MOBILE_MEDIA_ACCEPTANCE !== "true", "Explicit isolated local acceptance only");
  diagnostic = "";
  origin = "";
  page.on("pageerror", error => { diagnostic += error.stack; });
  page.on("console", message => { if (message.type() === "error" || message.text().startsWith("MEDIA")) diagnostic = (diagnostic + message.text()).slice(-8000); });
  child = spawn(process.execPath, ["--conditions=import", "--import", "tsx", "scripts/mobile-media-acceptance.mjs"], { cwd: path.resolve("../.."), stdio: ["ignore", "pipe", "pipe"] });
  child.stderr!.on("data", b => { diagnostic = (diagnostic + b).slice(-8000); });
  origin = await new Promise<string>((resolve, reject) => {
    const timer = setTimeout(() => reject(Error(`Harness startup: ${diagnostic}`)), 15000);
    child.stdout!.on("data", b => { const match = String(b).match(/"origin":"([^"]+)"/); if (match) { clearTimeout(timer); resolve(match[1]); } });
    child.once("exit", code => { clearTimeout(timer); reject(Error(`Harness exited ${code}: ${diagnostic}`)); });
  });
  await page.route("**/mobile-acceptance/**", async route => {
    const pathname = new URL(route.request().url()).pathname.replace("/mobile-acceptance", "");
    const response = await fetch(`${origin}${pathname}`, { method: route.request().method(), body: route.request().postData() ?? undefined });
    await route.fulfill({ status: response.status, body: Buffer.from(await response.arrayBuffer()), headers: Object.fromEntries(response.headers) });
  });
  await page.route("https://relay.acceptance.invalid/**", async route => {
    const response = await fetch(`${origin}${new URL(route.request().url()).pathname}`);
    await route.fulfill({ status: response.status, body: Buffer.from(await response.arrayBuffer()), headers: Object.fromEntries(response.headers) });
  });
  await page.addInitScript((forceMse) => { const original = HTMLMediaElement.prototype.canPlayType; HTMLMediaElement.prototype.canPlayType = function(type: string) { return forceMse && type === "application/vnd.apple.mpegurl" ? "" : original.call(this, type); }; for (const event of ["play", "pause", "playing", "loadedmetadata", "error", "waiting"]) document.addEventListener(event, e => { const n=e.target as HTMLMediaElement; if (n instanceof HTMLMediaElement) console.log("MEDIA",event,n.tagName,n.paused,n.readyState,n.currentTime); }, true); Object.defineProperty(window, "AudioContext", { value: class { constructor() { throw Error("Native playback constructed Web Audio"); } } }); }, process.env.MOBILE_MEDIA_FORCE_MSE === "true");
});
test.afterEach(async ({ page }, info) => {
  try {
    const cdp = await page.context().newCDPSession(page);
    await cdp.send("Emulation.setScriptExecutionDisabled", {value:false});
    await page.context().setOffline(false);
    await info.attach("media-state", {body:JSON.stringify(await page.locator("audio,video").evaluateAll(nodes=>nodes.map(n=>{const m=n as HTMLMediaElement;return {time:m.currentTime,paused:m.paused,ready:m.readyState,error:m.error?.message,src:m.currentSrc};}))),contentType:"application/json"});
    if (origin) await info.attach("harness-state", { body: JSON.stringify(await api("state")), contentType: "application/json" });
    await page.goto("about:blank");
  } finally {
    if (child?.exitCode === null) {
      const closed = once(child, "close");
      child.kill("SIGTERM");
      const force = setTimeout(() => child.kill("SIGKILL"), 5000);
      try { await closed; } finally { clearTimeout(force); }
    }
    await info.attach("harness-diagnostics", { body: diagnostic, contentType: "text/plain" });
  }
});

test("composed grants, decoded media, native controls, retained navigation and source recovery", async ({ page }, info) => {
  test.setTimeout(120000);
  await page.goto("/playwright/mobile-hls-playback");
  await expect(page.getByRole("button", { name: "Play DJ Aurora", exact: true })).toBeVisible();
  expect((await api("state")).metrics.sourceConnections).toBe(0);
  await page.getByRole("button", { name: "Play DJ Aurora", exact: true }).click();
  const media = page.locator("[data-event-playback-mount] video").first();
  await expect.poll(() => media.evaluate(n => (n as HTMLMediaElement).currentTime), { timeout: 30000 }).toBeGreaterThan(0.5);
  const shell = page.getByRole("region", { name: "Event playback", exact: true }).filter({ visible: true });
  await shell.getByRole("button", { name: "Audio only", exact: true }).click();
  const audio = page.locator("[data-event-playback-mount] audio").first();
  await expect.poll(() => audio.evaluate(n => (n as HTMLMediaElement).currentTime), { timeout: 15000 }).toBeGreaterThan(0.5);
  const before = await audio.evaluate(n => (n as HTMLMediaElement).currentTime);
  await page.getByRole("link", { name: "Navigate", exact: true }).click();
  await expect.poll(() => audio.evaluate(n => (n as HTMLMediaElement).currentTime)).toBeGreaterThan(before + 0.5);
  await expect.poll(() => audio.evaluate(n => (n as HTMLMediaElement).currentTime), { timeout: 15000 }).toBeGreaterThan(before + 5);
  await api("action", { action: "restart-source" });
  await expect.poll(async () => (await api("state")).metrics.sourceConnections, { timeout: 30000 }).toBeGreaterThan(1);
  await expect.poll(async () => (await api("state")).sources[0]?.snapshots?.audio?.segments.some((s: {discontinuity:boolean}) => s.discontinuity), { timeout: 30000 }).toBe(true);
  await expect.poll(async () => (await api("state")).sources[0]?.state, {timeout:30000}).toBe("ready");
  await expect.poll(async () => { const state=await api("state");const prefix=state.sources[0].snapshots.audio.segments[0].objectKey.split("/").slice(0,-1).join("/");return state.metrics.lastObjects.some((key:string)=>key.startsWith(prefix)); }, {timeout:15000}).toBe(true);
  const recoveredTime=await audio.evaluate(n=>(n as HTMLMediaElement).currentTime);
  await expect.poll(() => audio.evaluate(n => (n as HTMLMediaElement).currentTime), { timeout: 15000 }).toBeGreaterThan(recoveredTime + 1);
  await api("action", {action:"metadata"});
  await page.evaluate(() => document.dispatchEvent(new Event("visibilitychange")));
  await expect(audio).toHaveAttribute("title", "DJ Lumen - VRDex");
  await expect(shell.getByText("DJ Lumen", {exact:true})).toBeVisible();
  await api("action", { action: "stale-publication" });
  expect((await api("state")).metrics.staleRejected).toBe(1);
  await expect(shell.getByRole("button", { name: "Audio only", exact: true })).toHaveAttribute("aria-pressed", "true");
  expect(await page.locator("audio,video").evaluateAll(nodes => nodes.filter(n => !(n as HTMLMediaElement).paused && !(n as HTMLMediaElement).muted).length)).toBe(1);
  for (const [name, width, height] of [["desktop",1280,900],["phone-width",390,844]] as const) {
    await page.setViewportSize({width,height});
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
    await page.screenshot({ path: info.outputPath(`${name}.png`), fullPage: true });
  }
  await shell.getByRole("button", { name: "Close event playback", exact: true }).click();
  await expect.poll(async () => (await api("state")).grants.every((g: {releasedAt?:number}) => g.releasedAt !== undefined)).toBe(true);
});

test("event revocation leaves profile grant valid and pending close cannot resume", async ({ page }) => {
  test.setTimeout(60000);
  const setup = await api("setup");
  const event = await api("playback",{name:"openPlayback",context:{kind:"event",eventId:setup.eventId,selectedSourceId:"Alpha"},streamId:"Alpha",preferredMode:"audio"});
  const profile = await api("playback",{name:"openPlayback",context:{kind:"profile",profileId:setup.profileId,linkId:"Alpha"},streamId:"Alpha",preferredMode:"audio"});
  await expect.poll(async () => (await api("playback",{name:"getPlayback",grantId:profile.grantId})).kind,{timeout:30000}).toBe("ready");
  await api("action",{action:"revoke-event"});
  expect((await fetch(`${origin}/p/${event.grantId}/audio/index.m3u8`)).status).toBe(403);
  expect((await fetch(`${origin}/p/${profile.grantId}/audio/index.m3u8`)).status).toBe(200);
  await api("action",{action:"metadata"});
  expect((await api("playback",{name:"getPlayback",grantId:profile.grantId})).metadata.displayName).toBe("DJ Lumen");
  await api("action",{action:"delay",ms:1500});
  await page.goto("/playwright/mobile-hls-playback");
  await page.getByRole("button",{name:"Play DJ Aurora",exact:true}).click();
  await page.getByRole("button",{name:"Audio only",exact:true}).filter({visible:true}).click();
  await page.getByRole("button",{name:"Close event playback",exact:true}).filter({visible:true}).click();
  await expect.poll(async () => (await api("state")).grants.filter((g:{releasedAt?:number})=>g.releasedAt!==undefined).length).toBeGreaterThan(0);
  expect(await page.locator("audio,video").count()).toBe(0);
});

test("uncached native-style HTTP demand survives suspended page JS beyond 180 seconds, then idle stops", async ({ page }, info) => {
  test.skip(info.project.name !== "desktop-chromium", "One bounded HTTP proof; phone viewport is not phone evidence");
  test.skip(process.env.MOBILE_MEDIA_LONG_PROOF !== "true", "Explicit 390-second local demand proof");
  test.setTimeout(430000);
  // MSE needs page JS. Disable native capability here so the independent HTTP client is the only demand producer while JS is suspended.
  await page.addInitScript(() => {const original=HTMLMediaElement.prototype.canPlayType;HTMLMediaElement.prototype.canPlayType=function(type:string){return type==="application/vnd.apple.mpegurl"?"":original.call(this,type);};});
  await page.goto("/playwright/mobile-hls-playback");
  await page.getByRole("button",{name:"Play DJ Aurora",exact:true}).click();
  await expect.poll(async()=> (await api("state")).sources[0]?.state,{timeout:30000}).toBe("ready");
  await expect.poll(() => page.locator("[data-event-playback-mount] video").first().evaluate(n => (n as HTMLMediaElement).currentTime), {timeout:15000}).toBeGreaterThan(0.5);
  const grant = (await api("state")).grants[0].grantId;
  const cdp = await page.context().newCDPSession(page);
  await cdp.send("Emulation.setScriptExecutionDisabled",{value:true});
  const started=Date.now(), target=started+185000;
  console.log(JSON.stringify({nativeStyleHttpStart:new Date(started).toISOString(),target:new Date(target).toISOString(),physicalPhone:false}));
  const cache=new Set<string>(); let hits=0, polls=0;
  while(Date.now()<target){
    const response=await fetch(`${origin}/p/${grant}/audio/index.m3u8`);
    expect(response.status).toBe(200);expect(response.headers.get("cache-control")).toBe("no-store");
    for(const line of (await response.text()).split("\n").filter(l=>l.startsWith("https:"))){
      if(cache.has(line)){hits++;continue;}
      const segment=await fetch(`${origin}${new URL(line).pathname}`);expect(segment.status).toBe(200);await segment.arrayBuffer();cache.add(line);
    }
    polls++;await new Promise(r=>setTimeout(r,2000));
  }
  expect(hits).toBeGreaterThan(0);expect((await api("state")).connections).toBe(1);
  // The page remains suspended. Stop browser networking too; no hidden MSE demand may retain the room.
  await page.context().setOffline(true);
  const demandEnded=Date.now();
  await expect.poll(async()=>(await api("state")).connections,{timeout:190000,intervals:[2000]}).toBe(0);
  const evidence={startedAt:new Date(started).toISOString(),durationMs:demandEnded-started,polls,cachedSegmentHits:hits,idleStoppedAfterMs:Date.now()-demandEnded,state:await api("state"),physicalPhone:false};
  await info.attach("native-style-demand",{body:JSON.stringify(evidence,null,2),contentType:"application/json"});
  await cdp.send("Emulation.setScriptExecutionDisabled",{value:false});await page.context().setOffline(false);
});

test("stalled control fences producing worker before restart and a new epoch decodes", async ({ page }, info) => {
  test.setTimeout(110000);
  await page.goto("/playwright/mobile-hls-playback");
  await page.getByRole("button",{name:"Play DJ Aurora",exact:true}).click();
  const media=page.locator("[data-event-playback-mount] video").first();
  await expect.poll(()=>media.evaluate(n=>(n as HTMLMediaElement).currentTime),{timeout:30000}).toBeGreaterThan(0.5);
  const before=await api("state"), epoch=before.sources[0].epoch, grant=before.grants[0].grantId;
  await api("action",{action:"stall",value:true});
  await expect.poll(async()=>(await api("state")).connections,{timeout:35000,intervals:[500]}).toBe(0);
  const fenced=await api("state");
  expect(fenced.sources[0].epoch).toBe(epoch);
  expect(Date.now()).toBeLessThanOrEqual(fenced.sources[0].leaseExpiresAt);
  await expect.poll(() => Date.now(), {timeout:31000,intervals:[500]}).toBeGreaterThanOrEqual(fenced.sources[0].leaseExpiresAt);
  await api("action",{action:"stall",value:false});
  await api("action",{action:"restart-worker"});
  await api("playback",{name:"restartPlayback",grantId:grant});
  await expect.poll(async()=>(await api("state")).sources[0].epoch,{timeout:30000}).toBeGreaterThan(epoch);
  await page.getByRole("button",{name:"Close event playback",exact:true}).filter({visible:true}).click();
  await page.getByRole("button",{name:"Play DJ Aurora",exact:true}).click();
  await expect.poll(()=>media.evaluate(n=>(n as HTMLMediaElement).currentTime),{timeout:30000}).toBeGreaterThan(0.5);
  await info.attach("worker-epochs",{body:JSON.stringify({old:epoch,next:(await api("state")).sources[0].epoch,fencedConnections:fenced.connections}),contentType:"application/json"});
});

test("explicit MSE fallback decodes both renditions and retains audio through source recovery", async ({ page }) => {
  test.setTimeout(90000);
  await page.addInitScript(() => { const original=HTMLMediaElement.prototype.canPlayType; HTMLMediaElement.prototype.canPlayType=function(type:string){return type==="application/vnd.apple.mpegurl"?"":original.call(this,type);}; });
  await page.goto("/playwright/mobile-hls-playback");
  await page.getByRole("button",{name:"Play DJ Aurora",exact:true}).click();
  const media=page.locator("[data-event-playback-mount] video").first();
  await expect.poll(()=>media.evaluate(n=>(n as HTMLMediaElement).currentTime),{timeout:30000}).toBeGreaterThan(0.5);
  await page.getByRole("button",{name:"Audio only",exact:true}).filter({visible:true}).click();
  const audio=page.locator("[data-event-playback-mount] audio").first();
  await expect.poll(()=>audio.evaluate(n=>(n as HTMLMediaElement).currentTime),{timeout:15000}).toBeGreaterThan(5);
  const before=await audio.evaluate(n=>(n as HTMLMediaElement).currentTime);
  await api("action",{action:"restart-source"});
  await expect.poll(async()=>(await api("state")).sources[0]?.state,{timeout:30000}).toBe("ready");
  await expect.poll(()=>audio.evaluate(n=>(n as HTMLMediaElement).currentTime),{timeout:15000}).toBeGreaterThan(before+12);
  await expect(page.getByRole("button",{name:"Audio only",exact:true}).filter({visible:true})).toHaveAttribute("aria-pressed","true");
  await page.getByRole("button",{name:"Close event playback",exact:true}).filter({visible:true}).click();
});
