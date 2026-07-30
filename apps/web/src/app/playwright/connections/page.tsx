import { notFound } from "next/navigation";

import { ConnectionsPanelPreview } from "./preview";
import { Card } from "@/components/ui/card";
import { BrandLink, PageContainer, PageNav, PageShell } from "@/components/ui/page-shell";

export default async function PlaywrightConnectionsPage({
  searchParams,
}: {
  searchParams: Promise<{ community?: string | string[] }>;
}) {
  if (
    process.env.NODE_ENV === "production" &&
    process.env.VRDEX_ENABLE_PLAYWRIGHT_FIXTURES !== "true"
  ) {
    notFound();
  }

  const rawCommunity = (await searchParams).community;
  const community = (Array.isArray(rawCommunity) ? rawCommunity[0] : rawCommunity) === "1";

  return (
    <PageShell className="py-10">
      <PageContainer max="6xl">
        <PageNav accountMode="signed-out">
          <BrandLink />
        </PageNav>

        <Card className="shadow-hero" padding="lg">
          <h1 className="text-3xl leading-none font-semibold sm:text-4xl">Connections</h1>
          <p className="mt-3 max-w-2xl text-base leading-7 text-muted">
            Discord servers and VRChat groups you have proved you control, and which profiles they
            represent. Connecting is separate from claiming: proving you administer a server does
            not by itself say which community it stands for.
          </p>
          <div className="mt-8">
            <ConnectionsPanelPreview community={community} />
          </div>
        </Card>
      </PageContainer>
    </PageShell>
  );
}
