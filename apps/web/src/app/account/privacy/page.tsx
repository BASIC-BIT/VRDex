import Link from "next/link";

import { PrivacyPanel } from "./privacy-panel";
import { buttonVariants } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { BrandLink, PageContainer, PageNav, PageShell } from "@/components/ui/page-shell";

export default async function PrivacyPage({
  searchParams,
}: {
  searchParams: Promise<{ profileId?: string | string[] }>;
}) {
  const demoMode = process.env.VRDEX_ENABLE_PLAYWRIGHT_FIXTURES === "true";
  const requestedProfileId = (await searchParams).profileId;
  const initialProfileId = Array.isArray(requestedProfileId)
    ? requestedProfileId[0]
    : requestedProfileId;

  return (
    <PageShell className="py-10">
      <PageContainer max="6xl">
        <PageNav>
          <BrandLink />
          <div className="flex flex-wrap gap-2">
            <Link className={buttonVariants({ variant: "secondary" })} href="/account">
              Account
            </Link>
            <Link className={buttonVariants({ variant: "secondary" })} href="/account/appearance">
              Appearance
            </Link>
          </div>
        </PageNav>

        <Card className="shadow-hero" padding="lg">
          <h1 className="text-3xl leading-none font-semibold sm:text-4xl">
            Privacy Controls
          </h1>
          <div className="mt-8">
            <PrivacyPanel demoMode={demoMode} initialProfileId={initialProfileId} />
          </div>
        </Card>
      </PageContainer>
    </PageShell>
  );
}
