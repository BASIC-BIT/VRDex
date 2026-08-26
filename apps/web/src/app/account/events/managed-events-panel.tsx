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

  return (
    <main className="grid gap-6">
      <div className="flex flex-wrap items-end justify-between gap-3">
        <SectionTitle>Events</SectionTitle>
        <Link className={buttonVariants({ variant: "primary" })} href="/events/new">Add event</Link>
      </div>
      {events === undefined ? <p aria-busy="true" className="text-sm text-muted">Loading events…</p> : null}
      {events?.length === 0 ? <Notice>No events to manage.</Notice> : null}
      <div className="grid gap-3">
        {events?.map((event) => (
          <Card className="flex flex-wrap items-center justify-between gap-4" key={event.eventId} padding="sm">
            <div>
              <Link className="text-lg font-semibold underline-offset-4 hover:underline" href={`/events/${event.slug}/edit`}>
                {event.title}
              </Link>
              <p className="mt-1 text-sm text-muted">
                {event.communityDisplayName} · <ViewerLocalEventDateTime timestamp={event.startAt} />
              </p>
            </div>
            <span className="text-sm font-medium">{eventState(event)}</span>
          </Card>
        ))}
      </div>
    </main>
  );
}
