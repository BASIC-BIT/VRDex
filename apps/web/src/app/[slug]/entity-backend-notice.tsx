import Link from "next/link";

import { buttonVariants } from "@/components/ui/button";
import { Card, Eyebrow } from "@/components/ui/card";
import { PageContainer, PageShell } from "@/components/ui/page-shell";
import { cn } from "@/lib/cn";

/**
 * Shown when the root route cannot reach the backend.
 *
 * Separate from the three per-entity notices because this route genuinely does not
 * know what the slug names: the lookup that would have told us is the one that
 * failed. Reusing `ProfileBackendNotice` labelled a world or event outage "Profile
 * read failed".
 *
 * The copy is written for a visitor rather than for whoever is running the app. The
 * per-entity notices say things like "run the local backend bootstrap", which is
 * fine on a page only a developer reaches and wrong on a public link somebody
 * followed from a Discord post.
 *
 * Takes no `kind`. An unset Convex URL and a failed read are the same event to a
 * visitor -- the page is not available right now -- and which one it was is a
 * deployment detail that belongs in the logs, where the fetchers already put it.
 */
export function EntityBackendNotice() {
  return (
    <PageShell className="py-10">
      <PageContainer max="3xl">
        <Card className="shadow-panel" padding="lg">
          <Eyebrow>VRDex</Eyebrow>
          <h1 className="mt-4 text-4xl font-semibold tracking-[-0.04em]">
            This page could not be loaded
          </h1>
          <p className="mt-4 max-w-2xl text-sm leading-7 text-muted">
            Something went wrong on our end, so we could not load this page. Nothing is
            missing or deleted — try again in a moment.
          </p>
          <Link
            className={cn(buttonVariants({ size: "lg", variant: "secondary" }), "mt-6")}
            href="/"
          >
            Back to homepage
          </Link>
        </Card>
      </PageContainer>
    </PageShell>
  );
}
