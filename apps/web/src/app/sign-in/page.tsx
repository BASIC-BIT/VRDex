import { SignIn } from "@clerk/nextjs";

import { BrandLink, PageContainer, PageShell } from "@/components/ui/page-shell";
import { ThemeToggle } from "@/components/ui/theme-toggle";
import { validateSignInReturnTo } from "@/lib/safe-return-to";

export default async function SignInPage({
  searchParams,
}: {
  searchParams: Promise<{
    redirectTo?: string | string[];
    returnTo?: string | string[];
  }>;
}) {
  const params = await searchParams;
  // Still validated locally rather than handed to Clerk unchecked, so an
  // attacker-supplied `returnTo` cannot bounce a signed-in user off-site.
  const returnTo = validateSignInReturnTo(params.returnTo ?? params.redirectTo);

  return (
    <PageShell className="flex py-6 sm:py-8">
      <PageContainer className="min-h-[calc(100vh-3rem)] gap-0 sm:min-h-[calc(100vh-4rem)]" max="4xl">
        <nav className="flex items-center justify-between border-b border-border pb-4" aria-label="Primary navigation">
          <BrandLink />
          <ThemeToggle className="size-10 p-0" />
        </nav>

        <div className="flex flex-1 items-center justify-center py-10 sm:py-14">
          <section aria-labelledby="sign-in-heading" className="w-full max-w-md">
            <header className="text-center">
              <h1 id="sign-in-heading" className="text-3xl font-semibold sm:text-4xl">
                Sign in
              </h1>
              <p className="mt-2 text-sm leading-6 text-muted">Manage your VRDex profile and events.</p>
            </header>

            <div className="mt-6 flex justify-center">
              <SignIn
                fallbackRedirectUrl={returnTo}
                signUpFallbackRedirectUrl={returnTo}
              />
            </div>
          </section>
        </div>
      </PageContainer>
    </PageShell>
  );
}
