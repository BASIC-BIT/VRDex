import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp,readFile,writeFile,mkdir,rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { spawn } from 'node:child_process';
import { setTimeout as delay } from 'node:timers/promises';
import { positiveProgram,simulatedOuter } from './event-marker-positive-program.test.mjs';
import { sha } from '../fixtures/marker-positive-program.mjs';
import { verifyNativeOuterJoins,nativeArtifact } from '../../scripts/event-marker-native-controller.mjs';
import { retrieveProgramOriginals,createRootRetrievalOwner } from '../../scripts/event-marker-root-retrieval.mjs';
import { replayProgramRecording } from '../../scripts/marker-qualification/program-replay.mjs';
import { collectPositiveProgram } from '../../scripts/event-marker-program-collector.mjs';
import { createAcquisitionDeadline } from '../../scripts/event-marker-native-binding.mjs';
const json=v=>Buffer.from(JSON.stringify(v)),temp=()=>mkdtemp(join(tmpdir(),'marker-fix2-'));
const boundary=(v,outer,budget)=>verifyNativeOuterJoins({binding:v.producer.producerEvidence.encoder.binding,manifest:outer.manifest,budget:budget??{...outer.manifest.budget,numericBytes:outer.manifest.budget.numericBytes+v.result.programProof.replayRef.bytes,artifactBytes:outer.manifest.budget.artifactBytes+v.result.programProof.replayRef.bytes},serialized:v.result,invocations:[v.producer.producerEvidence.encoder.runtime,v.result.material.decoder.runtime],outerResolver:outer.options.outerResolver,rootLedger:outer.options.rootLedger});
function replaceReadback(outer,value){const L=JSON.parse(outer.originals.get('L'));L.readbackRef=outer.put('artifact-readback',value);const complete=JSON.parse(outer.originals.get('retrieval-completion'));complete.readbackSHA=L.readbackRef.sha256;complete.inputSHA=L.retrievalInputRef.sha256;L.retrievalCompletionRef=outer.put('retrieval-completion',complete);outer.put('L',L);}

