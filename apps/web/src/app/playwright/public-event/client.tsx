"use client";

import { useMemo } from "react";
import { ConvexProvider, type ConvexReactClient } from "convex/react";
import { getFunctionName, type FunctionReference } from "convex/server";
import { EventPublicPage, type PublicEvent } from "../../_components/event-public-page";

import { EventHostView } from "../../_components/event-host-view";

/** Static public-route fixture. The server selects this only under its fixture gate. */
export function PublicEventFixture({ event, host = false }: { event: PublicEvent; host?: boolean }) {
  const client = useMemo(() => ({
    watchQuery(query: FunctionReference<"query">, args: { slug: string; communitySlug?: string }) {
      if (getFunctionName(query) !== (host ? "events:getHostBySlug" : "events:getPublicBySlug") || args.slug !== event.slug || (host && args.communitySlug !== event.communitySlug)) {
        throw new Error("Unexpected public event fixture query");
      }
      return {
        localQueryResult: () => event,
        onUpdate: () => () => {},
        journal: () => undefined,
      };
    },
  }) as unknown as ConvexReactClient, [event, host]);

  return <ConvexProvider client={client}>{host ? <EventHostView event={event} /> : <EventPublicPage event={event} />}</ConvexProvider>;
}
