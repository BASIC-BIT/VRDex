import Link from "next/link";

import { OAuthAppsPanel } from "./oauth-apps-panel";
import { buttonVariants } from "@/components/ui/button";
import { BrandLink, PageContainer, PageNav, PageShell } from "@/components/ui/page-shell";

export const metadata = {
  title: "OAuth Apps | VRDex",
};

export default function OAuthAppsPage() {
  return (
    <PageShell className="py-10">
      <PageContainer max="6xl">
        <PageNav>
          <BrandLink />
          <div className="flex flex-wrap gap-3">
            <Link className={buttonVariants({ variant: "secondary" })} href="/developers/tokens">
              Developer tokens
            </Link>
            <Link className={buttonVariants({ variant: "secondary" })} href="/developers/api">
              API reference
            </Link>
          </div>
        </PageNav>

        <section className="grid gap-8">
          <div className="flex flex-col justify-between gap-5 lg:flex-row lg:items-end">
            <div>
              <h1 className="text-4xl leading-none font-semibold sm:text-6xl">OAuth apps</h1>
              <p className="mt-5 max-w-2xl text-sm leading-7 text-muted">
                Register clients for OAuth authorization and hosted MCP access.
              </p>
            </div>
            <Link className={buttonVariants({ size: "lg", variant: "primary" })} href="/developers/api">
              View API docs
            </Link>
          </div>

          <OAuthAppsPanel />
        </section>
      </PageContainer>
    </PageShell>
  );
}
