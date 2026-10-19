export type SourceObservation = { state: 'live' | 'offline' | 'unavailable'; observedAt: number };
export type PublicStatusSource = { key: string; url: string };
export function reportedSourceState(value: SourceObservation | undefined, now: number): SourceObservation['state'] {
 return value && now-value.observedAt<=60_000 && value.observedAt<=now ? value.state : 'unavailable';
}
/** Shared queue bounds probes across simultaneous event requests. */
export function createSourceStatusReader(probe: (source: PublicStatusSource)=>Promise<SourceObservation>, now=Date.now) {
 const cache=new Map<string,{expiresAt:number; value:Promise<SourceObservation>}>();
 let active=0;
 const queue:Array<()=>void>=[];
 async function check(source:PublicStatusSource):Promise<SourceObservation> {
  if(active>=4) await new Promise<void>(resolve=>queue.push(resolve));
  else active++;
  try { return await probe(source); }
  catch { return {state:'unavailable',observedAt:now()}; }
  finally { const next=queue.shift(); if(next) next(); else active--; }
 }
 return async (sources:readonly PublicStatusSource[]):Promise<Record<string,SourceObservation>> => {
  const unique=new Map(sources.map(source=>[source.key,source]));
  const entries=await Promise.all([...unique.values()].map(async source=>{
   let entry=cache.get(source.key);
   if(!entry || entry.expiresAt<=now()) { entry={expiresAt:now()+30_000,value:check(source)}; cache.set(source.key,entry); }
   const value=await entry.value;
   return [source.key,{...value,state:reportedSourceState(value,now())}] as const;
  }));
  for(const [key,entry] of cache) if(entry.expiresAt<=now()) cache.delete(key);
  return Object.fromEntries(entries);
 };
}

export function parseSourceObservations(value: unknown): Record<string, SourceObservation> {
 if(typeof value!=='object' || value===null || Array.isArray(value)) return {};
 const entries: Array<[string,SourceObservation]> = [];
 for(const [key,observation] of Object.entries(value)) {
  if(typeof observation!=='object' || observation===null || !('state' in observation) || !('observedAt' in observation)) continue;
  if((observation.state==='live' || observation.state==='offline' || observation.state==='unavailable') && typeof observation.observedAt==='number' && Number.isFinite(observation.observedAt)) entries.push([key,{state:observation.state,observedAt:observation.observedAt}]);
 }
 return Object.fromEntries(entries);
}
