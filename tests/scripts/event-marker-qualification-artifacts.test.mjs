import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp,writeFile,symlink,rm } from 'node:fs/promises';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { createArtifactStore,createInvocationStore } from '../../scripts/marker-qualification/artifacts.mjs';
test('qualification artifact closure rehashes originals rejects unlisted bytes and symlinks',async()=>{
 const root=await mkdtemp(join(tmpdir(),'marker-artifact-pure-'));
 try {
  const store=createArtifactStore(root,{byteCap:20});const first=await store.write('source.pcm',Buffer.from('abc'),10,'pcm');assert.equal(first.bytes,3);assert.equal((await store.seal()).length,1);
  await writeFile(join(root,'source.pcm'),'abd');await assert.rejects(store.seal(),/sha_mismatch/);
  await writeFile(join(root,'source.pcm'),'abc');await writeFile(join(root,'extra.json'),'{}');await assert.rejects(store.seal(),/unlisted_artifact/);await rm(join(root,'extra.json'));
  await symlink(join(root,'source.pcm'),join(root,'linked.pcm'));await assert.rejects(store.adopt('linked.pcm',10,'pcm'),/artifact_type/);await rm(join(root,'linked.pcm'));
  await assert.rejects(store.write('../escape',Buffer.alloc(1),10,'pcm'),/artifact_name/);await assert.rejects(store.write('large.pcm',Buffer.alloc(18),20,'pcm'),/byte_cap/);
 }finally{await rm(root,{recursive:true});}
});

test('invocation numeric budget combines legal files and reserves bounded failure shards',async()=>{
 const dir=await mkdtemp(join(tmpdir(),'marker-numeric-pure-'));
 try{
  const base=createArtifactStore(dir),scope=createInvocationStore(base,{id:'mass-test',kind:'mass'});
  await scope.write('mass-test-source.json.gz',Buffer.alloc(150000,1),262144,'sourceObservation');
  await assert.rejects(scope.write('mass-test-decode.json.gz',Buffer.alloc(150000,2),262144,'observation'),/invocation_byte_cap/);
  assert.equal(base.entries.length,1);assert.equal(scope.numericBytes,150000);
  assert.throws(()=>scope.checkFinal([Buffer.alloc(120000)]),/invocation_byte_cap/);
  scope.checkFinal([Buffer.alloc(1000)]);assert.equal(scope.artifactBytes,150000);
 }finally{await rm(dir,{recursive:true});}
});
test('invocation final budget includes post-executor result shards in aggregate',async()=>{
 const dir=await mkdtemp(join(tmpdir(),'marker-final-budget-pure-'));
 try{
  const base=createArtifactStore(dir),scope=createInvocationStore(base,{id:'mass-test',kind:'mass'});
  await scope.write('mass-test-source.pcm',Buffer.alloc(16777216-65536),16777216,'pcm');
  assert.throws(()=>scope.checkFinal([Buffer.alloc(65537)]),/invocation_byte_cap/);
  assert.throws(()=>scope.checkFinal([Buffer.alloc(65536)]),/invocation_byte_cap/);
  scope.checkFinal([]);
 }finally{await rm(dir,{recursive:true});}
});
test('artifact budgets charge explicit evidence roles independently of extensions and preserve roles on adoption',async()=>{
 const dir=await mkdtemp(join(tmpdir(),'marker-role-budget-'));
 try {
  const base=createArtifactStore(dir),scope=createInvocationStore(base,{id:'mass-role',kind:'mass'});
  await scope.write('mass-role-stdout.bin',Buffer.alloc(100000,1),262144,'audioMetadata');
  await writeFile(join(dir,'mass-role-packets.raw'),Buffer.alloc(96608,2));
  await scope.adopt('mass-role-packets.raw',262144,'packet');
  assert.equal(scope.numericBytes,196608);assert.equal(scope.entries[1].role,'packet');
  assert.equal(scope.remainingNumericBytes,0);
  await assert.rejects(scope.write('mass-role-next.dat',Buffer.alloc(1),262144,'stderr'),/invocation_byte_cap/);
  assert.throws(()=>scope.checkFinal([Buffer.alloc(65536)]),/invocation_byte_cap/);assert.equal(scope.checkFinal([]).numericBytes,196608);
  assert.throws(()=>scope.checkFinal([Buffer.alloc(65537)]),/invocation_byte_cap/);
  await scope.write('mass-role-media.json',Buffer.alloc(12),12,'pcm');assert.equal(scope.numericBytes,196608);
  await assert.rejects(scope.write('mass-role-untyped.bin',Buffer.alloc(1),1),/artifact_role/);
  await assert.rejects(scope.json('mass-role-false-media.json',{count:1},100,'pcm'),/artifact_role/);
  assert(Object.isFrozen(base.entries[0]));assert.equal((await base.seal()).length,3);
 }finally{await rm(dir,{recursive:true});}
});
test('concurrent numeric evidence writes reserve the same unchanged invocation budget',async()=>{
 const dir=await mkdtemp(join(tmpdir(),'marker-role-concurrent-'));
 try {
  const base=createArtifactStore(dir),scope=createInvocationStore(base,{id:'mass-concurrent',kind:'mass'});
  const outcomes=await Promise.allSettled([scope.write('mass-concurrent-a.bin',Buffer.alloc(100000),100000,'audioMetadata'),scope.write('mass-concurrent-b.bin',Buffer.alloc(100000),100000,'stderr')]);
  assert.equal(outcomes[0].status,'fulfilled');assert.equal(outcomes[1].status,'rejected');assert.match(outcomes[1].reason.message,/invocation_byte_cap/);
  assert.equal(scope.numericBytes,100000);assert.equal(scope.remainingNumericBytes,96608);assert.equal((await base.seal()).length,1);
 }finally{await rm(dir,{recursive:true});}
});

