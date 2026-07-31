import { SignIn } from "@clerk/nextjs";

import {
  AuthPageShell,
  AuthUnavailableNotice,
} from "@/components/auth-page-shell";
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
    <AuthPageShell
      headingId="sign-in-heading"
      subtitle="Manage your VRDex profile and events."
      title="Sign in"
    >
      {process.env.NEXT_PUBLIC_CLERK_PUBLISHABLE_KEY ? (
        <SignIn
          fallbackRedirectUrl={returnTo}
          signUpFallbackRedirectUrl={returnTo}
          signUpUrl="/sign-up"
        />
      ) : (
        <AuthUnavailableNotice />
      )}
    </AuthPageShell>
  );
}
