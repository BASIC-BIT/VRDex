import Link from "next/link";
import { HomeSchedule } from "./timeline/home-schedule";

import { PublicSearchControl } from "./public-search-control";
import { buttonVariants } from "@/components/ui/button";
import { BrandLink, PageContainer, PageNav, PageShell } from "@/components/ui/page-shell";

export function HomeSearchPage() {
  return (
    <PageShell>
      <PageContainer className="gap-5" max="7xl">
        <PageNav>
          <BrandLink variant="wordmark" />
          <Link className={buttonVariants({ variant: "ghost" })} href="/discovery">
            Discovery
          </Link>
          <Link className={buttonVariants({ variant: "secondary" })} href="/submit">
            Add profile
          </Link>
        </PageNav>
        <header className="grid gap-4 pt-2">
          <h1 className="text-3xl leading-none font-semibold tracking-[-0.045em] sm:text-5xl">
            DJs, clubs &amp; events
          </h1>
          <PublicSearchControl action="/search" surface="home" tone="default" />
        </header>
        <HomeSchedule />
      </PageContainer>
    </PageShell>
  );
}
