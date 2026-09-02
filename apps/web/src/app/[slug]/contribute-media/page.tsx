import { notFound, redirect } from "next/navigation";

import { fetchPublicProfileBySlug } from "@/convex/server";

export const dynamic = "force-dynamic";

export default async function ProfileMediaContributionPage({
  params,
}: {
  params: Promise<{ slug: string }>;
}) {
  if (
    process.env.VRDEX_PROFILE_MEDIA_SUBMISSIONS_ENABLED !== "true" &&
    process.env.VRDEX_ENABLE_PLAYWRIGHT_FIXTURES !== "true"
  ) {
    notFound();
  }
  const { slug } = await params;
  // This lookup only authorizes an immediate redirect, so provider liveness
  // must not add the VRCDN probe's latency to the redirect path.
  const result = await fetchPublicProfileBySlug(slug, undefined, { includeLiveState: false });
  if (result.kind !== "live" || result.profile === null) notFound();
  if (
    result.profile.trustLabel !== "unclaimed" &&
    result.profile.trustLabel !== "community_submitted"
  ) {
    notFound();
  }
  redirect(`/${encodeURIComponent(slug)}/edit?section=media#media-contributions`);
}
