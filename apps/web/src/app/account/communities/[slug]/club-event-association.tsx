"use client";

import { useState } from "react";
import { useMutation, usePaginatedQuery, useQuery } from "convex/react";
import { api } from "@convex-generated-api";
import type { Id } from "../../../../../../../convex/_generated/dataModel";
import { Button } from "@/components/ui/button";
import { Field, Select } from "@/components/ui/field";
import { Notice } from "@/components/ui/notice";
import { useClubWorkspace } from "./club-workspace";

export function ClubEventAssociation({
  sessionId,
}: {
  sessionId: Id<"instanceSessions">;
}) {
  const data = useClubWorkspace();
  const allowed =
    data.actor.kind === "owner" ||
    data.actor.permissions.includes("manage_events");
  const events = usePaginatedQuery(
    api.clubProviderReads.listEvents,
    allowed ? { communityProfileId: data.community._id } : "skip",
    { initialNumItems: 50 },
  );
  const associate = useMutation(api.communityTelemetry.associateEventInstance);
  const association = useQuery(
    api.communityTelemetry.getInstanceEventAssociation,
    allowed ? { communitySlug: data.community.slug, sessionId } : "skip",
  );
  const [eventId, setEventId] = useState("");
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState<string | null>(null);
  if (!allowed) return null;
  if (association)
    return <p className="mt-5 text-sm">Event: {association.title}</p>;
  return (
    <form
      className="mt-5 flex flex-wrap items-end gap-3"
      onSubmit={async (event) => {
        event.preventDefault();
        setBusy(true);
        setMessage(null);
        try {
          await associate({
            communitySlug: data.community.slug,
            sessionId,
            eventId: eventId as Id<"events">,
          });
          setMessage("Event associated.");
        } catch (error) {
          setMessage(
            error instanceof Error ? error.message : "Association failed.",
          );
        } finally {
          setBusy(false);
        }
      }}
    >
      <Field>
        Event
        <Select
          aria-label="Event"
          value={eventId}
          onChange={(event) => setEventId(event.target.value)}
          required
        >
          <option value="">Select event</option>
          {events.results.map((event) => (
            <option key={event.id} value={event.id}>
              {event.title} · {new Date(event.startAt).toLocaleDateString()}
            </option>
          ))}
        </Select>
      </Field>
      <Button type="submit" disabled={!eventId || busy}>
        Associate event
      </Button>
      {events.status === "CanLoadMore" ? (
        <Button type="button" onClick={() => events.loadMore(50)}>
          Load more events
        </Button>
      ) : null}
      {message ? <Notice role="status">{message}</Notice> : null}
    </form>
  );
}
