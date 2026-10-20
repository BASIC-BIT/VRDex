"use client";
import { Profiler, useEffect, useState } from "react";
import { ConvexProviderWithAuth, useQuery, type ConvexReactClient } from "convex/react";
import { getFunctionName, type FunctionReference } from "convex/server";
import { api } from "@convex-generated-api";
import { eventPlaybackRequest } from "@/lib/event-playback-request";
import { EventPublicPage } from "../../_components/event-public-page";
import { EventLineupPlayer } from "../../_components/event-lineup-player";
import { EventWatchSurface } from "../../_components/event-watch-surface";
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
 return {client,initial,base,readProjection:()=>event,composed:params.has("composed"),restore:()=>{Date.now=realNow;},setTime:(at:number)=>{scheduleNow=at;Date.now=()=>scheduleNow;document.dispatchEvent(new Event("visibilitychange"));},change:(kind:string)=>{
   if (kind==="unpublish") event=null;
   else if (event) {
     if (kind==="cancel") event={...event,status:"cancelled"};
     if (kind==="hide") event={...event,slots:event.slots.map(slot=>({...slot,stream:undefined,performer:slot.performer?{...slot.performer,outboundLinks:[]}:undefined}))};
     if (kind==="swap-source") event={...event,slots:event.slots.map(slot=>({...slot,stream:source("replacement","audible")}))};
     if (kind==="replace") event={...event,slots:event.slots.map(slot=>({...slot,playbackKey:slot.playbackKey+"-new"}))};
     if (kind==="duplicate") event={...event,slots:[{...a,playbackKey:"x"},{...a,playbackKey:"y"},b]};
     if (kind==="missing") event={...event,slots:[a,{...b,stream:undefined},{...b,playbackKey:"c",startAt:1_500_000}]};
     if (kind==="third") event={...event,endAt:1_800_000,slots:[a,b,{...b,playbackKey:"c",startAt:1_500_000,endAt:1_800_000,stream:source("third","audible")}]};
     if (kind==="overlap") event={...event,slots:[a,{...b,startAt:1_200_000}]};
     if (kind==="event-stream") event={...event,watchMode:"event_stream",mediaLinks:[{type:"vrcdn",label:"Event stream",url:"vrcdn:fixture",presentation:"open"}]};
   }
   listeners.forEach(listener=>listener());
 },listeners};
}
// This older suite exercises standalone component lifetimes. The retained root
// owner has its own production-transport navigation and revocation fixture.
function StandaloneProjection({ initial }: { initial: PublicEvent }) {
 const projection = useQuery(api.events.getPublicBySlug, { slug: initial.slug });
 const event = projection === undefined ? initial : projection;
 const request = eventPlaybackRequest(event);
 if (!event || !request) return null;
 return <><h2>{event.title}</h2><span>{event.slots[0]?.displayLabel}</span>{request.kind === "performer_sequence"
  ? <EventLineupPlayer event={request.event} />
  : <EventWatchSurface enabled startAt={event.startAt!} doorsOpenAt={event.doorsOpenAt} endAt={event.endAt} mediaLinks={event.mediaLinks} />}</>;
}
const useAnonymousFixtureAuth = () => ({ isLoading: false, isAuthenticated: false, fetchAccessToken: async () => null });
export default function Fixture() {
 const [fixture]=useState(setup);
 useEffect(() => {
  if (!fixture.composed) return;
  // Public HTTP projection is synthetic; the production root polling helper runs.
  const original = window.fetch;
  window.fetch = async (input, init) => {
   if (typeof input === "string" && new URL(input, location.href).pathname === "/api/query" && typeof init?.body === "string" && JSON.parse(init.body).path === "events:getPublicBySlug") {
    return new Response(JSON.stringify({ status: "success", value: fixture.readProjection() }), { headers: { "Content-Type": "application/json" } });
   }
   return original(input, init);
  };
  return () => { window.fetch = original; };
 }, [fixture]);
 const [mounted,setMounted]=useState(true);
 const [baseline,setBaseline]=useState(false);
 return <main className="mx-auto max-w-3xl space-y-5 p-5"><h1>Lineup playback fixture</h1>
  <div className="flex flex-wrap gap-3">{[["Before event",800_000],["Before window",1_000_000],["Just before eligible",1_119_999],["Exactly eligible",1_120_000],["Eligible",1_121_000],["Boundary",1_240_000],["Next slot",1_250_000],["Later eligible",1_381_000],["After end",1_600_000]].map(([label,at])=><button key={label} onClick={()=>fixture.setTime(Number(at))}>{label}</button>)}
  {["third","swap-source","hide","cancel","unpublish","replace","duplicate","missing","overlap","event-stream"].map(action=><button key={action} onClick={()=>fixture.change(action)}>{action}</button>)}
  <button onClick={()=>{setMounted(false);setBaseline(false);}}>Unmount</button><button onClick={()=>{setMounted(false);setBaseline(true);}}>Profile player</button>
  </div>
  <ConvexProviderWithAuth client={fixture.client} useAuth={useAnonymousFixtureAuth}>{mounted&&<Profiler id="lineup" onRender={()=>{const target=window as unknown as {lineupCommits?:number};target.lineupCommits=(target.lineupCommits??0)+1;}}>{fixture.composed ? <EventPublicPage event={fixture.initial}/> : <StandaloneProjection initial={fixture.initial}/>}</Profiler>}</ConvexProviderWithAuth>
  {baseline&&<VrcdnStreamPlayer title="Profile stream" src={`${fixture.base}/audible.live.ts?id=profile`}/>}
 </main>;
}