test('PP28-01 real Python retrieval wire passes the Node wrapper/common verifier with exact JSON semantics',async()=>{
 const v=await positiveProgram(),directory=await temp();try{
  const outer=await simulatedOuter(v),input=JSON.parse(outer.originals.get('retrieval-input')),originals=join(directory,'originals');await mkdir(originals);
  for(const [id,name] of [['K','candidate'],['I','intent'],['Q','launch']]){input[name+'Path']=join(directory,name+'.json');await writeFile(input[name+'Path'],outer.originals.get(id));}
  const terminal=outer.originals.get('terminal.json'),inventory=JSON.parse(terminal).artifacts;await writeFile(join(originals,'terminal.json'),terminal);
  for(const f of inventory)await writeFile(join(originals,f.name),outer.originals.get(f.name)??await readFile(v.store.path(f.name)));
  input.config.downloadAuthorized=true;input.terminalBase64=terminal.toString('base64');input.terminalIdentity={bytes:terminal.length,sha256:sha(terminal)};input.urls=Object.fromEntries(['terminal.json',...inventory.map(f=>f.name)].map(name=>[name,'https://vrdex-restream-worker-079358094174-artifacts.s3.us-east-1.amazonaws.com/synthetic-benchmarks/task6-simulated/qualification/canary-000/'+name]));
  const inputPath=join(directory,'input.json'),outputPath=join(directory,'readback.json');await writeFile(inputPath,json(input));
  const result=await retrieveProgramOriginals({inputPath,outputPath,deadline:performance.now()+10000,ownerFactory:()=>createRootRetrievalOwner({spawnProcess:(command,args,options)=>{assert.equal(command,'python3');assert.equal(args[0],'scripts/event-marker-root-retrieval.py');return spawn(command,['-B','tests/fixtures/marker-root-wire.py',args[1],args[2],originals,join(directory,'retrieved')],options);}})});
  assert.deepEqual(Object.keys(result.retrieval.files[0]),['bytes','name','sha256']);assert.equal(result.cleanup.emptyCensuses,2);assert.equal(result.helper.exitCode,0);
  let L=JSON.parse(outer.originals.get('L'));L.retrievalInputRef=outer.put('retrieval-input',input);L.readbackRef=nativeArtifact('observation','artifact-readback',await readFile(outputPath));outer.originals.set('artifact-readback',await readFile(outputPath));L.retrievalCompletionRef=outer.put('retrieval-completion',{schema:'root-helper-completion-v1',exitCode:0,signal:null,completedAtMonotonic:2,absoluteDeadlineMonotonic:3,readbackSHA:L.readbackRef.sha256,inputSHA:L.retrievalInputRef.sha256});outer.put('L',L);
  const accepted=await replayProgramRecording(v.result,outer.options);assert.equal(accepted.replay.kind,'AcceptedConditionalProgramRecord');assert.equal(accepted.replay.nativeBindingVerified,false);assert.equal(accepted.replay.loaderComplete,false);
  const saved=new Map(outer.originals);
  for(const change of [r=>r.retrieval.files[0].bytes++,r=>r.retrieval.files.reverse(),r=>delete r.retrieval.files[0].sha256,r=>r.retrieval.files[0].extra=true,r=>r.retrieval.files[0].bytes=String(r.retrieval.files[0].bytes),r=>r.retrieval.native.records.task.response.tasks[0].lastStatus='RUNNING',r=>r.retrieval.native.expected.definition.containerDefinitions.push({}),r=>r.retrieval.native.expected.extra=true]){
   const bad=structuredClone(result);change(bad);replaceReadback(outer,bad);await assert.rejects(boundary(v,outer),/root_two_pass|root_native_records/);outer.originals.clear();for(const [k,b] of saved)outer.originals.set(k,b);
  }
  const q=JSON.parse(outer.originals.get('Q'));q.parametersJSON=' '+q.parametersJSON;q.parametersSHA256=sha(Buffer.from(q.parametersJSON));const changedQ=outer.put('Q',q);L=JSON.parse(outer.originals.get('L'));L.requestSHA=changedQ.sha256;input.expected.launch=q;L.retrievalInputRef=outer.put('retrieval-input',input);outer.put('L',L);const changedReadback=structuredClone(result);changedReadback.retrieval.native.expected.launch=q;replaceReadback(outer,changedReadback);await assert.rejects(boundary(v,outer),/ecs_request/);
 }finally{await rm(v.directory,{recursive:true,force:true});await rm(directory,{recursive:true,force:true});}
});

test('PP28-02 PROGRAM ordinary same-byte engine-archive IDs pay full numeric and aggregate charges',async()=>{
 const v=await positiveProgram();try{const outer=await simulatedOuter(v),base=await boundary(v,outer),saved=new Map(outer.originals);
  for(const field of ['imageManifestRef','imageConfigRef','taskReadbackRef']){
   const L=JSON.parse(outer.originals.get('L')),old=L[field].id,renamed='engine-archive-'+old,bytes=outer.originals.get(old),oldL=outer.originals.get('L');outer.originals.set(renamed,bytes);L[field]={...L[field],id:renamed};outer.put('L',L);
   const result=await boundary(v,outer),delta=outer.originals.get('L').length-oldL.length;assert.equal(result.chargedBytes,base.chargedBytes+delta);assert.equal(result.domainNumericBytes,0);
   const b={...outer.manifest.budget},atNumeric={...b,numericBytes:b.normalNumericCap-result.chargedBytes},atAggregate={...b,artifactBytes:b.artifactCap-65536-result.chargedBytes};
   assert.equal((await boundary(v,outer,atNumeric)).chargedBytes,result.chargedBytes);await assert.rejects(boundary(v,outer,{...atNumeric,numericBytes:atNumeric.numericBytes+1}),/outer_budget/);
   assert.equal((await boundary(v,outer,atAggregate)).chargedBytes,result.chargedBytes);await assert.rejects(boundary(v,outer,{...atAggregate,artifactBytes:atAggregate.artifactBytes+1}),/outer_budget/);
   outer.originals.clear();for(const [k,b] of saved)outer.originals.set(k,b);
  }
 }finally{await rm(v.directory,{recursive:true,force:true});}
});

