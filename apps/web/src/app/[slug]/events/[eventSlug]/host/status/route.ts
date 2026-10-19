import { fetchPublicEventBySlug } from '@/convex/server';
import { eventDjTarget } from '@/lib/event-dj-target';
import { getEventSourceStatuses } from '@/lib/server/event-source-status';
export const dynamic='force-dynamic';
export async function GET(_request:Request,{params}:{params:Promise<{slug:string;eventSlug:string}>}) {
 const {slug,eventSlug}=await params;
 const result=await fetchPublicEventBySlug(eventSlug);
 if(result.kind!=='live') return Response.json({}, {status:503});
 if(!result.event || result.event.communitySlug!==slug) return Response.json({}, {status:404});
 const sources=(result.event.lineup ?? [...result.event.slots, ...result.event.participants.map(performer=>({performer}))]).flatMap(row=>(row.performer?.outboundLinks ?? []).flatMap(link=>{const target=eventDjTarget(link.url);return target ? [{key:target.key,url:target.url}]:[]}));
 return Response.json(await getEventSourceStatuses(sources),{headers:{'Cache-Control':'no-store'}});
}
