import { gzipSync } from 'node:zlib';
import { createReadStream } from 'node:fs';
import { lstat,writeFile,readdir } from 'node:fs/promises';
import { join } from 'node:path';
import { createHash } from 'node:crypto';
import { inspectAcquiredDependencies } from '../event-marker-native-binding.mjs';
import { LEGACY_POLICY,deriveEvidencePolicy,invocationAggregate,programResultLimits,isProgramResultReference } from '../event-marker-evidence-policy.mjs';
// Roles describe the retained evidence, never its file extension. Raw numeric
// diagnostics remain numeric even when stored as opaque gzip/binary members.
export const ARTIFACT_ROLES=Object.freeze({coded:'media',pcm:'media',rgb:'media',packet:'numeric',probe:'numeric',audioMetadata:'numeric',videoMetadata:'numeric',argv:'numeric',feed:'numeric',native:'numeric',progressVideo:'numeric',progressAudio:'numeric',stderr:'numeric',sourceProbe:'numeric',normalization:'numeric',sourceObservation:'numeric',observation:'numeric',results:'numeric',catalog:'numeric',runtimeBinding:'numeric',procMaps:'numeric'});
export function artifactCharge(role) {if(!Object.hasOwn(ARTIFACT_ROLES,role))throw Error('artifact_role');return ARTIFACT_ROLES[role];}
export function artifactUseEntries(budget){if(budget.useEncoding!=='original-tuples-v1'||!Array.isArray(budget.uses))throw Error('artifact_use_encoding');return budget.uses.map((r,event)=>{if(!Array.isArray(r)||r.length!==4)throw Error('artifact_use_encoding');artifactCharge(r[0]);return {event,kind:'original',role:r[0],name:r[1],bytes:r[2],sha256:r[3]};});}
export function createArtifactStore(directory,{byteCap=134152192}={}) {
 const entries=new Map(),implementationAssets=new Map();let total=0;
 const path=name=>{if(!/^[a-z0-9][a-z0-9._-]{0,159}$/.test(name))throw Error('artifact_name');return join(directory,name);};
 async function digest(name,cap,{signal,check=()=>signal?.throwIfAborted()}={}) {
  check();
  const file=path(name),s=await lstat(file);check();
  if(!s.isFile()||s.isSymbolicLink()||s.nlink!==1)throw Error('artifact_type');
  if(s.size<1||s.size>cap)throw Error('byte_cap');
  const hash=createHash('sha256');let count=0;
  for await(const b of createReadStream(file,{signal})){check();count+=b.length;if(count>cap)throw Error('byte_cap');hash.update(b);}
  check();if(count!==s.size)throw Error('artifact_changed');
  return {name,bytes:count,sha256:hash.digest('hex')};
 }
 async function adopt(name,cap,role,control={}) {
  control.check?.();artifactCharge(role);
  if(entries.has(name))throw Error('duplicate_artifact');
  const entry=await digest(name,cap,control);control.check?.();if(total+entry.bytes>byteCap)throw Error('byte_cap');
  const retained=Object.freeze({...entry,role});entries.set(name,retained);total+=entry.bytes;return retained;
 }
 async function write(name,bytes,cap,role,control={}) {
  control.check?.();
  const file=path(name);
  artifactCharge(role);
  if(!(bytes instanceof Uint8Array)||bytes.length<1||bytes.length>cap||total+bytes.length>byteCap)throw Error('byte_cap');
  await writeFile(file,bytes,{flag:'wx',mode:0o600,signal:control.signal});control.check?.();return adopt(name,cap,role,control);
 }
 async function json(name,value,cap,role,control={}) {control.check?.();if(artifactCharge(role)!=='numeric')throw Error('artifact_role');const raw=Buffer.from(JSON.stringify(value)+'\n');if(raw.length>8388608)throw Error('byte_cap');return write(name,name.endsWith('.gz')?gzipSync(raw):raw,cap,role,control);}
 async function seal() {
  const names=await readdir(directory);
  if(names.length!==entries.size||names.some(n=>!entries.has(n)))throw Error('unlisted_artifact');
  for(const e of entries.values()){const observed=await digest(e.name,e.bytes);if(observed.sha256!==e.sha256||observed.bytes!==e.bytes)throw Error('sha_mismatch');}
  return [...entries.values()];
 }
 function registerImplementationAssets(files){const unique=new Map(files.map(f=>[f.sha256+':'+f.bytes,f])),added=[...unique.values()].filter(f=>!implementationAssets.has(f.sha256+':'+f.bytes)),bytes=added.reduce((n,f)=>n+f.bytes,0);if(total+bytes>byteCap)throw Error('byte_cap');for(const f of added)implementationAssets.set(f.sha256+':'+f.bytes,{...f});total+=bytes;}
 return {path,write,json,adopt,seal,registerImplementationAssets,get implementationAssets(){return [...implementationAssets.values()];},get total(){return total;},get entries(){return [...entries.values()];}};
}

