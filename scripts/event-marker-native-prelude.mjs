import { mkdir,writeFile } from 'node:fs/promises';
import { openNativeBindingDependencies,createAcquisitionDeadline,inspectAcquiredDependencies } from './event-marker-native-binding.mjs';
import { createArtifactStore,createInvocationStore } from './marker-qualification/artifacts.mjs';
import { retainBindingFailure } from './marker-qualification/binding-retention.mjs';
/** Transport coverage and measurement admission have separate outputs. This
 * prelude cannot issue a program/clock certificate. Missing inputs are retained
 * as an honest negative while the original 132 assertions still run. */
export async function captureNativePrelude(directory,{dependencies=openNativeBindingDependencies,control=createAcquisitionDeadline(10000),fileSystem={mkdir,writeFile}}={}) {
 const work=createAcquisitionDeadline(Math.max(0,control.deadline-performance.now()-500)),store=createInvocationStore(createArtifactStore(directory),{id:'prelude',kind:'mass'});let result,failure,created=false;
 try {await work.run(()=>fileSystem.mkdir(directory,{recursive:true}));created=true;const binding=await work.run(()=>dependencies({...work,registerImplementationAssets:files=>store.registerImplementationAssets(files,'prelude-binding','prelude')}));if(inspectAcquiredDependencies(binding)){store.selectNativePolicy(binding);store.reserveProgramOuter('prelude-binding',inspectAcquiredDependencies(binding).plans.outerReserveBytes);}for(const [i,a] of binding.artifacts.entries()){if(a.bytes)await work.run(()=>store.write(`prelude-original-${i}.bin`,Buffer.from(a.data,'base64'),196608,'runtimeBinding',work));}
  const {artifacts,...projection}=binding;await work.run(()=>store.json('prelude-binding.json',{...projection,artifacts:artifacts.map(({data,...ref})=>ref)},196608,'runtimeBinding',work));result={kind:'Unproven',missing:[...(binding.missing??[]),'program_recording','independent_outer_join'],bindingKind:binding.kind};
 }catch(error){failure=error;if(created)await retainBindingFailure(store,'prelude-binding',error,control);result={kind:'Unproven',missing:['binding_acquisition'],error:String(error.message).slice(0,512),failure:error.bindingFailure??null};}
 finally{work.dispose();}
 const receipt={schema:'native-binding-prelude-v1',...result,assuranceBasis:'trustedStackMeasurement',measurementAdmitted:false,nativeBindingVerified:false,loaderComplete:false,budget:store.programBudget('prelude-binding')};
 try{if(created){const raw=Buffer.from(JSON.stringify(receipt)+'\n');await control.run(()=>failure?store.writeNegative('prelude-receipt.json',raw,196608,'observation',control):store.write('prelude-receipt.json',raw,196608,'observation',control));const inventory=Buffer.from(JSON.stringify({schema:'native-binding-inventory-v1',files:store.entries.map(e=>({path:'native-binding/'+e.name,bytes:e.bytes,sha256:e.sha256,role:e.role}))})+'\n');if(inventory.length>65536)throw Error('native_inventory_bound');store.checkFinal([inventory]);await control.run(()=>fileSystem.writeFile(directory+'/inventory.json',inventory,{flag:'wx',mode:0o600,signal:control.signal}));}control.check();}
 catch(error){result={kind:'Unproven',missing:['binding_retention'],error:(failure??error).message};}
 finally{control.dispose();}
 return {kind:result.kind,missing:result.missing,measurementAdmitted:false,nativeBindingVerified:false,loaderComplete:false};
}
