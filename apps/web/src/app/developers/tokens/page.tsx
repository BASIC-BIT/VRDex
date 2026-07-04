import Link from "next/link";

import { DeveloperTokensPanel } from "./developer-tokens-panel";
import { buttonVariants } from "@/components/ui/button";
import { BrandLink, PageContainer, PageNav, PageShell } from "@/components/ui/page-shell";

export const metadata = {
  title: "Developer Tokens | VRDex",
};

export default function DeveloperTokensPage() {
  return (
    <PageShell className="py-10">
      <PageContainer max="6xl">
        <PageNav>
          <BrandLink />
          <div className="flex flex-wrap gap-3">
            <Link className={buttonVariants({ variant: "secondary" })} href="/developers/api">
              API reference
            </Link>
            <Link className={buttonVariants({ variant: "secondary" })} href="/account">
              Account
            </Link>
          </div>
        </PageNav>

        <section className="grid gap-8">
          <div className="flex flex-col justify-between gap-5 lg:flex-row lg:items-end">
            <div>
              <h1 className="text-4xl leading-none font-semibold sm:text-6xl">Developer tokens</h1>
              <p className="mt-5 max-w-2xl text-sm leading-7 text-muted">
                Create scoped personal tokens for API clients, local scripts, and MCP tools.
              </p>
            </div>
            <Link className={buttonVariants({ size: "lg", variant: "primary" })} href="/developers/api">
              View API docs
            </Link>
          </div>

          <DeveloperTokensPanel />
        </section>
      </PageContainer>
    </PageShell>
  );
}