/** One invocation's complete budget, including numeric observations and later
 * result shards. The fixed failure reserve is INSIDE both original caps. */
export function createInvocationStore(store,invocation) {
 const aggregate=invocationAggregate(invocation.kind),reserve=65536,initial=new Set(store.entries.map(e=>e.name));let policy=LEGACY_POLICY,selection=null,selectedDependencies=null;
 const entries=()=>store.entries.filter(e=>!initial.has(e.name));
 let pendingBytes=0,pendingNumeric=0,pendingOperations=0,logicalBytes=0,negativeFinalization=false;
 const outerReservations=new Map(),resultWrites=new Set();
 const outerReserved=()=>[...outerReservations.values()].reduce((n,v)=>n+v,0);
 const dependencyUses=new Map(),physicalDependencies=new Set();
 const implementationAssets=new Map(),implementationUses=[];let implementationBytes=0;
 const total=()=>implementationBytes+logicalBytes+entries().reduce((n,e)=>n+e.bytes,0),numbers=()=>logicalBytes+entries().filter(e=>artifactCharge(e.role)==='numeric').reduce((n,e)=>n+e.bytes,0);
 const reserveWrite=(name,bytes,role)=>{
  const numeric=artifactCharge(role)==='numeric';
  if(negativeFinalization||!Number.isSafeInteger(bytes)||bytes<0||!name.startsWith(invocation.id+'-')||total()+pendingBytes+bytes+outerReserved()>aggregate-reserve||numeric&&numbers()+pendingNumeric+bytes+outerReserved()>policy.normal)throw Error('invocation_byte_cap');
  pendingBytes+=bytes;if(numeric)pendingNumeric+=bytes;
  return ()=>{pendingBytes-=bytes;if(numeric)pendingNumeric-=bytes;};
 };
 const path=name=>{if(!name.startsWith(invocation.id+'-'))throw Error('artifact_name');return store.path(name);};
 async function write(name,bytes,cap,role,control={}){control.check?.();pendingOperations++;let release;try{release=reserveWrite(name,bytes.length,role);return await store.write(name,bytes,Math.min(cap,bytes.length),role,control);}finally{release?.();pendingOperations--;}}
 async function json(name,value,cap,role,control={}){control.check?.();if(artifactCharge(role)!=='numeric')throw Error('artifact_role');const raw=Buffer.from(JSON.stringify(value)+'\n');if(raw.length>8388608)throw Error('invocation_byte_cap');return write(name,name.endsWith('.gz')?gzipSync(raw):raw,cap,role,control);}
 async function adopt(name,cap,role){
  pendingOperations++;let release;
  try{
   artifactCharge(role);const s=await lstat(path(name));release=reserveWrite(name,s.size,role);
   // The underlying digest must reject growth BEFORE inserting an entry.
   // Its maximum retained size is the reservation, even if producer cap is larger.
   return await store.adopt(name,Math.min(cap,s.size),role);
  }finally{release?.();pendingOperations--;}
 }
 async function writeFailure(name,journal,control={}) {
  control.check?.();
  if(!journal?.primary||!name.startsWith(invocation.id+'-'))throw Error('artifact_role');
  const raw=Buffer.from(JSON.stringify(journal)+'\n');
  // 8192 primary + 2048 secondary journal + 12 JSON/newline bytes.
  if(raw.length>10252||numbers()+pendingNumeric+raw.length>policy.final||total()+pendingBytes+raw.length>aggregate)throw Error('invocation_byte_cap');
  negativeFinalization=true;pendingOperations++;pendingBytes+=raw.length;pendingNumeric+=raw.length;
  try{return await store.write(name,raw,raw.length,'native',control);}finally{pendingOperations--;pendingBytes-=raw.length;pendingNumeric-=raw.length;}
 }
 async function writeNegative(name,bytes,cap,role,control={}){control.check?.();if(!negativeFinalization||artifactCharge(role)!=='numeric'||bytes.length<1||bytes.length>cap||!name.startsWith(invocation.id+'-')||numbers()+pendingNumeric+bytes.length>policy.final||total()+pendingBytes+bytes.length>aggregate)throw Error('invocation_byte_cap');pendingOperations++;pendingNumeric+=bytes.length;pendingBytes+=bytes.length;try{return await store.write(name,bytes,cap,role,control);}finally{pendingOperations--;pendingNumeric-=bytes.length;pendingBytes-=bytes.length;}}
 function useRuntimeDependency(entry,recordKey,artifactId=entry.name) {
  if(typeof artifactId!=='string'||!artifactId||typeof recordKey!=='string'||!recordKey.startsWith(invocation.id+'-')||!entries().some(e=>e===entry)||entry.role!=='runtimeBinding')throw Error('artifact_role');
  const physical=entry.sha256+':'+entry.bytes,key=artifactId+':'+physical,uses=dependencyUses.get(key)??new Set();
  if(uses.has(recordKey))return;
  if(physicalDependencies.has(physical)){const release=reserveWrite(recordKey,entry.bytes,'runtimeBinding');logicalBytes+=entry.bytes;release();}
  uses.add(recordKey);dependencyUses.set(key,uses);physicalDependencies.add(physical);
 }
 function checkFinal(shards){const size=shards.reduce((n,b)=>n+b.length,0),numericCap=negativeFinalization?policy.final:policy.normal,artifactCap=negativeFinalization?aggregate:aggregate-reserve,pending=negativeFinalization?0:outerReserved();if(pendingOperations||numbers()+size+pending>numericCap||total()+size+pending>artifactCap)throw Error('invocation_byte_cap');return {numericBytes:numbers()+size,artifactBytes:total()+size,numericCap,artifactCap:aggregate,failureReserveBytes:reserve};}
 function reserveProgramOuter(recordKey,bytes){const limits=programResultLimits(selectedDependencies,invocation);if(!Number.isSafeInteger(bytes)||bytes<=0||bytes>limits.reservation||selectedDependencies&&bytes!==selectedDependencies.plans.outerReserveBytes||outerReservations.has(recordKey)||!recordKey.startsWith(invocation.id+'-')||limits.result>196608&&recordKey!==invocation.id+'-program')throw Error('invocation_byte_cap');const release=reserveWrite(recordKey,bytes,'runtimeBinding');outerReservations.set(recordKey,bytes);release();}
 async function writeProgramOuter(recordKey,name,bytes,control={}){
  control.check?.();const reserved=outerReservations.get(recordKey),limits=programResultLimits(selectedDependencies,invocation);
  if(!isProgramResultReference({name,role:'observation'},recordKey,invocation)||resultWrites.has(recordKey)||!Number.isSafeInteger(reserved)||!(bytes instanceof Uint8Array)||bytes.length<1||bytes.length>limits.result||bytes.length>reserved||bytes.at(-1)!==10)throw Error('invocation_byte_cap');
  // An exact filename cannot relabel a runtime original as a result. Require
  // its owned replay manifest and coded original before allowing retention.
  const value=JSON.parse(Buffer.from(bytes).toString()),ref=value?.programProof?.replayRef,manifest=entries().find(e=>e.name===recordKey+'-program-originals.json'),coded=entries().find(e=>e.name===recordKey+'.ts');
  if(!manifest||!coded||ref?.name!==manifest.name||ref.role!=='observation'||ref.bytes!==manifest.bytes||ref.sha256!==manifest.sha256||value.record?.recordingSha256!==coded.sha256||entries().some(e=>e.role==='runtimeBinding'&&e.bytes===bytes.length&&e.sha256===createHash('sha256').update(bytes).digest('hex')))throw Error('artifact_role');
  resultWrites.add(recordKey);outerReservations.set(recordKey,reserved-bytes.length);
  try{return await write(name,bytes,limits.result,'observation',control);}catch(error){outerReservations.set(recordKey,reserved);resultWrites.delete(recordKey);throw error;}
 }
 function checkProgramOuterFinal(recordKey,bytes){const reserved=outerReservations.get(recordKey);if(negativeFinalization||!Number.isSafeInteger(bytes)||bytes<0||bytes>programResultLimits(selectedDependencies,invocation).other||!Number.isSafeInteger(reserved)||bytes>reserved||pendingOperations||numbers()+outerReserved()>policy.normal||total()+outerReserved()>aggregate-reserve)throw Error('invocation_byte_cap');}
 function selectNativePolicy(binding){const deps=inspectAcquiredDependencies(binding);if(!deps||negativeFinalization||pendingOperations)throw Error('invocation_policy');const chosen=deriveEvidencePolicy(deps,invocation),identity=JSON.stringify([binding.candidateSHA,binding.profileSHA,chosen.id,invocation.id,invocation.kind]);if(selection&&selection!==identity||!selection&&numbers()+pendingNumeric>196608)throw Error('invocation_policy');policy=chosen;selection=identity;selectedDependencies=deps;return chosen;}
 function registerImplementationAssets(files,recordKey,event){
  if(!recordKey.startsWith(invocation.id+'-')||!['encode','decode','prelude'].includes(event)||files.some(f=>f.kind!=='implementationCode'||!f.loaded||!Number.isSafeInteger(f.bytes)||f.bytes<=0||f.bytes>196608))throw Error('artifact_role');
  const unique=new Map(files.map(f=>[f.sha256+':'+f.bytes,f]));if(unique.size!==files.length||implementationUses.some(u=>u.recordKey===recordKey&&u.event===event))throw Error('artifact_role');
  const added=files.filter(f=>!implementationAssets.has(f.sha256+':'+f.bytes)),bytes=added.reduce((n,f)=>n+f.bytes,0);if(total()+pendingBytes+outerReserved()+bytes>aggregate-reserve)throw Error('invocation_byte_cap');store.registerImplementationAssets(added);for(const f of added)implementationAssets.set(f.sha256+':'+f.bytes,{path:f.path,bytes:f.bytes,sha256:f.sha256});implementationBytes+=bytes;const keys=[...implementationAssets.keys()],use={recordKey,event,assetIndices:files.map(f=>keys.indexOf(f.sha256+':'+f.bytes))};implementationUses.push(use);return {kind:'implementationCode-v1',bytes:files.reduce((n,f)=>n+f.bytes,0),invocation:invocation.id,recordKey,event};
 }
 function programBudget(recordKey){const assets=[...implementationAssets.values()];return {policyId:policy.id,invocation:{id:invocation.id,kind:invocation.kind},normalNumericCap:policy.normal,finalNumericCap:policy.final,failureReserve:65536,artifactCap:aggregate,numericBytes:numbers(),artifactBytes:total(),implementationBytes,implementationAssets:assets.map((_,i)=>i),implementationSetSHA:createHash('sha256').update(JSON.stringify(assets)).digest('hex'),implementationUses:[...implementationUses],reservedOuterBytes:outerReservations.get(recordKey)??0,useEncoding:'original-tuples-v1',uses:entries().map(e=>[e.role,e.name,e.bytes,e.sha256]),dependencyUses:[...dependencyUses].map(([id,uses])=>({id,recordings:[...uses]}))};}
 return {path,write,json,adopt,writeFailure,writeNegative,useRuntimeDependency,selectNativePolicy,checkFinal,reserveProgramOuter,writeProgramOuter,checkProgramOuterFinal,programBudget,registerImplementationAssets,get remainingBytes(){return Math.max(0,aggregate-reserve-total()-pendingBytes-outerReserved());},get remainingNumericBytes(){return Math.max(0,policy.normal-numbers()-pendingNumeric-outerReserved());},get total(){return total();},get artifactBytes(){return total();},get numericBytes(){return numbers();},get entries(){return entries();}};
}
