import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp,rm,readFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { createHash } from 'node:crypto';
import * as replay from '../../scripts/marker-qualification/program-replay.mjs';
import { createArtifactStore,createInvocationStore } from '../../scripts/marker-qualification/artifacts.mjs';
import { simulatedProgramRuntime } from '../fixtures/marker-positive-program.mjs';
import { PROGRAM_SOURCE_CONTRACT } from '../../scripts/event-marker-program-contract.mjs';
const sha=b=>createHash('sha256').update(b).digest('hex');
test('R94 complete mandatory amendment is a checked-in original',async()=>{
 const body=await readFile(new URL('../fixtures/program-result-sizing-r94-v1.txt',import.meta.url));
 assert.equal(body.length,41830);assert.equal(sha(body),'0a7214700021178996f717487ce09b513fa8ebfcb70dca6a2bed863abb7a5c3c');assert.equal(PROGRAM_SOURCE_CONTRACT.resultSizing,sha(body));
});
test('R94 raw loader rejects invalid declarations before fetch and bad returns before copy or parse',async()=>{
 assert.equal(typeof replay.replayProgramOriginal,'function');let calls=0;const ref={name:'mass-program-result.json',role:'observation',bytes:262145,sha256:'a'.repeat(64)};
 await assert.rejects(replay.replayProgramOriginal(ref,{resolveOriginal:()=>{calls++;}}),/reference/);assert.equal(calls,0);
 for(const changed of [{...ref,bytes:1,name:'runtime.json'},{...ref,bytes:1,role:'runtimeBinding'},{...ref,bytes:1,id:'another-result.json'}])await assert.rejects(replay.replayProgramOriginal(changed,{resolveOriginal:()=>{calls++;}}),/reference/);assert.equal(calls,0);
 for(const raw of [Buffer.alloc(262145),{},'{}',new Uint16Array(2),Buffer.alloc(2)])await assert.rejects(replay.replayProgramOriginal({...ref,bytes:1},{resolveOriginal:()=>{calls++;return raw;}}),/original/);
 assert.equal(calls,5);
});
test('R94 direct store validates the selected combined reservation independently',async()=>{
 const directory=await mkdtemp(join(tmpdir(),'r94-reserve-'));
 try{const runtime=await simulatedProgramRuntime(),store=createInvocationStore(createArtifactStore(directory),{id:'simulated',kind:'mass'}),binding=await runtime.dependencies({registerImplementationAssets:f=>store.registerImplementationAssets(f,'simulated-program','encode')});store.selectNativePolicy(binding);
 assert.throws(()=>store.reserveProgramOuter('simulated-other',458753),/invocation_byte_cap/);
 store.reserveProgramOuter('simulated-program',458752);assert.equal(store.programBudget('simulated-program').reservedOuterBytes,458752);
 }finally{await rm(directory,{recursive:true,force:true});}
});
import { writeFile } from 'node:fs/promises';
import { readBounded,inspectAcquiredDependencies,createAcquisitionDeadline } from '../../scripts/event-marker-native-binding.mjs';
import { validateProgramDependencies } from '../../scripts/event-marker-program-guards.mjs';
import { programResultLimits,isProgramResultReference,LEGACY_POLICY,NATIVE_POLICY } from '../../scripts/event-marker-evidence-policy.mjs';
import { positiveProgram,simulatedOuter } from './event-marker-positive-program.test.mjs';
import { verifyNativeOuterJoins } from '../../scripts/event-marker-native-controller.mjs';
const json=v=>Buffer.from(JSON.stringify(v)+'\n');
const boundary=(v,o,budget)=>verifyNativeOuterJoins({binding:v.producer.producerEvidence.encoder.binding,manifest:o.manifest,budget:budget??{...o.manifest.budget,numericBytes:o.manifest.budget.numericBytes+v.result.programProof.replayRef.bytes,artifactBytes:o.manifest.budget.artifactBytes+v.result.programProof.replayRef.bytes},serialized:v.result,invocations:[v.producer.producerEvidence.encoder.runtime,v.result.material?.decoder.runtime],outerResolver:o.options.outerResolver,rootLedger:o.options.rootLedger});
async function scopedStore(options={}){
 const directory=await mkdtemp(join(tmpdir(),'r94-store-')),runtime=await simulatedProgramRuntime(options),id=options.domain==='native132'?'prelude':'simulated',key=id+'-program',store=createInvocationStore(createArtifactStore(directory),{id,kind:'mass'}),binding=await runtime.dependencies({registerImplementationAssets:f=>store.registerImplementationAssets(f,key,'encode')});store.selectNativePolicy(binding);return {directory,runtime,store,binding,key};
}
async function structuralResult(v,size){
 const coded=await v.store.write(v.key+'.ts',Buffer.from('SIMULATED structural bytes'),100,'coded'),replayRef=await v.store.json(v.key+'-program-originals.json',{scope:'structural storage only; no semantic proof'},196608,'observation');
 const value={record:{recordingSha256:coded.sha256},programProof:{replayRef},padding:'é'};value.padding+='x'.repeat(size-json(value).length);assert.equal(json(value).length,size);return json(value);
}
test('R94 exact UTF8 plus LF result cap, one-byte excess, one identity, transactional reserve and old scopes',async()=>{
 for(const options of [{},{legacyPolicy:true},{domain:'native132'}]){const v=await scopedStore(options);try{
  const selected=!options.legacyPolicy&&!options.domain,limit=selected?262144:196608;
  // Legacy positive plans deliberately request less than their maximum.
  const reservation=v.runtime.plans.outerReserveBytes;v.store.reserveProgramOuter(v.key,reservation);
  const raw=await structuralResult(v,limit),before=v.store.programBudget(v.key);
  for(const name of ['wrong-result.json',v.key+'-second-result.json'])await assert.rejects(v.store.writeProgramOuter(v.key,name,raw),/invocation_byte_cap/);
  await assert.rejects(v.store.writeProgramOuter(v.key,v.key+'-result.json',Buffer.concat([raw,Buffer.from(' ')])),/invocation_byte_cap/);
  assert.equal(v.store.programBudget(v.key).reservedOuterBytes,before.reservedOuterBytes);
  if(selected||options.domain){const ref=await v.store.writeProgramOuter(v.key,v.key+'-result.json',raw);assert.equal(ref.bytes,limit);assert.equal(v.store.numericBytes,before.numericBytes+limit);assert.equal(v.store.programBudget(v.key).reservedOuterBytes,reservation-limit);await assert.rejects(v.store.writeProgramOuter(v.key,v.key+'-result.json',raw),/invocation_byte_cap/);await assert.rejects(replay.replayProgramOriginal(ref,{resolveOriginal:(r,{cap})=>readBounded(v.store.path(r.name),cap)}),/manifest/);}
  else await assert.rejects(v.store.writeProgramOuter(v.key,v.key+'-result.json',raw),/invocation_byte_cap/);
 }finally{await rm(v.directory,{recursive:true,force:true});}}
 const directory=await mkdtemp(join(tmpdir(),'r94-old-'));try{const store=createInvocationStore(createArtifactStore(directory),{id:'ordinary',kind:'mass'});assert.throws(()=>store.reserveProgramOuter('ordinary-program',196609),/invocation_byte_cap/);store.reserveProgramOuter('ordinary-program',196608);assert.throws(()=>store.selectNativePolicy({kind:'AcquiredDependencies'}),/invocation_policy/);}finally{await rm(directory,{recursive:true,force:true});}
});
test('R94 selected result cannot relabel runtime bytes and cancellation restores the held allowance',async()=>{
 const v=await scopedStore();try{v.store.reserveProgramOuter(v.key,458752);const raw=await structuralResult(v,1000),runtime=await v.store.write(v.key+'-runtime.json',raw,196608,'runtimeBinding'),before=v.store.programBudget(v.key);await assert.rejects(v.store.writeProgramOuter(v.key,v.key+'-result.json',raw),/artifact_role/);assert.equal(runtime.bytes,raw.length);assert.equal(v.store.programBudget(v.key).reservedOuterBytes,before.reservedOuterBytes);
 const cancelled=Error('SIMULATED_result_cancel');await assert.rejects(v.store.writeProgramOuter(v.key,v.key+'-result.json',raw,{check(){throw cancelled;}}),e=>e===cancelled);assert.equal(v.store.programBudget(v.key).reservedOuterBytes,before.reservedOuterBytes);
 }finally{await rm(v.directory,{recursive:true,force:true});}
});
test('R94 required G0 and G12 amendment is exact, full, and independent of optional K membership',async()=>{
 const v=await scopedStore();try{const deps={...structuredClone(inspectAcquiredDependencies(v.binding)),profile:JSON.parse(v.runtime.files.get('/app/workers/restream/native-binding/runtime/profile.json')),nativeCatalog:JSON.parse(v.runtime.files.get('/app/workers/restream/native-binding/runtime/nativeCatalog.json'))};validateProgramDependencies(deps);
 for(const guard of ['G0','G12'])for(const mutate of [refs=>refs.filter(r=>r.id!=='program-result-sizing-r94-v1'),refs=>refs.map(r=>r.id==='program-result-sizing-r94-v1'?{...r,id:'optional-policy'}:r),refs=>refs.map(r=>r.id==='program-result-sizing-r94-v1'?{...r,bytes:r.bytes-1}:r),refs=>refs.map(r=>r.id==='program-result-sizing-r94-v1'?{...r,sha256:'0'.repeat(64)}:r),refs=>refs.map(r=>r.id==='program-result-sizing-r94-v1'?{...r,range:{start:0,length:1}}:r)]){const changed=structuredClone(deps);changed.proof.descriptions.find(d=>d.guard===guard).sourceRefs=mutate(changed.proof.descriptions.find(d=>d.guard===guard).sourceRefs);assert.throws(()=>validateProgramDependencies(changed),/result_sizing_authority/);}
 for(const mutate of [d=>delete d.proof.contract.resultSizing,d=>d.proof.contract.resultSizing='0'.repeat(64)]){const d=structuredClone(deps);mutate(d);assert.throws(()=>validateProgramDependencies(d),/guard_contract/);}
 for(const mutate of [d=>d.intent.execution.producer='ci-native132-v1',d=>d.intent.execution.retrieval='engine-binding-v1',d=>d.plans.evidencePolicy=LEGACY_POLICY.id,d=>d.intent.execution.invocation.id='wrong']){const d=structuredClone(deps);mutate(d);assert.throws(()=>programResultLimits(d,{id:'simulated',kind:'mass'}),/marker_policy/);}
 assert.equal(PROGRAM_SOURCE_CONTRACT.design,'aa6d1308c3ed17a2440004d06ef85a5d47aa47d09034b11fe8ddc01087f13c93');assert.equal(PROGRAM_SOURCE_CONTRACT.guards,'a9cdeede2f5be1c9daf79cc9842b60e079e1bc2dff8501b3cc9cf75f4f9073f7');assert.equal(PROGRAM_SOURCE_CONTRACT.pins,'8cd6382c44b4c70bde56a20387d8268b8133023c79bd8c5afd90027dbd00e75a');
 }finally{await rm(v.directory,{recursive:true,force:true});}
});
test('R94 full ordinary O and combined boundaries, exact-once result charge, failure headroom, and A intake',async()=>{
 const v=await positiveProgram();try{
  const originalSize=json(v.result).length;v.result.padding='é';v.result.padding+='x'.repeat(262144-json(v.result).length);assert.equal(json(v.result).length,262144);
  const outer=await simulatedOuter(v),base=await boundary(v,outer),R=262144;assert(base.chargedBytes>R);const O=base.chargedBytes-R,approval=JSON.parse(outer.ledger.original);approval.padding='';approval.padding='x'.repeat(196608-O-(Buffer.byteLength(JSON.stringify(approval))-outer.ledger.original.length));outer.ledger.original=Buffer.from(JSON.stringify(approval));assert(outer.ledger.original.length<=196608);
  const exact=await boundary(v,outer);assert.equal(exact.chargedBytes,458752);const budget={...outer.manifest.budget,numericBytes:NATIVE_POLICY.normal-458752,artifactBytes:16777216-65536-458752};assert.equal((await boundary(v,outer,budget)).chargedBytes,458752);
  for(const changed of [{...budget,numericBytes:budget.numericBytes+1},{...budget,artifactBytes:budget.artifactBytes+1},{...budget,reservedOuterBytes:458753},{...budget,reservedOuterBytes:458751}])await assert.rejects(boundary(v,outer,changed),/outer_budget/);
  outer.ledger.original=Buffer.concat([outer.ledger.original,Buffer.from(' ')]);await assert.rejects(boundary(v,outer),/outer_budget/);
  for(const bad of [Buffer.alloc(196609),{},'{}',new Uint16Array(2)]){outer.ledger.original=bad;await assert.rejects(boundary(v,outer),/external_approval/);}
  const L=JSON.parse(outer.originals.get('L')),receipt=JSON.parse(outer.originals.get('receipt.json'));let fetched=false;receipt.resultRef={...receipt.resultRef,bytes:262145};L.receiptRef=outer.put('receipt.json',receipt);outer.put('L',L);outer.ledger.original=Buffer.from(JSON.stringify(approval));const resolve=outer.options.outerResolver;outer.options.outerResolver=(id,options)=>{if(id===v.key+'-result.json')fetched=true;return resolve(id,options);};await assert.rejects(boundary(v,outer),/outer_reference/);assert.equal(fetched,false);assert(originalSize<196608);
 }finally{await rm(v.directory,{recursive:true,force:true});}
});
test('R94 raw and replay reads use owned bound/identity/EOF acquisition and abort before parsing',async()=>{
 const directory=await mkdtemp(join(tmpdir(),'r94-reader-'));try{const file=join(directory,'oversized.json'),raw=Buffer.alloc(262145,32);await writeFile(file,raw);let reads=0;const resolveOriginal=async(r,{cap})=>{reads++;return readBounded(file,cap);};await assert.rejects(replay.replayProgramOriginal({name:'owned-program-result.json',role:'observation',bytes:262144,sha256:sha(raw)},{resolveOriginal}),/marker_binding_file/);assert.equal(reads,1);
 const abort=new AbortController();abort.abort(Error('SIMULATED_read_abort'));await assert.rejects(readBounded(file,262145,{signal:abort.signal}),/SIMULATED_read_abort/);
 const manifestRef={name:'owned-program-program-originals.json',role:'observation',bytes:1,sha256:sha(Buffer.from('x'))};for(const raw of [Buffer.alloc(196609),new Uint16Array(1),'x',Buffer.from('xx')])await assert.rejects(replay.replayProgramRecording({programProof:{replayRef:manifestRef}},{resolveOriginal:()=>raw}),/original_bytes/);
 let calls=0;await assert.rejects(replay.replayProgramRecording({programProof:{replayRef:{...manifestRef,bytes:196609}}},{resolveOriginal:()=>{calls++;return Buffer.alloc(196609);}}),/manifest_role/);assert.equal(calls,0);
 }finally{await rm(directory,{recursive:true,force:true});}
});
import { open,lstat,readdir } from 'node:fs/promises';
import { randomUUID } from 'node:crypto';
import { acquirePositiveProgram } from '../../scripts/event-marker-program-acquire.mjs';
test('R94 write and digest cancellation retain no positive entry, restore reservation and preserve primary',async()=>{
 for(const stopAt of [4,7]){const v=await scopedStore();try{v.store.reserveProgramOuter(v.key,458752);const raw=await structuralResult(v,262144),before=v.store.programBudget(v.key),primary=Error('SIMULATED_cancel_'+stopAt);let checks=0;
  await assert.rejects(v.store.writeProgramOuter(v.key,v.key+'-result.json',raw,{check(){if(++checks===stopAt)throw primary;}}),e=>e===primary);
  assert(!v.store.entries.some(e=>e.name===v.key+'-result.json'));assert.equal(v.store.numericBytes,before.numericBytes);assert.equal(v.store.programBudget(v.key).reservedOuterBytes,458752);
  const failed=await v.store.writeFailure(v.key+'-failure.json',{primary:{error:{message:primary.message}},secondary:[]});await assert.rejects(v.store.writeProgramOuter(v.key,v.key+'-result.json',raw),/invocation_byte_cap/);assert.equal(JSON.parse(await readFile(v.store.path(failed.name))).primary.error.message,primary.message);
 }finally{await rm(v.directory,{recursive:true,force:true});await assert.rejects(lstat(v.directory),e=>e.code==='ENOENT');}}
});
test('R94 owned acquisition cancels during read and closes the actual file handle',async()=>{
 const directory=await mkdtemp(join(tmpdir(),'r94-read-abort-'));try{const file=join(directory,'original'),raw=Buffer.alloc(131072,32),abort=new AbortController();await writeFile(file,raw);let reads=0,closes=0;
 await assert.rejects(readBounded(file,raw.length,{signal:abort.signal,fileSystem:{lstat,open:async(...args)=>{const handle=await open(...args);return {stat:()=>handle.stat(),read:async(...a)=>{const r=await handle.read(...a);reads++;abort.abort(Error('SIMULATED_in_read'));return r;},close:async()=>{closes++;await handle.close();}};}}}),/SIMULATED_in_read/);assert.equal(reads,1);assert.equal(closes,1);
 }finally{await rm(directory,{recursive:true,force:true});}
});
test('R94 bounded Root A owner checks metadata before acquisition and preserves full O charging',async()=>{
 const v=await positiveProgram(),directory=await mkdtemp(join(tmpdir(),'r94-root-a-'));try{const outer=await simulatedOuter(v),base=await boundary(v,outer),file=join(directory,'approval.json');await writeFile(file,outer.ledger.original);const ref={id:'A',bytes:outer.ledger.original.length,sha256:sha(outer.ledger.original)};let reads=0;
 outer.options.rootLedger.lookup=async(_candidate,{cap})=>{assert.equal(cap,196608);assert(ref.bytes>0&&ref.bytes<=cap);reads++;return {...outer.ledger,ref,original:await readBounded(file,ref.bytes)};};assert.equal((await boundary(v,outer)).chargedBytes,base.chargedBytes);assert.equal(reads,1);
 ref.bytes=196609;await assert.rejects(boundary(v,outer));assert.equal(reads,1);
 ref.bytes=1;await assert.rejects(boundary(v,outer),/marker_binding_file/);assert.equal(reads,2);
 }finally{await rm(v.directory,{recursive:true,force:true});await rm(directory,{recursive:true,force:true});}
});
test('R94 exact owned result refuses runtime relabel at outer boundary; copies and every audit body remain required',async()=>{
 const v=await positiveProgram();try{const outer=await simulatedOuter(v),base=await boundary(v,outer),saved=new Map(outer.originals),ledger=outer.ledger.original;
 for(const id of ['program-result-sizing-r94-v1','SIMULATED-APPROVAL-ONLY'])for(const replacement of [undefined,Buffer.from('changed')]){outer.originals.set(id,replacement);await assert.rejects(boundary(v,outer),/candidate_member/);outer.originals.set(id,saved.get(id));}
 const approval=JSON.parse(ledger);approval.auditRefs=approval.auditRefs.filter(r=>r.id!=='program-result-sizing-r94-v1');outer.ledger.original=Buffer.from(JSON.stringify(approval));await assert.rejects(boundary(v,outer),/root_approval/);outer.ledger.original=ledger;
 const receipt=JSON.parse(outer.originals.get('receipt.json')),L=JSON.parse(outer.originals.get('L')),runtime=outer.manifest.budget.uses.find(r=>r[0]==='runtimeBinding'),body=await readFile(v.store.path(runtime[1]));outer.originals.set(v.key+'-result.json',body);receipt.resultRef={name:v.key+'-result.json',role:'observation',bytes:body.length,sha256:sha(body)};L.receiptRef=outer.put('receipt.json',receipt);outer.put('L',L);await assert.rejects(boundary(v,outer),/result_identity/);
 outer.originals.clear();for(const [id,b] of saved)outer.originals.set(id,b);
 const changedL=JSON.parse(outer.originals.get('L')),old=outer.originals.get(changedL.runTaskResponseRef.id),duplicate=outer.originals.get(changedL.taskReadbackRef.id),oldL=outer.originals.get('L');outer.originals.set(changedL.runTaskResponseRef.id,duplicate);changedL.runTaskResponseRef={...changedL.runTaskResponseRef,bytes:duplicate.length,sha256:sha(duplicate)};outer.put('L',changedL);const copied=await boundary(v,outer);assert.equal(copied.chargedBytes,base.chargedBytes-old.length+duplicate.length+outer.originals.get('L').length-oldL.length);
 const resultBytes=outer.originals.get(v.key+'-result.json'),before=v.store.numericBytes;await v.store.write(v.key+'-result-copy.json',resultBytes,196608,'observation');assert.equal(v.store.numericBytes,before+resultBytes.length);assert.equal(v.store.programBudget(v.key).reservedOuterBytes,458752-resultBytes.length);
 }finally{await rm(v.directory,{recursive:true,force:true});}
});
test('R94 final receipt cancellation follows real private replay and closes the owned fixture before rejecting',async()=>{
 const directory='/tmp/marker-program-r94-final-'+randomUUID(),id='mass-320-48000stereo-073',request={schema:'positive-program-acquisition-v1',invocationId:id,groupId:'canary-000',settings:{videoPreset:'480p30',audioBitrateKbps:320},train:{sourceRate:48000,samples:31*1600,frames:31,slots:[{index:0,start:1,end:2,sourceStart:1,visualFrame:0,family:'missing',params:{seed:42,kind:'silence'}}]}},runtime=await simulatedProgramRuntime({programRequest:request}),control=createAcquisitionDeadline(30000),primary=Error('SIMULATED_final_receipt_cancel');let closed,writes=0;
 const check=control.check,run=control.run;let cancelled=false;const ownedControl={...control,check(){if(cancelled)throw primary;check();},run(operation){return run(async()=>{if(cancelled)throw primary;const value=await operation();if(cancelled)throw primary;return value;});}};
 const close=runtime.owner.close;runtime.owner.close=async(...args)=>{closed=await close(...args);return closed;};
 try{await assert.rejects(acquirePositiveProgram({directory,ownerFactory:async()=>runtime.owner,io:{...runtime,control:ownedControl,metadata:{environment:{ECS_CONTAINER_METADATA_URI_V4:'http://169.254.170.2/v4/SIMULATED'},fetchImpl:async()=>new Response('{}')},fileSystem:{writeFile:async()=>{writes++;cancelled=true;throw primary;}}}}),e=>e===primary);assert.equal(writes,1);assert.equal(closed.closed,true);assert.equal(closed.liveChildren,0);assert.equal(closed.liveGroups,0);assert(!(await readdir(directory)).includes('receipt.json'));assert((await readdir(directory)).includes(id+'-program-result.json'));
 }finally{control.dispose();await rm(directory,{recursive:true,force:true});}
});

