import type { Metadata } from "next";
import { notFound } from "next/navigation";

import { EventBackendNotice, EventPublicPage } from "../../../_components/event-public-page";
import { fetchPublicEventBySlug, fetchPublicEventShareCard } from "@/convex/server";
import { eventShareMetadata } from "@/lib/event-share-card";

export const dynamic = "force-dynamic";

type CommunityEventPageProps = {
  params: Promise<{ eventSlug: string; slug: string }>;
};

export async function generateMetadata({
  params,
}: CommunityEventPageProps): Promise<Metadata> {
  const { eventSlug, slug } = await params;
  const result = await fetchPublicEventShareCard(slug, eventSlug);

  return result.kind === "live" && result.event !== null
    ? eventShareMetadata(result.event)
    : {};
}

export default async function CommunityEventPage({
  params,
}: CommunityEventPageProps) {
  const { eventSlug, slug } = await params;
  const result = await fetchPublicEventBySlug(eventSlug);

  if (result.kind === "missing-url" || result.kind === "error") {
    return <EventBackendNotice kind={result.kind} />;
  }

  if (result.event === null || result.event.communitySlug !== slug) {
    notFound();
  }

  return <EventPublicPage event={result.event} />;
}
