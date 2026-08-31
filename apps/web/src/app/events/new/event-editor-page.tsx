import Link from "next/link";

import { EventEditorForm } from "../event-editor-form";
import { buttonVariants } from "@/components/ui/button";
import { BrandLink, PageContainer, PageNav, PageShell } from "@/components/ui/page-shell";

export function EventEditorPage({ demoMode = false }: { demoMode?: boolean }) {
  return (
    <PageShell className="py-10">
      <PageContainer max="6xl">
        <PageNav>
          <BrandLink />
          <Link className={buttonVariants({ variant: "secondary" })} href="/account/events">
            Events
          </Link>
        </PageNav>

        <header className="border-b border-border pb-6 pt-2">
          <h1 className="text-4xl font-semibold tracking-[-0.04em] sm:text-5xl">Add event</h1>
        </header>

        <EventEditorForm demoMode={demoMode} />
      </PageContainer>
    </PageShell>
  );
}