test('PP28-03 removing mandatory frontdoor groups rejects coherent use, manifest and outer inventories',async()=>{
 const v=await positiveProgram();try{const original=JSON.parse(await readFile(v.store.path(v.result.programProof.replayRef.name))),key=v.key;
  const groups=[['sentinel',n=>n===key+'-prebinding.json'],['request-use',n=>n===key+'-request-use.json'],...['42','43'].flatMap(seed=>[[`noise-${seed}`,n=>n===key+'-noise-'+seed+'.pcm'],[`noise-owner-${seed}`,n=>n===key+'-noise-'+seed+'-owner.json']]),...['0','1'].flatMap(i=>[[`metadata-${i}`,n=>n===key+'-metadata-'+i+'.json'],[`metadata-owner-${i}`,n=>n===key+'-metadata-'+i+'-owner.json']]),['all-groups',n=>n===key+'-prebinding.json'||n===key+'-request-use.json'||n.startsWith(key+'-noise-')||n.startsWith(key+'-metadata-')]];
  for(const [group,remove] of groups){
   const manifest=structuredClone(original),removed=manifest.budget.uses.filter(u=>remove(u[1]));assert(removed.length,group);manifest.budget.uses=manifest.budget.uses.filter(u=>!remove(u[1]));for(const [role,,bytes] of removed){manifest.budget.artifactBytes-=bytes;if(!['pcm','coded','rgb'].includes(role))manifest.budget.numericBytes-=bytes;}
   const raw=Buffer.from(JSON.stringify(manifest)+'\n'),serialized=structuredClone(v.result);serialized.programProof.replayRef={...serialized.programProof.replayRef,bytes:raw.length,sha256:sha(raw)};const changed={...v,result:serialized,store:{path:name=>v.store.path(name)}};
   // Materialize the internally consistent reduced original and outer graph.
   const old=await readFile(v.store.path(serialized.programProof.replayRef.name));await writeFile(v.store.path(serialized.programProof.replayRef.name),raw);let outer;try{outer=await simulatedOuter(changed);}finally{await writeFile(v.store.path(serialized.programProof.replayRef.name),old);}
   let outerReads=0;await assert.rejects(replayProgramRecording(serialized,{...outer.options,resolveOriginal:r=>r.name===serialized.programProof.replayRef.name?raw:readFile(v.store.path(r.name)),outerResolver:async id=>{outerReads++;return outer.originals.get(id);}}),/frontdoor_required/);assert.equal(outerReads,0,group+' must fail before outer acceptance');
  }
  // Keep every authenticated dependency body and its full charges, but remove
  // the actual public prebinding acquisition identities from the graph.
  for(const all of [false,true]){const manifest=structuredClone(original),aliases=new Map();for(const row of manifest.budget.uses)if(row[1].startsWith(key+'-prebinding-')&&(all||row[1]===key+'-prebinding-0.bin')){const previous=row[1];row[1]=row[1].replace('-prebinding-','-binding-');aliases.set(row[1],previous);}const raw=Buffer.from(JSON.stringify(manifest)+'\n'),serialized=structuredClone(v.result);serialized.programProof.replayRef={...serialized.programProof.replayRef,bytes:raw.length,sha256:sha(raw)};const old=await readFile(v.store.path(serialized.programProof.replayRef.name));await writeFile(v.store.path(serialized.programProof.replayRef.name),raw);let outer;try{outer=await simulatedOuter({...v,result:serialized});}finally{await writeFile(v.store.path(serialized.programProof.replayRef.name),old);}await assert.rejects(replayProgramRecording(serialized,{...outer.options,resolveOriginal:r=>r.name===serialized.programProof.replayRef.name?raw:readFile(v.store.path(aliases.get(r.name)??r.name))}),/frontdoor_required/);}
 }finally{await rm(v.directory,{recursive:true,force:true});}
});

