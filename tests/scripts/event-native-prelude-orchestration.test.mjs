import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, mkdir, readFile, readdir, rm, stat, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import * as cli from '../../scripts/event-twitch-input-proof.mjs';
import { captureNativePrelude } from '../../scripts/event-marker-native-prelude.mjs';
import { openNativeBindingDependencies, createAcquisitionDeadline } from '../../scripts/event-marker-native-binding.mjs';
const json=async path=>JSON.parse(await readFile(path,'utf8'));
const cleanup={closed:true,liveChildren:0,liveGroups:0};
const summary=count=>Buffer.from(JSON.stringify({testsRun:count,passed:true,outcomes:Array.from({length:count},(_,n)=>({test:'SIMULATED_'+n,outcome:'passed'}))}));
const env={VRDEX_PROOF_PUBLIC_CHANNELS_JSON:'["fixture_a","fixture_b"]'};
const metadata={task:{TaskARN:'arn:aws:ecs:us-east-1:000000000000:task/SIMULATED',Limits:{CPU:8,Memory:16384},Containers:[{DockerId:'SIMULATED',Name:'worker',Limits:{CPU:8192,Memory:16384}}]},container:{DockerId:'SIMULATED',Name:'worker',ImageID:'SIMULATED',Limits:{CPU:8192,Memory:16384}}};
function run(request,options){assert.equal(typeof cli.runTwitchProofWorkload,'function');return cli.runTwitchProofWorkload(request,{env,...options});}
function effects(outputDir,{binding='absent',nativeFailure=false,cleanupFailure=false}={}){
 const events=[];let calls=0;
 const prelude=async directory=>{
  assert((await stat(outputDir)).isDirectory());assert.deepEqual(await readdir(outputDir),[]);events.push('prelude');
  if(binding==='throws')throw Error('SIMULATED prelude fault');
  const options=binding==='deadline'?{control:createAcquisitionDeadline(600),dependencies:()=>new Promise(()=>{})}:{dependencies:options=>openNativeBindingDependencies({...options,environment:{}})};
  const result=await captureNativePrelude(directory,options);assert.equal(result.kind,'Unproven');assert.equal(result.measurementAdmitted,false);events.push('prelude retained');return result;
 };
 const ownerFactory=()=>({run:async(command,args,options)=>{
  assert.equal(events.at(-1),calls?'python':'prelude retained');const receipt=await json(join(outputDir,'native-binding/prelude-receipt.json'));assert.equal(receipt.kind,'Unproven');assert.equal(receipt.nativeBindingVerified,false);assert.equal(receipt.loaderComplete,false);
  calls++;events.push(calls===1?'python':'node');
  assert.deepEqual(options,calls===1?{timeoutMs:240000,maxBytes:262144}:{timeoutMs:120000,maxBytes:131072});
  assert.equal(command,calls===1?'python3':process.execPath);assert.deepEqual(args,calls===1?['-m','workers.restream.tests.proof_suite','test_twitch_transport','test_twitch_input']:['workers/restream/tests/owner_proof.mjs']);
  if(nativeFailure)throw Error('SIMULATED native boundary failure');return summary(calls===1?42:90);
 },start:()=>{throw Error('native spawn forbidden');},close:async()=>{events.push('cleanup');if(cleanupFailure)throw Error('SIMULATED cleanup failure');return cleanup;}});
 return {events,transport:{ownerFactory,prelude,delay:async()=>{},createInput:()=>({dispose:async()=>{events.push('cancel');}})},publicInput:{ownerFactory,prelude,readMetadata:async()=>metadata,createRenderer:()=>{events.push('renderer');throw Error('SIMULATED stop before media');}}};
}
for(const branch of ['all','public'])test(`selected ${branch} workload owns fresh parent before real negative prelude and native boundary`,async()=>{
 const parent=await mkdtemp(join(tmpdir(),'marker-prelude-orchestration-')),outputDir=join(parent,'fresh'),fx=effects(outputDir);
 try{
  const result=run({case:branch,outputDir},fx);if(branch==='all')await result;else await assert.rejects(result,/Private public-input proof failed/);
  const receipt=await json(join(outputDir,'receipt.json')),binding=await json(join(outputDir,'native-binding/prelude-receipt.json'));
  assert.equal(receipt.terminal,true);assert.deepEqual(receipt.cleanup,cleanup);assert.equal(receipt.passed,branch==='all');assert.equal(binding.measurementAdmitted,false);assert(binding.missing.includes('binding_context'));
  if(branch==='all'){assert.equal(receipt.tests.testsRun,42);assert.equal(receipt.tests.owner.testsRun,90);assert.deepEqual(fx.events,['prelude','prelude retained','python','node','cancel','cleanup']);}
  else{assert.equal(receipt.failurePhase,'startup');assert.deepEqual(fx.events,['prelude','prelude retained','renderer','cleanup']);}
 }finally{await rm(parent,{recursive:true,force:true});}
});
for(const branch of ['all','public'])test(`selected ${branch} workload rejects a stale parent without prelude child or receipt overwrite`,async()=>{
 const outputDir=await mkdtemp(join(tmpdir(),'marker-prelude-stale-')),fx=effects(outputDir);await writeFile(join(outputDir,'sentinel'),'previous owner');
 try{await assert.rejects(run({case:branch,outputDir},fx),{code:'EEXIST'});assert.deepEqual(fx.events,[]);assert.deepEqual(await readdir(outputDir),['sentinel']);assert.equal(await readFile(join(outputDir,'sentinel'),'utf8'),'previous owner');}finally{await rm(outputDir,{recursive:true,force:true});}
});
test('bounded prelude acquisition failure stays Unproven while unchanged transport coverage proceeds',async()=>{
 const parent=await mkdtemp(join(tmpdir(),'marker-prelude-bounded-')),outputDir=join(parent,'fresh'),fx=effects(outputDir,{binding:'deadline'}),began=performance.now();
 try{await run({case:'all',outputDir},fx);assert(performance.now()-began<3000);assert.equal((await json(join(outputDir,'receipt.json'))).passed,true);const receipt=await json(join(outputDir,'native-binding/prelude-receipt.json'));assert.equal(receipt.measurementAdmitted,false);assert(receipt.missing.includes('binding_acquisition'));}finally{await rm(parent,{recursive:true,force:true});}
});
for(const fault of ['prelude','native','cleanup'])test(`transport ${fault} failure retains a terminal negative and cleanup outcome`,async()=>{
 const parent=await mkdtemp(join(tmpdir(),'marker-prelude-failure-')),outputDir=join(parent,'fresh'),fx=effects(outputDir,{binding:fault==='prelude'?'throws':'absent',nativeFailure:fault==='native',cleanupFailure:fault==='cleanup'});
 try{await assert.rejects(run({case:'all',outputDir},fx),/Transport contract failed/);const receipt=await json(join(outputDir,'receipt.json'));assert.equal(receipt.terminal,true);assert.equal(receipt.passed,false);assert.equal(receipt.failurePhase,{prelude:'native_binding_prelude',native:'python_contracts',cleanup:'cleanup'}[fault]);assert.equal(receipt.cleanup.closed,fault!=='cleanup');if(fault==='prelude')assert.deepEqual(fx.events,['prelude','cleanup']);}finally{await rm(parent,{recursive:true,force:true});}
});
