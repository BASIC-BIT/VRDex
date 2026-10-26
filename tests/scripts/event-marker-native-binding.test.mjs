import test from 'node:test';
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { mkdtemp,rm,readFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { constants } from 'node:fs';
import { createArtifactStore,createInvocationStore } from '../../scripts/marker-qualification/artifacts.mjs';
import { startCapturedInvocation } from '../../scripts/marker-qualification/invocation-capture.mjs';
import { openNativeBindingDependencies,readBounded,createAcquisitionDeadline } from '../../scripts/event-marker-native-binding.mjs';
const sha=b=>createHash('sha256').update(b).digest('hex'),bytes=x=>Buffer.from(JSON.stringify(x));
function fixture() {
 const profile=bytes({schema:'native-profile-v1',objects:[]}),proof=bytes({schema:'native-proof-descriptions-v1',descriptions:[]}),closure=bytes({schema:'native-verifier-closure-v1',files:[]}),plans=bytes({schema:'native-plans-v1',plans:[]}),files=new Map(),entries=[];
 for(const [id,data] of [['profile',profile],['proof',proof],['closure',closure],['plans',plans]]){files.set('/app/workers/restream/native-binding/runtime/'+id+'.json',data);entries.push({id,sha256:sha(data),bytes:data.length,relativePath:id+'.json',mediaType:'application/json',dependsOn:[]});}
 const manifest=bytes({schema:'native-runtime-deps-v1',entries,entrypoints:{profile:'profile',proofDescriptions:'proof',verifierClosure:'closure',plans:'plans'}});files.set('/app/workers/restream/native-binding/runtime/manifest.json',manifest);
 const intent=bytes({schema:'native-intent-v1',nonce:'fixture',candidateManifestSHA:'a'.repeat(64),profileSHA:sha(profile),runtimeManifestSHA:sha(manifest),observerClosureSHA:sha(closure),imageFacts:{kind:'localUnpublishedImage',configSHA:'b'.repeat(64),configBytes:100,localImageId:'sha256:'+'b'.repeat(64),diffIdsSHA:'c'.repeat(64),outerImageEvidenceId:'image'},workload:{originalCommand:['node','fixture'],containerName:'owned',allocation:{}},semanticEnvironment:{PATH:'/usr/bin'},transport:{kind:'file',name:'VRDEX_NATIVE_BINDING_CONTEXT',path:'/run/vrdex-native/context.json'},deadline:12345});
 const context=bytes({schema:'native-context-v1',intent:{utf8:intent.toString(),bytes:intent.length,sha256:sha(intent)}});files.set('/run/vrdex-native/context.json',context);
 return {files,environment:{PATH:'/usr/bin',VRDEX_NATIVE_BINDING_CONTEXT:'/run/vrdex-native/context.json'},read:async path=>files.get(path)};
}
test('binding dependency acquisition validates exact embedded intent and finite packaged bytes but cannot certify an empty profile',async()=>{
 const f=fixture(),observed=await openNativeBindingDependencies({environment:f.environment,read:f.read});
 assert.equal(observed.kind,'Unproven');assert(observed.missing.includes('native_profile'));assert.equal(observed.contextSHA,sha(f.files.get('/run/vrdex-native/context.json')));assert.equal(observed.artifacts.length,7);assert(!Object.hasOwn(observed,'verified'));assert(!Object.hasOwn(observed,'ClockCompatible'));
 assert.equal((await openNativeBindingDependencies({environment:{}})).kind,'Unproven');
});
test('binding acquisition rejects changed transport bytes dependencies environment and path escapes',async()=>{
 for(const mutate of [f=>{f.environment.VRDEX_NATIVE_BINDING_CONTEXT_B64='e30=';},f=>{f.environment.PATH='/changed';},f=>{f.environment.LD_PRELOAD='injected.so';},f=>{f.files.set('/app/workers/restream/native-binding/runtime/profile.json',Buffer.from('{}'));}]) {
  const f=fixture();mutate(f);await assert.rejects(openNativeBindingDependencies({environment:f.environment,read:f.read}),/marker_binding_/);
 }
 const f=fixture();const c=JSON.parse(f.files.get('/run/vrdex-native/context.json'));c.intent.utf8+=' ';f.files.set('/run/vrdex-native/context.json',bytes(c));await assert.rejects(openNativeBindingDependencies({environment:f.environment,read:f.read}),/marker_binding_/);
});

function amendManifest(f,change) {
 const path='/app/workers/restream/native-binding/runtime/manifest.json',manifest=JSON.parse(f.files.get(path));change(manifest);const raw=bytes(manifest);f.files.set(path,raw);
 const context=JSON.parse(f.files.get('/run/vrdex-native/context.json')),intent=JSON.parse(context.intent.utf8);intent.runtimeManifestSHA=sha(raw);const original=bytes(intent);context.intent={utf8:original.toString(),bytes:original.length,sha256:sha(original)};f.files.set('/run/vrdex-native/context.json',bytes(context));
}
test('binding acquisition rejects literal path escapes runtime cycles and out-of-range refs before any native spawn',async()=>{
 for(const change of [m=>m.entries[0].relativePath='../profile.json',m=>m.entries[0].relativePath='/profile.json',m=>{const e=m.entries[0];e.dependsOn=[{kind:'runtime',id:e.id,sha256:e.sha256,bytes:e.bytes}];},m=>{const e=m.entries[1];m.entries[0].dependsOn=[{kind:'runtime',id:e.id,sha256:e.sha256,bytes:e.bytes,range:{start:e.bytes,length:1}}];}]) {
  const f=fixture();amendManifest(f,change);await assert.rejects(openNativeBindingDependencies({environment:f.environment,read:f.read}),/marker_binding_/);
 }
 const f=fixture();amendManifest(f,m=>m.entries[0].dependsOn=[{kind:'audit',id:'signed-source',sha256:'d'.repeat(64),bytes:2000000,range:{start:0,length:5}}]);assert.equal((await openNativeBindingDependencies({environment:f.environment,read:f.read})).kind,'Unproven');
 const absent=fixture();const result=await openNativeBindingDependencies({environment:absent.environment,read:async path=>{if(path.endsWith('profile.json')){const error=Error('absent');error.code='ENOENT';throw error;}return absent.files.get(path);}});assert.equal(result.kind,'Unproven');assert(result.missing.includes('runtime_input'));assert.equal(result.artifacts.length,3);
});

for(const variant of ['manifest-sha','dependency-sha','dependency-short','dependency-long'])test(`binding mismatch retains observed original and failed expected identity: ${variant}`,async()=>{
 const f=fixture(),manifest=variant==='manifest-sha',path='/app/workers/restream/native-binding/runtime/'+(manifest?'manifest':'profile')+'.json',expected=f.files.get(path);
 const observed=manifest?Buffer.from('complete unexpected manifest bytes'):variant==='dependency-sha'?Buffer.alloc(expected.length,32):variant==='dependency-short'?Buffer.from('{}'):Buffer.concat([expected,Buffer.from(' ')]);
 f.files.set(path,observed);
 await assert.rejects(openNativeBindingDependencies({environment:f.environment,read:f.read}),error=>{
  assert.equal(error.message,manifest?'marker_binding_manifest_hash':'marker_binding_dependency_hash');
  const artifact=error.bindingArtifacts.find(a=>a.id===(manifest?'runtime-manifest':'profile'));
  assert(artifact);assert.equal(artifact.kind,'observation');assert.equal(artifact.sha256,sha(observed));assert.equal(artifact.bytes,observed.length);assert.deepEqual(Buffer.from(artifact.data,'base64'),observed);
  assert.equal(artifact.expectedRuntimeRef.sha256,sha(expected));assert.equal(artifact.authentication.state,'failed');return true;
 });
});

for(const variant of ['manifest-sha','dependency-sha','dependency-short','dependency-long'])test(`capture negative path retains complete mismatched bytes and authentication catalog: ${variant}`,async()=>{
 const f=fixture(),manifest=variant==='manifest-sha',path='/app/workers/restream/native-binding/runtime/'+(manifest?'manifest':'profile')+'.json',expected=f.files.get(path);
 const observed=manifest?Buffer.from('complete unexpected manifest bytes'):variant==='dependency-sha'?Buffer.alloc(expected.length,32):variant==='dependency-short'?Buffer.from('{}'):Buffer.concat([expected,Buffer.from(' ')]);f.files.set(path,observed);
 const directory=await mkdtemp(join(tmpdir(),'marker-mismatch-')),store=createInvocationStore(createArtifactStore(directory),{id:'fake',kind:'mass'});let starts=0;
 try{
  await assert.rejects(startCapturedInvocation({start(){starts++;throw Error('unexpected spawn');}},{original:['-loglevel','error'],stdio:['ignore','ignore','pipe'],channels:{},stderrCap:65536,timeoutMs:1000,store,prefix:'fake-mismatch',dependencies:control=>openNativeBindingDependencies({...f,...control})}),error=>error.message===(manifest?'marker_binding_manifest_hash':'marker_binding_dependency_hash'));
  assert.equal(starts,0);const entry=store.entries.find(e=>e.sha256===sha(observed));assert(entry);assert.deepEqual(await readFile(store.path(entry.name)),observed);
  const catalog=JSON.parse(await readFile(store.path('fake-mismatch-binding-failed.json'))),ref=catalog.artifacts.find(a=>a.id===(manifest?'runtime-manifest':'profile'));
  assert.equal(ref.kind,'observation');assert.equal(ref.bytes,observed.length);assert.equal(ref.sha256,sha(observed));assert.equal(ref.expectedRuntimeRef.sha256,sha(expected));assert.equal(ref.authentication.state,'failed');assert(store.numericBytes<196608);
 }finally{await rm(directory,{recursive:true,force:true});}
});
test('mismatch remains primary when negative retention fails',async()=>{
 const f=fixture();f.files.set('/app/workers/restream/native-binding/runtime/manifest.json',Buffer.from('bad manifest'));const secondary=Error('retention failure');let primary;
 const dependencies=async control=>{try{return await openNativeBindingDependencies({...f,...control});}catch(error){primary=error;throw error;}};
 await assert.rejects(startCapturedInvocation({start(){throw Error('unexpected spawn');}},{original:[],stdio:[],channels:{},stderrCap:65536,timeoutMs:1000,prefix:'fake-mismatch',store:{writeFailure:async()=>{throw secondary;}},dependencies}),error=>{assert.equal(error,primary);assert.equal(error.message,'marker_binding_manifest_hash');assert.equal(error.retentionError,secondary);assert.equal(error.bindingArtifacts.at(-1).authentication.state,'failed');return true;});
});
test('default binding reader rejects special files before open and closes a raced descriptor after cancellation',async()=>{
 let opens=0;
 const special={isSymbolicLink:()=>false,isFile:()=>false,isDirectory:()=>false};
 await assert.rejects(readBounded('/fifo',100,{fileSystem:{lstat:async()=>special,open:async()=>{opens++;throw Error('blocking open');}}}),/marker_binding_file/);assert.equal(opens,0);
 let release,closed=0,reads=0,flags;
 const regular={isSymbolicLink:()=>false,isFile:()=>true,size:1,dev:1,ino:2},control=createAcquisitionDeadline(10);
 try{
  const operation=control.run(()=>readBounded('/file',100,{...control,fileSystem:{lstat:async()=>regular,open:async(_path,value)=>{flags=value;return new Promise(r=>{release=r;});}}}));
  await assert.rejects(operation,/timeout/);release({stat:async()=>{reads++;return regular;},close:async()=>{closed++;}});await new Promise(r=>setImmediate(r));
  assert.equal(reads,0);assert.equal(closed,1);assert(flags&constants.O_NONBLOCK);assert(flags&constants.O_NOFOLLOW);
 }finally{control.dispose();}
});
test('late low-level dependency read observes cancellation before parsing or another read',async()=>{
 const f=fixture(),control=createAcquisitionDeadline(10);let release,reads=0,readControl;
 try{
  const pending=openNativeBindingDependencies({...f,...control,read:async(_path,_cap,options)=>{reads++;readControl=options;return new Promise(r=>{release=r;});}});
  await assert.rejects(pending,/timeout/);assert.equal(readControl.deadline,control.deadline);assert(readControl.signal.aborted);
  release(f.files.get('/run/vrdex-native/context.json'));await new Promise(r=>setImmediate(r));assert.equal(reads,1);
 }finally{control.dispose();}
});

for(const empty of ['manifest','dependency'])test(`complete empty ${empty} retains its observed identity and failed expected reference in the negative capture catalog`,async()=>{
 const f=fixture(),manifest=empty==='manifest',path='/app/workers/restream/native-binding/runtime/'+(manifest?'manifest':'profile')+'.json',expected=f.files.get(path);f.files.set(path,Buffer.alloc(0));
 const directory=await mkdtemp(join(tmpdir(),'marker-empty-')),store=createInvocationStore(createArtifactStore(directory),{id:'fake',kind:'mass'});let starts=0;
 try{
  await assert.rejects(startCapturedInvocation({start(){starts++;throw Error('unexpected spawn');}},{original:['-loglevel','error'],stdio:['ignore','ignore','pipe'],channels:{},stderrCap:65536,timeoutMs:1000,store,prefix:'fake-empty',dependencies:control=>openNativeBindingDependencies({...f,...control})}),error=>{
   assert.equal(error.message,manifest?'marker_binding_manifest_hash':'marker_binding_dependency_hash');const observed=error.bindingArtifacts.at(-1);
   assert.equal(observed.bytes,0);assert.equal(observed.sha256,sha(Buffer.alloc(0)));assert.equal(observed.data,'');assert.equal(observed.complete,true);assert.equal(observed.emptyOriginal,true);assert.equal(observed.kind,'observation');assert.equal(observed.expectedRuntimeRef.sha256,sha(expected));assert.equal(observed.authentication.state,'failed');return true;
  });
  assert.equal(starts,0);const catalog=JSON.parse(await readFile(store.path('fake-empty-binding-failed.json'))),observed=catalog.artifacts.at(-1);
  assert.equal(observed.id,manifest?'runtime-manifest':'profile');assert.equal(observed.bytes,0);assert.equal(observed.sha256,sha(Buffer.alloc(0)));assert.equal(observed.emptyOriginal,true);assert.equal(observed.authentication.state,'failed');assert.equal(store.entries.filter(e=>e.name.endsWith('.bin')).length,manifest?2:3);
 }finally{await rm(directory,{recursive:true,force:true});}
});
for(const size of [65536,65537])test(`profile observation honors its producer subcap for ${size} actual bytes`,async()=>{
 const f=fixture(),original=Buffer.alloc(size,32);let requestedCap;
 const directory=await mkdtemp(join(tmpdir(),'marker-profile-cap-')),store=createInvocationStore(createArtifactStore(directory),{id:'fake',kind:'mass'});
 try{
  await assert.rejects(startCapturedInvocation({start(){throw Error('unexpected spawn');}},{original:['-loglevel','error'],stdio:['ignore','ignore','pipe'],channels:{},stderrCap:65536,timeoutMs:1000,store,prefix:'fake-profile',dependencies:control=>openNativeBindingDependencies({...f,...control,read:async(path,cap)=>{if(path.endsWith('profile.json')){requestedCap=cap;return original;}return f.files.get(path);}})}),error=>{
   assert.equal(requestedCap,65536);assert.equal(error.message,size===65536?'marker_binding_dependency_hash':'marker_binding_bound');
   const observed=error.bindingArtifacts.find(a=>a.id==='profile');assert(observed);assert.equal(observed.bytes,65536);assert.equal(observed.complete,size===65536);assert.equal(observed.kind,'observation');assert.equal(observed.authentication.state,'failed');assert.deepEqual(Buffer.from(observed.data,'base64'),original.subarray(0,65536));
   if(size>65536){assert.equal(observed.producerCap,65536);assert.equal(observed.observedBytesAtLeast,65537);}return true;
  });
  const entry=store.entries.find(e=>e.bytes===65536);assert(entry);assert.deepEqual(await readFile(store.path(entry.name)),original.subarray(0,65536));assert(store.numericBytes<196608);
 }finally{await rm(directory,{recursive:true,force:true});}
});

test('an expected empty manifest hash cannot authenticate a successful runtime original',async()=>{
 const f=fixture(),context=JSON.parse(f.files.get('/run/vrdex-native/context.json')),intent=JSON.parse(context.intent.utf8);intent.runtimeManifestSHA=sha(Buffer.alloc(0));const original=bytes(intent);context.intent={utf8:original.toString(),bytes:original.length,sha256:sha(original)};f.files.set('/run/vrdex-native/context.json',bytes(context));f.files.set('/app/workers/restream/native-binding/runtime/manifest.json',Buffer.alloc(0));
 await assert.rejects(openNativeBindingDependencies(f),error=>{assert.equal(error.message,'marker_binding_manifest_hash');const observed=error.bindingArtifacts.at(-1);assert.equal(observed.sha256,observed.expectedRuntimeRef.sha256);assert.equal(observed.bytes,0);assert.equal(observed.complete,true);assert.equal(observed.authentication.state,'failed');assert.equal(observed.kind,'observation');return true;});
});
test('default bounded reader rejects oversized metadata before open and retains only the observed prefix on growth',async()=>{
 let opens=0,closes=0,reads=0;
 const regular=size=>({isSymbolicLink:()=>false,isFile:()=>true,size,dev:1,ino:2,mtimeMs:0});
 await assert.rejects(readBounded('/profile',65536,{fileSystem:{lstat:async()=>regular(65537),open:async()=>{opens++;throw Error('unexpected open');}}}),/marker_binding_file/);assert.equal(opens,0);
 await assert.rejects(readBounded('/profile',65536,{fileSystem:{lstat:async()=>regular(32),open:async()=>({stat:async()=>regular(32),read:async buffer=>{reads++;buffer.fill(32);return {bytesRead:buffer.length};},close:async()=>{closes++;}})}}),error=>{
  assert.equal(error.message,'marker_binding_bound');assert.equal(error.bindingOverflow.producerCap,65536);assert.equal(error.bindingOverflow.observedBytesAtLeast,65537);assert.equal(error.bindingOverflow.prefix.length,65536);assert.deepEqual(error.bindingOverflow.prefix,Buffer.alloc(65536,32));return true;
 });assert.equal(reads,2);assert.equal(closes,1);
});