test('R94 result identity rejects wrong name, role, record, invocation and ambiguous aliases',()=>{
 const invocation={id:'owned',kind:'mass'},key='owned-program',ref={name:key+'-result.json',role:'observation'};assert(isProgramResultReference(ref,key,invocation));
 for(const changed of [{...ref,id:'copied-result.json'},{...ref,kind:'runtime'},{...ref,role:'runtimeBinding'},{...ref,name:'other-result.json'}])assert.equal(isProgramResultReference(changed,key,invocation),false);
 assert.equal(isProgramResultReference(ref,'other-program',invocation),false);assert.equal(isProgramResultReference(ref,key,{...invocation,kind:'literal'}),false);
});
test('R94 oversized resolver returns reject before another Buffer copy or JSON parse',async()=>{
 const bad=Buffer.alloc(262145,32),copy=Buffer.from,parse=JSON.parse;let copies=0,parses=0;
 const stop=()=>{Buffer.from=copy;JSON.parse=parse;};
 try{Buffer.from=function(value,...args){if(value===bad)copies++;return copy(value,...args);};JSON.parse=function(value,...args){if(value===bad)parses++;return parse(value,...args);};
 const ref={name:'owned-program-result.json',role:'observation',bytes:1,sha256:'a'.repeat(64)};
 await assert.rejects(replay.replayProgramOriginal(ref,{resolveOriginal:()=>bad}),/original_bytes/);
 await assert.rejects(replay.replayProgramRecording({programProof:{replayRef:{...ref,name:'owned-program-program-originals.json'}}},{resolveOriginal:()=>bad}),/original_bytes/);
 await assert.rejects(verifyNativeOuterJoins({outerResolver:()=>bad}),/outer_original/);assert.equal(copies,0);assert.equal(parses,0);
 }finally{stop();}
 const v=await positiveProgram();try{const outer=await simulatedOuter(v);outer.ledger.original=bad;try{Buffer.from=function(value,...args){if(value===bad)copies++;return copy(value,...args);};JSON.parse=function(value,...args){if(value===bad)parses++;return parse(value,...args);};await assert.rejects(boundary(v,outer),/external_approval/);assert.equal(copies,0);assert.equal(parses,0);}finally{stop();}}finally{await rm(v.directory,{recursive:true,force:true});}
});

