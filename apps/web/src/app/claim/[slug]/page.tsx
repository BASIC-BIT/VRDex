import { notFound } from "next/navigation";

import { ClaimFlow } from "./claim-flow";
import { BrandLink, PageContainer, PageNav, PageShell } from "@/components/ui/page-shell";
import { Notice } from "@/components/ui/notice";
import { fetchClaimProfileBySlug } from "@/convex/server";
import { parseClaimEntrySource } from "@/lib/profile-claim";

export default async function ClaimProfilePage({
  params,
  searchParams,
}: {
  params: Promise<{ slug: string }>;
  searchParams: Promise<{ source?: string | string[] }>;
}) {
  const [{ slug }, resolvedSearchParams] = await Promise.all([params, searchParams]);
  const result = await fetchClaimProfileBySlug(slug);
  const rawSource = Array.isArray(resolvedSearchParams.source)
    ? resolvedSearchParams.source[0]
    : resolvedSearchParams.source;

  if (result.kind === "live" && result.profile === null) {
    notFound();
  }

  return (
    <PageShell className="py-6 sm:py-8">
      <PageContainer max="4xl">
        <PageNav>
          <BrandLink />
        </PageNav>

        {result.kind === "live" && result.profile ? (
          <ClaimFlow
            profile={{
              avatarImageUrl:
                "avatarImageUrl" in result.profile && typeof result.profile.avatarImageUrl === "string"
                  ? result.profile.avatarImageUrl
                  : undefined,
              displayName: result.profile.displayName,
              hasPublicProfile:
                "hasPublicProfile" in result.profile
                  ? result.profile.hasPublicProfile
                  : true,
              profileType: result.profile.profileType,
              slug: result.profile.slug,
            }}
            source={parseClaimEntrySource(rawSource)}
          />
        ) : (
          <Notice variant="dashed">
            Profile claims are temporarily unavailable. Your profile has not been changed.
          </Notice>
        )}
      </PageContainer>
    </PageShell>
  );
}