test('adoption is pending before its first stat and releases finalization on success and error',async()=>{
 const dir=await mkdtemp(join(tmpdir(),'marker-adopt-pending-'));let pending;
 try {
  const base=createArtifactStore(dir),scope=createInvocationStore(base,{id:'mass-pending',kind:'mass'});
  await writeFile(join(dir,'mass-pending-meta.raw'),Buffer.alloc(100000));
  pending=scope.adopt('mass-pending-meta.raw',262144,'packet');
  assert.throws(()=>scope.checkFinal([Buffer.alloc(200000)]),/invocation_byte_cap/);
  await pending;
  assert.throws(()=>scope.checkFinal([Buffer.alloc(200000)]),/invocation_byte_cap/);
  assert.equal(scope.checkFinal([Buffer.alloc(65536)]).numericBytes,165536);
  pending=scope.adopt('mass-pending-missing.raw',262144,'packet');
  assert.throws(()=>scope.checkFinal([]),/invocation_byte_cap/);
  await assert.rejects(pending,/ENOENT/);
  assert.equal(scope.checkFinal([]).numericBytes,100000);assert.equal((await base.seal()).length,1);
 }finally{if(pending)await Promise.allSettled([pending]);await rm(dir,{recursive:true});}
});

test('adoption cannot commit file growth beyond its numeric or aggregate reservation',async()=>{
 for(const [role,limit,producerCap] of [['packet',196608,262144],['pcm',16777216-65536,16777216]]) {
  for(const [initial,retained,accepted] of [[limit,limit,true],[1,limit,false],[1,limit+1,false]]) {
   const dir=await mkdtemp(join(tmpdir(),'marker-adopt-growth-'));
   try {
    const base=createArtifactStore(dir),name='mass-growth-input.raw';
    // Explicit fake, no globals patched: grow exactly after invocation stat
    // and before the real artifact store independently stats and digests.
    const seam={get entries(){return base.entries;},path:base.path,write:base.write,async adopt(name,cap,role){await writeFile(base.path(name),Buffer.alloc(retained));return base.adopt(name,cap,role);}};
    const scope=createInvocationStore(seam,{id:'mass-growth',kind:'mass'});
    await writeFile(base.path(name),Buffer.alloc(initial));
    if(accepted) {
     assert.equal((await scope.adopt(name,producerCap,role)).bytes,limit);
     assert.equal(scope.artifactBytes,limit);assert.equal(scope.numericBytes,role==='packet'?limit:0);
     assert.throws(()=>scope.checkFinal([Buffer.alloc(65536)]),/invocation_byte_cap/);assert.equal(scope.checkFinal([]).artifactBytes,limit);
     assert.equal((await base.seal()).length,1);
    } else {
     await assert.rejects(scope.adopt(name,producerCap,role),/byte_cap/);
     assert.equal(base.entries.length,0);assert.equal(scope.artifactBytes,0);assert.equal(scope.numericBytes,0);
     assert.equal(scope.checkFinal([Buffer.alloc(65536)]).numericBytes,65536);
     await assert.rejects(base.seal(),/unlisted_artifact/);
     await rm(base.path(name));assert.equal((await base.seal()).length,0);
    }
   }finally{await rm(dir,{recursive:true});}
  }
 }
});

