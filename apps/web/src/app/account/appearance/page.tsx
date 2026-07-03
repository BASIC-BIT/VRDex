import Link from "next/link";

import { AppearancePanel } from "./appearance-panel";
import { buttonVariants } from "@/components/ui/button";
import { Card, Eyebrow } from "@/components/ui/card";
import { BrandLink, PageContainer, PageNav, PageShell } from "@/components/ui/page-shell";

export default function AppearancePage() {
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
            <Link className={buttonVariants({ variant: "secondary" })} href="/submit">
              Add profile
            </Link>
          </div>
        </PageNav>

        <Card className="shadow-hero" padding="lg">
          <Eyebrow>Appearance</Eyebrow>
          <h1 className="mt-5 max-w-4xl text-4xl leading-none font-semibold tracking-[-0.04em] sm:text-6xl">
            Shape your public profile presentation.
          </h1>
          <p className="mt-5 max-w-2xl text-base leading-7 text-muted">
            Tune the avatar frame and arrange the main public sections.
          </p>
          <div className="mt-8">
            <AppearancePanel demoMode={demoMode} />
          </div>
        </Card>
      </PageContainer>
    </PageShell>
  );
}