for(const phase of ['driver','upload','helper','terminal-upload'])for(const interrupt of ['SIGINT','SIGTERM','external'])test(`PP28-04 real ${phase} wrapper ${interrupt} closes every owned detached group`,async()=>{
 const child=spawn(process.execPath,['tests/fixtures/marker-wrapper-process.mjs',phase],{stdio:['ignore','pipe','pipe','ipc']}),events=[],groups=new Set(),output=[],diagnostics=[];let signalled=false,signalAt;
 child.stdout.on('data',b=>output.push(b));child.stderr.on('data',b=>diagnostics.push(b));
 const closed=new Promise((resolve,reject)=>{child.once('error',reject);child.once('close',(code,signal)=>resolve({code,signal}));});
 child.on('message',message=>{events.push(message);if(message.event==='spawn')groups.add(message.pid);if(message.event==='ready'&&!signalled){signalled=true;signalAt=performance.now();if(interrupt==='external')child.send('cancel-external');else child.kill(interrupt);}});
 const timeout=setTimeout(()=>{child.kill('SIGKILL');for(const pid of groups)try{process.kill(-pid,'SIGKILL');}catch{}},12000);
 try{
  const outcome=await closed;assert.equal(signalled,true,Buffer.concat(diagnostics).toString());assert.deepEqual(outcome,{code:1,signal:null});assert(performance.now()-signalAt<3000,'cleanup stayed inside original deadline');
  const result=events.find(e=>e.event==='result');assert(result,Buffer.concat(diagnostics).toString());assert.equal(result.positive,false);assert.match(result.failure??result.value?.failure,interrupt==='external'?/SIMULATED_external_abort/:new RegExp('cancelled:'+interrupt));assert(result.closed.length>0);assert(result.closed.every(c=>c.closed&&c.emptyCensuses===2&&c.liveChildren===0&&c.liveGroups===0));
  const readyIndex=events.findIndex(e=>e.event==='ready');assert(!events.slice(readyIndex+1).some(e=>['spawn','write'].includes(e.event)),'no new work or terminal publication after cancellation');assert.equal(Buffer.concat(output).length,0);
  for(const pid of groups){await delay(10);assert.throws(()=>process.kill(-pid,0),e=>e.code==='ESRCH','owned group absent');}
 }finally{clearTimeout(timeout);if(child.exitCode===null&&child.signalCode===null)child.kill('SIGKILL');for(const pid of groups)try{process.kill(-pid,'SIGKILL');}catch{}}
});

test('PP28-04 cancellation stays primary when physical cleanup fails, without publishing or starting another owner',async()=>{
 const cancelled=Error('SIMULATED_original_cancel'),abort=new AbortController();let owners=0,writes=0,closeCalls=0;
 const terminal=await collectPositiveProgram('task6-simulated',{signal:abort.signal,ownerFactory:async()=>{owners++;return {run:async()=>{abort.abort(cancelled);throw Error('SIMULATED_secondary_run');},close:async options=>{closeCalls++;assert(options.timeoutMs<=20000);return {closed:false,emptyCensuses:0};}};},read:async()=>{throw Error('read after cancellation');},write:async()=>{writes++;}});
 assert.equal(terminal.programLocalComplete,false);assert.equal(terminal.failure,cancelled.message);assert.match(terminal.secondary,/physical_cleanup/);assert.equal(owners,1);assert.equal(closeCalls,1);assert.equal(writes,0);
 const v=await positiveProgram();try{const outer=await simulatedOuter(v),input=JSON.parse(outer.originals.get('retrieval-input')),stop=new AbortController();Object.assign(input,{candidatePath:'K',intentPath:'I',launchPath:'Q'});let rootWrites=0,rootCloses=0;await assert.rejects(retrieveProgramOriginals({inputPath:'input',outputPath:'out',deadline:performance.now()+3000,signal:stop.signal,read:async p=>p==='input'?json(input):outer.originals.get(p),write:async()=>rootWrites++,ownerFactory:async()=>({run:async()=>{stop.abort(cancelled);throw Error('SIMULATED_secondary_helper');},close:async options=>{rootCloses++;assert(options.timeoutMs<=1500);return {closed:false,emptyCensuses:0};}})}),error=>{assert.equal(error,cancelled);assert.match(error.cleanupError.message,/physical_cleanup/);return true;});assert.equal(rootCloses,1);assert.equal(rootWrites,0);}finally{await rm(v.directory,{recursive:true,force:true});}
});
