import { notFound } from "next/navigation";

import { ProfileBackendNotice, ProfilePublicPage } from "../../_components/profile-public-page";
import { fetchPublicProfileBySlug } from "@/convex/server";

export const dynamic = "force-dynamic";

type ProfilePageProps = {
  params: Promise<{
    slug: string;
  }>;
};

export default async function PersonProfilePage({ params }: ProfilePageProps) {
  const { slug } = await params;
  const result = await fetchPublicProfileBySlug(slug, "person");

  if (result.kind === "missing-url" || result.kind === "error") {
    return <ProfileBackendNotice kind={result.kind} />;
  }

  if (result.profile === null) {
    notFound();
  }

  return <ProfilePublicPage profile={result.profile} />;
}
