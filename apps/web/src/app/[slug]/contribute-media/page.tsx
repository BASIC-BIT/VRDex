import { notFound } from "next/navigation";

import { ProfileMediaContributionForm } from "./profile-media-contribution-form";
import { BrandLink, PageContainer, PageNav, PageShell } from "@/components/ui/page-shell";
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
  const result = await fetchPublicProfileBySlug(slug);
  if (result.kind !== "live" || result.profile === null) notFound();
  const profile = result.profile;
  if (profile.trustLabel !== "unclaimed" && profile.trustLabel !== "community_submitted") {
    notFound();
  }
  if (profile.id === undefined || profile.updatedAt === undefined) notFound();

  return (
    <PageShell className="py-10">
      <PageContainer max="3xl">
        <PageNav>
          <BrandLink />
        </PageNav>
        <ProfileMediaContributionForm
          profile={{
            id: profile.id,
            slug: profile.slug,
            displayName: profile.displayName,
            profileType: profile.profileType,
            updatedAt: profile.updatedAt,
          }}
        />
      </PageContainer>
    </PageShell>
  );
}
