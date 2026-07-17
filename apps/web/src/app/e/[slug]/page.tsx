import { notFound } from "next/navigation";

import { EventBackendNotice, EventPublicPage } from "../../_components/event-public-page";
import { fetchPublicEventBySlug } from "@/convex/server";

export const dynamic = "force-dynamic";

type EventPageProps = {
  params: Promise<{
    slug: string;
  }>;
};

export default async function EventPage({ params }: EventPageProps) {
  const { slug } = await params;
  const result = await fetchPublicEventBySlug(slug);

  if (result.kind === "missing-url" || result.kind === "error") {
    return <EventBackendNotice kind={result.kind} />;
  }

  if (result.event === null) {
    notFound();
  }

  return <EventPublicPage event={result.event} showEditLink />;
}
