import { createRecordFailure } from '../event-marker-raw-capture.mjs';
/** Shared by all three acquisition front doors. Observed bytes, including
 * partial/empty/authentication failures, keep their actual identities. */
export async function retainBindingFailure(store,prefix,error,control={},stage='encode'){
 const journal=createRecordFailure({recordKey:prefix,inputSHA:'0'.repeat(64)});journal.record({stage,completedPrerequisites:[],native:null,error});
 try{control.check?.();await store.writeFailure(prefix+'-binding-failure.json',journal.snapshot(),control);
  for(const [i,a] of (error.bindingArtifacts??[]).entries()){if(a.bytes===0)continue;await store.writeNegative(`${prefix}-binding-failed-${i}.bin`,Buffer.from(a.data,'base64'),196608,'runtimeBinding',control);}
  if(error.bindingArtifacts?.length)await store.writeNegative(prefix+'-binding-failed.json',Buffer.from(JSON.stringify({artifacts:error.bindingArtifacts.map(({data,...r})=>r)})+'\n'),196608,'runtimeBinding',control);
 }catch(secondary){journal.record({stage:'retain',completedPrerequisites:[],native:null,error:secondary});error.retentionError??=secondary;}
 error.bindingFailure=journal.snapshot();return error.bindingFailure;
}
