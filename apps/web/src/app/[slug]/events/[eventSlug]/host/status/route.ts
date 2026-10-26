import { fetchHostEventBySlug } from '@/convex/server';
import { eventHostStatusSources } from '@/lib/event-host-status-window';
import { getEventSourceStatuses } from '@/lib/server/event-source-status';
export const dynamic='force-dynamic';
export async function GET(request:Request,{params}:{params:Promise<{slug:string;eventSlug:string}>}) {
 const {slug,eventSlug}=await params;
 const result=await fetchHostEventBySlug(eventSlug,slug);
 if(result.kind!=='live') return Response.json({}, {status:503,headers:{'Cache-Control':'private, no-store'}});
 if(!result.event || result.event.communitySlug!==slug) return Response.json({}, {status:404,headers:{'Cache-Control':'private, no-store'}});
 const requested=new URL(request.url).searchParams.get('sources');
 if(requested && (requested.length>1024 || requested.split(',').length>4)) return Response.json({}, {status:400,headers:{'Cache-Control':'private, no-store'}});
 const sources=eventHostStatusSources(result.event,Date.now(),requested?.split(',')??[]);
 return Response.json(await getEventSourceStatuses(sources),{headers:{'Cache-Control':'private, no-store'}});
}
