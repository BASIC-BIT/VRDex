import Link from "next/link";

import { SuppressionRequestForm } from "./suppression-request-form";
import { buttonVariants } from "@/components/ui/button";
import { Card, Eyebrow } from "@/components/ui/card";
import { BrandLink, PageContainer, PageNav, PageShell } from "@/components/ui/page-shell";

export const dynamic = "force-dynamic";

export default function SuppressionRequestPage() {
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
          <Eyebrow>Privacy and suppression</Eyebrow>
          <h1 className="mt-4 text-4xl leading-none font-semibold tracking-[-0.04em] sm:text-6xl">
            Request review of a public listing.
          </h1>
        </Card>

        <Card>
          <SuppressionRequestForm />
        </Card>
      </PageContainer>
    </PageShell>
  );
}