test('write retention is bounded by its reserved payload length before commitment',async()=>{
 const dir=await mkdtemp(join(tmpdir(),'marker-write-growth-'));
 try {
  const base=createArtifactStore(dir),name='mass-write-growth.raw';
  const seam={get entries(){return base.entries;},path:base.path,adopt:base.adopt,async write(name,_bytes,cap,role){await writeFile(base.path(name),Buffer.alloc(196609));return base.adopt(name,cap,role);}};
  const scope=createInvocationStore(seam,{id:'mass-write',kind:'mass'});
  await assert.rejects(scope.write(name,Buffer.alloc(1),262144,'packet'),/byte_cap/);
  assert.equal(base.entries.length,0);assert.equal(scope.numericBytes,0);assert.equal(scope.checkFinal([]).artifactBytes,0);
 }finally{await rm(dir,{recursive:true});}
});

test('runtime dependency bytes are retained once and charged once per distinct recording use',async()=>{
 const directory=await mkdtemp(join(tmpdir(),'marker-runtime-use-'));
 try {
  const base=createArtifactStore(directory),store=createInvocationStore(base,{id:'mass-use',kind:'mass'});
  const entry=await store.write('mass-use-runtime.bin',Buffer.alloc(60000,1),65536,'runtimeBinding');
  store.useRuntimeDependency(entry,'mass-use-program');store.useRuntimeDependency(entry,'mass-use-program');assert.equal(store.numericBytes,60000);
  store.useRuntimeDependency(entry,'mass-use-twitch');assert.equal(store.numericBytes,120000);assert.equal(store.entries.length,1);
  store.useRuntimeDependency(entry,'mass-use-other');assert.equal(store.numericBytes,180000);assert.throws(()=>store.useRuntimeDependency(entry,'mass-use-fourth'),/invocation_byte_cap/);assert.equal(store.numericBytes,180000);
  assert.throws(()=>store.checkFinal([Buffer.alloc(82144)]),/invocation_byte_cap/);assert.equal(store.checkFinal([Buffer.alloc(16608)]).numericBytes,196608);assert.throws(()=>store.checkFinal([Buffer.alloc(82145)]),/invocation_byte_cap/);assert.equal((await base.seal()).length,1);
 }finally{await rm(directory,{recursive:true,force:true});}
});

test('bounded primary failure uses the existing reserve and closes normal writes without funding later positives',async()=>{
 const {createRecordFailure}=await import('../../scripts/event-marker-raw-capture.mjs'),directory=await mkdtemp(join(tmpdir(),'marker-failure-use-'));
 try {
  const base=createArtifactStore(directory),store=createInvocationStore(base,{id:'mass-negative',kind:'mass'});
  await store.write('mass-negative-filled.bin',Buffer.alloc(196608),196608,'packet');
  const failure=createRecordFailure({recordKey:'mass-negative-program',inputSHA:'a'.repeat(64)});failure.record({stage:'clock',completedPrerequisites:['inventory'],native:{exitCode:0,signal:null},error:Error('marker_binding_unproven')});
  const retained=await store.writeFailure('mass-negative-failure.json',failure.snapshot());assert(retained.bytes<10241);assert.equal(store.numericBytes,196608+retained.bytes);
  await assert.rejects(store.write('mass-negative-positive.bin',Buffer.alloc(1),1,'packet'),/invocation_byte_cap/);
  assert.equal(store.checkFinal([Buffer.alloc(65536-retained.bytes)]).numericBytes,262144);assert.throws(()=>store.checkFinal([Buffer.alloc(65537-retained.bytes)]),/invocation_byte_cap/);
 }finally{await rm(directory,{recursive:true,force:true});}
});

test('artifact stores honor cancellation before a delayed write resumes and do not create late files',async()=>{
 const {createAcquisitionDeadline}=await import('../../scripts/event-marker-native-binding.mjs'),directory=await mkdtemp(join(tmpdir(),'marker-cancel-write-'));
 const base=createArtifactStore(directory),control=createAcquisitionDeadline(10);let release;
 const store=createInvocationStore({get entries(){return base.entries;},path:base.path,write:async(...args)=>{await new Promise(r=>{release=r;});return base.write(...args);}},{id:'fake',kind:'mass'});
 try{
  const result=control.run(()=>store.write('fake-late.bin',Buffer.alloc(1),1,'runtimeBinding',control));await assert.rejects(result,/timeout/);release();await new Promise(r=>setImmediate(r));
  assert.equal(base.entries.length,0);assert.deepEqual(await base.seal(),[]);assert.equal(store.checkFinal([]).numericBytes,0);
 }finally{control.dispose();await rm(directory,{recursive:true,force:true});}
});
