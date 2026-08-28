import { notFound } from "next/navigation";
import Link from "next/link";

import { MediaKitPanel } from "./media-kit-panel";
import { DEMO_MEDIA_KIT_WORKSPACE_PROFILES, ProfileWorkspace } from "../profile-workspace";
import { BrandLink, PageContainer, PageNav, PageShell } from "@/components/ui/page-shell";
import { buttonVariants } from "@/components/ui/button";
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

        <ProfileWorkspace
          activeSlug={initialProfileSlug}
          mediaKitEnabled
          previewProfiles={demoMode ? DEMO_MEDIA_KIT_WORKSPACE_PROFILES : undefined}
          tab="media-kit"
        >
          {/* The active tab already names this surface, but the panel still
              needs its own landmark heading — matching Privacy, Connections and
              Personalization. */}
          <div className="flex flex-wrap items-center justify-between gap-3">
            <h2 className="text-xl font-semibold">Media kit</h2>
            <Link className={buttonVariants({ size: "sm", variant: "secondary" })} href="/account/media-review">
              Review contributions
            </Link>
          </div>
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
