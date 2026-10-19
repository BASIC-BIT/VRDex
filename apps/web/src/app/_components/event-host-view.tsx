'use client';
import Link from 'next/link';
import { useQuery } from 'convex/react';
import { api } from '@convex-generated-api';
import { useEffect, useState } from 'react';
import { eventLineupForDisplay, type PublicEvent } from './event-public-page';
import { eventDjTarget } from '@/lib/event-dj-target';
import { parseSourceObservations, reportedSourceState, type SourceObservation } from '@/lib/event-source-observations';
import { CopyValueRow } from '@/components/ui/copy-value-row';
import { PageContainer, PageShell } from '@/components/ui/page-shell';
import { ViewerLocalEventTimeRange } from './viewer-local-event-times';
import { publicEventPath } from '@/lib/event-path';
import { vrcdnPlaybackHref } from '../../../../../convex/_vrcdnLinks';

export function EventHostView({event:initialEvent}:{event:PublicEvent}) {
 const projection=useQuery(api.events.getPublicBySlug,{slug:initialEvent.slug});
 const event=projection===undefined ? initialEvent : projection;
 return event ? <EventHostContent event={event}/> : null;
}

export function EventHostContent({event}:{event:PublicEvent}) {
 const [observations,setObservations]=useState<Record<string,SourceObservation>>({});
 const [now,setNow]=useState(0);
 const path=publicEventPath(event);
 useEffect(()=>{
  let cancelled=false;
  const refresh=async()=>{
   setNow(Date.now());
   try {
    const response=await fetch(`${path}/host/status`, {signal:AbortSignal.timeout(10_000)});
    if(response.ok) { const data=parseSourceObservations(await response.json()); if(!cancelled) setObservations(data); }
   } catch { /* Links remain usable during provider failures. */ }
  };
  void refresh(); const timer=setInterval(()=>void refresh(),30_000);
  const clock=setInterval(()=>setNow(Date.now()),1000);
  return ()=>{cancelled=true;clearInterval(timer);clearInterval(clock)};
 },[path]);
 return <PageShell><PageContainer className="py-10 sm:py-16">
  <Link className="text-sm text-muted hover:text-foreground" href={path ?? '/events'}>{event.title}</Link>
  <h1 className="mt-3 text-3xl font-semibold">Host view</h1>
  <div className="mt-8 grid gap-4">
   {eventLineupForDisplay(event).map(row=>{
    const slot=event.slots.find(slot=>slot.playbackKey===row.key);
    const targets=[...new Map((row.performer?.outboundLinks ?? []).flatMap(link=>{const target=eventDjTarget(link.url);return target ? [[target.key,target] as const]:[];})).values()];
    const scheduleEnd=row.endAt ?? eventLineupForDisplay(event).find(next=>next.position>row.position && next.startAt!==undefined)?.startAt ?? event.endAt;
    const scheduled=now>0 && row.startAt!==undefined && row.startAt<=now && scheduleEnd!==undefined && now<scheduleEnd;
    return <section key={row.key} className="min-w-0 rounded-panel border border-border bg-surface-strong p-5 sm:p-6">
     <div className="flex flex-wrap items-baseline justify-between gap-2">
      <h2 className="text-xl font-semibold [overflow-wrap:anywhere]">{row.performer?.displayName ?? row.displayLabel}</h2>
      {row.startAt!==undefined ? <span className="text-sm text-muted"><ViewerLocalEventTimeRange startAt={row.startAt} endAt={row.endAt}/>{scheduled ? ' · Scheduled now' : ''}</span>:null}
     </div>
     {row.roleLabel ? <p className="mt-1 text-sm text-muted">{row.roleLabel}</p>:null}
     <div className="mt-4 grid gap-3 lg:grid-cols-2">
      {targets.length===0 ? <span className="text-sm text-muted">No links</span>:targets.map(target=><div className="min-w-0 rounded-control border border-border p-3" key={target.key}>
       <div className="mb-2 flex flex-wrap items-center justify-between gap-2 text-sm">
        <span className="font-medium">{target.pcUrl ? `VRCDN · ${target.label}` : target.label}{slot?.stream && target.key===`vrcdn:${slot.stream.streamId}` ? ' · Selected source' : ''}</span>
        <span className="text-muted" title={observations[target.key] ? new Date(observations[target.key].observedAt).toISOString():undefined}>{reportedSourceState(observations[target.key],now)==='live' ? 'Live now':reportedSourceState(observations[target.key],now)==='offline' ? 'Offline':'Unavailable'}</span>
       </div>
       {target.pcUrl && target.questUrl ? <><CopyValueRow label="PC" value={target.pcUrl}/><CopyValueRow label="Quest" value={target.questUrl}/></>:<CopyValueRow label="Twitch" value={target.url}/>}
       <a className="mt-2 inline-block text-sm text-accent hover:underline" href={vrcdnPlaybackHref(target.url) ?? target.url} target="_blank" rel="noreferrer">Open</a>
      </div>)}
     </div>
    </section>;
   })}
  </div>
 </PageContainer></PageShell>;
}
