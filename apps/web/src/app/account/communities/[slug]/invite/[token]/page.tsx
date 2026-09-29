import type { Metadata } from "next";
import { ClubInvitation } from "../../club-invitation";
import {
  BrandLink,
  PageContainer,
  PageNav,
  PageShell,
} from "@/components/ui/page-shell";
import { ClubErrorBoundary } from "../../club-workspace";

export const metadata: Metadata = {
  title: "Staff invitation | VRDex",
  referrer: "no-referrer",
  robots: {
    follow: false,
    index: false,
  },
};

export default async function InvitationPage({
  params,
}: {
  params: Promise<{ slug: string; token: string }>;
}) {
  const { slug, token } = await params;
  return (
    <PageShell>
      <PageContainer max="3xl">
        <PageNav>
          <BrandLink />
        </PageNav>
        <ClubErrorBoundary key={token}>
          <ClubInvitation communitySlug={slug} token={token} />
        </ClubErrorBoundary>
      </PageContainer>
    </PageShell>
  );
}
