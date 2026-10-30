/** Isolated local acceptance transport. Never imports deployment credentials or enables a deployment. */
import { createServer, request } from 'node:http';
import { spawn } from 'node:child_process';
import { once } from 'node:events';
import { mkdtemp, mkdir, readFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { convexTest } from 'convex-test';
import { makeFunctionReference } from 'convex/server';
import schemaModule from '../convex/schema.ts';
import { createConvexControl } from '../packages/media-relay/src/providers/convex-control.ts';
import { createRelayRegistry } from '../packages/media-relay/src/worker/registry.ts';
import { createPackager } from '../packages/media-relay/src/worker/packager.ts';
import { createSourceRelay } from '../workers/restream/source-relay.mjs';
import { createManifestHandler } from '../packages/media-relay/src/gateway/handler.ts';
import { snapshotObjectKey } from '../packages/media-relay/src/contracts.ts';
import { createDemand } from '../packages/media-relay/src/gateway/demand.ts';

const schema = schemaModule.default ?? schemaModule;
const binding = { workerId: 'acceptance', workerEpoch: 1, allocation: {cpuUnits:1024,memoryMiB:2048,evidenceId:'local-acceptance-only'}, maxSources:2, draining:false };
Object.assign(process.env, { MEDIA_RELAY_ENABLED:'true', MEDIA_RELAY_MAX_SOURCES:'2', MEDIA_RELAY_MAX_GRANTS:'100', MEDIA_RELAY_ADMISSIONS_PER_MINUTE:'100', MEDIA_RELAY_WORKER_TOKEN:'local-worker', MEDIA_RELAY_GATEWAY_TOKEN:'local-gateway', MEDIA_RELAY_WORKERS:JSON.stringify([binding]), MEDIA_RELAY_PLAYBACK_ORIGIN:'https://relay.acceptance.invalid' });
const t = convexTest({schema, modules: {
  '../convex/_generated/api.ts': () => import('../convex/_generated/api.ts'),
  '../convex/mediaRelayPlayback.ts': () => import('../convex/mediaRelayPlayback.ts'),
  '../convex/mediaRelayWorker.ts': () => import('../convex/mediaRelayWorker.ts'),
}});
const call = (method, module, name, args) => t[method](makeFunctionReference(`${module}:${name}`), args);
const ids = await t.run(async ctx => {
  await ctx.db.insert('mediaRelayOperations',{key:'global',enabled:true,drainingWorkers:[],updatedAt:Date.now()});
  const profileId = await ctx.db.insert('profiles',{slug:'acceptance-dj',displayName:'DJ Aurora',sortName:'dj aurora',aliases:[],tags:[],claimState:'unclaimed',publicationState:'published',publicSurfacingState:'public',creationSource:'community',updatedAt:1,profileType:'person',person:{roleTags:[]},outboundLinks:[{type:'vrcdn',url:'vrcdn:Alpha',label:'Live',source:'owner_authored'}]});
  const eventId = await ctx.db.insert('events',{slug:'acceptance-show',title:'Harbor Sessions',sortTitle:'harbor sessions',startAt:Date.now()-1000,endAt:Date.now()+3600_000,watchSurfaceEnabled:true,watchMode:'event_stream',mediaLinks:[{type:'vrcdn',label:'Live',url:'vrcdn:Alpha',presentation:'open'}],sourceType:'manual',sourceLabel:'test',eventStatus:'scheduled',publicationState:'published',updatedAt:1});
  return {profileId,eventId};
});
const scratch = await mkdtemp(join(tmpdir(),'mobile-media-acceptance-'));
const objects = new Map(), snapshots = new Map(), activity = new Map(), children = new Set(), responses = new Set();
const metrics = {sourceConnections:0, manifests:0, objectRequests:0, segmentBytes:0, demandWrites:0, publications:0, staleRejected:0, lastManifests:[], lastObjects:[], perturbations:[], partialWindows:[]};
let stall = false, admissionDelay = 0, registry, timer, origin, stopped = false, sourceGop = 50, reorderNext = false;
const demand = createDemand({clock:Date.now,store:{async checkHealth(){},async updateMax({streamKey,at}){metrics.demandWrites++;activity.set(streamKey,Math.max(activity.get(streamKey)??0,at));},async read(key){return activity.get(key)??null;}}});
const rpc = async (method,name,args,signal) => { signal.throwIfAborted(); if(stall) return new Promise((_r,reject)=>signal.addEventListener('abort',()=>reject(Error('control stalled')),{once:true})); return call(method,'mediaRelayWorker',name,{...args,credential:'local-worker'}); };
const control = createConvexControl(rpc,binding);
const storage = { async putSegment({objectKey,filePath,signal}) {signal.throwIfAborted(); if(!objects.has(objectKey)) objects.set(objectKey,await readFile(filePath));},async putSnapshot({objectKey,snapshot,signal}){signal.throwIfAborted();snapshots.set(objectKey,snapshot);metrics.publications++;},async retire(){} };
const manifest = createManifestHandler({authorize:({grantId,rendition})=>call('query','mediaRelayWorker','readGateway',{grantId,rendition,credential:'local-gateway'}),readSnapshot:async({objectKey})=>snapshots.get(objectKey),demand,signSegment:({objectKey})=>`https://relay.acceptance.invalid/objects/${encodeURIComponent(objectKey)}`,clock:Date.now,origins:[]});
async function stopChild(child){ if(child.exitCode!==null||child.signalCode!==null)return; const closed=once(child,'close');child.kill('SIGTERM');const force=setTimeout(()=>child.kill('SIGKILL'),1000);await closed;clearTimeout(force); }
const server = createServer(async(req,res)=>{
  try {
    const url = new URL(req.url, 'http://local');
    if(url.pathname==='/source'){
      metrics.sourceConnections++;responses.add(res);
      const child=spawn('ffmpeg',['-hide_banner','-loglevel','error','-nostdin','-re','-f','lavfi','-i','testsrc2=size=320x180:rate=25','-f','lavfi','-i','sine=frequency=440:sample_rate=48000','-t','650','-c:v','libx264','-preset','ultrafast','-threads','1','-b:v','300k','-g',String(sourceGop),'-keyint_min',String(sourceGop),'-sc_threshold','0','-bf','0','-c:a','aac','-b:a','96k','-frag_duration','200000','-movflags','frag_keyframe+empty_moov+default_base_moof','-f','mp4','pipe:1'],{stdio:['ignore','pipe','ignore']});
      children.add(child);res.writeHead(200,{"content-type":"video/mp4"});child.stdout.pipe(res);res.once('close',()=>{responses.delete(res);void stopChild(child);});return;
    }
    if(url.pathname.startsWith('/p/')) {metrics.manifests++;const reply=await manifest(new Request(`https://relay.acceptance.invalid${url.pathname}`));const body=await reply.text();metrics.lastManifests.push({at:Date.now(),rendition:url.pathname.includes("/audio/")?"audio":"video",status:reply.status,body});metrics.lastManifests=metrics.lastManifests.slice(-8);res.writeHead(reply.status,Object.fromEntries(reply.headers));res.end(body);return;}
    if(url.pathname.startsWith('/objects/')) {const bytes=objects.get(decodeURIComponent(url.pathname.slice(9)));metrics.objectRequests++;metrics.lastObjects.push(decodeURIComponent(url.pathname.slice(9)));metrics.lastObjects=metrics.lastObjects.slice(-12);if(!bytes){res.writeHead(404).end();return;}metrics.segmentBytes+=bytes.length;res.writeHead(200,{'content-type':'video/mp2t','cache-control':'public, max-age=31536000, immutable'}).end(bytes);return;}
    const chunks=[];for await(const chunk of req) chunks.push(chunk);const args=chunks.length?JSON.parse(Buffer.concat(chunks)):{};
    let value;
    if(url.pathname==='/setup') value={...ids,request:{kind:'vrcdn',profileId:ids.profileId,profileSlug:'acceptance-dj',href:'#profile',title:'DJ Aurora',sourceId:'Alpha',src:'vrcdn:Alpha',transport:'mpegts'}};
    else if(url.pathname==='/playback') {const {name,...input}=args;if(name==='openPlayback'&&admissionDelay) await new Promise(r=>setTimeout(r,admissionDelay));value=await call(name==='getPlayback'?'query':'mutation','mediaRelayPlayback',name,input);}
    else if(url.pathname==='/state') value=await t.run(async ctx=>({metrics,sources:await ctx.db.query('mediaRelaySources').collect(),grants:await ctx.db.query('mediaRelayGrants').collect(),connections:responses.size,active:registry.diagnostics()}));
    else if(url.pathname==='/action') {
      if(args.action==='revoke-event') await t.run(ctx=>ctx.db.patch(ids.eventId,{mediaLinks:[]}));
      else if(args.action==='metadata') await t.run(ctx=>ctx.db.patch(ids.profileId,{displayName:'DJ Lumen',updatedAt:Date.now()}));
      else if(args.action==='restart-source') for(const response of responses) response.destroy();
      else if(args.action==='late-keyframe') {if(responses.size) throw Error('Set keyframe fixture before acquisition');sourceGop=250;metrics.perturbations.push({kind:'late-keyframe',at:Date.now(),gopFrames:sourceGop,fps:25});}
      else if(args.action==='reorder-output') {reorderNext=true;for(const response of responses) response.destroy();}
      else if(args.action==='delay') admissionDelay=args.ms;
      else if(args.action==='stall') stall=args.value;
      else if(args.action==='restart-worker'){await registry.stop();await startRegistry();}
      else if(args.action==='expire') await t.run(async ctx=>{for(const row of await ctx.db.query('mediaRelayGrants').collect()) await ctx.db.patch(row._id,{expiresAt:Date.now()-1});});
      else if(args.action==='stale-publication') {const row=await t.run(ctx=>ctx.db.query('mediaRelaySources').first());try{await call('mutation','mediaRelayWorker','commitSnapshot',{credential:'local-worker',workerId:binding.workerId,workerEpoch:1,streamKey:row.streamKey,epoch:row.epoch,snapshot:row.snapshots.video,objectKey:snapshotObjectKey(row.snapshots.video)});}catch{metrics.staleRejected++;}}
      else throw Error('Unknown action'); value={ok:true};
    } else {res.writeHead(404).end();return;}
    res.writeHead(200,{'content-type':'application/json','cache-control':'no-store'}).end(JSON.stringify(value));
  } catch(error){res.writeHead(500,{'content-type':'application/json'}).end(JSON.stringify({error:String(error)}));}
});
async function startRegistry(){
  const directory=await mkdtemp(join(scratch,'worker-'));
  const realPackager=createPackager({createRelay:()=>createSourceRelay({inputFormat:'vrcdn_fmp4',resolveAddresses:async()=>[{address:'93.184.216.34',family:4}],requestSource:(_url,_options,callback)=>request(`${origin}/source`,callback)})});
  const packager=options=>{
    let held;
    return realPackager({...options,onSnapshot:async(snapshot,signal)=>{
      if(sourceGop!==50) {
        metrics.partialWindows.push({at:Date.now(),rendition:snapshot.rendition,target:snapshot.targetDurationSeconds,duration:snapshot.segments.reduce((n,s)=>n+s.durationSeconds,0),first:snapshot.sequence,last:snapshot.segments.at(-1).sequence});
        metrics.partialWindows=metrics.partialWindows.slice(-40);
      }
      if(reorderNext && snapshot.rendition==='video') {
        if(!held){held=structuredClone(snapshot);return;}
        if(snapshot.segments.at(-1).sequence===held.segments.at(-1).sequence)return;
        reorderNext=false;
        await options.onSnapshot(snapshot,signal);
        const event={kind:'reordered-output',at:Date.now(),newer:snapshot.segments.at(-1).sequence,older:held.segments.at(-1).sequence,attempt:held.segments[0].objectKey.split('/')[0]};
        metrics.perturbations.push(event);
        try {await options.onSnapshot(held,signal);event.accepted=true;} catch(error){event.rejection=String(error);throw error;}
        return;
      }
      await options.onSnapshot(snapshot,signal);
    }});
  };
  registry=createRelayRegistry({control,storage,binding,directory,demand,packager});registry.reconcile();
}
async function cleanup(){if(stopped)return;stopped=true;clearInterval(timer);await registry?.stop();for(const response of responses)response.destroy();await Promise.all([...children].map(stopChild));server.closeAllConnections();await new Promise(r=>server.close(r));await rm(scratch,{recursive:true,force:true});console.log(JSON.stringify({cleanup:true,childrenAlive:[...children].filter(c=>c.exitCode===null&&c.signalCode===null).length}));}
try {await mkdir(scratch,{recursive:true});server.listen(0,'127.0.0.1');await once(server,'listening');origin=`http://127.0.0.1:${server.address().port}`;await startRegistry();timer=setInterval(()=>registry.reconcile(),100);console.log(JSON.stringify({origin}));process.once('SIGTERM',()=>void cleanup());process.once('SIGINT',()=>void cleanup());setTimeout(()=>void cleanup(),650000).unref();}catch(error){await cleanup();throw error;}
