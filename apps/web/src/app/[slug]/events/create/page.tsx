import { notFound } from "next/navigation";

import { EventEditorPage } from "../../../events/event-editor-page";
import { fetchPublicProfileBySlug } from "@/convex/server";

export const dynamic = "force-dynamic";

export default async function CommunityEventCreatePage({
  params,
}: {
  params: Promise<{ slug: string }>;
}) {
  const { slug } = await params;
  const result = await fetchPublicProfileBySlug(slug);

  if (result.kind !== "live" || result.profile?.profileType !== "community") {
    notFound();
  }

  return <EventEditorPage communityName={result.profile.displayName} communitySlug={result.profile.slug} />;
}
