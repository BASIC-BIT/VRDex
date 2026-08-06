import Link from "next/link";
import { Suspense } from "react";

import { SupportRequestForm } from "./support-request-form";
import { buttonVariants } from "@/components/ui/button";
import { Card, Eyebrow } from "@/components/ui/card";
import { BrandLink, PageContainer, PageNav, PageShell } from "@/components/ui/page-shell";

export const dynamic = "force-dynamic";

export const metadata = {
  title: "Contact VRDex",
  description: "Report an ownership dispute, transfer or recover a profile, or send feedback.",
};

export default function SupportPage() {
  return (
    <PageShell>
      <PageContainer max="4xl">
        <PageNav>
          <BrandLink />
          <Link className={buttonVariants({ variant: "secondary" })} href="/">
            Back to discovery
          </Link>
        </PageNav>

        <Card className="shadow-hero" padding="lg">
          <Eyebrow>Contact and requests</Eyebrow>
          <h1 className="mt-4 text-4xl leading-none font-semibold tracking-[-0.04em] sm:text-6xl">
            Tell us what you need.
          </h1>
        </Card>

        <Card>
          {/* `useSearchParams` reads the `?topic=` deep link the claim page and
              the footer send people through, and the App Router requires a
              boundary around any client component that calls it. */}
          <Suspense>
            <SupportRequestForm />
          </Suspense>
        </Card>
      </PageContainer>
    </PageShell>
  );
}
