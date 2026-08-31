import { notFound } from "next/navigation";

import { EventBackendNotice, EventPublicPage } from "../../../_components/event-public-page";
import { fetchPublicEventBySlug } from "@/convex/server";

export const dynamic = "force-dynamic";

export default async function CommunityEventPage({
  params,
}: {
  params: Promise<{ eventSlug: string; slug: string }>;
}) {
  const { eventSlug, slug } = await params;
  const result = await fetchPublicEventBySlug(eventSlug);

  if (result.kind === "missing-url" || result.kind === "error") {
    return <EventBackendNotice kind={result.kind} />;
  }

  if (result.event === null || result.event.communitySlug !== slug) {
    notFound();
  }

  return <EventPublicPage event={result.event} showEditLink />;
}
