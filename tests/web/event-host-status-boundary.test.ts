import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import path from 'node:path';
import { it } from 'node:test';
import vm from 'node:vm';
import ts from 'typescript';
import { eventDjTarget } from '../../apps/web/src/lib/event-dj-target';
import { createSourceStatusReader } from '../../apps/web/src/lib/event-source-observations';
import { buildGroupPopulationSeries } from '../../convex/_groupPopulationSeries';
const webRequire=createRequire(path.resolve('apps/web/package.json'));
function load(relative:string,dependencies:Record<string,unknown>,globals:Record<string,unknown>={}) {
 const source=readFileSync(path.resolve('apps/web/src',relative),'utf8');
 const {outputText}=ts.transpileModule(source,{compilerOptions:{target:ts.ScriptTarget.ES2020,module:ts.ModuleKind.CommonJS,jsx:ts.JsxEmit.ReactJSX}});
 const exports:Record<string,any>={};
 vm.runInNewContext(outputText,{exports,require:(name:string)=>name in dependencies?dependencies[name]:name.startsWith('@/')?webRequire(path.resolve('apps/web/src',name.slice(2))):webRequire(name),Date,Response,URL,AbortController,AbortSignal,setTimeout,clearTimeout,setInterval,clearInterval,...globals});
 return exports;
}
it('known fixture profiles omit unrelated world reads only while fixtures are enabled',async()=>{
 for(const enabled of [true,false]) {
  const processFixture={env:{NODE_ENV:'test',VRDEX_ENABLE_PLAYWRIGHT_FIXTURES:enabled?'true':'false',NEXT_PUBLIC_CONVEX_URL:'http://127.0.0.1:3210'}};
  const fixtures=load('convex/playwright-fixtures.ts',{
   '../../../../convex/_groupPopulationSeries':{buildGroupPopulationSeries},
  },{process:processFixture});
  const calls:string[]=[];
  const server=load('convex/server.ts',{
   'convex/nextjs':{fetchQuery:async(_ref:unknown,args:{slug:string})=>{calls.push(args.slug);return null;}},
   '@convex-generated-api':{api:{worlds:{getPublicBySlug:'world-query'}}},
   '@/lib/server/auth':{},'@/lib/server/twitch-live':{},'@/lib/server/vrcdn-live':{},
   './playwright-fixtures':fixtures,
  },{process:processFixture,console});
  const known=await server.fetchPublicWorldBySlug('playwright-group-population');
  assert.equal(known.kind,'live');assert.equal(known.world,null);
  assert.equal(calls.length,enabled?0:1);
  await server.fetchPublicWorldBySlug('ordinary-live-world');
  assert.equal(calls.at(-1),'ordinary-live-world');
 }
});
function roster() {
 const slots=Array.from({length:80},(_,index)=>({playbackKey:`slot-${index}`,position:index,startAt:index*1000,endAt:(index+1)*1000,stream:{streamId:`dj${index}`},performer:{slug:`dj${index}`,outboundLinks:[{url:`vrcdn:dj${index}`},{url:`https://twitch.tv/dj${index}`}]}}));
 return {slug:'show',communitySlug:'club',slots,lineup:slots.map(slot=>({...slot,key:slot.playbackKey})),participants:[]};
}
it('R3F4 large roster probes current and upcoming sources in one bounded wave and keeps unprobed unknown',async()=>{
 const event=roster(),calls:string[]=[];
 const read=createSourceStatusReader(async source=>{calls.push(source.key);throw Error('provider unavailable');});
 const route=load('app/[slug]/events/[eventSlug]/host/status/route.ts',{
  '@/convex/server':{fetchHostEventBySlug:async()=>({kind:'live',event})},
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
  './event-operator-preview':{},'./event-public-page':{eventLineupForDisplay:()=>[]},'./viewer-local-event-times':{},'./vrcdn-stream-player':{},
 },{fetch:(_url:string,options:{signal:AbortSignal})=>{calls++;signal=options.signal;return new Promise(resolve=>{resolveFetch=resolve;});},setInterval:(callback:()=>void,ms:number)=>{intervals.push({callback,ms});return intervals.length;},clearInterval:()=>{},setTimeout:(callback:()=>void,ms:number)=>{timeouts.push({callback,ms});return timeouts.length;},clearTimeout:()=>{}});
 component.EventHostContent({event:roster()});const cleanup=effect!() as unknown as ()=>void;
 for(const timer of intervals.filter(timer=>timer.ms===30000))timer.callback();
 assert.equal(calls,1,'A pending request must not overlap the refresh interval');
 resolveFetch({ok:true,json:async()=>({})});await new Promise(resolve=>setImmediate(resolve));
 assert.equal(timeouts.filter(timer=>timer.ms===30000).length,1);
 cleanup();assert.equal(signal?.aborted,true);
});

