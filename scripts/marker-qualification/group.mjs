import { readFileSync } from 'node:fs';
import { enumerateQualification,binding } from './authority.mjs';
import { createArtifactStore,createInvocationStore } from './artifacts.mjs';
import { createQualificationOwner } from './owner.mjs';
import { runLiteralInvocation } from './literal-runner.mjs';
import { evaluateClassifierCase,makeResultShards,validateResultUnion,prerequisiteStates } from './results.mjs';
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
  const expected=binding(invocation.rows),scope=createInvocationStore(store,invocation);
  const incomplete=(reason,previous=[])=>invocation.rows.map((_,index)=>({index,status:'incomplete',reason,prerequisites:invocation.kind==='literal'?'not_applicable':{...(previous[index]?.prerequisites??prerequisiteStates('not_run'))}}));
  let owner,cleanup,results,expired=false;
  if(stopped||clock()-began>=workMs)results=incomplete('unrun');
  else {
   owner=await ownerFactory();onOwner(owner);const beganInvocation=clock();
   const limit=Math.min(workMs-(beganInvocation-began),invocation.kind==='compressed-source'?360000:invocation.kind==='association'?110000:90000);
   const timeout=setTimeout(()=>{expired=true;void owner.close().catch(()=>{});},limit);timeout.unref?.();
   try {results=await execute(invocation,{owner,store:scope});}
   catch(error){results=incomplete(['byte_cap','invocation_byte_cap'].includes(error.message)?'byte_cap':'unrun');}
   finally {
    clearTimeout(timeout);expired ||= clock()-beganInvocation>=limit;
    try{cleanup=await owner.close();}catch{cleanup={closed:false,reason:'process_leak'};}
    onOwner(undefined,owner);completedInvocations++;
   }
   for(const result of results)if(result.prerequisites&&typeof result.prerequisites==='object')result.prerequisites.physical_children_closed=cleanup.closed===true?'pass':'fail';
   closed &&= cleanup.closed===true;
   if(!closed||expired){stopped=true;results=incomplete(!closed?'process_leak':'timeout',results);}
   else {
    results=results.map(result=>{
     if(invocation.kind==='literal')result.prerequisites='not_applicable';
     else if(result.prerequisites)result.prerequisites.physical_children_closed='pass';
     if(result.status)return result;
     if(result.kind==='classifier')return {index:result.index,prerequisites:result.prerequisites,observation:result.observation,...evaluateClassifierCase(invocation.rows[result.index],result.prerequisites,result.evidence)};
     // Association/bridge executors return their observed semantic verdict only
     // after all other prerequisites; physical closure is imposed here.
     if(result.kind==='association'&&result.evaluate)return {index:result.index,prerequisites:result.prerequisites,observation:result.observation,...result.evaluate(result.prerequisites)};
     return incomplete('unrun')[result.index];
    });
   }
  }
  if(results.some(r=>r.reason==='byte_cap'))results=incomplete('byte_cap',results);
  let bundle,budget;
  try{bundle=makeResultShards(invocation,results,request.pins);budget=scope.checkFinal(bundle.shards.map(s=>s.bytes));}
  catch(error){results=incomplete(['byte_cap','invocation_byte_cap','qualification_result_shard_bound'].includes(error.message)?'byte_cap':'invalid_result',results);bundle=makeResultShards(invocation,results,request.pins);if(bundle.shards.reduce((n,s)=>n+s.length,0)>65536)throw Error('qualification_failure_reserve');budget=scope.checkFinal(bundle.shards.map(s=>s.bytes));}
  bundles.push(bundle);
  const shards=[];
  for(const [index,shard] of bundle.shards.entries())shards.push(await store.write(`${invocation.id}-results-${String(index).padStart(2,'0')}.json.gz`,shard.bytes,262144));
  const counts={pass:0,fail:0,incomplete:0};for(const r of results)counts[r.status]++;
  reports.push({id:invocation.id,expected,counts,shards,budget,cleanup:cleanup??null});
 }
 const union=validateResultUnion(invocations,bundles,request.pins,name=>readFileSync(store.path(name))),artifacts=await store.seal();
 return {schema:'marker-qualification-inner-v1',groupId:group.id,pins:request.pins,capacityAccepted:false,passed:union.passed&&closed,completedInvocations,elapsedMs:clock()-began,expected:binding(invocations.flatMap(i=>i.rows)),invocations:reports,cleanup:{closed},artifacts,rootStoppedAttestationRequired:true,terminalOwnUpload:'pending'};
}
