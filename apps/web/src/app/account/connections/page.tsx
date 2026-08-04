import { ConnectionsPanel } from "./connections-panel";
import { ProfileWorkspace } from "../profile-workspace";
import { isVrclinkingSecretStoreConfigured } from "@/lib/server/vrclinking-secret-store";
import { Card } from "@/components/ui/card";
import { Notice } from "@/components/ui/notice";
import { parseDiscordVerifyStatus } from "@/lib/profile-claim";
import { BrandLink, PageContainer, PageNav, PageShell } from "@/components/ui/page-shell";

export default async function ConnectionsPage({
  searchParams,
}: {
  searchParams: Promise<{ profileSlug?: string | string[]; discordVerify?: string | string[] }>;
}) {
  const mediaKitEnabled =
    process.env.VRDEX_PROFILE_MEDIA_KIT_ENABLED === "true" ||
    process.env.VRDEX_ENABLE_PLAYWRIGHT_FIXTURES === "true";
  const params = await searchParams;
  const requestedSlug = params.profileSlug;
  const initialProfileSlug = Array.isArray(requestedSlug) ? requestedSlug[0] : requestedSlug;
  // This page is the `returnTo` for its own "Verify Discord servers" link, so
  // it is where a declined or failed round-trip lands. Without reading the
  // outcome the user came back to an unchanged page with nothing to say the
  // check had not worked.
  const rawDiscordVerify = params.discordVerify;
  const discordVerify = parseDiscordVerifyStatus(
    Array.isArray(rawDiscordVerify) ? rawDiscordVerify[0] : rawDiscordVerify,
  );

  return (
    <PageShell className="py-10">
      <PageContainer max="6xl">
        <PageNav>
          <BrandLink />
        </PageNav>

        <ProfileWorkspace
          activeSlug={initialProfileSlug}
          mediaKitEnabled={mediaKitEnabled}
          tab="connections"
        >
        <Card className="shadow-hero" padding="lg">
          <h2 className="text-xl font-semibold">Connections</h2>
          <p className="mt-3 max-w-2xl text-base leading-7 text-muted">
            Discord servers and VRChat groups you have proved you control, and which profiles they
            represent. Connecting is separate from claiming: proving you administer a server does
            not by itself say which community it stands for.
          </p>
          {discordVerify === null || discordVerify === "verified" ? null : (
            <Notice className="mt-6" variant={discordVerify === "declined" ? "info" : "error"}>
              {discordVerify === "declined"
                ? "You cancelled the Discord check. Nothing changed."
                : "That Discord check could not finish. Nothing changed; try again."}
            </Notice>
          )}

          <div className="mt-8">
            <ConnectionsPanel
              delegationEnabled={isVrclinkingSecretStoreConfigured()}
              initialProfileSlug={initialProfileSlug}
            />
          </div>
        </Card>
        </ProfileWorkspace>
      </PageContainer>
    </PageShell>
  );
}