it('R4F3 actual host page and status route use viewer-scoped host projection before rendering or probing',async()=>{
 const event=roster();let probes=0;const calls:any[]=[];
 for(const allowed of [true,false]) {
  const dependencies={
   '@/convex/server':{fetchPublicEventBySlug:async()=>({kind:'live',event:null}),fetchHostEventBySlug:async(...args:any[])=>{calls.push(args);return {kind:'live',event:allowed?event:null};}},
   '@/lib/server/event-source-status':{getEventSourceStatuses:async()=>{probes++;return {}; }},
   'next/navigation':{notFound:()=>{throw Error('NOT_FOUND');}},
   '../../../../_components/event-host-view':{EventHostView:()=>null},
   '../../../../_components/event-public-page':{EventBackendNotice:()=>null},
   '@/convex/playwright-fixtures':{getPlaywrightPublicEventFixture:()=>null},
   '../../../../playwright/public-event/client':{PublicEventFixture:()=>null},
  };
  const route=load('app/[slug]/events/[eventSlug]/host/status/route.ts',dependencies);
  const page=load('app/[slug]/events/[eventSlug]/host/page.tsx',dependencies);
  const params=Promise.resolve({slug:'club',eventSlug:'show'});
  const response=await route.GET(new Request('https://example.test/club/events/show/host/status'),{params});
  assert.equal(response.status,allowed?200:404);
  assert.match(response.headers.get('Cache-Control')??'',/private.*no-store/);
  if(allowed)assert.ok(await page.default({params}));else await assert.rejects(page.default({params}),/NOT_FOUND/);
 }
 assert.equal(probes,1);assert.equal(calls.length,4);for(const call of calls)assert.deepEqual(call,['show','club']);
});

