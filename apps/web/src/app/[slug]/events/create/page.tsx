import { notFound } from "next/navigation";

import { EventBackendNotice } from "../../../_components/event-public-page";
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

  if (result.kind === "missing-url" || result.kind === "error") {
    return <EventBackendNotice kind={result.kind} />;
  }

  if (result.community === null) {
    notFound();
  }

  return <EventEditorPage communityName={result.community.displayName} communitySlug={result.community.slug} />;
}
