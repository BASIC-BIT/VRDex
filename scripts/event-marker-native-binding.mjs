import { open,lstat } from 'node:fs/promises';
import { constants } from 'node:fs';
import { createHash } from 'node:crypto';
import { validateProgramDependencies } from './event-marker-program-guards.mjs';
import { validateImplementationCatalog,verifyImplementationSource } from './event-marker-implementation-assets.mjs';
const ROOT='/app/workers/restream/native-binding/runtime',CONTEXT='/run/vrdex-native/context.json';
const sha=b=>createHash('sha256').update(b).digest('hex');
const fail=reason=>{throw Error('marker_binding_'+reason);};
const overflow=(bytes,cap)=>Object.assign(Error('marker_binding_bound'),{
 bindingOverflow:{prefix:Buffer.from(bytes.subarray(0,cap)),observedBytesAtLeast:bytes.length,producerCap:cap},
});
const hash=x=>typeof x==='string'&&/^[0-9a-f]{64}$/.test(x);
const freeze=x=>{if(x&&typeof x==='object'){Object.values(x).forEach(freeze);Object.freeze(x);}return x;};
const parse=bytes=>{try{return JSON.parse(new TextDecoder('utf-8',{fatal:true}).decode(bytes));}catch{fail('json');}};
const acquired=new WeakMap();
export function inspectAcquiredDependencies(value) {return acquired.get(value);}
export function expandImplementationObservations(rows,closure) {const loaded=validateImplementationCatalog(closure);if(!Array.isArray(rows)||rows.length!==loaded.length)fail('implementation_observations');return rows.map((r,i)=>{if(!Array.isArray(r)||r.length!==9||r[0]!==i||r[8]!==1)fail('implementation_observations');return {event:i,path:loaded[i].path,kind:loaded[i].kind,bytes:r[1],sha256:r[2],identity:{path:'/app/'+loaded[i].path,regular:true,symlink:false,bytes:r[1],dev:r[3],ino:r[4],nlink:r[5],mtimeMs:r[6],ctimeMs:r[7],eof:true}};});}
/** A single monotonic deadline covers acquisition and the owned child. Every
 * awaited pre-spawn operation races cancellation; late results have no authority
 * to start another read, retention write, or child. */
export function createAcquisitionDeadline(timeoutMs) {
 const deadline=performance.now()+timeoutMs,controller=new AbortController(),{signal}=controller;
 const expire=()=>{if(!signal.aborted)controller.abort(Error('timeout'));};
 const timer=setTimeout(expire,Math.max(0,timeoutMs));
 const check=()=>{if(performance.now()>=deadline)expire();signal.throwIfAborted();};
 async function run(operation) {
  check();let onAbort;
  const cancelled=new Promise((_,reject)=>{onAbort=()=>reject(signal.reason);signal.addEventListener('abort',onAbort,{once:true});});
  try {const result=await Promise.race([Promise.resolve().then(()=>{check();return operation();}),cancelled]);check();return result;}
  finally {signal.removeEventListener('abort',onAbort);}
 }
 return {deadline,signal,check,run,dispose(){clearTimeout(timer);}};
}
export async function readBounded(path,cap,{signal,check=()=>signal?.throwIfAborted(),fileSystem={open,lstat}}={}) {
 // Reject special files before open. O_NONBLOCK also closes the replacement
 // race with a FIFO; O_NOFOLLOW prevents a final-component symlink race.
 let current='',expected;const components=path.split('/').filter(Boolean);
 for(const [index,part] of components.entries()) {
  check();current+='/'+part;const stat=await fileSystem.lstat(current);check();
  if(stat.isSymbolicLink())fail('symlink');
  if(index===components.length-1){if(!stat.isFile()||stat.size>cap)fail('file');expected=stat;}
  else if(!stat.isDirectory())fail('file');
 }
 check();const file=await fileSystem.open(path,constants.O_RDONLY|constants.O_NONBLOCK|constants.O_NOFOLLOW);
 try {
  check();const before=await file.stat();check();
  if(!before.isFile()||before.size>cap||before.dev!==expected.dev||before.ino!==expected.ino)fail('file');
  const parts=[];let count=0;
  for(;;){check();const buffer=Buffer.alloc(Math.min(65536,cap-count+1)),{bytesRead}=await file.read(buffer);check();if(!bytesRead)break;count+=bytesRead;if(count>cap)throw overflow(Buffer.concat([...parts,buffer.subarray(0,bytesRead)]),cap);parts.push(buffer.subarray(0,bytesRead));}
  const after=await file.stat();check();const raw=Buffer.concat(parts);
  if(before.dev!==after.dev||before.ino!==after.ino||before.size!==after.size||count!==after.size||before.mtimeMs!==after.mtimeMs||before.ctimeMs!==after.ctimeMs)throw Object.assign(Error('marker_binding_changed'),{bindingObservedOriginal:raw});
  raw.bindingIdentity={path,regular:true,symlink:false,dev:String(before.dev),ino:String(before.ino),bytes:count,nlink:before.nlink,mtimeMs:before.mtimeMs,ctimeMs:before.ctimeMs,eof:true};return raw;
 }finally{await file.close();}
}
/** R76 finite dependency acquisition, not a completed positive native binder.
 * Actual profile/guard interpretation and mapped-object/source closure remain
 * explicit obligations. No empty catalog, copied boolean or source hash alone
 * can turn these acquired bytes into an accepted runtime/clock certificate. */
