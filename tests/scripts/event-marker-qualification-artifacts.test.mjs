import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp,writeFile,symlink,rm } from 'node:fs/promises';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { createArtifactStore } from '../../scripts/marker-qualification/artifacts.mjs';
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
