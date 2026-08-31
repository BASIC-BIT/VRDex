import Link from "next/link";

import { EventEditorForm } from "./event-editor-form";
import { buttonVariants } from "@/components/ui/button";
import { BrandLink, PageContainer, PageNav, PageShell } from "@/components/ui/page-shell";

export function EventEditorPage({
  communityName,
  communitySlug,
  demoMode = false,
}: {
  communityName: string;
  communitySlug: string;
  demoMode?: boolean;
}) {
  return (
    <div className="ph-no-capture" data-ph-no-capture>
      <PageShell className="py-10">
        <PageContainer max="6xl">
        <PageNav>
          <BrandLink />
          <Link className={buttonVariants({ variant: "secondary" })} href="/account/events">
            Events
          </Link>
        </PageNav>

        <header className="border-b border-border pb-6 pt-2">
          <Link className="text-sm font-medium text-muted underline-offset-4 hover:underline" href={`/${communitySlug}`}>
            {communityName}
          </Link>
          <h1 className="mt-2 text-4xl font-semibold tracking-[-0.04em] sm:text-5xl">Add event</h1>
        </header>

        <EventEditorForm communitySlug={communitySlug} demoMode={demoMode} />
        </PageContainer>
      </PageShell>
    </div>
  );
}
