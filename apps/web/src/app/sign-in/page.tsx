import Link from "next/link";

import { SignInForm } from "./sign-in-form";
import { buttonVariants } from "@/components/ui/button";
import { Card, Eyebrow } from "@/components/ui/card";
import { BrandLink, PageContainer, PageNav, PageShell } from "@/components/ui/page-shell";

export default function SignInPage() {
  return (
    <PageShell className="py-10">
      <PageContainer max="4xl">
        <PageNav>
          <BrandLink />
          <Link className={buttonVariants({ variant: "secondary" })} href="/account">
            Account
          </Link>
        </PageNav>

        <section className="overflow-hidden rounded-hero border border-border bg-surface shadow-hero backdrop-blur">
          <div className="grid gap-8 px-6 py-8 sm:px-8 lg:grid-cols-[0.9fr_1.1fr] lg:px-10 lg:py-10">
            <div>
              <Eyebrow>Account access</Eyebrow>
              <h1 className="mt-5 text-4xl leading-none font-semibold tracking-[-0.04em] sm:text-6xl">
                Sign in to claim and manage profiles.
              </h1>
              <p className="mt-5 max-w-xl text-base leading-7 text-muted sm:text-lg">
                Use Discord, Google, or verified email/password. Claims and owner controls stay separate from the login provider so VRDex can accept multiple proof sources over time.
              </p>
            </div>

            <Card surface="glass">
              <SignInForm />
            </Card>
          </div>
        </section>
      </PageContainer>
    </PageShell>
  );
}