export async function openNativeBindingDependencies({environment=process.env,read=readBounded,signal,deadline,check=()=>signal?.throwIfAborted(),run=operation=>operation(),registerImplementationAssets,runtimeIdentity=()=>({version:process.versions.node,execPath:process.execPath,execArgv:[...process.execArgv]})}={}) {
 check();
 const file=environment.VRDEX_NATIVE_BINDING_CONTEXT,b64=environment.VRDEX_NATIVE_BINDING_CONTEXT_B64;
 if(file&&b64)fail('transport');if(!file&&!b64)return freeze({kind:'Unproven',missing:['binding_context'],artifacts:[]});
 if(Object.keys(environment).some(k=>/^(?:LD_|DYLD_)/.test(k)||['FFREPORT','AV_LOG_FORCE_COLOR','NODE_OPTIONS','NODE_PATH'].includes(k)))fail('environment');
 const artifacts=[];let retained=0;
 try {
 const retain=(id,bytes)=>{check();retained+=bytes.length;if(retained>196608)fail('bound');const item={id,kind:'runtime',bytes:bytes.length,sha256:sha(bytes),data:bytes.toString('base64'),complete:true,...(bytes.length===0?{emptyOriginal:true}:{})};artifacts.push(item);return item;};
 const get=async(path,cap)=>{let bytes;try{bytes=await run(()=>read(path,cap,{signal,deadline,check}));check();}catch(error){if(error.code==='ENOENT'){error.bindingMissing=path;}throw error;}if(!(bytes instanceof Uint8Array))fail('bound');if(bytes.length>cap)throw overflow(bytes,cap);return Buffer.from(bytes);};
 let contextBytes;
 if(file){if(file!==CONTEXT)fail('transport');contextBytes=await get(CONTEXT,4096);}
 else {if(typeof b64!=='string'||b64.length>5464)fail('transport');contextBytes=Buffer.from(b64,'base64');if(contextBytes.length>4096||contextBytes.toString('base64')!==b64)fail('transport');}
 const contextRef=retain('context',contextBytes),context=parse(contextBytes);
 if(context.schema!=='native-context-v1'||Object.keys(context).sort().join(',')!=='intent,schema'||typeof context.intent?.utf8!=='string')fail('context');
 const intentBytes=Buffer.from(context.intent.utf8);if(intentBytes.length!==context.intent.bytes||sha(intentBytes)!==context.intent.sha256)fail('intent');
 const intentRef=retain('intent',intentBytes),intent=parse(intentBytes);
 if(intent.schema!=='native-intent-v1'||!['candidateManifestSHA','profileSHA','runtimeManifestSHA','observerClosureSHA'].every(k=>hash(intent[k]))||typeof intent.nonce!=='string'||!intent.nonce||Buffer.byteLength(intent.nonce)>128||!Number.isFinite(intent.deadline))fail('intent');
 if(Object.keys(intent).some(k=>!['schema','nonce','candidateManifestSHA','candidateManifestBytes','profileSHA','runtimeManifestSHA','observerClosureSHA','imageFacts','workload','semanticEnvironment','transport','deadline','execution'].includes(k)))fail('cycle');
 if(!intent.semanticEnvironment||typeof intent.semanticEnvironment!=='object'||Array.isArray(intent.semanticEnvironment)||Object.hasOwn(intent.semanticEnvironment,'VRDEX_NATIVE_BINDING_CONTEXT')||Object.hasOwn(intent.semanticEnvironment,'VRDEX_NATIVE_BINDING_CONTEXT_B64'))fail('environment');
 for(const [name,value] of Object.entries(intent.semanticEnvironment))if(typeof value!=='string'||environment[name]!==value)fail('environment');
 if(file?(intent.transport?.kind!=='file'||intent.transport.name!=='VRDEX_NATIVE_BINDING_CONTEXT'||intent.transport.path!==file):(intent.transport?.kind!=='base64'||intent.transport.name!=='VRDEX_NATIVE_BINDING_CONTEXT_B64'||Object.hasOwn(intent.transport,'path')))fail('transport');
 if(!intent.workload||!Array.isArray(intent.workload.originalCommand)||intent.workload.originalCommand.some(v=>typeof v!=='string')||!hash(intent.imageFacts?.configSHA)||!Number.isSafeInteger(intent.imageFacts.configBytes)||intent.imageFacts.configBytes<=0||!hash(intent.imageFacts.diffIdsSHA)||typeof intent.imageFacts.outerImageEvidenceId!=='string')fail('intent');
 const authenticate=(item,expected,reason)=>{
  item.expectedRuntimeRef={...expected};
  if(item.bytes===0||item.sha256!==expected.sha256||(expected.bytes!==undefined&&item.bytes!==expected.bytes)){
   item.kind='observation';item.authentication={state:'failed',reason:'marker_binding_'+reason};fail(reason);
  }
  item.authentication={state:'matched'};
 };
 const acquire=async(id,path,cap,expected,reason)=>{
  let raw;
  try{raw=await get(path,cap);}catch(error){
   if(error.bindingOverflow){
    const {prefix,observedBytesAtLeast,producerCap}=error.bindingOverflow,item=retain(id,prefix);
    Object.assign(item,{kind:'observation',complete:false,observedBytesAtLeast,producerCap,expectedRuntimeRef:{...expected},authentication:{state:'failed',reason:error.message}});
    delete item.emptyOriginal;
    delete error.bindingOverflow;
   }
   throw error;
  }
  const item=retain(id,raw);authenticate(item,expected,reason);return raw;
 };
 const manifestBytes=await acquire('runtime-manifest',ROOT+'/manifest.json',65536,{kind:'runtime',id:'runtime-manifest',sha256:intent.runtimeManifestSHA},'manifest_hash');
 const manifest=parse(manifestBytes),entries=new Map(),paths=new Set(),objects=new Map();
 if(manifest.schema!=='native-runtime-deps-v1'||!Array.isArray(manifest.entries)||!manifest.entries.length||manifest.entries.length>256)fail('manifest');
 for(const entry of manifest.entries) {
  if(typeof entry.id!=='string'||!entry.id||entries.has(entry.id)||['context','intent','runtime-manifest'].includes(entry.id)||!hash(entry.sha256)||!Number.isSafeInteger(entry.bytes)||entry.bytes<=0||entry.bytes>196608||typeof entry.relativePath!=='string'||!entry.relativePath.split('/').every(p=>p&&p!=='.'&&p!=='..'&&/^[a-zA-Z0-9_.-]+$/.test(p))||paths.has(entry.relativePath)||!Array.isArray(entry.dependsOn))fail('dependency');
  entries.set(entry.id,entry);paths.add(entry.relativePath);
 }
 const visiting=new Set(),visited=new Set();
 function walk(id) {
  if(visited.has(id))return;if(visiting.has(id))fail('cycle');const entry=entries.get(id);if(!entry)fail('dependency');visiting.add(id);
  for(const ref of entry.dependsOn) {
   if(!['runtime','audit'].includes(ref.kind)||typeof ref.id!=='string'||!ref.id||!hash(ref.sha256)||!Number.isSafeInteger(ref.bytes)||ref.bytes<0)fail('dependency_kind');
   if(ref.range&&(!Number.isSafeInteger(ref.range.start)||!Number.isSafeInteger(ref.range.length)||ref.range.start<0||ref.range.length<0||!Number.isSafeInteger(ref.range.start+ref.range.length)||ref.range.start+ref.range.length>ref.bytes))fail('range');
   if(ref.kind==='runtime'){const target=entries.get(ref.id);if(!target||ref.sha256!==target.sha256||ref.bytes!==target.bytes)fail('dependency');walk(ref.id);}
  }visiting.delete(id);visited.add(id);
 }
 for(const entry of entries.values())walk(entry.id);
 for(const key of ['profile','proofDescriptions','verifierClosure','plans'])if(!entries.has(manifest.entrypoints?.[key]))fail('entrypoint');
 if(entries.get(manifest.entrypoints.profile).bytes>65536)fail('bound');
 for(const entry of entries.values()) {
  // Expected length is an authentication operand, not the observation cap.
  // Complete mismatched originals may use only the unchanged remaining budget.
  const cap=Math.min(entry.id===manifest.entrypoints.profile?65536:196608,196608-retained);
  const raw=await acquire(entry.id,ROOT+'/'+entry.relativePath,cap,{kind:'runtime',id:entry.id,sha256:entry.sha256,bytes:entry.bytes},'dependency_hash');
  if(Object.values(manifest.entrypoints).includes(entry.id))objects.set(entry.id,parse(raw));
 }
 if(entries.get(manifest.entrypoints.profile).sha256!==intent.profileSHA||entries.get(manifest.entrypoints.verifierClosure).sha256!==intent.observerClosureSHA)fail('projection');
 const profile=objects.get(manifest.entrypoints.profile),proof=objects.get(manifest.entrypoints.proofDescriptions),missing=[];
 const projection={contextSHA:contextRef.sha256,intentSHA:intentRef.sha256,candidateSHA:intent.candidateManifestSHA,profileSHA:intent.profileSHA,manifestSHA:intent.runtimeManifestSHA,observerClosureSHA:intent.observerClosureSHA,nonce:intent.nonce};
 if(profile.assuranceBasis==='trustedStackMeasurement') {
  if(!Number.isSafeInteger(intent.candidateManifestBytes)||intent.candidateManifestBytes<=0||intent.candidateManifestBytes>196608)fail('candidate_reference');
  const descriptions=validateProgramDependencies({profile,proof,closure:objects.get(manifest.entrypoints.verifierClosure),plans:objects.get(manifest.entrypoints.plans),nativeCatalog:objects.get(manifest.entrypoints.nativeCatalog),manifest,intent});
  const nodeRuntime=await run(()=>runtimeIdentity());if(JSON.stringify(nodeRuntime)!==JSON.stringify(descriptions.profile.platform.node))fail('node_platform');
  const loaded=validateImplementationCatalog(descriptions.closure),code=loaded.filter(f=>f.kind==='implementationCode'),implementation=[];
  if(typeof registerImplementationAssets!=='function')fail('implementation_reservation');
  const reservation=await run(()=>registerImplementationAssets(code));check();
  if(reservation?.kind!=='implementationCode-v1'||reservation.bytes!==code.reduce((n,f)=>n+f.bytes,0))fail('implementation_reservation');
  for(const [event,item] of loaded.entries()) {
   let raw;
   try {
    raw=await run(()=>read('/app/'+item.path,196608,{signal,deadline,check}));check();
    if(!(raw instanceof Uint8Array)||raw.length>196608)throw raw instanceof Uint8Array?overflow(raw,196608):Error('marker_binding_bound');
    const identity=raw.bindingIdentity;
    if(!identity||identity.path!=='/app/'+item.path||identity.regular!==true||identity.symlink!==false||identity.eof!==true||identity.bytes!==raw.length||!Number.isSafeInteger(identity.nlink)||identity.nlink<1||typeof identity.dev!=='string'||typeof identity.ino!=='string'||!Number.isFinite(identity.mtimeMs)||!Number.isFinite(identity.ctimeMs))fail('implementation_identity');
    verifyImplementationSource(item,raw,descriptions.closure);
    if(item.kind==='runtimeData')retain('loaded-data:'+item.path,Buffer.from(raw));
    implementation.push([event,raw.length,sha(raw),identity.dev,identity.ino,identity.nlink,identity.mtimeMs,identity.ctimeMs,1]);
   }catch(error){
    const observed=error.bindingObservedOriginal??error.bindingOverflow?.prefix??raw;
    if(observed instanceof Uint8Array){const cap=Math.max(0,196608-retained),prefix=Buffer.from(observed.subarray(0,cap)),itemRef=retain('failed-source:'+item.path,prefix);Object.assign(itemRef,{kind:'observation',complete:prefix.length===observed.length&&!error.bindingOverflow,observedBytesAtLeast:error.bindingOverflow?.observedBytesAtLeast??observed.length,expectedRuntimeRef:{kind:item.kind,id:item.path,sha256:item.sha256,bytes:item.bytes},authentication:{state:'failed',reason:error.message}});}
    throw error;
   }
  }
  const result=freeze({kind:'AcquiredDependencies',...projection,nodeRuntime,assurance:{kind:'trustedStackMeasurement',candidateRef:{kind:'audit',id:'candidate',sha256:intent.candidateManifestSHA,bytes:intent.candidateManifestBytes},profileRef:{kind:'runtime',id:manifest.entrypoints.profile,sha256:intent.profileSHA,bytes:entries.get(manifest.entrypoints.profile).bytes},contextRef:{kind:'observation',id:'context',sha256:contextRef.sha256,bytes:contextRef.bytes},runRef:{kind:'observation',id:intent.nonce,sha256:intentRef.sha256,bytes:intentRef.bytes},guardsRef:descriptions.guardsRef,platformAssumptionsRef:profile.platformAssumptionsRef,pendingOuterJoin:true,nativeBindingVerified:false,loaderComplete:false},implementation,reservation,artifacts});
  acquired.set(result,freeze({...descriptions,intent,projection}));return result;
 }
 if(!Array.isArray(profile.objects)||!profile.objects.length)missing.push('native_profile');
 if(!Array.isArray(proof.descriptions)||!proof.descriptions.length)missing.push('source_guard_descriptions');
 // This source slice acquires these inputs; the separately reviewed positive
 // guard evaluator must consume exact catalog descriptions and actual objects.
 missing.push('native_object_and_guard_validation','mapped_object_identity','source_loader_closure','outer_candidate_approval_join');
 return freeze({kind:'Unproven',missing,...projection,artifacts});
 }catch(error){if(error.code==='ENOENT')return freeze({kind:'Unproven',missing:['runtime_input'],missingPath:error.bindingMissing,artifacts});error.bindingArtifacts=freeze(artifacts);throw error;}
}
