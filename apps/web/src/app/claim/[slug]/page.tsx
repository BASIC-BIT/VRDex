import { notFound } from "next/navigation";

import { ClaimFlow } from "./claim-flow";
import { BrandLink, PageContainer, PageNav, PageShell } from "@/components/ui/page-shell";
import { Notice } from "@/components/ui/notice";
import { fetchClaimProfileBySlug } from "@/convex/server";
import { validClaimJourneyId } from "@/lib/claim-analytics";
import { parseClaimEntrySource, parseDiscordVerifyStatus } from "@/lib/profile-claim";

export default async function ClaimProfilePage({
  params,
  searchParams,
}: {
  params: Promise<{ slug: string }>;
  searchParams: Promise<{
    source?: string | string[];
    discordVerify?: string | string[];
    analyticsJourneyId?: string | string[];
  }>;
}) {
  const [{ slug }, resolvedSearchParams] = await Promise.all([params, searchParams]);
  const result = await fetchClaimProfileBySlug(slug);
  const rawSource = Array.isArray(resolvedSearchParams.source)
    ? resolvedSearchParams.source[0]
    : resolvedSearchParams.source;
  const rawDiscordVerify = Array.isArray(resolvedSearchParams.discordVerify)
    ? resolvedSearchParams.discordVerify[0]
    : resolvedSearchParams.discordVerify;
  const rawAnalyticsJourneyId = Array.isArray(resolvedSearchParams.analyticsJourneyId)
    ? resolvedSearchParams.analyticsJourneyId[0]
    : resolvedSearchParams.analyticsJourneyId;

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
            initialAnalyticsJourneyId={
              validClaimJourneyId(rawAnalyticsJourneyId)
                ? rawAnalyticsJourneyId
                : crypto.randomUUID()
            }
            reservedAnalyticsJourneyId={crypto.randomUUID()}
            profile={{
              avatarAppearance:
                "avatarAppearance" in result.profile && result.profile.avatarAppearance
                  ? result.profile.avatarAppearance
                  : "mediaKit" in result.profile && result.profile.mediaKit?.avatarAppearance
                    ? result.profile.mediaKit.avatarAppearance
                  : undefined,
              avatarImageUrl:
                "avatarImageUrl" in result.profile && typeof result.profile.avatarImageUrl === "string"
                  ? result.profile.avatarImageUrl
                  : undefined,
              displayName: result.profile.displayName,
              hasPublicProfile:
                "hasPublicProfile" in result.profile
                  ? result.profile.hasPublicProfile
                  : true,
              profileId:
                "profileId" in result.profile && typeof result.profile.profileId === "string"
                  ? result.profile.profileId
                  : undefined,
              profileType: result.profile.profileType,
              slug: result.profile.slug,
            }}
            discordVerify={parseDiscordVerifyStatus(rawDiscordVerify)}
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
