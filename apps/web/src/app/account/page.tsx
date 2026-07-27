import { AccountSessionBoundary } from "./account-session-boundary";
import { BrandLink, PageContainer, PageNav, PageShell } from "@/components/ui/page-shell";
import { redirect } from "next/navigation";
import { profileClaimPath, profileClaimSlugFromInput } from "@/lib/profile-claim";

export default async function AccountPage({
  searchParams,
}: {
  searchParams: Promise<{ claim?: string | string[]; claimType?: string | string[] }>;
}) {
  const resolvedSearchParams = await searchParams;
  const rawClaim = resolvedSearchParams.claim;
  const defaultClaimSlug = profileClaimSlugFromInput(
    (Array.isArray(rawClaim) ? rawClaim[0] : rawClaim)?.slice(0, 240) ?? "",
  );

  if (defaultClaimSlug) {
    redirect(profileClaimPath(defaultClaimSlug, "account"));
  }

  return (
    <PageShell className="py-10">
      <PageContainer max="5xl">
        <PageNav>
          <BrandLink />
        </PageNav>

        <header className="py-5 sm:py-8">
          <h1 className="text-3xl font-semibold sm:text-4xl">Account</h1>
        </header>

        <AccountSessionBoundary
          mediaKitEnabled={
            process.env.VRDEX_PROFILE_MEDIA_KIT_ENABLED === "true" ||
            process.env.VRDEX_ENABLE_PLAYWRIGHT_FIXTURES === "true"
          }
        />
      </PageContainer>
    </PageShell>
  );
}
