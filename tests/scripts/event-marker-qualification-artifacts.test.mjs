import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp,writeFile,symlink,rm } from 'node:fs/promises';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { createArtifactStore,createInvocationStore } from '../../scripts/marker-qualification/artifacts.mjs';
test('qualification artifact closure rehashes originals rejects unlisted bytes and symlinks',async()=>{
 const root=await mkdtemp(join(tmpdir(),'marker-artifact-pure-'));
 try {
  const store=createArtifactStore(root,{byteCap:20});const first=await store.write('source.pcm',Buffer.from('abc'),10);assert.equal(first.bytes,3);assert.equal((await store.seal()).length,1);
  await writeFile(join(root,'source.pcm'),'abd');await assert.rejects(store.seal(),/sha_mismatch/);
  await writeFile(join(root,'source.pcm'),'abc');await writeFile(join(root,'extra.json'),'{}');await assert.rejects(store.seal(),/unlisted_artifact/);await rm(join(root,'extra.json'));
  await symlink(join(root,'source.pcm'),join(root,'linked.pcm'));await assert.rejects(store.adopt('linked.pcm',10),/artifact_type/);await rm(join(root,'linked.pcm'));
  await assert.rejects(store.write('../escape',Buffer.alloc(1),10),/artifact_name/);await assert.rejects(store.write('large.pcm',Buffer.alloc(18),20),/byte_cap/);
 }finally{await rm(root,{recursive:true});}
});

test('invocation numeric budget combines legal files and reserves bounded failure shards',async()=>{
 const dir=await mkdtemp(join(tmpdir(),'marker-numeric-pure-'));
 try{
  const base=createArtifactStore(dir),scope=createInvocationStore(base,{id:'mass-test',kind:'mass'});
  await scope.write('mass-test-source.json.gz',Buffer.alloc(150000,1),262144);
  await assert.rejects(scope.write('mass-test-decode.json.gz',Buffer.alloc(150000,2),262144),/invocation_byte_cap/);
  assert.equal(base.entries.length,1);assert.equal(scope.numericBytes,150000);
  assert.throws(()=>scope.checkFinal([Buffer.alloc(120000)]),/invocation_byte_cap/);
  scope.checkFinal([Buffer.alloc(1000)]);assert.equal(scope.artifactBytes,150000);
 }finally{await rm(dir,{recursive:true});}
});
test('invocation final budget includes post-executor result shards in aggregate',async()=>{
 const dir=await mkdtemp(join(tmpdir(),'marker-final-budget-pure-'));
 try{
  const base=createArtifactStore(dir),scope=createInvocationStore(base,{id:'mass-test',kind:'mass'});
  await scope.write('mass-test-source.pcm',Buffer.alloc(16777216-65536),16777216);
  assert.throws(()=>scope.checkFinal([Buffer.alloc(65537)]),/invocation_byte_cap/);
  scope.checkFinal([Buffer.alloc(65536)]);
 }finally{await rm(dir,{recursive:true});}
});
