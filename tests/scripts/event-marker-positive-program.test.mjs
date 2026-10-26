import test from 'node:test';
import assert from 'node:assert/strict';
import * as conservation from '../../scripts/event-marker-conservation.mjs';
import * as clocks from '../../scripts/event-marker-clock.mjs';
import { mkdtemp,rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { simulatedProgramRuntime } from '../fixtures/marker-positive-program.mjs';
import { createArtifactStore,createInvocationStore,artifactUseEntries } from '../../scripts/marker-qualification/artifacts.mjs';
import { encodeProgram,generateNoise } from '../../scripts/marker-qualification/codec-io.mjs';
import { constructTrainPcm } from '../../scripts/marker-qualification/train-construction.mjs';
import { createAcquisitionDeadline } from '../../scripts/event-marker-native-binding.mjs';
import { captureNativeMetadata } from '../../scripts/event-marker-native-metadata.mjs';
import { readQualificationRecording } from '../../scripts/marker-qualification/codec-record.mjs';
import { replayProgramRecording,assertReplayedProgram } from '../../scripts/marker-qualification/program-replay.mjs';
import { readFile } from 'node:fs/promises';
import { nativeArtifact } from '../../scripts/event-marker-native-controller.mjs';
import { sha } from '../fixtures/marker-positive-program.mjs';

test('program verification and encoded clock reject copied evidence and serialized authority',()=>{
 assert.equal(typeof conservation.verifyProgramRecording,'function');
 assert.equal(typeof clocks.inspectProgramClock,'function');
 for(const forged of [{kind:'CheckedProgram',missing:[]},{kind:'CheckedProgram',verified:true},JSON.parse('{"kind":"ClockCompatible"}')]){
  assert.equal(clocks.inspectProgramClock({},forged).kind,'Unproven');
 }
});

export async function positiveProgram(options={}) {
 const id='mass-320-48000stereo-073',key=id+'-program',settings={videoPreset:'480p30',audioBitrateKbps:320},train={sourceRate:48000,samples:31*1600,frames:31,slots:[{index:0,start:1,end:2,sourceStart:1,visualFrame:0,family:'missing',params:{seed:42,kind:'silence'}}]},request={schema:'positive-program-acquisition-v1',invocationId:id,groupId:'canary-000',settings,train};
 const runtime=await simulatedProgramRuntime({...options,programRequest:request,containerName:'worker',taskDefinition:'arn:aws:ecs:us-east-1:079358094174:task-definition/SIMULATED:1'}),directory=await mkdtemp(join(tmpdir(),'marker-positive-')),store=createInvocationStore(createArtifactStore(directory),{id,kind:'mass'}),file=store.path(key+'.ts'),control=createAcquisitionDeadline(90000);
 try{
  const binding=await runtime.dependencies({registerImplementationAssets:files=>store.registerImplementationAssets(files,key,'encode')});store.selectNativePolicy(binding);
  for(const [i,a] of binding.artifacts.entries()){const ref=await store.write(key+'-prebinding-'+i+'.bin',Buffer.from(a.data,'base64'),196608,'runtimeBinding');store.useRuntimeDependency(ref,key,a.id);}await store.json(key+'-prebinding.json',{...binding,artifacts:binding.artifacts.map(({data,...r})=>r)},196608,'runtimeBinding');
  const metadata=await captureNativeMetadata({store,prefix:key,control,environment:{ECS_CONTAINER_METADATA_URI_V4:'http://169.254.170.2/v4/SIMULATED'},fetchImpl:async url=>new Response(JSON.stringify(url.endsWith('/task')?{TaskARN:'arn:aws:ecs:us-east-1:079358094174:task/vrdex-restream-worker/'+'1'.repeat(32),Containers:[{DockerId:'SIMULATED-container',Name:'worker'}]}:{DockerId:'SIMULATED-container',ImageID:'sha256:'+runtime.imageFacts.configSHA}))}),requestBytes=Buffer.from(JSON.stringify(request));await store.json(key+'-request-use.json',{acquisition:key,artifactId:'program-request',bytes:requestBytes.length,sha256:sha(requestBytes)},196608,'runtimeBinding');
  const noise=await generateNoise(runtime.owner,48000,train.samples,{observeCapture:async(seed,capture)=>{await store.write(key+'-noise-'+seed+'.pcm',capture.raw,2380800,'pcm');await store.json(key+'-noise-'+seed+'-owner.json',{...capture,raw:undefined,stderr:Buffer.from(capture.stderr).toString('base64')},196608,'native');}});
  let acquisitions=0;const producerIO={...runtime,dependencies:async options=>++acquisitions===1?binding:runtime.dependencies(options)};
  const producer=await encodeProgram(runtime.owner,{settings,construction:{kind:'massFrames',train},frameCount:runtime.frames,pcm:constructTrainPcm(train,noise),path:file,store},producerIO);
  options.mutateProducer?.(producer.producerEvidence);
  const result=await readQualificationRecording(runtime.owner,file,{settings,path:'program',frames:runtime.frames,samples:runtime.samples,producerEvidence:producer.producerEvidence,store,allowEpisodeBound:options.allowEpisodeBound??false},producerIO);
  return {result,producer,runtime,store,directory,file,settings,key,metadata};
 }catch(error){const budget=store.programBudget(key);error.simulatedLayout={...runtime.layout,numericBytes:store.numericBytes,reservedOuterBytes:runtime.plans.outerReserveBytes,implementationBytes:budget.implementationBytes,dependencyUses:budget.dependencyUses,entries:store.entries.map(e=>[e.name,e.bytes])};await rm(directory,{recursive:true,force:true});throw error;}finally{control.dispose();}
}
test('SIMULATED complete program uses the production E→R→guard→private-clock→classifier path',async()=>{
 const v=await positiveProgram();try{
  assert.equal(v.result.record.clock.kind,'ClockCompatible');assert.equal(v.result.record.clock.sourceKind,'externalCodedRecording');
  assert.equal(v.result.assurance.kind,'trustedStackMeasurement');assert.equal(v.result.assurance.pendingOuterJoin,true);assert.equal(v.result.assurance.nativeBindingVerified,false);assert.equal(v.result.assurance.loaderComplete,false);
  assert.equal(v.result.record.metadataSamples,v.runtime.units*1024);assert.equal(v.result.coverage.samples,v.runtime.units*1024);assert.equal(v.runtime.commands.filter(c=>c.command==='ffprobe').length,3);
  assert.throws(()=>clocks.assertProgramClock(JSON.parse(JSON.stringify(v.result.record.clock))),/unproven/);
  assertReplayedProgram(v.result);assert.throws(()=>assertReplayedProgram(v.result,{outer:true}),/proof_required/);
  const serialized=JSON.parse(JSON.stringify(v.result));
  assert.throws(()=>assertReplayedProgram(serialized),/proof_required/);
  for(const change of [x=>x.assurance.nativeBindingVerified=true,x=>delete x.record.assurance,x=>x.record.clock.domain.audio[0]++,x=>x.programProof.projection.file.sha256='0'.repeat(64),x=>x.record.episodes.push({identity:'a'}),x=>x.programProof.replayRef.bytes++]){
   const altered=structuredClone(serialized);change(altered);
   await assert.rejects(replayProgramRecording(altered,{resolveOriginal:ref=>readFile(v.store.path(ref.name)),resolveImplementation:v.runtime.resolveImplementation}));
  }
 }finally{await rm(v.directory,{recursive:true,force:true});}
});
test('SIMULATED 216-object catalog with full E/D DATA charges is a bounded negative under unchanged caps',async()=>{
 await assert.rejects(positiveProgram({legacyPolicy:true,nativeObjectCount:216}),error=>{assert.equal(error.message,'invocation_byte_cap');const layout=error.simulatedLayout;assert(layout.mapsReads.length>=2);assert(layout.numericBytes<=262144);console.log('SIMULATED-216-charged-bounded-negative',JSON.stringify({...layout,exactHistoricalCatalogAndFourMapsPayloadOnly:2*48662+4*12407,scope:'Partial retained ledger at the unchanged cap; no complete-record fit. Two catalog and four maps historical payloads alone are 146952 bytes before other DATA/observations/outer allowance.'}));return true;});
});
test('SIMULATED 216-object real-volume lower bound fails the unchanged normal cap with every maps event charged',async()=>{
 await assert.rejects(positiveProgram({legacyPolicy:true,nativeObjectCount:216,mapsVolume:true,nativeCatalogFloorBytes:48662}),error=>{const layout=error.simulatedLayout;assert.equal(error.message,'invocation_byte_cap');assert(layout.nativeCatalogBytes>=48662);assert(layout.mapsOriginalBytes>=125416);assert(layout.mapsStoredBytesPerRead>=12407);assert(layout.mapsReads.length>=2);assert(layout.numericBytes<=262144);console.log('SIMULATED-real-volume-bounded-negative',JSON.stringify(layout));return true;});
});
export async function simulatedOuter(v){
 const {runtime,result,store}=v,originals=new Map(runtime.outerOriginals),ref=result.programProof.replayRef,manifest=JSON.parse(await readFile(store.path(ref.name))),put=(id,value)=>{const b=Buffer.from(JSON.stringify(value));originals.set(id,b);return nativeArtifact('observation',id,b);},candidate=JSON.parse(runtime.candidate.bytes),Q=JSON.parse(runtime.prepared.launch.bytes),I=JSON.parse(runtime.intent);
 const taskArn='arn:aws:ecs:us-east-1:079358094174:task/vrdex-restream-worker/'+'1'.repeat(32),taskDefinitionArn=Q.parameters.taskDefinition,containerName=I.workload.containerName;
 const definition={cpu:'8192',memory:'16384',networkMode:'awsvpc',requiresCompatibilities:['FARGATE'],runtimePlatform:{cpuArchitecture:'X86_64',operatingSystemFamily:'LINUX'},containerDefinitions:[{name:containerName,image:runtime.imageFacts.reference,cpu:8192,memory:16384,linuxParameters:{initProcessEnabled:true}}]};
 const task={taskArn,taskDefinitionArn,lastStatus:'STOPPED',createdAt:'2026-10-25T00:00:00Z',startedAt:'2026-10-25T00:00:01Z',stoppedAt:'2026-10-25T00:00:02Z',overrides:Q.parameters.overrides,containers:[{name:containerName,runtimeId:'SIMULATED-container',imageDigest:'sha256:'+runtime.imageFacts.manifestSHA,exitCode:0,lastStatus:'STOPPED'}],attachments:[{type:'ElasticNetworkInterface',details:[{name:'networkInterfaceId',value:'eni-12345678'}]}]};
 const resultRaw=Buffer.from(JSON.stringify(result)+'\n'),resultRef=nativeArtifact('observation','local-result.json',resultRaw);originals.set(resultRef.id,resultRaw);
 const metadata=[];for(const i of [0,1]){const b=await readFile(store.path(v.key+'-metadata-'+i+'.json')),id=['metadata-task','metadata-container'][i];originals.set(id,b);metadata.push(nativeArtifact('observation',id,b));}
 const receiptRef=put('receipt.json',{schema:'program-local-receipt-v1',assurance:result.assurance,cleanup:{closed:true,liveChildren:0,liveGroups:0},replayRef:ref,resultRef,metadata:{kind:'ecs-v4',originals:metadata.map(r=>({...r,elapsedMs:12}))}}),runTaskResponseRef=put('run-task-response',{tasks:[{taskArn}],failures:[]}),taskReadbackRef=put('task-readback',{tasks:[task],failures:[]});
 const files=[...artifactUseEntries(manifest.budget).map(({event,kind,...r})=>r),ref,resultRef,receiptRef].map(f=>({name:f.name??f.id,bytes:f.bytes,sha256:f.sha256})),collectorTerminalRef=put('terminal.json',{schema:'single-program-terminal-v1',runId:'task6-simulated',groupId:'canary-000',invocationId:manifest.budget.invocation.id,capacityAccepted:false,pairedQualification:false,programLocalComplete:true,artifactBindingComplete:true,artifactUploadsComplete:true,cleanup:{closed:true,emptyCensuses:2},receiptRef:files.at(-1),resultRef,replayRef:ref,binding:{candidateSHA:runtime.candidate.ref.sha256,contextSHA:runtime.prepared.context.ref.sha256,imageManifestSHA:runtime.imageFacts.manifestSHA},artifacts:files,destination:'s3://vrdex-restream-worker-079358094174-artifacts/synthetic-benchmarks/task6-simulated/qualification/canary-000/'});
 const records={task:{request:{cluster:'vrdex-restream-worker',tasks:[taskArn]},response:{tasks:[task],failures:[]}},definition:{request:{taskDefinition:taskDefinitionArn},response:{taskDefinition:{...definition,taskDefinitionArn,status:'INACTIVE'}}},eni:{request:{NetworkInterfaceIds:['eni-12345678']},response:{NetworkInterfaces:[]}}},expected={taskArn,taskDefinitionArn,imageDigest:'sha256:'+runtime.imageFacts.manifestSHA,definition,launch:Q},retrievalInputRef=put('retrieval-input',{schema:'single-program-root-retrieval-input-v1',config:{candidateSHA:runtime.candidate.ref.sha256,runId:'task6-simulated',groupId:'canary-000'},expected,records}),inventory=[{name:'terminal.json',bytes:collectorTerminalRef.bytes,sha256:collectorTerminalRef.sha256},...files];
 const readbackRef=put('artifact-readback',{schema:'single-program-root-helper-v1',capacityAccepted:false,pairedQualification:false,helper:{command:'python3',script:'scripts/event-marker-root-retrieval.py',exitCode:0,signal:null,stdoutEOF:true,stderrEOF:true,closedBeforeDeadline:true},cleanup:{closed:true,emptyCensuses:2},retrieval:{schema:'single-program-root-retrieval-v1',runId:'task6-simulated',groupId:'canary-000',files:inventory,independentRemoteFiles:inventory,freeBeforeBytes:536870912,minimumFreeDuringBytes:134217728,localHighWaterBytes:16777216,finishedMonotonic:2,absoluteDeadlineMonotonic:3,native:{physicalClosed:true,withinDeadlines:true,exitCode:0,taskArn,records,expected}}}),retrievalCompletionRef=put('retrieval-completion',{schema:'root-helper-completion-v1',exitCode:0,signal:null,completedAtMonotonic:2,absoluteDeadlineMonotonic:3,readbackSHA:readbackRef.sha256,inputSHA:retrievalInputRef.sha256});
 put('L',{schema:'native-outer-ledger-v1',domain:'program',startedAtUTC:'2026-10-25T00:00:01Z',requestSHA:runtime.prepared.launch.ref.sha256,contextSHA:runtime.prepared.context.ref.sha256,intentSHA:runtime.prepared.intent.ref.sha256,imageConfigSHA:runtime.imageFacts.configSHA,nativeExit:0,nativeSignal:null,receiptRef,readbackRef,collectorTerminalRef,retrievalInputRef,retrievalCompletionRef,runTaskResponseRef,taskReadbackRef,imageManifestRef:nativeArtifact('observation','image-manifest',originals.get('image-manifest')),imageConfigRef:nativeArtifact('observation','image-config',originals.get('image-config')),artifactUseRef:ref,artifactUsesSHA:sha(Buffer.from(JSON.stringify(manifest.budget.uses))),metadata:{originals:metadata,elapsedMs:12},rawImageID:'sha256:'+runtime.imageFacts.configSHA});
 const approval={schema:'native-root-approval-v1',decision:'approve-trustedStackMeasurement',candidateSHA:runtime.candidate.ref.sha256,profileSHA:candidate.profileSHA,environmentClass:'ecs',ledgerId:'SIMULATED-external-ledger',recordId:'SIMULATED-approval',auditRefs:candidate.auditRefs,issuedAtUTC:'2026-10-25T00:00:00Z'},ledger={original:Buffer.from(JSON.stringify(approval)),ledgerId:approval.ledgerId,recordId:approval.recordId};return {originals,ledger,put,manifest,options:{resolveOriginal:r=>readFile(store.path(r.name)),resolveImplementation:runtime.resolveImplementation,outerResolver:async id=>originals.get(id),rootLedger:{lookup:async()=>ledger}}};
}
test('SIMULATED external Root ledger and original A/K/I/C/Q/L joins admit only the independently replayed conditional record',async()=>{
 const v=await positiveProgram();try{const outer=await simulatedOuter(v),accepted=await replayProgramRecording(JSON.parse(JSON.stringify(v.result)),outer.options);assertReplayedProgram(accepted,{outer:true});assert.equal(accepted.replay.pendingOuterJoin,false);assert.equal(accepted.replay.nativeBindingVerified,false);assert.equal(accepted.replay.loaderComplete,false);
  for(const id of ['K','I','C','Q','L','image','metadata-task','run-task-response','local-result.json','receipt.json','artifact-readback',v.runtime.closure.files[0].path]){const original=outer.originals.get(id);outer.originals.set(id,Buffer.from('{}'));await assert.rejects(replayProgramRecording(JSON.parse(JSON.stringify(v.result)),outer.options));outer.originals.set(id,original);}
  const old=outer.ledger.original;outer.ledger.original=Buffer.from('{}');await assert.rejects(replayProgramRecording(JSON.parse(JSON.stringify(v.result)),outer.options));outer.ledger.original=old;
  accepted.record.episodes.push({identity:'forged'});assert.throws(()=>assertReplayedProgram(accepted,{outer:true}),/proof_required/);
 }finally{await rm(v.directory,{recursive:true,force:true});}
});
test('independent replay rejects code-asset, per-event use, outer reservation and numeric-cap forgery',async()=>{
 const v=await positiveProgram();try{const original=JSON.parse(await readFile(v.store.path(v.result.programProof.replayRef.name)));for(const change of [b=>b.implementationBytes=0,b=>b.implementationBytes*=2,b=>b.implementationUses.pop(),b=>b.implementationUses.push({...b.implementationUses[0]}),b=>b.reservedOuterBytes=0,b=>b.normalNumericCap=262144,b=>b.uses[0][2]++,b=>b.implementationAssets.pop()]){const manifest=structuredClone(original);change(manifest.budget);const raw=Buffer.from(JSON.stringify(manifest)+'\n'),serialized=JSON.parse(JSON.stringify(v.result));serialized.programProof.replayRef={...serialized.programProof.replayRef,bytes:raw.length,sha256:sha(raw)};await assert.rejects(replayProgramRecording(serialized,{resolveOriginal:r=>r.name===serialized.programProof.replayRef.name?raw:readFile(v.store.path(r.name)),resolveImplementation:v.runtime.resolveImplementation}));}}
 finally{await rm(v.directory,{recursive:true,force:true});}
});

for(const [name,options] of [
 ['unsupported profile',{mutateProfile:p=>p.assuranceBasis='implicit-fallback'}],
 ['missing critical ffprobe',{mutateProfile:p=>p.objects=p.objects.filter(o=>o.semantic!=='ffprobe')}],
 ['changed approved view',{mutateProfile:p=>p.platform.mountinfoSHA256='1'.repeat(64)}],
 ['unsupported loader environment',{mutateProfile:p=>p.environment.LD_PRELOAD='interpose.so'}],
 ['missing startup mapping',{mutateLogs:(d,r)=>{if(r==='decode')d.prefix=Buffer.from(d.prefix.toString().replace('[info] Stream mapping:\n',''));}}],
 ['wrong initialized tuple',{mutateLogs:(d,r)=>{if(r==='decode')d.prefix=Buffer.from(d.prefix.toString().replace('rgb24, 2x1','rgb24, 3x1'));}}],
 ['extra native filter',{mutateLogs:(d,r)=>{if(r==='decode')d.prefix=Buffer.concat([d.prefix,Buffer.from('[Parsed_fps_42 @ 0xf] [verbose] fps=30\n')]);}}],
 ['wrong aresample tuple',{mutateLogs:(d,r)=>{if(r==='decode')d.prefix=Buffer.from(d.prefix.toString().replace('fmt:s16 r:48000Hz','fmt:s16 r:44100Hz'));}}],
 ['wrong same-process start',{mutateLogs:(d,r)=>{if(r==='decode')d.prefix=Buffer.from(d.prefix.toString().replace('start: 0.000000','start: 0.001000'));}}],
 ['absent terminal line',{mutateLogs:d=>{d.stderr=Buffer.from(d.stderr.toString().replace('[verbose] No more output streams to write to, finishing.\n',''));}}],
 ['undrained decoded output',{mutateLogs:(d,r)=>{if(r==='decode')d.stderr=Buffer.from(d.stderr.toString().replace(/\d+ samples/,'4096 samples'));}}],
 ['lost decoded audio sample',{mutateLogs:(d,r)=>{if(r==='decode')d.pcm=d.pcm.subarray(0,-2);}}],
 ['lost decoded picture',{mutateLogs:(d,r)=>{if(r==='decode')d.rgb=d.rgb.subarray(0,-6);}}],
 ['wrong metadata timestamp',{mutateLogs:(d,r)=>{if(r==='decode')d.audio=Buffer.from(d.audio.toString().replace('pts:1024','pts:1025'));}}],
 ['source parameter mutation',{mutateProducer:p=>{p.parameters[10]^=1;}}],
 ['wrong successful feed hash',{mutateProducer:p=>{p.feeds.video={...p.feeds.video,actualFedSHA256:'0'.repeat(64),writtenSHA256:'0'.repeat(64)};}}],
 ['wrong E origin file',{mutateProducer:p=>{p.file={...p.file,sha256:'0'.repeat(64)};}}],
 ['wrong E original options',{mutateProducer:p=>{p.encoder.argv={...p.encoder.argv,args:[...p.encoder.argv.args,'-shortest']};}}],
 ['metadata ordinal gap',{mutateLogs:(d,r)=>{if(r==='decode')d.video=Buffer.from(d.video.toString().replace('frame:1 ','frame:2 '));}}],
 ['permission failure is not terminal absence',{mutateIO:io=>{const read=io.read;io.read=async(path,...rest)=>{if(/\/proc\/\d+\/maps$/.test(path))throw Object.assign(Error('SIMULATED denied'),{code:'EACCES'});return read(path,...rest);};}}],
])test(`SIMULATED positive orchestration rejects ${name}`,async()=>{await assert.rejects(positiveProgram(options));});
test('allowEpisodeBound retains verified program material and conditional assurance through independent negative replay',async()=>{const v=await positiveProgram({allowEpisodeBound:true,mutateLogs:(d,r)=>{if(r==='decode')for(let i=960;i<32000;i+=2)d.pcm.writeInt16LE(16384,i);}});try{assert.equal(v.result.classificationFailure,'episode_bound');assert.equal(v.result.record.episodes.length,0);assert(v.result.material.pcm.length);assertReplayedProgram(v.result);assert.equal(v.result.assurance.nativeBindingVerified,false);}finally{await rm(v.directory,{recursive:true,force:true});}});

test('TS supported grammar falsifies nonzero rewind and requires final PES/parser population',async()=>{
 const runtime=await simulatedProgramRuntime(),identity={regular:true,seekable:true,nlink:1,position:0,bytes:runtime.transport.bytes.length};
 for(const change of [x=>x.position=188,x=>x.seekable=false,x=>x.nlink=2,x=>x.bytes--]){const bad={...identity};change(bad);assert.throws(()=>conservation.replayProgramDemux(runtime.inventory,{fps:30,fileIdentity:bad}),/marker_program_/);}
 const replay=conservation.replayProgramDemux(runtime.inventory,{fps:30,fileIdentity:identity});assert.equal(replay.packets.at(-1).event,replay.emission.length);assert.deepEqual(replay.finalFlush.parserOrder,[0,1]);assert(replay.emission.some(e=>e.reason==='fileEnd'));assert.equal(replay.packets.length,runtime.frames+runtime.units);
 for(const key of ['video','audio']){const inventory=structuredClone(runtime.inventory);inventory[key].pes.packets.pop();assert.throws(()=>conservation.replayProgramDemux(inventory,{fps:30,fileIdentity:identity}),/marker_program_/);}
});

test('R90 selected 216-object real-volume source layout completes both E/D and independent replay',async()=>{const v=await positiveProgram({nativeObjectCount:216,mapsVolume:true,nativeCatalogFloorBytes:48662});try{const manifest=JSON.parse(await readFile(v.store.path(v.result.programProof.replayRef.name)));assert.equal(manifest.budget.policyId,'r83-native-evidence-v1');assert.equal(manifest.budget.normalNumericCap,1572864);assert.equal(v.runtime.layout.mapsReads.length,4);assert(manifest.budget.numericBytes+manifest.budget.reservedOuterBytes<1572864);const record=await replayProgramRecording(v.result,{resolveOriginal:r=>readFile(v.store.path(r.name)),resolveImplementation:v.runtime.resolveImplementation});assertReplayedProgram(record);console.log('SIMULATED-R90-complete-216-layout',JSON.stringify({...v.runtime.layout,budget:manifest.budget}));}finally{await rm(v.directory,{recursive:true,force:true});}});
test('PP27-03 replay rejects retagged original JSON and forged aggregate despite consistent recomputed hashes/totals',async()=>{const v=await positiveProgram();try{const base=JSON.parse(await readFile(v.store.path(v.result.programProof.replayRef.name)));for(const mutate of [b=>{const row=b.uses.find(r=>r[1].endsWith('-runtime.json'));row[0]='pcm';b.numericBytes-=row[2];},b=>{const row=b.uses.find(r=>r[1].endsWith('-parameters.json'));row[0]='coded';b.numericBytes-=row[2];},b=>b.artifactCap=67108864]){const manifest=structuredClone(base);mutate(manifest.budget);const raw=Buffer.from(JSON.stringify(manifest)+'\n'),serialized=structuredClone(v.result);serialized.programProof.replayRef={...serialized.programProof.replayRef,bytes:raw.length,sha256:sha(raw)};await assert.rejects(replayProgramRecording(serialized,{resolveOriginal:r=>r.name===serialized.programProof.replayRef.name?raw:readFile(v.store.path(r.name)),resolveImplementation:v.runtime.resolveImplementation}),/original_role_or_cap|budget/);}}finally{await rm(v.directory,{recursive:true,force:true});}});

test('PP27-01 pinned mux prefix is SDT then PAT then PMT before PES and rejects alternate ordering',async()=>{const runtime=await simulatedProgramRuntime(),b=runtime.transport.bytes;assert.equal(runtime.inventory.physical.packets[0].pid,17);for(const bytes of [Buffer.concat([b.subarray(188,376),b.subarray(0,188),b.subarray(376)]),b.subarray(188)]){assert.throws(()=>{const inventory=conservation.inventoryProgramTransport(bytes,{byteCap:bytes.length});conservation.replayProgramDemux(inventory,{fps:30,fileIdentity:{regular:true,seekable:true,nlink:1,position:0,bytes:bytes.length}});},/probe_rewind_prefix|psi_sections/);}});
