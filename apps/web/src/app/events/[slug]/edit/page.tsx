import { redirect } from "next/navigation";

import { fetchEditableEventBySlug } from "@/convex/server";

export const dynamic = "force-dynamic";

export default async function LegacyEditEventPage({
  params,
}: {
  params: Promise<{ slug: string }>;
}) {
  const { slug } = await params;
  const result = await fetchEditableEventBySlug(slug);

  if (result.kind === "live" && result.event?.communitySlug) {
    redirect(`/${result.event.communitySlug}/events/${slug}/edit`);
  }

  redirect("/account/events");
}
