import type { ReactNode } from "react";

import { Notice } from "@/components/ui/notice";
import { BrandLink, PageContainer, PageShell } from "@/components/ui/page-shell";
import { ThemeToggle } from "@/components/ui/theme-toggle";
import { AUTH_UNAVAILABLE_COPY } from "@/lib/auth-copy";

/**
 * Shared chrome for the sign-in and sign-up routes. Both mount a Clerk component
 * on an optional catch-all segment, because Clerk's path routing advances through
 * nested URLs — a verification step lands on something like
 * `/sign-in/factor-one`, which would 404 on a single static page.
 */
export function AuthPageShell({
  children,
  headingId,
  subtitle,
  title,
}: {
  children: ReactNode;
  headingId: string;
  subtitle: string;
  title: string;
}) {
  return (
    <PageShell className="flex py-6 sm:py-8">
      <PageContainer className="min-h-[calc(100vh-3rem)] gap-0 sm:min-h-[calc(100vh-4rem)]" max="4xl">
        <nav className="flex items-center justify-between border-b border-border pb-4" aria-label="Primary navigation">
          <BrandLink />
          <ThemeToggle className="size-10 p-0" />
        </nav>

        <div className="flex flex-1 items-center justify-center py-10 sm:py-14">
          <section aria-labelledby={headingId} className="w-full max-w-md">
            <header className="text-center">
              <h1 id={headingId} className="text-3xl font-semibold sm:text-4xl">
                {title}
              </h1>
              <p className="mt-2 text-sm leading-6 text-muted">{subtitle}</p>
            </header>

            <div className="mt-6 flex justify-center">{children}</div>
          </section>
        </div>
      </PageContainer>
    </PageShell>
  );
}

/** Shown when this environment has no auth credentials. See `AUTH_UNAVAILABLE_COPY`. */
export function AuthUnavailableNotice() {
  return (
    <Notice className="py-5 leading-7" variant="dashed">
      {AUTH_UNAVAILABLE_COPY}
    </Notice>
  );
}
