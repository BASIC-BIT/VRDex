import Link from "next/link";

import { AccountPanel } from "./account-panel";
import { buttonVariants } from "@/components/ui/button";
import { Card, Eyebrow } from "@/components/ui/card";
import { BrandLink, PageContainer, PageNav, PageShell } from "@/components/ui/page-shell";

export default function AccountPage() {
  return (
    <PageShell className="py-10">
      <PageContainer max="5xl">
        <PageNav>
          <BrandLink />
          <Link className={buttonVariants({ variant: "secondary" })} href="/sign-in">
            Sign in
          </Link>
        </PageNav>

        <Card className="shadow-hero" padding="lg">
          <Eyebrow>Account</Eyebrow>
          <h1 className="mt-5 text-4xl leading-none font-semibold tracking-[-0.04em] sm:text-6xl">
            Your VRDex account and claim readiness.
          </h1>
          <div className="mt-8">
            <AccountPanel />
          </div>
        </Card>
      </PageContainer>
    </PageShell>
  );
}
