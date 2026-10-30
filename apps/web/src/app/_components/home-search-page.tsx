import Link from "next/link";
import styles from "./home-browse.module.css";
import { HomeBrowseProvider } from "./home-browse-provider";
import { HomeDiscovery } from "./discovery/home-discovery";
import { HomeSchedule } from "./timeline/home-schedule";

import { PublicSearchControl } from "./public-search-control";
import { buttonVariants } from "@/components/ui/button";
import {
  BrandLink,
  PageContainer,
  PageNav,
  PageShell,
} from "@/components/ui/page-shell";

export function HomeSearchPage() {
  return (
    <PageShell>
      <PageContainer className={styles.home} max="7xl">
        <PageNav>
          <BrandLink variant="wordmark" />
          <Link
            className={buttonVariants({ variant: "ghost" })}
            href="/discovery"
          >
            Discovery
          </Link>
          <Link
            className={buttonVariants({ variant: "secondary" })}
            href="/submit"
          >
            Add profile
          </Link>
        </PageNav>
        <header className={styles.searchRow}>
          <h1 className={styles.searchHeading}>DJs, clubs &amp; events</h1>
          <PublicSearchControl action="/search" surface="home" tone="default" />
        </header>
        <HomeBrowseProvider>
          <HomeSchedule />
          <HomeDiscovery />
        </HomeBrowseProvider>
      </PageContainer>
    </PageShell>
  );
}
