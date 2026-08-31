import { notFound } from "next/navigation";

import { EventEditorPage } from "../../../events/event-editor-page";
import { fetchManagedCommunityBySlug } from "@/convex/server";

export const dynamic = "force-dynamic";

export default async function CommunityEventCreatePage({
  params,
}: {
  params: Promise<{ slug: string }>;
}) {
  const { slug } = await params;
  const result = await fetchManagedCommunityBySlug(slug);

  if (result.kind !== "live" || result.community === null) {
    notFound();
  }

  return <EventEditorPage communityName={result.community.displayName} communitySlug={result.community.slug} />;
}
