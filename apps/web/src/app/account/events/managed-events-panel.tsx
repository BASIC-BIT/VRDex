"use client";

import Link from "next/link";
import { useQuery } from "convex/react";
import { api } from "@convex-generated-api";

import { ViewerLocalEventDateTime } from "@/app/_components/viewer-local-event-times";
import { buttonVariants } from "@/components/ui/button";
import { Card, SectionTitle } from "@/components/ui/card";
import { Notice } from "@/components/ui/notice";

function eventState(event: {
  publicationState: "draft_private" | "published";
  status: "scheduled" | "cancelled";
}) {
  if (event.status === "cancelled") return "Cancelled";
  return event.publicationState === "published" ? "Published" : "Draft";
}

export function ManagedEventsPanel() {
  const events = useQuery(api.events.listManagedEvents, { limit: 100 });
  const communities = useQuery(api.events.listManagedCommunities, {});
  const contributions = useQuery(api.eventCorrections.listOwnContributions, {});
  const reportsAllowed = useQuery(api.eventCorrections.getEventReportAccess, {});

  return (
    <main className="grid gap-6">
      <div className="flex flex-wrap items-end justify-between gap-3">
        <SectionTitle>Events</SectionTitle>
        <div className="flex flex-wrap justify-end gap-2">
          <Link className={buttonVariants({ variant: "primary" })} href="/events/new">Add event</Link>
          {reportsAllowed ? <Link className={buttonVariants({ variant: "secondary" })} href="/account/events/reports">Event reports</Link> : null}
          {communities?.map((community) => (
            <Link
              aria-label={`Add event for ${community.displayName}`}
              className={buttonVariants({ variant: "primary" })}
              href={`/${community.slug}/events/create`}
              key={community.profileId}
            >
              {`Manage ${community.displayName} event`}
            </Link>
          ))}
        </div>
      </div>
      {events === undefined ? <p aria-busy="true" className="text-sm text-muted">Loading events…</p> : null}
      {events?.length === 0 && contributions?.length === 0 ? <Notice>No events</Notice> : null}
      <div className="grid gap-3">
        {contributions?.filter(event => !events?.some(managed => managed.eventId === event.eventId)).map(event => <Card key={event.eventId} padding="sm">{event.published && event.eventPath ? <Link className="font-semibold underline-offset-4 hover:underline" href={event.eventPath}>{event.title}</Link> : <span>{event.title} · Retracted</span>}</Card>)}
        {events?.map((event) => (
          <Card className="flex flex-wrap items-center justify-between gap-4" key={event.eventId} padding="sm">
            <div>
              <Link className="text-lg font-semibold underline-offset-4 hover:underline" href={`/${event.communitySlug}/events/${event.slug}/edit`}>
                {event.title}
              </Link>
              <p className="mt-1 text-sm text-muted">
                {event.communityDisplayName} · <ViewerLocalEventDateTime timestamp={event.startAt} eventDate={event.eventDate} scheduleKind={event.scheduleKind} />
              </p>
            </div>
            <span className="text-sm font-medium">{eventState(event)}</span>
          </Card>
        ))}
      </div>
    </main>
  );
}
