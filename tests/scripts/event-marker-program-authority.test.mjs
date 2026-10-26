import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { execFileSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import * as contract from '../../scripts/event-marker-program-contract.mjs';
import * as authority from '../../scripts/event-marker-authority-closure.mjs';
import { validateProgramDependencies as validateDependencies } from '../../scripts/event-marker-program-guards.mjs';
import { inspectAcquiredDependencies } from '../../scripts/event-marker-native-binding.mjs';
import { makeNativeCandidate,makeNativeIntent,prepareCiCreate,verifyNativeOuterJoins,nativeArtifact } from '../../scripts/event-marker-native-controller.mjs';
import { prepareEcsNativeLaunch } from '../../scripts/event-marker-native-ecs-controller.mjs';
import { simulatedProgramRuntime } from '../fixtures/marker-positive-program.mjs';
const validateProgramDependencies=d=>{const value=structuredClone(d);delete value.profile.objects;return validateDependencies(value);};
const sha=b=>createHash('sha256').update(b).digest('hex');
const rows=[
  {
    "key": "design",
    "path": "docs/engineering/authority/program-source-design-rebaseline-v1.md",
    "kind": "audit",
    "id": "program-source-design-rebaseline-v1",
    "bytes": 17953,
    "sha256": "7463c898c2104ce5897830dafabb1e7b0ec88242f54bdfb45771ce6aa703c6c1"
  },
  {
    "key": "guards",
    "path": "docs/engineering/authority/program-source-guards-rebaseline-v1.md",
    "kind": "audit",
    "id": "program-source-guards-rebaseline-v1",
    "bytes": 21732,
    "sha256": "54130902985c22ddef115437afe033d4347e66901c17a211295b0e529ad7ef12"
  },
  {
    "key": "pins",
    "path": "docs/engineering/authority/program-native-pins-rebaseline-v1.md",
    "kind": "audit",
    "id": "program-native-pins-rebaseline-v1",
    "bytes": 15483,
    "sha256": "f5d04c68d66494a2aaa16056a06a15eea907f6254cafe4e567e97c2964e50417"
  },
  {
    "key": "resultSizing",
    "path": "tests/fixtures/program-result-sizing-r94-v1.txt",
    "kind": "audit",
    "id": "program-result-sizing-r94-v1",
    "bytes": 41830,
    "sha256": "0a7214700021178996f717487ce09b513fa8ebfcb70dca6a2bed863abb7a5c3c"
  },
  {
    "key": "authorityRebaseline",
    "path": "docs/engineering/authority/program-authority-rebaseline-v1.md",
    "kind": "audit",
    "id": "program-authority-rebaseline-v1",
    "bytes": 16626,
    "sha256": "42b3ad94be9a551b1f8a97e84ebff0ce65aaac4f6e367a323d1db2f442f014c5"
  }
];
const refs=rows.map(({path,key,...ref})=>ref);
const acquire=async()=>{const runtime=await simulatedProgramRuntime(),binding=await runtime.dependencies({registerImplementationAssets:files=>({kind:'implementationCode-v1',bytes:files.reduce((n,f)=>n+f.bytes,0),invocation:'simulated',recordKey:'simulated-program',event:'encode'})});return {runtime,deps:{...structuredClone(inspectAcquiredDependencies(binding)),profile:structuredClone(inspectAcquiredDependencies(binding).profile),nativeCatalog:JSON.parse(runtime.files.get('/app/workers/restream/native-binding/runtime/nativeCatalog.json'))}};};
const mutations=[r=>({...r,id:'SIMULATED-generic-S'}),r=>({...r,kind:'runtime'}),r=>({...r,bytes:r.bytes-1}),r=>({...r,sha256:'0'.repeat(64)}),... [undefined,null,{},0,'', {start:0,length:0},{start:0,length:1}].map(range=>r=>({...r,range})),r=>({...r,range:{start:0,length:r.bytes}})];
test('tracked originals match frozen five-field authority',async()=>{
 assert.deepEqual(Object.keys(contract.PROGRAM_SOURCE_CONTRACT),rows.map(r=>r.key));
 assert.deepEqual(contract.PROGRAM_AUTHORITY_REFS,rows.map(({path,...r})=>r));
 assert(Object.isFrozen(contract.PROGRAM_SOURCE_CONTRACT));assert(Object.isFrozen(contract.PROGRAM_AUTHORITY_REFS));assert(contract.PROGRAM_AUTHORITY_REFS.every(Object.isFrozen));
 for(const row of rows){execFileSync('git',['ls-files','--error-unmatch','--',row.path]);const body=await readFile(row.path);assert.equal(body.length,row.bytes);assert.equal(sha(body),row.sha256);assert.equal(contract.PROGRAM_SOURCE_CONTRACT[row.key],row.sha256);assert.notEqual(sha(Buffer.concat([body,Buffer.from('x')])),row.sha256);}
});
test('every mandatory reference requires whole identity',async()=>{
 assert.equal(typeof authority.isFullAuthorityReference,'function');assert.equal(typeof authority.requireMandatoryAuthorityMembership,'function');
 const {deps,runtime}=await acquire(),audits=JSON.parse(runtime.candidate.bytes).auditRefs;
 authority.requireMandatoryAuthorityMembership(audits);
 for(const ref of refs){assert(authority.isFullAuthorityReference(ref,ref));assert.equal(authority.isFullAuthorityReference({...ref,range:null},ref),false);
  assert.throws(()=>authority.requireMandatoryAuthorityMembership(audits.filter(r=>r.id!==ref.id)));
  for(const mutate of mutations){assert.equal(authority.isFullAuthorityReference(mutate(ref),ref),false);assert.throws(()=>authority.requireMandatoryAuthorityMembership(audits.map(r=>r.id===ref.id?mutate(r):r)));}
  for(const guard of ['G0','G12'])for(const mutate of [()=>null,...mutations]){const d=structuredClone(deps),description=d.proof.descriptions.find(x=>x.guard===guard);description.sourceRefs=description.sourceRefs.flatMap(r=>r.id===ref.id?(mutate(r)?[mutate(r)]:[]):[r]);assert.throws(()=>validateProgramDependencies(d),guard+':'+ref.id);}
  assert.throws(()=>authority.requireMandatoryAuthorityMembership([...audits,ref]));assert.throws(()=>authority.requireMandatoryAuthorityMembership([...audits,{...ref,bytes:ref.bytes+1}]));
 }
 for(let i=1;i<=11;i++){const d=structuredClone(deps),description=d.proof.descriptions[i];description.sourceRefs=description.sourceRefs.filter(r=>r.id!==refs[1].id);assert.throws(()=>validateProgramDependencies(d));}
 const conflicting=structuredClone(deps);conflicting.proof.descriptions[0].sourceRefs.push({...refs[0],bytes:refs[0].bytes+1});assert.throws(()=>authority.requiredAuthorityReferences(conflicting),/conflict/);
 const supplemented=structuredClone(deps);supplemented.proof.descriptions[0].sourceRefs.push({...refs[0],range:{start:0,length:1}});validateProgramDependencies(supplemented);authority.requireAuthorityMembership(supplemented,audits);
 assert.throws(()=>authority.requireMandatoryAuthorityMembership([refs[0],refs[0]]));
});
test('old and mixed contracts fail all front doors',async()=>{
 const {deps,runtime}=await acquire(),k=JSON.parse(runtime.candidate.bytes),intent=JSON.parse(runtime.intent),args={candidate:runtime.candidate,imageFacts:runtime.imageFacts,workload:intent.workload,semanticEnvironment:intent.semanticEnvironment,nonce:'SIMULATED',deadline:1,transport:{}};
 for(const mutate of [c=>delete c.authorityRebaseline,c=>delete c.resultSizing,c=>{delete c.resultSizing;delete c.authorityRebaseline;},c=>c.design='aa6d1308c3ed17a2440004d06ef85a5d47aa47d09034b11fe8ddc01087f13c93',c=>c.extra='0'.repeat(64)]){const d=structuredClone(deps);mutate(d.proof.contract);assert.throws(()=>validateProgramDependencies(d));const bad=structuredClone(k);mutate(bad.sourceContract);const bytes=Buffer.from(JSON.stringify(bad)),candidate={bytes,ref:nativeArtifact('audit','K',bytes)};assert.throws(()=>makeNativeIntent({...args,candidate}));assert.throws(()=>prepareCiCreate({...args,candidate}));assert.throws(()=>prepareEcsNativeLaunch({...args,candidate,parameters:{}}));}
 for(const ref of refs)for(const change of [a=>a.filter(r=>r.id!==ref.id),a=>a.map(r=>r.id===ref.id?{...r,range:null}:r)]){const auditRefs=change(k.auditRefs);assert.throws(()=>makeNativeCandidate({...k,auditRefs}));const bytes=Buffer.from(JSON.stringify({...k,auditRefs})),candidate={bytes,ref:nativeArtifact('audit','K',bytes)};assert.throws(()=>makeNativeIntent({...args,candidate}));assert.throws(()=>prepareCiCreate({...args,candidate}));assert.throws(()=>prepareEcsNativeLaunch({...args,candidate,parameters:{}}));}
});
test('required reviews cannot be optional attachments',async()=>{
 const {deps,runtime}=await acquire(),audits=JSON.parse(runtime.candidate.bytes).auditRefs,required=authority.requiredAuthorityReferences(deps),reviewRefs=required.filter(r=>/^SIMULATED-(?:review|adoption|semantic)/.test(r.id));assert(reviewRefs.length>=3);
 for(const ref of reviewRefs){assert.throws(()=>authority.requireAuthorityMembership(deps,audits.filter(r=>r.id!==ref.id)));assert(runtime.outerOriginals.has(ref.id));}
 const reduced=structuredClone(deps);for(const d of reduced.proof.descriptions)d.sourceRefs=d.sourceRefs.filter(r=>!reviewRefs.some(x=>x.id===r.id));assert.notEqual(sha(Buffer.from(JSON.stringify(reduced.proof))),sha(Buffer.from(JSON.stringify(deps.proof))));assert.notEqual(sha(Buffer.from(JSON.stringify(reduced.proof))),deps.manifest.entries.find(r=>r.id==='proof').sha256);const body=Buffer.from(JSON.stringify(reduced.proof)),manifest=structuredClone(deps.manifest);Object.assign(manifest.entries.find(r=>r.id==='proof'),{bytes:body.length,sha256:sha(body)});const k=JSON.parse(runtime.candidate.bytes),changed=makeNativeCandidate({...k,runtimeManifestSHA:sha(Buffer.from(JSON.stringify(manifest)))});assert.deepEqual(JSON.parse(changed.bytes).auditRefs,k.auditRefs);assert.notEqual(changed.ref.sha256,runtime.candidate.ref.sha256);
});
test('membership retains repeated logical uses',async()=>{
 const {deps,runtime}=await acquire(),repeatedId=refs[1].id,occurrences=deps.proof.descriptions.reduce((n,d)=>n+[d.auditRef,...d.sourceRefs].filter(r=>r.id===repeatedId).length,0);
 assert.equal(authority.requiredAuthorityReferences(deps).filter(r=>r.id===repeatedId).length,occurrences);assert.equal(occurrences,13);authority.requireAuthorityMembership(deps,JSON.parse(runtime.candidate.bytes).auditRefs);
});

// Rehash all attacker-controlled K/I/C joins and reacquire the real private
// dependency handle. This reaches catalog validation rather than failing an
// incidental stale digest. No simulated launch or approval is made eligible.
test('outer replay rejects malformed rehashed authority before source or audit reads',async()=>{
 const runtime=await simulatedProgramRuntime(),originalK=JSON.parse(runtime.candidate.bytes),originalI=JSON.parse(runtime.intent),originalC=JSON.parse(runtime.prepared.context.bytes);
 const changes=[...refs.flatMap(ref=>[k=>k.auditRefs=k.auditRefs.filter(r=>r.id!==ref.id),...mutations.filter(mutate=>{const changed=mutate(ref);return !Object.hasOwn(changed,'range')||changed.range!==undefined;}).map(mutate=>k=>k.auditRefs=k.auditRefs.map(r=>r.id===ref.id?mutate(r):r))]),k=>k.auditRefs.push(k.auditRefs[0]),k=>delete k.sourceContract.authorityRebaseline,k=>k.sourceContract.design='aa6d1308c3ed17a2440004d06ef85a5d47aa47d09034b11fe8ddc01087f13c93',k=>k.sourceContract.extra='0'.repeat(64)];
 for(const change of changes){const k=structuredClone(originalK);change(k);const K=Buffer.from(JSON.stringify(k)),i={...originalI,candidateManifestSHA:sha(K),candidateManifestBytes:K.length},I=Buffer.from(JSON.stringify(i)),c={...originalC,intent:{utf8:I.toString(),bytes:I.length,sha256:sha(I)}},C=Buffer.from(JSON.stringify(c));runtime.files.set('/run/vrdex-native/context.json',C);
  const binding=await runtime.dependencies({registerImplementationAssets:files=>({kind:'implementationCode-v1',bytes:files.reduce((n,f)=>n+f.bytes,0),invocation:'simulated',recordKey:'simulated-program',event:'encode'})}),documents=new Map([['K',K],['I',I],['C',C],['Q',runtime.prepared.launch.bytes],['L',Buffer.from('{}')],['image',runtime.outerOriginals.get('image')]]),reads=[];
  await assert.rejects(verifyNativeOuterJoins({binding,outerResolver:async id=>{reads.push(id);return documents.get(id);}}),/native_authority_|candidate_join/);assert.deepEqual(reads,['K','I','C','Q','L','image']);
 }
});