it('R4F3 server auth and actual routes enforce owner, operations, anonymous, nonstaff and community boundaries',async()=>{
 const {convexTest}=await import('convex-test');const {api}=await import('../../convex/_generated/api');
 const {default:schemaModule}=await import('../../convex/schema');const schema=(schemaModule as any).default??schemaModule;
 const t=convexTest({schema,modules:{'../../convex/_generated/api.ts':()=>import('../../convex/_generated/api'),'../../convex/events.ts':()=>import('../../convex/events')}});
 await t.run(async({db})=>{
  const now=Date.now();const community=await db.insert('profiles',{slug:'club',displayName:'Club',sortName:'club',aliases:[],tags:[],claimState:'claimed_verified',publicationState:'published',publicSurfacingState:'public',creationSource:'self',updatedAt:now,profileType:'community',community:{categoryTags:[]}});
  for(const subject of ['owner','reader','nonstaff']) {
   const userId=await db.insert('users',{clerkUserId:subject,name:subject});
   if(subject==='owner')await db.insert('profileOwners',{profileId:community,userId,roleKey:'owner',state:'active',grantedAt:now,updatedAt:now});
   if(subject==='reader')await db.insert('communityAuthorities',{communityProfileId:community,subjectTokenIdentifier:`test|${subject}`,subject:{subject,issuer:'test',tokenIdentifier:`test|${subject}`},capabilities:['view_event_operations'],state:'active',grantedAt:now,updatedAt:now});
  }
  await db.insert('events',{slug:'private-show',title:'Private rehearsal',sortTitle:'private rehearsal',communityProfileId:community,startAt:now,timezone:'UTC',sourceType:'community',sourceLabel:'Fixture',eventStatus:'scheduled',publicationState:'draft_private',createdAt:now,updatedAt:now});
 });
 let subject:string|undefined, probes=0, privateQueries=0;
 const server=load('convex/server.ts',{
  'convex/nextjs':{fetchQuery:async(ref:any,args:any,options?:{token:string})=>{if(options?.token)privateQueries++;return (options?.token?t.withIdentity({subject:options.token,issuer:'test',tokenIdentifier:`test|${options.token}`}):t).query(ref,args);}},
  '@convex-generated-api':{api},'@/lib/server/auth':{convexAuthToken:async()=>subject},
  '@/lib/server/twitch-live':{},'@/lib/server/vrcdn-live':{},
  './playwright-fixtures':{getPlaywrightPublicEventFixture:()=>null},
 },{process:{env:{NEXT_PUBLIC_CONVEX_URL:'http://127.0.0.1:3210'}},console});
 const dependencies={
  '@/convex/server':server,'@/lib/server/event-source-status':{getEventSourceStatuses:async()=>{probes++;return {};}},
  'next/navigation':{notFound:()=>{throw Error('NOT_FOUND');}},
  '../../../../_components/event-host-view':{EventHostView:()=>null},'../../../../_components/event-public-page':{EventBackendNotice:()=>null},
  '@/convex/playwright-fixtures':{getPlaywrightPublicEventFixture:()=>null},'../../../../playwright/public-event/client':{PublicEventFixture:()=>null},
 };
 const page=load('app/[slug]/events/[eventSlug]/host/page.tsx',dependencies),route=load('app/[slug]/events/[eventSlug]/host/status/route.ts',dependencies);
 for(const viewer of ['owner','reader',undefined,'nonstaff'])for(const slug of ['club','wrong-community']) {
  subject=viewer;const allowed=(viewer==='owner'||viewer==='reader')&&slug==='club';const params=Promise.resolve({slug,eventSlug:'private-show'});
  const response=await route.GET(new Request('https://example.test/host/status'),{params});
  assert.equal(response.status,allowed?200:404,`${viewer}:${slug}`);assert.match(response.headers.get('Cache-Control')!,/private.*no-store/);
  if(allowed){const rendered=await page.default({params});assert.equal(rendered.props.event.title,'Private rehearsal');}else await assert.rejects(page.default({params}),/NOT_FOUND/);
 }
 assert.equal(probes,2);assert.equal(privateQueries,12);
 await t.run(async({db})=>{const event=(await db.query('events').collect())[0];await db.patch(event._id,{publicationState:'published'});});
 subject=undefined;
 const params=Promise.resolve({slug:'club',eventSlug:'private-show'});
 assert.equal((await route.GET(new Request('https://example.test/host/status'),{params})).status,200);
 assert.equal((await page.default({params})).props.event.title,'Private rehearsal');
});

it('R4F3 live host subscription retains authorized draft projection and withdraws it on revocation',()=>{
 const event=roster();let allowed=true;const hostRef={},publicRef={};const queries:any[]=[];
 const component=load('app/_components/event-host-view.tsx',{
  'next/link':{default:()=>null},'convex/react':{useQuery:(ref:any,args:any)=>{queries.push(args);return ref===hostRef&&allowed?event:null;}},'@convex-generated-api':{api:{events:{getHostBySlug:hostRef,getPublicBySlug:publicRef}}},
  '@/components/ui/button':{},'@/components/ui/copy-value-row':{},'@/components/ui/page-shell':{},
  '@/lib/event-dj-target':{eventDjTarget},'@/lib/event-path':{publicEventPath:()=>'/club/events/show'},
  './event-operator-preview':{},'./event-public-page':{eventLineupForDisplay:()=>[]},'./viewer-local-event-times':{},'./vrcdn-stream-player':{},
 });
 assert.equal(component.EventHostView({event})?.props.event,event);
 assert.equal(JSON.stringify(queries[0]),JSON.stringify({slug:'show',communitySlug:'club'}));
 allowed=false;assert.equal(component.EventHostView({event}),null);
});
