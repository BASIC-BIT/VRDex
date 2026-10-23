import test from 'node:test';
import assert from 'node:assert/strict';
import { validateSourceManifest,validateCanaryAuthority } from '../../scripts/marker-qualification/preflight.mjs';
import { enumerateQualification,binding } from '../../scripts/marker-qualification/authority.mjs';
test('source authority requires exact packaged path set and canary all original IDs on same image',()=>{
 const files=[{path:'scripts/a.mjs',bytes:20,sha256:'a'.repeat(64)},{path:'workers/restream/b.mjs',bytes:30,sha256:'b'.repeat(64)}],manifest={schema:1,revision:'c'.repeat(40),files};
 assert.equal(validateSourceManifest(manifest,files.map(f=>f.path),manifest.revision).length,2);
 for(const mutate of [x=>x.files.pop(),x=>x.files.push(x.files[0]),x=>x.files[0].bytes=0,x=>x.files[0].path='../a',x=>x.revision='d'.repeat(40)]){const x=structuredClone(manifest);mutate(x);assert.throws(()=>validateSourceManifest(x,files.map(f=>f.path),manifest.revision),/qualification_sources/);}
 const a=enumerateQualification(),ids=a.groups[0].invocations,expected=binding(ids.flatMap(id=>a.invocations.find(i=>i.id===id).rows)),pins={imageDigest:'sha256:'+'e'.repeat(64),sourceManifestSha256:'f'.repeat(64)},receipt={schema:'marker-qualification-terminal-v1',groupId:'canary-000',pins,workPassed:true,artifactUploadsComplete:true,cleanup:{closed:true},expected,invocations:ids.map(id=>({id,counts:{pass:a.invocations.find(i=>i.id===id).rows.length,fail:0,incomplete:0}}))};
 assert.equal(validateCanaryAuthority(receipt,pins),true);
 for(const mutate of [r=>r.workPassed=false,r=>r.invocations[0].counts.incomplete=1,r=>r.pins.imageDigest='sha256:'+'d'.repeat(64),r=>r.expected.idsSha256='a'.repeat(64),r=>r.invocations.pop()]){const r=structuredClone(receipt);mutate(r);assert.throws(()=>validateCanaryAuthority(r,pins),/qualification_canary/);}
});
