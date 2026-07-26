import { BrandLink, PageContainer, PageNav, PageShell } from "@/components/ui/page-shell";
import { notFound } from "next/navigation";
import { ClaimFlowPreview } from "./preview";

export default async function PlaywrightClaimPage({
  searchParams,
}: {
  searchParams: Promise<{ private?: string | string[] }>;
}) {
  if (
    process.env.NODE_ENV === "production" &&
    process.env.VRDEX_ENABLE_PLAYWRIGHT_FIXTURES !== "true"
  ) {
    notFound();
  }

  const rawPrivate = (await searchParams).private;
  const privateProfile = (Array.isArray(rawPrivate) ? rawPrivate[0] : rawPrivate) === "1";

  return (
    <PageShell className="py-6 sm:py-8">
      <PageContainer max="4xl">
        <PageNav accountMode="signed-out">
          <BrandLink />
        </PageNav>
        <ClaimFlowPreview privateProfile={privateProfile} />
      </PageContainer>
    </PageShell>
  );
}
