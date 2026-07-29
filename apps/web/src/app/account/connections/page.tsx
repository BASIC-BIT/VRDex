import Link from "next/link";

import { ConnectionsPanel } from "./connections-panel";
import { buttonVariants } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { Notice } from "@/components/ui/notice";
import { parseDiscordVerifyStatus } from "@/lib/profile-claim";
import { BrandLink, PageContainer, PageNav, PageShell } from "@/components/ui/page-shell";

export default async function ConnectionsPage({
  searchParams,
}: {
  searchParams: Promise<{ profileSlug?: string | string[]; discordVerify?: string | string[] }>;
}) {
  const params = await searchParams;
  const requestedSlug = params.profileSlug;
  const initialProfileSlug = Array.isArray(requestedSlug) ? requestedSlug[0] : requestedSlug;
  // This page is the `returnTo` for its own "Verify Discord servers" link, so
  // it is where a declined or failed round-trip lands. Without reading the
  // outcome the user came back to an unchanged page with nothing to say the
  // check had not worked.
  const rawDiscordVerify = params.discordVerify;
  const discordVerify = parseDiscordVerifyStatus(
    Array.isArray(rawDiscordVerify) ? rawDiscordVerify[0] : rawDiscordVerify,
  );

  return (
    <PageShell className="py-10">
      <PageContainer max="6xl">
        <PageNav>
          <BrandLink />
          <div className="flex flex-wrap gap-2">
            <Link className={buttonVariants({ variant: "secondary" })} href="/account">
              Account
            </Link>
            <Link className={buttonVariants({ variant: "secondary" })} href="/account/privacy">
              Privacy
            </Link>
          </div>
        </PageNav>

        <Card className="shadow-hero" padding="lg">
          <h1 className="text-3xl leading-none font-semibold sm:text-4xl">Connections</h1>
          <p className="mt-3 max-w-2xl text-base leading-7 text-muted">
            Discord servers and VRChat groups you have proved you control, and which profiles they
            represent. Connecting is separate from claiming: proving you administer a server does
            not by itself say which community it stands for.
          </p>
          {discordVerify === null || discordVerify === "verified" ? null : (
            <Notice className="mt-6" variant={discordVerify === "declined" ? "info" : "error"}>
              {discordVerify === "declined"
                ? "You cancelled the Discord check. Nothing changed."
                : "That Discord check could not finish. Nothing changed; try again."}
            </Notice>
          )}

          <div className="mt-8">
            <ConnectionsPanel initialProfileSlug={initialProfileSlug} />
          </div>
        </Card>
      </PageContainer>
    </PageShell>
  );
}
