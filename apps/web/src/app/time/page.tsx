import { BrandLink, PageContainer, PageNav, PageShell } from "@/components/ui/page-shell";

import { TemporalParser } from "./temporal-parser";

export default function TimePage() {
  return (
    <PageShell tone="public">
      <PageContainer max="4xl">
        <PageNav>
          <BrandLink />
        </PageNav>
        <header className="py-5 sm:py-8">
          <h1 className="text-3xl font-semibold tracking-[-0.04em] sm:text-4xl">VRDex Time</h1>
          <p className="mt-3 max-w-2xl text-sm leading-6 text-muted">
            Turn phrases like “next Friday at 8” into an exact time or range.
          </p>
        </header>
        <TemporalParser />
      </PageContainer>
    </PageShell>
  );
}
