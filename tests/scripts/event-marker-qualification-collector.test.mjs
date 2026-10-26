import test from 'node:test';
import assert from 'node:assert/strict';
import { collectQualification } from '../../scripts/marker-qualification/collector.mjs';
const request={runId:'task6-collector-test',groupId:'canary-000',directory:'/tmp/marker-qualification-task6-collector-test-canary-000'};
const clean={closed:true,emptyCensuses:2},inner={schema:'marker-qualification-inner-v1',groupId:request.groupId,passed:true,capacityAccepted:false,outerCleanup:clean,cleanup:{closed:true},artifacts:[{name:'x.json',bytes:1,sha256:'a'.repeat(64)}],pins:{},expected:{count:1},invocations:[]};
test('collector requires actual exit, complete artifact binding and closed owners before upload',async()=>{
 for(const fault of ['none','exit','closure','sha','late']){
  const order=[],uploaded=[],owners=[];
  const effects={ownerFactory:async()=>{const owner={run:async(command,args)=>{order.push(command);if(command==='node'&&fault==='exit')throw Error('encode_failure');},close:async()=>{order.push('closed');return fault==='closure'?{closed:false}:clean;}};owners.push(owner);return owner;},readInner:async()=>structuredClone(inner),inventory:async()=>[{name:'x.json',bytes:1,sha256:(fault==='sha'?'b':'a').repeat(64)},{name:'receipt.json',bytes:10,sha256:'c'.repeat(64)}],writeTerminal:async terminal=>{order.push('terminal');if(fault==='late')effects.interrupt();return {name:'terminal.json',bytes:100,sha256:'d'.repeat(64)};},upload:async(owner,file)=>{assert(order.includes('closed'));uploaded.push(file.name);}};
  const result=await collectQualification(request,effects);
  assert.equal(result.workPassed,fault==='none');assert.equal(result.capacityAccepted,false);
  if(fault==='closure')assert.equal(uploaded.length,0);
  if(fault==='late')assert(!uploaded.includes('terminal.json'));
  assert.equal(result.terminalOwnUpload==='complete',fault==='none'||fault==='exit'||fault==='sha');
 }
});
