import {chromium,firefox,expect,test} from "@playwright/test";
import {pathToFileURL} from "node:url";
import path from "node:path";

for(const engine of [chromium,firefox]) for(const caller of ["lineup","profile"]) test(`@fixture aborted fulfilled response cancellation ${engine.name()} ${caller}`,async({baseURL},info)=>{
 test.skip(process.env.EVENT_PLAYBACK_PROOF!=="true","Opt-in local transport");test.setTimeout(30000);
 const {startProofServer}=await(new Function("url","return import(url)"))(pathToFileURL(path.resolve("../../scripts/event-playback-proof.mjs")).href);
 const transport=await startProofServer();const browser=await engine.launch();
 const diagnostics:unknown[]=[];const errors:string[]=[];
 try{
  const page=await browser.newPage();
  page.on("pageerror",error=>{errors.push(error.stack??error.message);diagnostics.push({type:"pageerror",name:error.name,message:error.message,stack:error.stack});});
  await page.exposeBinding("recordCancellation",(_source,entry)=>{diagnostics.push(entry);});
  await page.addInitScript(()=>{
   const record=(type:string,value:unknown)=>{const detail:Record<string,string>={};for(const key of ["name","message","stack","code"])detail[key]=String((value as Record<string,unknown>)?.[key]);void(window as unknown as {recordCancellation:(entry:unknown)=>Promise<void>}).recordCancellation({type,at:performance.now(),detail}).catch(()=>{});};
   window.addEventListener("unhandledrejection",event=>record("unhandledrejection",event.reason));
   const original=window.fetch;
   window.fetch=async(input,init)=>{
    const response=await original(input,init);
    if(typeof input==="string" && input.includes(".live.ts")){
     const cancel=response.body!.cancel.bind(response.body);
     response.body!.cancel=(reason)=>cancel(reason).catch(error=>{record("body.cancel rejected",error);throw error;});
     await new Promise<void>(resolve=>Object.assign(window,{releaseTransportResponse:resolve}));
    }
    return response;
   };
  });
  await page.goto(`${baseURL}/playwright/event-lineup-live?transport=${encodeURIComponent(transport.url)}`);
  if(caller==="profile")await page.getByRole("button",{name:"Profile player",exact:true}).click();
  await page.getByRole("button",{name:caller==="profile"?"Play Profile stream":"Play Lineup live"}).click();
  await page.waitForFunction(()=>"releaseTransportResponse" in window);
  await page.getByRole("button",{name:"Unmount",exact:true}).click();
  await expect.poll(async()=>(await(await fetch(`${transport.url}/stats`)).json()).active).toBe(0);
  await page.evaluate(()=>(window as unknown as {releaseTransportResponse:()=>void}).releaseTransportResponse());
  await expect.poll(()=>diagnostics.some(entry=>(entry as {type?:string}).type==="body.cancel rejected")).toBe(true);
  await page.waitForTimeout(500);
  expect(errors).toEqual([]);
 }finally{try{await info.attach("fetch-cancellation.json",{body:JSON.stringify({errors,diagnostics},null,2),contentType:"application/json"});}finally{try{await browser.close();}finally{await transport.close();}}}
});