test('R94-1 declared outer lengths reject longer and shorter bodies before copy or parse',async()=>{
 const v=await positiveProgram();try{const outer=await simulatedOuter(v),savedL=outer.originals.get('L'),receipt=outer.originals.get('receipt.json'),originalCopy=Buffer.from,originalParse=JSON.parse;
  for(const delta of [-1,1]){
   const L=JSON.parse(savedL),declared=receipt.length+delta;L.receiptRef={...L.receiptRef,bytes:declared};outer.put('L',L);let copies=0,parses=0,acquisitionCap;
   const resolver=outer.options.outerResolver;outer.options.outerResolver=(id,options)=>{if(id==='receipt.json')acquisitionCap=options.cap;return resolver(id,options);};
   try{Buffer.from=function(value,...args){if(value===receipt)copies++;return originalCopy(value,...args);};JSON.parse=function(value,...args){if(value===receipt)parses++;return originalParse(value,...args);};await assert.rejects(boundary(v,outer),/outer_original|outer_hash/);}
   finally{Buffer.from=originalCopy;JSON.parse=originalParse;outer.options.outerResolver=resolver;}
   assert.equal(copies,0,'length mismatch must precede Buffer.from');assert.equal(parses,0);assert.equal(acquisitionCap,declared,'declared length is the tighter owned acquisition cap');
  }
 }finally{await rm(v.directory,{recursive:true,force:true});}
});

