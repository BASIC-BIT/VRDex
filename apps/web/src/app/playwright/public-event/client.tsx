"use client";

import { useMemo } from "react";
import { ConvexProvider, type ConvexReactClient } from "convex/react";
import { getFunctionName, type FunctionReference } from "convex/server";
import { EventPublicPage, type PublicEvent } from "../../_components/event-public-page";

/** Static public-route fixture. The server selects this only under its fixture gate. */
export function PublicEventFixture({ event }: { event: PublicEvent }) {
  const client = useMemo(() => ({
    watchQuery(query: FunctionReference<"query">, args: { slug: string }) {
      if (getFunctionName(query) !== "events:getPublicBySlug" || args.slug !== event.slug) {
        throw new Error("Unexpected public event fixture query");
      }
      return {
        localQueryResult: () => event,
        onUpdate: () => () => {},
        journal: () => undefined,
      };
    },
  }) as unknown as ConvexReactClient, [event]);

  return <ConvexProvider client={client}><EventPublicPage event={event} /></ConvexProvider>;
}
