import { fetchQuery } from "convex/nextjs";
import { notFound, redirect } from "next/navigation";
import { api } from "@convex-generated-api";
import { convexAuthToken, signInPath } from "@/lib/server/auth";
import { fetchPublicEventBySlug } from "@/convex/server";
import { EventOperatorView } from "../../../../_components/event-operator-view";

export const dynamic = "force-dynamic";
export default async function EventOperatePage({
  params,
}: {
  params: Promise<{ slug: string; eventSlug: string }>;
}) {
  const { slug, eventSlug } = await params;
  const token = await convexAuthToken();
  if (!token) redirect(signInPath(`/${slug}/events/${eventSlug}/operate`));
  // Authenticate and authorize before fetching or serializing any private payload.
  let status;
  try {
    status = await fetchQuery(
      api.events.getEventMediaControlStatus,
      { currentSlug: eventSlug },
      { token },
    );
  } catch {
    notFound();
  }
  if (status.eventPath !== `/${slug}/events/${eventSlug}`)
    notFound();
  const result = await fetchPublicEventBySlug(eventSlug);
  return (
    <EventOperatorView
      currentSlug={eventSlug}
      initialStatus={status}
      event={result.kind === "live" ? (result.event ?? undefined) : undefined}
    />
  );
}
