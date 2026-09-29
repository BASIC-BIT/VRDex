import assert from "node:assert/strict";
import { access } from "node:fs/promises";
import test from "node:test";
import { startProofServer } from "../../scripts/event-playback-proof.mjs";

test("proof servers own isolated media and cleanup while another server streams", {skip:process.env.EVENT_PLAYBACK_PROOF!=="true",timeout:30000},async()=>{
 const first=await startProofServer();let second:Awaited<ReturnType<typeof startProofServer>>|undefined;
 const abort=new AbortController();
 try{
  const response=await fetch(`${first.url}/audible.live.ts`,{signal:abort.signal});
  const reader=response.body!.getReader();
  assert.ok((await reader.read()).value?.length);
  second=await startProofServer();
  assert.notEqual(first.mediaDirectory,second.mediaDirectory);
  await access(first.mediaDirectory);await access(second.mediaDirectory);
  assert.ok((await reader.read()).value?.length);
  abort.abort();await first.close();
  await assert.rejects(access(first.mediaDirectory));
  await access(second.mediaDirectory);
  const otherAbort=new AbortController();
  try{
   const other=await fetch(`${second.url}/audible.live.ts`,{signal:otherAbort.signal});
   assert.ok((await other.body!.getReader().read()).value?.length);
  }finally{otherAbort.abort();}
  await second.close();await assert.rejects(access(second.mediaDirectory));
 }finally{abort.abort();try{await first.close();}finally{await second?.close();}}
});
