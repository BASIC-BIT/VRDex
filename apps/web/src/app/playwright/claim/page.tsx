import { BrandLink, PageContainer, PageNav, PageShell } from "@/components/ui/page-shell";
import { notFound } from "next/navigation";
import { ClaimFlowPreview } from "./preview";

export default function PlaywrightClaimPage() {
  if (
    process.env.NODE_ENV === "production" &&
    process.env.VRDEX_ENABLE_PLAYWRIGHT_FIXTURES !== "true"
  ) {
    notFound();
  }

  return (
    <PageShell className="py-6 sm:py-8">
      <PageContainer max="4xl">
        <PageNav accountMode="signed-out">
          <BrandLink />
        </PageNav>
        <ClaimFlowPreview />
      </PageContainer>
    </PageShell>
  );
}
