import assert from "node:assert/strict";
import test from "node:test";
import type Mpegts from "mpegts.js";
import { VrcdnFetchLoader } from "../../apps/web/src/lib/vrcdn-fetch-loader";
const seek: Mpegts.SeekHandler = {getConfig:(url,range)=>({url,headers:{Range:`bytes=${range.from}-`}}),removeURLParameters:url=>url};

test("fetch loader preserves range, headers, credentials, redirects and clean EOF",async(t)=>{
 let options:RequestInit|undefined;let requested:unknown;
 t.mock.method(globalThis,"fetch",async(_url:unknown,init:RequestInit)=>{options=init;requested=_url;const response=new Response(new Uint8Array([1,2,3]),{headers:{"Content-Length":"3"}});Object.defineProperty(response,"url",{value:"https://example.com/final"});return response;});
 const loader=new VrcdnFetchLoader(seek,{headers:{"X-Stream":"fixture"},reuseRedirectedURL:true});
 const chunks:unknown[]=[];let redirect="";let length=0;
 loader.onDataArrival=(data,start,received)=>chunks.push({data:[...new Uint8Array(data)],start,received});
 loader.onURLRedirect=url=>{redirect=url;};loader.onContentLengthKnown=value=>{length=value;};
 const done=new Promise<unknown>((resolve,reject)=>{loader.onComplete=(from,to)=>resolve([from,to]);loader.onError=(_kind,info)=>reject(new Error(info.msg));});
 loader.open({url:"https://example.com/source",duration:0,withCredentials:true,cors:false,referrerPolicy:"origin",redirectedURL:"https://example.com/redirected"} as Mpegts.MediaSegment,{from:7,to:-1});
 assert.deepEqual(await done,[7,9]);
 assert.deepEqual(chunks,[{data:[1,2,3],start:7,received:3}]);
 assert.equal(new Headers(options?.headers).get("Range"),"bytes=7-");assert.equal(new Headers(options?.headers).get("X-Stream"),"fixture");
 assert.equal(requested,"https://example.com/redirected");assert.equal(options?.mode,"same-origin");assert.equal(options?.referrerPolicy,"origin");
 assert.equal(options?.credentials,"include");assert.equal(redirect,"https://example.com/final");assert.equal(length,3);assert.equal(loader.status,4);loader.destroy();
});

for(const kind of ["http","truncated","read"]) test(`fetch loader reports ${kind} errors to the player`,async(t)=>{
 t.mock.method(globalThis,"fetch",async()=>kind==="http"?new Response("offline",{status:503,statusText:"Unavailable"}):kind==="truncated"?new Response("x",{headers:{"Content-Length":"5"}}):new Response(new ReadableStream({start(controller){controller.error(new Error("stream broke"));}})));
 const loader=new VrcdnFetchLoader(seek,{});
 const failed=new Promise<unknown>(resolve=>{loader.onError=(type,info)=>resolve([type,info.code]);});
 loader.open({url:"https://example.com/source",duration:0},{from:0,to:-1});
 assert.deepEqual(await failed,[kind==="http"?"HttpStatusCodeInvalid":kind==="truncated"?"EarlyEof":"Exception",kind==="http"?503:-1]);loader.destroy();
});

test("destroy cancels an owned pending reader without a completion or error callback",async(t)=>{
 let cancelled=false;let pulled:()=>void=()=>{};
 const reading=new Promise<void>(resolve=>{pulled=resolve;});
 t.mock.method(globalThis,"fetch",async()=>new Response(new ReadableStream({pull(){pulled();},cancel(){cancelled=true;}})));
 const loader=new VrcdnFetchLoader(seek,{});const callbacks:string[]=[];
 loader.onComplete=()=>callbacks.push("complete");loader.onError=()=>callbacks.push("error");
 loader.open({url:"https://example.com/source",duration:0},{from:0,to:-1});await reading;await new Promise(resolve=>setImmediate(resolve));loader.destroy();await new Promise(resolve=>setImmediate(resolve));
 assert.equal(cancelled,true);assert.deepEqual(callbacks,[]);assert.equal(loader.status,0);
});
