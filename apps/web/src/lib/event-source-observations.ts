export type SourceObservation = { state: 'live' | 'offline' | 'unavailable'; observedAt: number };
export type PublicStatusSource = { key: string; url: string };
export function reportedSourceState(value: SourceObservation | undefined, now: number): SourceObservation['state'] | 'unknown' {
 return value && now-value.observedAt<=60_000 && value.observedAt<=now ? value.state : 'unknown';
}
/** Four actual probes globally, with no queued work after a partial response.
 * Provider probes have their own abort deadlines; this also bounds waiting for
 * shared pending cache entries. Omitted sources remain unknown to the caller.
 */
export function createSourceStatusReader(probe: (source: PublicStatusSource)=>Promise<SourceObservation>, now=Date.now, requestTimeoutMs=10_000) {
 const cache=new Map<string,{expiresAt:number; value:Promise<SourceObservation>}>();
 let active=0;
 return async (sources:readonly PublicStatusSource[]):Promise<Record<string,SourceObservation>> => {
  const unique=new Map(sources.map(source=>[source.key,source]));
  const observations:Record<string,SourceObservation>={};
  const pending:Promise<void>[]=[];
  for(const source of unique.values()) {
   let entry=cache.get(source.key);
   if(!entry || entry.expiresAt<=now()) {
    if(active>=4) continue;
    active++;
    const fresh={expiresAt:Infinity,value:Promise.resolve().then(()=>probe(source))};
    fresh.value=fresh.value.catch(():SourceObservation=>({state:'unavailable',observedAt:now()})).then(value=>{
     fresh.expiresAt=now()+30_000;
     return value;
    }).finally(()=>{active--;});
    cache.set(source.key,fresh);
    entry=fresh;
   }
   pending.push(entry.value.then(value=>{observations[source.key]={...value};}));
  }
  let timer:ReturnType<typeof setTimeout>|undefined;
  try {
   await Promise.race([Promise.all(pending),new Promise<void>(resolve=>{timer=setTimeout(resolve,requestTimeoutMs);})]);
  } finally { clearTimeout(timer); }
  for(const [key,entry] of cache) if(entry.expiresAt<=now()) cache.delete(key);
  // Late completion may populate the shared cache, but cannot mutate this reply.
  return {...observations};
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
