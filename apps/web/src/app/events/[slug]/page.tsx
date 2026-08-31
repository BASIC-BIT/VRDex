import { notFound, redirect } from "next/navigation";

import { EventBackendNotice, EventPublicPage } from "../../_components/event-public-page";
import { fetchPublicEventBySlug } from "@/convex/server";
import { publicEventPath } from "@/lib/event-path";

export const dynamic = "force-dynamic";

export default async function LegacyEventPage({
  params,
}: {
  params: Promise<{ slug: string }>;
}) {
  const { slug } = await params;
  const result = await fetchPublicEventBySlug(slug);

  if (result.kind === "missing-url" || result.kind === "error") {
    return <EventBackendNotice kind={result.kind} />;
  }

  if (result.event === null) {
    notFound();
  }

  const canonicalPath = publicEventPath(result.event);
  if (canonicalPath !== undefined) {
    redirect(canonicalPath);
  }

  return <EventPublicPage event={result.event} />;
}
