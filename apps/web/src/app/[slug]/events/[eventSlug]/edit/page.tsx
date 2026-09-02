import { EventEditPage } from "../../../../events/event-edit-page";

export const dynamic = "force-dynamic";

export default async function CommunityEventEditPage({
  params,
}: {
  params: Promise<{ eventSlug: string; slug: string }>;
}) {
  const { eventSlug, slug } = await params;
  return <EventEditPage communitySlug={slug} eventSlug={eventSlug} />;
}
