import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import path from 'node:path';
import { it } from 'node:test';
import vm from 'node:vm';
import ts from 'typescript';
import { eventDjTarget } from '../../apps/web/src/lib/event-dj-target';
import { createSourceStatusReader } from '../../apps/web/src/lib/event-source-observations';
const webRequire=createRequire(path.resolve('apps/web/package.json'));
function load(relative:string,dependencies:Record<string,unknown>,globals:Record<string,unknown>={}) {
 const source=readFileSync(path.resolve('apps/web/src',relative),'utf8');
 const {outputText}=ts.transpileModule(source,{compilerOptions:{module:ts.ModuleKind.CommonJS,jsx:ts.JsxEmit.ReactJSX}});
 const exports:Record<string,any>={};
 vm.runInNewContext(outputText,{exports,require:(name:string)=>name in dependencies?dependencies[name]:name.startsWith('@/')?webRequire(path.resolve('apps/web/src',name.slice(2))):webRequire(name),Date,Response,AbortController,AbortSignal,setTimeout,clearTimeout,setInterval,clearInterval,...globals});
 return exports;
}
function roster() {
 const slots=Array.from({length:80},(_,index)=>({playbackKey:`slot-${index}`,position:index,startAt:index*1000,endAt:(index+1)*1000,stream:{streamId:`dj${index}`},performer:{slug:`dj${index}`,outboundLinks:[{url:`vrcdn:dj${index}`},{url:`https://twitch.tv/dj${index}`}]}}));
 return {slug:'show',communitySlug:'club',slots,lineup:slots.map(slot=>({...slot,key:slot.playbackKey})),participants:[]};
}
it('R3F4 large roster probes current and upcoming sources in one bounded wave and keeps unprobed unknown',async()=>{
 const event=roster(),calls:string[]=[];
 const read=createSourceStatusReader(async source=>{calls.push(source.key);throw Error('provider unavailable');});
 const route=load('app/[slug]/events/[eventSlug]/host/status/route.ts',{
  '@/convex/server':{fetchPublicEventBySlug:async()=>({kind:'live',event})},
  '@/lib/event-dj-target':{eventDjTarget},
  '@/lib/server/event-source-status':{getEventSourceStatuses:read},
 },{Date:class extends Date {static now(){return 40_500;}}});
 const response=await route.GET(new Request('https://example.test/club/events/show/host/status'),{params:Promise.resolve({slug:'club',eventSlug:'show'})});
 const statuses=await response.json();
 assert(calls.length<=4,`Expected one bounded wave, got ${calls.length} probes`);
 assert(calls.includes('vrcdn:dj40'));assert(calls.includes('vrcdn:dj41'));
 assert.equal(statuses['vrcdn:dj0'],undefined);
 assert.equal(statuses['vrcdn:dj40'].state,'unavailable');
 assert.equal(event.lineup.length,80);assert.equal(event.lineup[79].performer.outboundLinks.length,2);
});
it('R3F4 concurrent host requests return partial results within a deadline without queuing hidden probes',async()=>{
 let calls=0,release:()=>void=()=>{};
 const blocked=new Promise<void>(resolve=>{release=resolve;});
 const read=createSourceStatusReader(async()=>{calls++;await blocked;return {state:'live',observedAt:Date.now()};},Date.now,20);
 const first=read(Array.from({length:4},(_,i)=>({key:`first-${i}`,url:`vrcdn:first${i}`})));
 await Promise.resolve();
 const second=read(Array.from({length:80},(_,i)=>({key:`second-${i}`,url:`vrcdn:second${i}`})));
 const deadline=Symbol('unbounded');let timer:ReturnType<typeof setTimeout>;
 const result=await Promise.race([Promise.all([first,second]),new Promise<typeof deadline>(resolve=>{timer=setTimeout(()=>resolve(deadline),150);})]);
 clearTimeout(timer!);release();
 assert.notEqual(result,deadline,'Requests must return even while provider probes are unavailable');
 assert.equal(calls,4,'Unprobed rows must not queue work after the response');
 assert.deepEqual(result,[{},{}]);
 await Promise.all([first,second]);
});
it('R3F4 actual host effect does not overlap requests and aborts on cleanup',async()=>{
 let effect:(()=>void)|undefined,resolveFetch:(value:any)=>void=()=>{},calls=0,signal:AbortSignal|undefined;
 const intervals:Array<{callback:()=>void,ms:number}>=[],timeouts:Array<{callback:()=>void,ms:number}>=[];
 const React={...webRequire('react'),useEffect:(fn:()=>void)=>{effect=fn;},useState:(value:unknown)=>[value,()=>{}]};
 const component=load('app/_components/event-host-view.tsx',{
  react:React,'next/link':{default:()=>null},'convex/react':{},'@convex-generated-api':{api:{}},
  '@/components/ui/button':{},'@/components/ui/copy-value-row':{},'@/components/ui/page-shell':{},
  '@/lib/event-dj-target':{eventDjTarget},'@/lib/event-path':{publicEventPath:()=>'/club/events/show'},
  './event-public-page':{eventLineupForDisplay:()=>[]},'./viewer-local-event-times':{},'./vrcdn-stream-player':{},
 },{fetch:(_url:string,options:{signal:AbortSignal})=>{calls++;signal=options.signal;return new Promise(resolve=>{resolveFetch=resolve;});},setInterval:(callback:()=>void,ms:number)=>{intervals.push({callback,ms});return intervals.length;},clearInterval:()=>{},setTimeout:(callback:()=>void,ms:number)=>{timeouts.push({callback,ms});return timeouts.length;},clearTimeout:()=>{}});
 component.EventHostContent({event:roster()});const cleanup=effect!() as unknown as ()=>void;
 for(const timer of intervals.filter(timer=>timer.ms===30000))timer.callback();
 assert.equal(calls,1,'A pending request must not overlap the refresh interval');
 resolveFetch({ok:true,json:async()=>({})});await new Promise(resolve=>setImmediate(resolve));
 assert.equal(timeouts.filter(timer=>timer.ms===30000).length,1);
 cleanup();assert.equal(signal?.aborted,true);
});
