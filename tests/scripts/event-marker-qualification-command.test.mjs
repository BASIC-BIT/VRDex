import test from 'node:test';
import assert from 'node:assert/strict';
import { runQualificationCommand } from '../../scripts/event-source-marker-qualification.mjs';
const request={schema:1,runId:'task6-command-test',groupId:'canary-000',revision:'a'.repeat(40),imageDigest:'sha256:'+'b'.repeat(64),sourceManifestSha256:'c'.repeat(64),sourceManifestPath:'/tmp/marker-qualification-sources.json'};
test('qualification command actual wiring cannot turn successful work into acceptance before outer closure',async()=>{
 for(const closed of [true,false]){
  const order=[],writes=[];
  const effects={lstat:async()=>({isFile:()=>true,isSymbolicLink:()=>false,nlink:1,size:100}),readFile:async()=>JSON.stringify(request),mkdir:async()=>{order.push('mkdir');},writeFile:async(path,bytes)=>{order.push('receipt');writes.push(JSON.parse(bytes));},ownerFactory:async()=>({close:async()=>{order.push('close');return {closed,emptyCensuses:closed?2:0};}}),preflight:async()=>({pins:{imageDigest:request.imageDigest}}),workload:async r=>{order.push('work');return {schema:'marker-qualification-inner-v1',groupId:r.groupId,passed:true,cleanup:{closed:true}};}};
  const result=await runQualificationCommand(['--request','/tmp/marker-qualification-request.json'],effects);
  assert.deepEqual(order,['mkdir','work','close','receipt']);assert.equal(writes.length,1);assert.equal(result.passed,closed);assert.equal(writes[0].passed,closed);assert.equal(result.artifactUpload,'root_collector_pending');assert.equal(result.capacityAccepted,false);
 }
});
test('late signal during terminal I/O cannot leave a positive inner result',async()=>{
 const writes=[];let first=true;
 const effects={lstat:async()=>({isFile:()=>true,isSymbolicLink:()=>false,nlink:1,size:100}),readFile:async()=>JSON.stringify(request),mkdir:async()=>{},writeFile:async(path,bytes)=>{writes.push(JSON.parse(bytes));if(first){first=false;process.emit('SIGTERM');}},ownerFactory:async()=>({close:async()=>({closed:true,emptyCensuses:2})}),preflight:async()=>({pins:{}}),workload:async()=>({passed:true})};
 const result=await runQualificationCommand(['--request','/tmp/marker-qualification-request.json'],effects);
 assert.equal(result.passed,false);assert.equal(writes.at(-1).passed,false);assert.equal(writes.at(-1).interrupted,true);
});
