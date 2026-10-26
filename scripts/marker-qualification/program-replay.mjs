import { gunzipSync } from 'node:zlib';
import { readFile } from 'node:fs/promises';
import { createHash } from 'node:crypto';
import { replayRawMembers } from '../event-marker-raw-capture.mjs';
import { parseMarkerMetadata } from '../event-marker-metadata.mjs';
import { openNativeBindingDependencies,expandImplementationObservations,inspectAcquiredDependencies } from '../event-marker-native-binding.mjs';
import { verifyProgramRecording,inspectCheckedProgram } from '../event-marker-conservation.mjs';
import { inspectProgramClock,assertProgramClock } from '../event-marker-clock.mjs';
import { referenceDetector } from './detector-reference.mjs';
import { replayAudioWire } from './audio-wire-reference.mjs';
import { packAudioEpisode } from '../event-marker-wire.mjs';
import { verifyNativeOuterJoins } from '../event-marker-native-controller.mjs';
import { validateImplementationCatalog } from '../event-marker-implementation-assets.mjs';
import { artifactUseEntries } from './artifacts.mjs';
import { checkProgramOriginalRoles,requireProgramFrontdoor } from './program-originals.mjs';
import { constructTrainPcm } from './train-construction.mjs';
import { deriveEvidencePolicy,invocationAggregate } from '../event-marker-evidence-policy.mjs';
import { assertEncodedFormat,assertDecodedCoverage,strictPacketFacts } from './media-facts.mjs';
const sha=b=>createHash('sha256').update(b).digest('hex'),same=(a,b)=>JSON.stringify(a)===JSON.stringify(b),checked=new WeakMap();
const must=(v,r)=>{if(!v)throw Error('marker_replay_'+r);};
const decode=(entry,bytes)=>JSON.parse((entry.name.endsWith('.gz')?gunzipSync(bytes,{maxOutputLength:8388608}):bytes).toString());

export async function retainProgramReplay(store,{recordKey,settings,file,fileIdentity,result},control={}) {
 const budget=store.programBudget(recordKey);
 const manifest={schema:'program-originals-v1',recordKey,settings,file,fileIdentity,budget,assurance:result.assurance};
 const replayRef=await store.json(`${recordKey}-program-originals.json`,manifest,196608,'observation',control);
 return {...result,programProof:{...result.programProof,replayRef}};
}
function replayVisual(rgb,rows) {
 must(rgb.length===rows.length*6&&rows.length>0,'visual_bytes');const visuals=[],identities=[],identityEpochs=[],identityEpochFrames=[];let active;
 for(const [i,r] of rows.entries()){
  const [red,green,blue,fr,fg,fb]=rgb.subarray(6*i,6*i+6),identity=red>150&&red>green*2&&red>blue*2?'a':blue>150&&blue>red*2&&blue>green*2?'b':'slate',on=fr>180&&fg>180&&fb>180;
  if(identities.at(-1)?.identity!==identity){identities.push({identity,pts:r.pts});identityEpochs.push([r.pts,{a:1,b:2,slate:4}[identity]]);identityEpochFrames.push(i);}
  if(active&&(!on||active.identity!==identity)){visuals.push({...active,end:r.pts,endFrame:i});active=undefined;}
  if(on&&!active)active={id:visuals.length,start:r.pts,startFrame:i,identity,watermark:-1};
 }must(!active&&identityEpochs.length<=32&&visuals.length<=4096,'visual_bounds');return {visuals,identities,identityEpochs,identityEpochFrames,videoRange:[rows[0].pts,rows.at(-1).pts],videoFrames:rows.length};
}

/** Reopens every original and rebuilds the finite proof and clock. Only byte
 * codecs are shared with production classification; audio fitting, purity,
 * detector partitions and visual partitions are recomputed independently.
 * Outer Root admission is a separate optional OUTPUT STATE, never a bypass of
 * media replay. Without actual A/K/I/C/Q/L this returns only local pending work. */
