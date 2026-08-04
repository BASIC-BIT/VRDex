import { notFound } from "next/navigation";

import { MediaKitPanel } from "./media-kit-panel";
import { ProfileWorkspace } from "../profile-workspace";
import { BrandLink, PageContainer, PageNav, PageShell } from "@/components/ui/page-shell";
import { profileClaimSlugFromInput } from "@/lib/profile-claim";

export default async function MediaKitPage({
  searchParams,
}: {
  searchParams: Promise<{ profile?: string | string[] }>;
}) {
  const demoMode = process.env.VRDEX_ENABLE_PLAYWRIGHT_FIXTURES === "true";
  if (!demoMode && process.env.VRDEX_PROFILE_MEDIA_KIT_ENABLED !== "true") {
    notFound();
  }
  const rawProfile = (await searchParams).profile;
  const initialProfileSlug = profileClaimSlugFromInput(
    (Array.isArray(rawProfile) ? rawProfile[0] : rawProfile)?.slice(0, 120) ?? "",
  );

  return (
    <PageShell className="py-10">
      <PageContainer max="6xl">
        <PageNav>
          <BrandLink />
        </PageNav>

        <ProfileWorkspace activeSlug={initialProfileSlug} mediaKitEnabled tab="media-kit">
          <MediaKitPanel
            demoMode={demoMode}
            generationEnabled={
              demoMode ||
              (process.env.VRDEX_PROFILE_MEDIA_ACCESSIBILITY_GENERATION_ENABLED === "true" &&
                Boolean(process.env.OPENAI_API_KEY?.trim()))
            }
            initialProfileSlug={initialProfileSlug}
          />
        </ProfileWorkspace>
      </PageContainer>
    </PageShell>
  );
}
