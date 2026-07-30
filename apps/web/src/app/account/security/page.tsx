import Link from "next/link";

import { AccountSessionsPanel } from "./account-sessions-panel";
import { buttonVariants } from "@/components/ui/button";
import {
  BrandLink,
  PageContainer,
  PageNav,
  PageShell,
} from "@/components/ui/page-shell";

export default function AccountSecurityPage() {
  return (
    <PageShell className="py-10">
      <PageContainer max="5xl">
        <PageNav>
          <BrandLink />
          <Link
            className={buttonVariants({ variant: "secondary" })}
            href="/account"
          >
            Account
          </Link>
        </PageNav>
        <div className="py-5 sm:py-8">
          <AccountSessionsPanel />
        </div>
      </PageContainer>
    </PageShell>
  );
}
