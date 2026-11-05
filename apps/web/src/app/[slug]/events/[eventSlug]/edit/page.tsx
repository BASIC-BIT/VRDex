import { EventEditPage } from "../../../../events/event-edit-page";

export const dynamic = "force-dynamic";

export default async function CommunityEventEditPage({
  params,
  searchParams,
}: {
  params: Promise<{ eventSlug: string; slug: string }>;
  searchParams: Promise<{ scope?: string }>;
}) {
  const { eventSlug, slug } = await params;
  const { scope } = await searchParams;
  return <EventEditPage communitySlug={slug} eventSlug={eventSlug} scope={scope} />;
}
