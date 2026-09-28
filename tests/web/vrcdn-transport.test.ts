import assert from "node:assert/strict";
import test from "node:test";
import { attachVrcdnTransport, releaseVrcdnTransport, type VrcdnTransport } from "../../apps/web/src/lib/vrcdn-transport";
test("transport cleanup attempts every release step when an earlier step throws",()=>{
 const calls:string[]=[];
 const player=Object.fromEntries(["pause","unload","detachMediaElement","destroy"].map(method=>[method,()=>{calls.push(method);if(method==="pause")throw new Error("already detached");}])) as unknown as VrcdnTransport;
 releaseVrcdnTransport(player);
 assert.deepEqual(calls,["pause","unload","detachMediaElement","destroy"]);
});
test("failed load releases the partially attached transport",()=>{
 const calls:string[]=[];
 const player={on(){},attachMediaElement(){},load(){throw new Error("load failed");},pause(){calls.push("pause");},unload(){calls.push("unload");},detachMediaElement(){calls.push("detach");},destroy(){calls.push("destroy");}};
 const library={createPlayer:()=>player,Events:{ERROR:"error",LOADING_COMPLETE:"complete"}} as unknown as Parameters<typeof attachVrcdnTransport>[0];
 assert.throws(()=>attachVrcdnTransport(library,{} as HTMLVideoElement,"url",{onError(){}}),/load failed/);
 assert.deepEqual(calls,["pause","unload","detach","destroy"]);
});
