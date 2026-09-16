"use client";
import { useState } from "react";
import { ConvexProvider, type ConvexReactClient } from "convex/react";
import { getFunctionName, type FunctionReference } from "convex/server";
import { EventPublicPage } from "../../_components/event-public-page";
import { VrcdnStreamPlayer } from "../../_components/vrcdn-stream-player";
import { previewEvent } from "../event-editor/preview";
import type { PublicEvent } from "../../_components/event-public-page";

// Mocked subscription boundary only. Backend projection has integration tests in
// event-playback-projection.test.ts. This route exercises the real query hook/player.
function setup() {
 const params = new URLSearchParams(location.search);
 const base = params.get("transport");
 if (!base || !/^http:\/\/127\.0\.0\.1:\d+$/.test(base)) throw new Error("Loopback transport required");
 const realNow = Date.now;
 let scheduleNow = 1_000_000;
 Date.now = () => scheduleNow;
 const source = (id: string, kind: string) => ({streamId:id,pcUrl:`${base}/${kind}.live.ts?id=${id}`,questUrl:`${base}/${kind}.live.ts?id=${id}`});
 const a = {...previewEvent.slots[0],playbackKey:"a",startAt:900_000,endAt:1_240_000,displayLabel:"Aurora",performer:{slug:"aurora",displayName:"Aurora",trustLabel:"claimed_verified" as const,outboundLinks:[{source:"owner_authored" as const,type:"website" as const,label:"Public source",url:"https://example.com/public-source"}]},stream:source("current",params.get("kind") ?? "audible")};
 const b = {...a,playbackKey:"b",startAt:1_240_000,endAt:1_500_000,displayLabel:"Lumen",performer:{...a.performer,slug:"lumen",displayName:"Lumen"},stream:source("next","audible")};
 let event: PublicEvent | null = {...previewEvent,title:"Lineup live",startAt:900_000,endAt:1_500_000,doorsOpenAt:900_000,watchSurfaceEnabled:true,watchMode:"performer_sequence",slots:[a,b]};
 const initial = event;
 const listeners = new Set<() => void>();
 const client = {watchQuery(query:FunctionReference<"query">) {
   if (getFunctionName(query) !== "events:getPublicBySlug") throw new Error("Unexpected subscription");
   return {localQueryResult:()=>event,onUpdate:(callback:()=>void)=>{listeners.add(callback);return ()=>{listeners.delete(callback);};},journal:()=>undefined};
 }} as unknown as ConvexReactClient;
 return {client,initial,base,restore:()=>{Date.now=realNow;},setTime:(at:number)=>{scheduleNow=at;Date.now=()=>scheduleNow;document.dispatchEvent(new Event("visibilitychange"));},change:(kind:string)=>{
   if (kind==="unpublish") event=null;
   else if (event) {
     if (kind==="cancel") event={...event,status:"cancelled"};
     if (kind==="hide") event={...event,slots:event.slots.map(slot=>({...slot,stream:undefined,performer:slot.performer?{...slot.performer,outboundLinks:[]}:undefined}))};
     if (kind==="replace") event={...event,slots:event.slots.map(slot=>({...slot,playbackKey:slot.playbackKey+"-new"}))};
     if (kind==="duplicate") event={...event,slots:[{...a,playbackKey:"x"},{...a,playbackKey:"y"},b]};
     if (kind==="missing") event={...event,slots:[a,{...b,stream:undefined},{...b,playbackKey:"c",startAt:1_500_000}]};
     if (kind==="overlap") event={...event,slots:[a,{...b,startAt:1_200_000}]};
     if (kind==="event-stream") event={...event,watchMode:"event_stream",mediaLinks:[{type:"vrcdn",label:"Event stream",url:"vrcdn:fixture",presentation:"open"}]};
   }
   listeners.forEach(listener=>listener());
 },listeners};
}
export default function Fixture() {
 const [fixture]=useState(setup);
 const [mounted,setMounted]=useState(true);
 const [baseline,setBaseline]=useState(false);
 return <main className="mx-auto max-w-3xl space-y-5 p-5"><h1>Lineup playback fixture</h1>
  <div className="flex flex-wrap gap-3">{[["Before event",800_000],["Before window",1_000_000],["Eligible",1_121_000],["Next slot",1_250_000],["After end",1_600_000]].map(([label,at])=><button key={label} onClick={()=>fixture.setTime(Number(at))}>{label}</button>)}
  {["hide","cancel","unpublish","replace","duplicate","missing","overlap","event-stream"].map(action=><button key={action} onClick={()=>fixture.change(action)}>{action}</button>)}
  <button onClick={()=>{setMounted(false);setBaseline(false);}}>Unmount</button><button onClick={()=>{setMounted(false);setBaseline(true);}}>Profile player</button>
  </div>
  <ConvexProvider client={fixture.client}>{mounted&&<EventPublicPage event={fixture.initial}/>}</ConvexProvider>
  {baseline&&<VrcdnStreamPlayer title="Profile stream" src={`${fixture.base}/audible.live.ts?id=profile`}/>}
 </main>;
}
