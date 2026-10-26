import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp,rm,readFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { createHash } from 'node:crypto';
import { collectImplementationCatalog,compactImplementationCatalog,expandImplementationCatalog,validateImplementationCatalog,verifyImplementationSource,implementationImports,IMPLEMENTATION_ROOTS,PROGRAM_BUILTINS } from '../../scripts/event-marker-implementation-assets.mjs';
import { createArtifactStore,createInvocationStore } from '../../scripts/marker-qualification/artifacts.mjs';
import { simulatedProgramRuntime } from '../fixtures/marker-positive-program.mjs';
const audit={kind:'audit',id:'SIMULATED-semantic-review',bytes:1,sha256:'a'.repeat(64)},sha=b=>createHash('sha256').update(b).digest('hex');
test('R87 complete source closure is derived from actual static/reexport/dynamic edges and preserves mixed data',async()=>{
 const c=await collectImplementationCatalog({roots:IMPLEMENTATION_ROOTS,approvedBuiltins:PROGRAM_BUILTINS,sourceAuditRef:audit,read:readFile});assert.deepEqual(expandImplementationCatalog(compactImplementationCatalog(c)),c);const loaded=validateImplementationCatalog(c);assert(loaded.length>30);assert(!loaded.some(f=>f.path.endsWith('/authority.mjs')||f.path.endsWith('/association.json')));for(const path of ['workers/restream/broadcast-profiles.mjs','scripts/event-capacity-fixture-data.mjs','scripts/event-marker-program-contract.mjs','scripts/marker-qualification/construction-data.mjs','scripts/marker-qualification/detector-expectations.mjs']){const entry=loaded.find(f=>f.path===path),raw=await readFile(path);assert.equal(entry.kind,'runtimeData');assert.equal(entry.bytes,raw.length);assert.equal(entry.sha256,sha(raw));const compact=compactImplementationCatalog(c);assert.equal(compact.files[compact.paths.indexOf(path)][1],1);assert.throws(()=>validateImplementationCatalog({...c,files:c.files.map(f=>f===entry?{...f,kind:'implementationCode'}:f)}),/eligibility/);}
 for(const f of loaded)verifyImplementationSource(f,await readFile(f.path),c);
 const root=c.files.find(f=>f.path===IMPLEMENTATION_ROOTS[0]),bytes=await readFile(root.path);assert.throws(()=>verifyImplementationSource({...root,imports:[]},bytes,c),/imports/);
 const mixed=c.files.find(f=>f.kind==='runtimeData');assert.throws(()=>validateImplementationCatalog({...c,files:c.files.map(f=>f===mixed?{...f,kind:'implementationCode'}:f)}),/eligibility/);
 for(const text of ['export const plan = { approved: true };','export default [1,2,3];']){const b=Buffer.from(text);assert.throws(()=>verifyImplementationSource({kind:'implementationCode',path:'scripts/fake-data.mjs',bytes:b.length,sha256:sha(b),imports:[]},b,c),/data_disguised/);}
 for(const text of ["import(process.env.LOADER)","require('x')","new Function('return 42')","import 'third-party'"] )assert.throws(()=>implementationImports('scripts/fake.mjs',Buffer.from(text)),/marker_implementation_/);
 assert.deepEqual(implementationImports('scripts/fake.mjs',Buffer.from("export {x} from './a.mjs'; const p=import('./b.mjs');")),[{kind:'static',target:'scripts/a.mjs'},{kind:'dynamic',target:'scripts/b.mjs'}]);
});
test('R87 code bodies reserve once per invocation and once in group storage, with distinct record/E/D uses',async()=>{
 const directory=await mkdtemp(join(tmpdir(),'marker-assets-'));try{const group=createArtifactStore(directory),one=createInvocationStore(group,{id:'one',kind:'mass'}),two=createInvocationStore(group,{id:'two',kind:'mass'}),asset={kind:'implementationCode',loaded:true,path:'scripts/SIMULATED.mjs',bytes:100,sha256:'b'.repeat(64),sourceAuditRef:audit};
  one.registerImplementationAssets([asset],'one-a','encode');one.registerImplementationAssets([asset],'one-a','decode');one.registerImplementationAssets([asset],'one-b','encode');two.registerImplementationAssets([asset],'two-a','encode');assert.equal(group.total,100);assert.equal(one.total,100);assert.equal(two.total,100);assert.equal(one.numericBytes,0);assert.equal(one.programBudget('one-a').implementationUses.length,3);assert.throws(()=>one.registerImplementationAssets([asset],'one-a','decode'),/artifact_role/);assert.throws(()=>one.registerImplementationAssets([{...asset,kind:'runtimeData'}],'one-c','encode'),/artifact_role/);
  const small=createInvocationStore(createArtifactStore(directory,{byteCap:99}),{id:'small',kind:'mass'});assert.throws(()=>small.registerImplementationAssets([asset],'small-a','encode'),/byte_cap/);assert.equal(small.total,0);
  const many=Array.from({length:86},(_,i)=>({...asset,path:'scripts/code'+i+'.mjs',bytes:196608,sha256:i.toString(16).padStart(64,'0')}));assert.throws(()=>one.registerImplementationAssets(many,'one-c','encode'),/invocation_byte_cap/);assert.equal(one.total,100);
 }finally{await rm(directory,{recursive:true,force:true});}
});
test('failed code bytes remain charged negative originals and strict sourceClosed never receives the code exception',async()=>{
 const runtime=await simulatedProgramRuntime(),path='/app/scripts/marker-qualification/codec-input.mjs',original=runtime.files.get(path),bad=Buffer.concat([original,Buffer.from('\n// SIMULATED changed code\n')]);runtime.files.set(path,bad);let reservations=0,caught;
 try{await runtime.dependencies({registerImplementationAssets:files=>{reservations++;return {kind:'implementationCode-v1',bytes:files.reduce((n,f)=>n+f.bytes,0)};}});}catch(e){caught=e;}
 assert(caught);assert.equal(reservations,1);const failed=caught.bindingArtifacts.find(a=>a.id==='failed-source:'+path.slice(5));assert.equal(failed.kind,'observation');assert.equal(failed.complete,true);assert.equal(failed.sha256,sha(bad));assert.deepEqual(Buffer.from(failed.data,'base64'),bad);
 const strict=await simulatedProgramRuntime({mutateProfile:p=>p.assuranceBasis='sourceClosed'});const result=await strict.dependencies({registerImplementationAssets:()=>{throw Error('strict discount');}});assert.equal(result.kind,'Unproven');assert(result.missing.includes('source_loader_closure'));
});
