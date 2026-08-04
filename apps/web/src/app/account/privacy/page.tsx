import { PrivacyPanel } from "./privacy-panel";
import { ProfileWorkspace } from "../profile-workspace";
import { Card } from "@/components/ui/card";
import { BrandLink, PageContainer, PageNav, PageShell } from "@/components/ui/page-shell";

export default async function PrivacyPage({
  searchParams,
}: {
  searchParams: Promise<{ profileId?: string | string[] }>;
}) {
  const demoMode = process.env.VRDEX_ENABLE_PLAYWRIGHT_FIXTURES === "true";
  const mediaKitEnabled =
    process.env.VRDEX_PROFILE_MEDIA_KIT_ENABLED === "true" || demoMode;
  const requestedProfileId = (await searchParams).profileId;
  const initialProfileId = Array.isArray(requestedProfileId)
    ? requestedProfileId[0]
    : requestedProfileId;

  return (
    <PageShell className="py-10">
      <PageContainer max="6xl">
        <PageNav>
          <BrandLink />
        </PageNav>

        <ProfileWorkspace
          activeProfileId={initialProfileId}
          mediaKitEnabled={mediaKitEnabled}
          tab="privacy"
        >
          <Card className="shadow-hero" padding="lg">
            <PrivacyPanel demoMode={demoMode} initialProfileId={initialProfileId} />
          </Card>
        </ProfileWorkspace>
      </PageContainer>
    </PageShell>
  );
}
