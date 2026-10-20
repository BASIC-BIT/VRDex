import { fetchPublicEventBySlug } from '@/convex/server';
import { eventHostStatusSources } from '@/lib/event-host-status-window';
import { getEventSourceStatuses } from '@/lib/server/event-source-status';
export const dynamic='force-dynamic';
export async function GET(_request:Request,{params}:{params:Promise<{slug:string;eventSlug:string}>}) {
 const {slug,eventSlug}=await params;
 const result=await fetchPublicEventBySlug(eventSlug);
 if(result.kind!=='live') return Response.json({}, {status:503});
 if(!result.event || result.event.communitySlug!==slug) return Response.json({}, {status:404});
 const sources=eventHostStatusSources(result.event,Date.now());
 return Response.json(await getEventSourceStatuses(sources),{headers:{'Cache-Control':'no-store'}});
}
