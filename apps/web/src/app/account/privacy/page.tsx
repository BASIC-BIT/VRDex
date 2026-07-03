import Link from "next/link";

import { PrivacyPanel } from "./privacy-panel";
import { buttonVariants } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { BrandLink, PageContainer, PageNav, PageShell } from "@/components/ui/page-shell";

export default function PrivacyPage() {
  const demoMode = process.env.VRDEX_ENABLE_PLAYWRIGHT_FIXTURES === "true";

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
          <h1 className="max-w-4xl text-4xl leading-none font-semibold sm:text-6xl">
            Control what your claimed profiles show.
          </h1>
          <p className="mt-5 max-w-2xl text-base leading-7 text-muted">
            Set supported fields to public, unlisted, or private.
          </p>
          <div className="mt-8">
            <PrivacyPanel demoMode={demoMode} />
          </div>
        </Card>
      </PageContainer>
    </PageShell>
  );
}
