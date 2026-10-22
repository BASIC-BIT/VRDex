import { notFound } from 'next/navigation';
import { fetchHostEventBySlug } from '@/convex/server';
import { EventHostView } from '../../../../_components/event-host-view';
import { EventBackendNotice } from '../../../../_components/event-public-page';
import { getPlaywrightPublicEventFixture } from '@/convex/playwright-fixtures';
import { PublicEventFixture } from '../../../../playwright/public-event/client';
export const dynamic='force-dynamic';
export default async function EventHostPage({params}:{params:Promise<{slug:string;eventSlug:string}>}) {
 const {slug,eventSlug}=await params;
 const result=await fetchHostEventBySlug(eventSlug,slug);
 if(result.kind==='error' || result.kind==='missing-url') return <EventBackendNotice kind={result.kind}/>;
 if(!result.event || result.event.communitySlug!==slug) notFound();
 if(getPlaywrightPublicEventFixture(eventSlug)) return <PublicEventFixture event={result.event} host/>;
 return <EventHostView event={result.event}/>;
}
