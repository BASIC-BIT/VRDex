import { enumerateQualification,binding } from './authority.mjs';
import { createArtifactStore } from './artifacts.mjs';
import { createQualificationOwner } from './owner.mjs';
import { runLiteralInvocation } from './literal-runner.mjs';
import { evaluateClassifierCase,makeResultShards,validateResultUnion } from './results.mjs';
async function executeDefault(invocation,context) {
 if(invocation.kind==='literal')return runLiteralInvocation(invocation).results;
 if(invocation.kind==='mass')return (await import('./mass.mjs')).executeMass(invocation,context);
 if(invocation.kind==='association')return (await import('./association-runner.mjs')).executeAssociation(invocation,context);
 return (await import('./bridges.mjs')).executeBridge(invocation,context);
}
/** One explicitly selected frozen group; no scheduler/retry/admission. Upload
 * belongs to the outer CLI, after the final physical census and byte seal. */
export async function runQualificationGroup(request,{clock=()=>performance.now(),ownerFactory=createQualificationOwner,execute=executeDefault,onOwner=()=>{},workMs=400000}={}) {
 if(!Number.isFinite(workMs)||workMs<0||workMs>400000)throw Error('qualification_work_budget');
 const authority=enumerateQualification(),group=authority.groups.find(g=>g.id===request.groupId);
 if(!group)throw Error('qualification_group');
 const invocations=group.invocations.map(id=>authority.invocations.find(i=>i.id===id)),store=createArtifactStore(request.directory),bundles=[],reports=[];
 const began=clock();let completedInvocations=0,closed=true,stopped=false;
 for(const invocation of invocations) {
  const expected=binding(invocation.rows);let owner,cleanup,results,expired=false;
  if(stopped||clock()-began>=workMs)results=invocation.rows.map((_,index)=>({index,status:'incomplete',reason:'unrun'}));
  else {
   owner=await ownerFactory();onOwner(owner);const beganInvocation=clock();
   const limit=Math.min(workMs-(beganInvocation-began),invocation.kind==='compressed-source'?360000:invocation.kind==='association'?110000:90000);
   const timeout=setTimeout(()=>{expired=true;void owner.close().catch(()=>{});},limit);timeout.unref?.();
   try {results=await execute(invocation,{owner,store});}
   catch{results=invocation.rows.map((_,index)=>({index,status:'incomplete',reason:'unrun'}));}
   finally {
    clearTimeout(timeout);expired ||= clock()-beganInvocation>=limit;
    try{cleanup=await owner.close();}catch{cleanup={closed:false,reason:'process_leak'};}
    onOwner(undefined,owner);completedInvocations++;
   }
   closed &&= cleanup.closed===true;
   if(!closed||expired){stopped=true;results=invocation.rows.map((_,index)=>({index,status:'incomplete',reason:!closed?'process_leak':'timeout'}));}
   else {
    results=results.map(result=>{
     if(result.prerequisites)result.prerequisites.physical_children_closed='pass';
     if(result.status)return result;
     if(result.kind==='classifier')return {index:result.index,...evaluateClassifierCase(invocation.rows[result.index],result.prerequisites,result.evidence)};
     // Association/bridge executors return their observed semantic verdict only
     // after all other prerequisites; physical closure is imposed here.
     if(result.kind==='association'&&result.evaluate)return {index:result.index,...result.evaluate(result.prerequisites)};
     return {index:result.index,status:'incomplete',reason:'unrun'};
    });
   }
  }
  const bundle=makeResultShards(invocation,results,request.pins);bundles.push(bundle);
  const shards=[];
  for(const [index,shard] of bundle.shards.entries())shards.push(await store.write(`${invocation.id}-results-${String(index).padStart(2,'0')}.json`,shard.bytes,262144));
  const counts={pass:0,fail:0,incomplete:0};for(const r of results)counts[r.status]++;
  reports.push({id:invocation.id,expected,counts,shards,cleanup:cleanup??null});
 }
 const union=validateResultUnion(invocations,bundles,request.pins),artifacts=await store.seal();
 return {schema:'marker-qualification-inner-v1',groupId:group.id,pins:request.pins,capacityAccepted:false,passed:union.passed&&closed,completedInvocations,elapsedMs:clock()-began,expected:binding(invocations.flatMap(i=>i.rows)),invocations:reports,cleanup:{closed},artifacts,rootStoppedAttestationRequired:true,terminalOwnUpload:'pending'};
}