test('R94-1 cached outer originals retain exact requested length and hash without another read or copy',async()=>{
 const v=await positiveProgram();try{const outer=await simulatedOuter(v),savedL=outer.originals.get('L'),K=outer.originals.get('K'),copy=Buffer.from;
  for(const delta of [-1,1,0]){const L=JSON.parse(savedL);L.receiptRef={kind:'observation',id:'K',bytes:K.length+delta,sha256:delta===0?'0'.repeat(64):sha(K)};outer.put('L',L);let reads=0,copies=0;const resolver=outer.options.outerResolver;outer.options.outerResolver=(id,options)=>{if(id==='K')reads++;return resolver(id,options);};
   try{Buffer.from=function(value,...args){if(value===K)copies++;return copy(value,...args);};await assert.rejects(boundary(v,outer),/outer_original|outer_hash/);}finally{Buffer.from=copy;outer.options.outerResolver=resolver;}
   assert.equal(reads,1);assert.equal(copies,1,'only the initial fixed-document acquisition copies K');
  }
 }finally{await rm(v.directory,{recursive:true,force:true});}
});

test('R94-2 ordinary-scope padded raw originals cannot spend the hard intake ceiling',async()=>{
 const v=await positiveProgram({legacyPolicy:true,nativeObjectCount:10});try{
  const canonical=json(v.result);assert(canonical.length<196608);assert.equal(v.runtime.plans.evidencePolicy,LEGACY_POLICY.id);
  const ref=await v.store.writeProgramOuter(v.key,v.key+'-result.json',canonical),options={resolveOriginal:(r,{cap})=>readBounded(v.store.path(r.name),cap),resolveImplementation:v.runtime.resolveImplementation};
  replay.assertReplayedProgram(await replay.replayProgramOriginal(ref,options));
  for(const bytes of [196608,196609,262144]){const raw=Buffer.concat([Buffer.alloc(bytes-canonical.length,32),canonical]);assert.equal(raw.length,bytes);let delegatedReads=0;
   await assert.rejects(replay.replayProgramOriginal({...ref,bytes,sha256:sha(raw)},{...options,resolveOriginal:(r,o)=>{if(r.name===ref.name)return raw;delegatedReads++;return options.resolveOriginal(r,o);}}),/original_encoding/);assert.equal(delegatedReads,0);
  }
  const tooLarge={...v.result,padding:''};tooLarge.padding='x'.repeat(196609-json(tooLarge).length);const raw=json(tooLarge);assert.equal(raw.length,196609);let delegatedReads=0;
  await assert.rejects(replay.replayProgramOriginal({...ref,bytes:raw.length,sha256:sha(raw)},{...options,resolveOriginal:(r,o)=>{if(r.name===ref.name)return raw;delegatedReads++;return options.resolveOriginal(r,o);}}),/result_cap/);assert(delegatedReads>0,'canonical input still reaches the privately derived ordinary limit');
 }finally{await rm(v.directory,{recursive:true,force:true});}
});