export async function replayProgramRecording(serialized,{resolveOriginal,resolveImplementation=path=>readFile(path),outerResolver,rootLedger}={}) {
 must(serialized?.programProof?.replayRef&&typeof resolveOriginal==='function','originals_required');
 const readDirect=async ref=>{must(ref&&typeof ref.name==='string'&&Number.isSafeInteger(ref.bytes)&&ref.bytes>0&&ref.bytes<=67108864&&/^[0-9a-f]{64}$/.test(ref.sha256),'reference');const b=Buffer.from(await resolveOriginal(ref));must(b.length===ref.bytes&&sha(b)===ref.sha256,'original_hash');return b;};
 const ref=serialized.programProof.replayRef;must(ref.role==='observation'&&ref.bytes<=196608,'manifest_role');const manifest=decode(ref,await readDirect(ref));must(manifest.schema==='program-originals-v1'&&Array.isArray(manifest.budget?.uses)&&manifest.budget.uses.length<=4096,'manifest');
 const uses=artifactUseEntries(manifest.budget),refs=uses.map(({event,kind,...ref})=>ref);
 checkProgramOriginalRoles(refs,manifest.recordKey,manifest.budget.invocation);
 const byName=new Map(),raws=new Map();let numeric=ref.bytes,total=ref.bytes;
 for(const r of refs){must(!byName.has(r.name)&&r.name!==ref.name,'duplicate_original');byName.set(r.name,r);const b=await readDirect(r);raws.set(r.name,b);total+=b.length;if(!['coded','pcm','rgb'].includes(r.role))numeric+=b.length;}
 const budget=manifest.budget;
 must(!Object.hasOwn(serialized.programProof,'budget'),'serialized_budget');
 must(Array.isArray(budget.implementationAssets)&&Array.isArray(budget.implementationUses)&&budget.implementationAssets.length<=256,'implementation_ledger');
 const bindingDocument=JSON.parse(raws.get(manifest.recordKey+'-binding.json')),closureOriginal=refs.find(r=>r.role==='runtimeBinding'&&r.sha256===bindingDocument.observerClosureSHA);must(closureOriginal,'implementation_catalog');
 const assets=validateImplementationCatalog(JSON.parse(raws.get(closureOriginal.name))).filter(f=>f.kind==='implementationCode').map(f=>({path:f.path,bytes:f.bytes,sha256:f.sha256}));must(same(budget.implementationAssets,assets.map((_,i)=>i))&&budget.implementationSetSHA===sha(Buffer.from(JSON.stringify(assets))),'implementation_set');
 const assetKeys=new Set(),assetBytes=assets.reduce((n,a)=>{const key=a.sha256+':'+a.bytes;must(!assetKeys.has(key)&&Number.isSafeInteger(a.bytes)&&a.bytes>0&&a.bytes<=196608,'implementation_asset');assetKeys.add(key);return n+a.bytes;},0);
 must(assetBytes===budget.implementationBytes&&assetBytes>0,'implementation_charge');
 const physicalUses=new Set();let logical=0;
 for(const use of budget.dependencyUses){const fields=use.id.split(':'),bytes=Number(fields.pop()),hash=fields.pop(),physical=hash+':'+bytes;must(refs.some(r=>r.role==='runtimeBinding'&&r.bytes===bytes&&r.sha256===hash)&&new Set(use.recordings).size===use.recordings.length&&use.recordings.length>0,'dependency_use');logical+=bytes*(use.recordings.length-(physicalUses.has(physical)?0:1));physicalUses.add(physical);}
 numeric+=logical;total+=logical+assetBytes;
 must(budget.numericBytes===numeric-ref.bytes&&budget.artifactBytes===total-ref.bytes&&budget.artifactCap===invocationAggregate('mass')&&budget.failureReserve===65536&&total+budget.reservedOuterBytes<=invocationAggregate('mass')-65536,'budget');
 must(uses.length===refs.length&&uses.every((u,i)=>u.event===i&&u.name===refs[i].name&&u.role===refs[i].role&&u.bytes===refs[i].bytes&&u.sha256===refs[i].sha256),'use_ledger');
 const consumed=new Set(),original=name=>{must(raws.has(name),'missing_original');consumed.add(name);return raws.get(name);},readJson=name=>decode(byName.get(name),original(name)),prefix=manifest.recordKey;
 const rawChannel=(catalog,cap)=>{
  const compressed=original(catalog.artifact.name);must(compressed.length===catalog.compressedBytes&&sha(compressed)===catalog.compressedSHA256,'compressed');let at=0;
  const members=catalog.members.map(m=>{const b=compressed.subarray(at,at+m.bytes);at+=m.bytes;return {...m,data:b.toString('base64')};});must(at===compressed.length,'members');const result=replayRawMembers({...catalog,members},{producerCap:cap});
  for(const [i,m] of members.entries()){const b=result.subarray(i*65536,(i+1)*65536);must(b.length===m.originalBytes&&sha(b)===m.originalSHA256,'member_original');}return result;
 };
 const expectedDependencyUses=new Map();
 const binding=async name=>{
  const b=readJson(`${name}-binding.json`),manifestRef=b.artifacts.find(a=>a.id==='runtime-manifest'),manifestBytes=manifestRef&&[...raws.values()].find(v=>v.length===manifestRef.bytes&&sha(v)===manifestRef.sha256);must(manifestBytes,'runtime_manifest');const runtime=JSON.parse(manifestBytes),paths=new Map();
  for(const a of b.artifacts){const found=refs.find(r=>r.sha256===a.sha256&&r.bytes===a.bytes&&r.role==='runtimeBinding');must(found,'runtime_original');const key=a.id+':'+a.sha256+':'+a.bytes,events=expectedDependencyUses.get(key)??[];events.push(name);expectedDependencyUses.set(key,events);const p=a.id.startsWith('loaded-data:')?'/app/'+a.id.slice(12):a.id==='context'?'/run/vrdex-native/context.json':a.id==='intent'?null:a.id==='runtime-manifest'?'/app/workers/restream/native-binding/runtime/manifest.json':'/app/workers/restream/native-binding/runtime/'+runtime.entries.find(e=>e.id===a.id)?.relativePath;const acquiredOriginal=original(found.name);if(p)paths.set(p,acquiredOriginal);}
  const context=JSON.parse(paths.get('/run/vrdex-native/context.json')),intent=JSON.parse(context.intent.utf8),env={...intent.semanticEnvironment,...(intent.transport.kind==='file'?{VRDEX_NATIVE_BINDING_CONTEXT:'/run/vrdex-native/context.json'}:{VRDEX_NATIVE_BINDING_CONTEXT_B64:paths.get('/run/vrdex-native/context.json').toString('base64')})};
  const closureEntry=runtime.entries.find(e=>e.id===runtime.entrypoints.verifierClosure),closure=JSON.parse(paths.get('/app/workers/restream/native-binding/runtime/'+closureEntry.relativePath)),observations=expandImplementationObservations(b.implementation,closure);
  const event=name===prefix?'encode':'decode',uses=budget.implementationUses.filter(u=>u.recordKey===prefix&&u.event===event);must(uses.length===1,'implementation_event');
  const result=await openNativeBindingDependencies({environment:env,runtimeIdentity:()=>b.nodeRuntime,registerImplementationAssets:files=>{const refs=files.map(f=>({path:f.path,bytes:f.bytes,sha256:f.sha256}));must(same(refs,uses[0].assetIndices.map(i=>assets[i])),'implementation_reservation');must(b.reservation?.event===event&&b.reservation.recordKey===prefix,'implementation_reservation');return b.reservation;},read:async path=>{
   const raw=paths.has(path)?paths.get(path):await resolveImplementation(path);must(raw instanceof Uint8Array,'implementation_original');const bytes=Buffer.from(raw),observed=observations.find(o=>'/app/'+o.path===path);if(observed)bytes.bindingIdentity=observed.identity;return bytes;
  }});must(result.kind==='AcquiredDependencies'&&same(result.assurance,b.assurance)&&same(result.implementation,b.implementation)&&same(result.artifacts.map(({data,...a})=>a),b.artifacts),'runtime_replay');return result;
 };
 const capture=async name=>{const n=readJson(`${name}-native.json.gz`),argv=readJson(`${name}-argv.json.gz`),b=await binding(name),runtime=readJson(`${name}-runtime.json`);for(const phase of ['startup','terminal']){const c=runtime[phase].originals?.maps?.capture;if(!c)continue;rawChannel(c,1048576);const compressed=original(c.artifact.name);let at=0;c.members=c.members.map(m=>{const data=compressed.subarray(at,at+m.bytes);at+=m.bytes;return {...m,data:data.toString('base64')};});}const out={native:n.native,channelEOF:n.channelEOF,references:n.channels,argv,binding:b,runtime};
  for(const [key,r] of Object.entries(n.channels))if(r.artifact&&['rgb','pcm'].includes(key))out[key]=original(r.artifact.name);else if(r.members)out[key]=rawChannel(r,key==='stderr'&&name===prefix?65536:1048576);
  return out;
 };
 const encoder=await capture(prefix),decoder=await capture(prefix+'-decode'),construction=readJson(prefix+'-source-construction.json.gz'),sourceReplay=readJson(prefix+'-source-replay.json.gz'),parameters=original(prefix+'-parameters.json'),inputPcm=original(prefix+'-input.pcm'),bytes=original(prefix+'.ts');
 const requestedSamples=JSON.parse(parameters).train?.samples;must(Number.isSafeInteger(requestedSamples)&&requestedSamples>0&&requestedSamples<=1190400,'producer_population_bound');const maxSeconds=requestedSamples/48000+1;must(decoder.pcm.length<=Math.ceil(maxSeconds*48000*2+96000)&&decoder.rgb.length<=Math.ceil(maxSeconds*61*6)&&decoder.audioMetadata.length<=Math.ceil(maxSeconds*32768)&&decoder.videoMetadata.length<=Math.ceil(maxSeconds*65536),'producer_channel_cap');
 const inventory=readJson(prefix+'-inventory.json.gz');must(inventory.file.bytes===bytes.length&&inventory.file.sha256===sha(bytes),'inventory_original');
 requireProgramFrontdoor(refs,prefix,budget.invocation,inspectAcquiredDependencies(encoder.binding),encoder.binding);
 {
  const pre=readJson(prefix+'-prebinding.json'),enc=readJson(prefix+'-binding.json');must(same(pre,enc),'prebinding');for(const [i,a] of pre.artifacts.entries()){const raw=original(prefix+'-prebinding-'+i+'.bin');must(raw.length===a.bytes&&sha(raw)===a.sha256,'prebinding_original');}
  const use=readJson(prefix+'-request-use.json'),request=pre.artifacts.find(a=>a.id==='program-request');must(request&&use.artifactId===request.id&&use.bytes===request.bytes&&use.sha256===request.sha256&&use.acquisition===prefix,'request_use');
  const requestBody=JSON.parse(original(refs.find(r=>r.role==='runtimeBinding'&&r.bytes===request.bytes&&r.sha256===request.sha256).name));must(requestBody.schema==='positive-program-acquisition-v1'&&requestBody.invocationId===budget.invocation.id&&requestBody.groupId==='canary-000'&&requestBody.settings.videoPreset==='480p30'&&requestBody.settings.audioBitrateKbps===320&&same(requestBody.settings,manifest.settings)&&same({kind:'massFrames',train:requestBody.train},JSON.parse(parameters))&&requestBody.train.sourceRate===48000&&requestBody.train.frames===Math.ceil(requestedSamples/1600)&&Array.isArray(requestBody.train.slots)&&requestBody.train.slots.length>0,'request_construction');
  const noiseBySeed={};for(const seed of [42,43]){const noise=original(prefix+'-noise-'+seed+'.pcm'),owner=readJson(prefix+'-noise-'+seed+'-owner.json'),args=['-hide_banner','-nostdin','-loglevel','error','-f','lavfi','-i',`anoisesrc=color=white:sample_rate=48000:amplitude=0.12:seed=${seed}:duration=${(requestedSamples+48000)/48000}`,'-af',`atrim=end_sample=${requestedSamples}`,'-ac','1','-ar','48000','-f','s16le','pipe:1'];must(owner.command==='ffmpeg'&&same(owner.args,args)&&owner.native?.exitCode===0&&owner.native.signal===null&&owner.channelEOF.stdout&&owner.channelEOF.stderr&&!owner.error&&noise.length===requestedSamples*2&&noise.length===inputPcm.length/2,'noise_original');noiseBySeed[seed]=noise;}
  must(constructTrainPcm(requestBody.train,noiseBySeed).equals(inputPcm),'noise_construction');
  for(const i of [0,1]){const name=prefix+'-metadata-'+i+'.json',raw=original(name),owner=readJson(prefix+'-metadata-'+i+'-owner.json');must(owner.status===200&&owner.bodyEOF&&owner.elapsedMs>=0&&owner.elapsedMs<=2000&&owner.bytes===raw.length&&raw.length<=65536&&owner.ref.name===name&&owner.ref.sha256===sha(raw),'metadata_original');}
 }
 const policy=deriveEvidencePolicy(inspectAcquiredDependencies(encoder.binding),budget.invocation);must(budget.policyId===policy.id&&budget.normalNumericCap===policy.normal&&budget.finalNumericCap===policy.final&&numeric+budget.reservedOuterBytes<=policy.normal,'policy');
 must(same(budget.dependencyUses,[...expectedDependencyUses].map(([id,recordings])=>({id,recordings}))),'dependency_events');
 const feed=kind=>{const f=readJson(`${prefix}-${kind}-feed-facts.json.gz`),compressed=original(f.trace.artifact.name);let at=0;return {...f,trace:{...f.trace,members:f.trace.members.map(m=>{const b=compressed.subarray(at,at+m.bytes);at+=m.bytes;return {...m,data:b.toString('base64')};})}};};
 const producer={file:{bytes:bytes.length,sha256:sha(bytes)},encoder,parameters,inputPcm,source:{...construction,parametersSHA256:sha(parameters),replay:sourceReplay.replay,sourceJoin:sourceReplay.sourceJoin,missing:[]},feeds:{video:feed('video'),audio:feed('audio')}};
 const probes={};for(const [kind,suffix] of [['format','probe'],['packets','packets'],['final','final-probe']]){const receipt=readJson(`${prefix}-decode-${kind}-owner.json`),catalog=readJson(`${prefix}-decode-${suffix}-catalog.json.gz`);probes[kind]={...receipt,stderr:Buffer.from(receipt.stderr,'base64'),raw:rawChannel(catalog,kind==='packets'?8388608:1048576)};}
 const audioRows=parseMarkerMetadata(decoder.audioMetadata.toString(),'audio'),videoRows=parseMarkerMetadata(decoder.videoMetadata.toString(),'video'),captured={audioChunks:[decoder.pcm],audioRows,videoRows,rgb:decoder.rgb};
 must(budget.implementationUses.length===2&&budget.implementationAssets.every((a,i)=>budget.implementationUses.some(u=>u.assetIndices.includes(i))),'implementation_use_closure');
 const handle=verifyProgramRecording({bytes,producer,decoder,capture:captured,settings:manifest.settings,file:manifest.file,fileIdentity:manifest.fileIdentity,probes,budget:{...budget,numericBytes:numeric,artifactBytes:total}});must(handle.kind==='CheckedProgram','program_unproven');
 const conservation=readJson(prefix+'-decode-conservation.json.gz');must(conservation.state==='CheckedProgram'&&same(conservation.projection,handle.projection),'conservation_original');
 const clock=inspectProgramClock(captured,handle);assertProgramClock(clock);const facts=inspectCheckedProgram(handle),reference=referenceDetector(decoder.pcm,audioRows,clock),visual=replayVisual(decoder.rgb,videoRows);
 must(same(serialized.assurance,manifest.assurance)&&same(serialized.assurance,clock.assurance)&&same(serialized.record.assurance,clock.assurance)&&same(serialized.observation.assurance,clock.assurance)&&same(serialized.record.clock,clock)&&same(serialized.observation.clock,clock),'lost_assurance');
 must(same(serialized.programProof.projection,handle.projection)&&serialized.record.recordingSha256===sha(bytes)&&same(serialized.observation.reference,reference)&&same(serialized.observation.audioRows,audioRows)&&same(serialized.observation.videoRows,videoRows),'projection');
 for(const [key,value] of Object.entries(visual))must(same(serialized.record[key],value)&&same(serialized.observation.visual[key],value),'visual_partition');
 let independent;
 if(serialized.classificationFailure){must(serialized.classificationFailure==='episode_bound','classifier_failure');try{replayAudioWire(serialized.record.episodes.map(packAudioEpisode),decoder.pcm,audioRows);throw Error('marker_replay_missing_episode_failure');}catch(error){must(error.message==='reference_episode_bound','episode_bound');}must(serialized.record.episodes.length===0,'negative_episode_record');}
 else{independent=replayAudioWire(serialized.record.episodes.map(packAudioEpisode),decoder.pcm,audioRows);must(same(independent.episodes.map((e,id)=>({...e,id})),serialized.record.episodes),'independent_classification');}
 must(serialized.record.metadataSamples===facts.population.decodedSamples&&serialized.record.decodedBytes===decoder.pcm.length,'population');
 const local={...serialized,record:{...serialized.record,clock},observation:{...serialized.observation,clock}};
 must(same(local.record.audioRange,[audioRows[0].pts,audioRows.at(-1).pts+audioRows.at(-1).samples])&&local.record.videoStreamIndex===0&&local.record.audioStreamIndex===1,'record_ranges');
 const info=JSON.parse(probes.format.raw),packetFacts=await strictPacketFacts({run:async()=>probes.packets.raw},manifest.file,info),format=assertEncodedFormat(info,packetFacts,manifest.settings,'program'),coverage=assertDecodedCoverage(local.record,{frames:facts.population.sourceFrames,fps:facts.fps,samples:facts.population.sourceSamples});must(same(serialized.format,format)&&same(serialized.coverage,coverage),'format_coverage');
 for(const r of refs)if(!consumed.has(r.name)&&r.name.endsWith('-catalog.json.gz')){const catalog=readJson(r.name);must(catalog.artifact&&consumed.has(catalog.artifact.name),'unused_catalog');}must(consumed.size===refs.length,'unexpected_original:'+refs.filter(r=>!consumed.has(r.name)).map(r=>r.name).join(','));
 let joins=null;if(outerResolver&&rootLedger)joins=await verifyNativeOuterJoins({binding:encoder.binding,manifest,budget:{...budget,numericBytes:numeric,artifactBytes:total},serialized,invocations:[encoder.runtime,decoder.runtime],outerResolver,rootLedger});
 const result={...local,replay:{kind:joins?'AcceptedConditionalProgramRecord':'ReplayedConditionalProgramRecord',originalsSHA256:ref.sha256,outerJoins:joins,pendingOuterJoin:!joins,nativeBindingVerified:false,loaderComplete:false}};
 checked.set(result,{outer:!!joins,clock,manifest,digest:sha(Buffer.from(JSON.stringify(result)))});return result;
}
export function assertReplayedProgram(record,{outer=false}={}) {const value=checked.get(record);must(value&&(!outer||value.outer)&&value.digest===sha(Buffer.from(JSON.stringify(record))),'proof_required');assertProgramClock(value.clock);return value;}
