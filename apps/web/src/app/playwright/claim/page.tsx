import { BrandLink, PageContainer, PageNav, PageShell } from "@/components/ui/page-shell";
import { notFound } from "next/navigation";
import { ClaimFlowPreview } from "./preview";

export default async function PlaywrightClaimPage({
  searchParams,
}: {
  searchParams: Promise<{
    noDiscord?: string | string[];
    noVrclinking?: string | string[];
    private?: string | string[];
  }>;
}) {
  if (
    process.env.NODE_ENV === "production" &&
    process.env.VRDEX_ENABLE_PLAYWRIGHT_FIXTURES !== "true"
  ) {
    notFound();
  }

  const params = await searchParams;
  const first = (value: string | string[] | undefined) =>
    Array.isArray(value) ? value[0] : value;
  const privateProfile = first(params.private) === "1";
  const discordLinked = first(params.noDiscord) !== "1";
  const vrclinkingConfigured = first(params.noVrclinking) !== "1";

  return (
    <PageShell className="py-6 sm:py-8">
      <PageContainer max="4xl">
        <PageNav accountMode="signed-out">
          <BrandLink />
        </PageNav>
        <ClaimFlowPreview
          discordLinked={discordLinked}
          privateProfile={privateProfile}
          vrclinkingConfigured={vrclinkingConfigured}
        />
      </PageContainer>
    </PageShell>
  );
}
