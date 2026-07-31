import { SignUp } from "@clerk/nextjs";

import {
  AuthPageShell,
  AuthUnavailableNotice,
} from "@/components/auth-page-shell";
import { validateSignInReturnTo } from "@/lib/safe-return-to";

export default async function SignUpPage({
  searchParams,
}: {
  searchParams: Promise<{
    redirectTo?: string | string[];
    returnTo?: string | string[];
  }>;
}) {
  const params = await searchParams;
  const returnTo = validateSignInReturnTo(params.returnTo ?? params.redirectTo);

  return (
    <AuthPageShell
      headingId="sign-up-heading"
      subtitle="Create a VRDex account to claim a profile and publish events."
      title="Create account"
    >
      {process.env.NEXT_PUBLIC_CLERK_PUBLISHABLE_KEY ? (
        <SignUp
          fallbackRedirectUrl={returnTo}
          signInFallbackRedirectUrl={returnTo}
          signInUrl="/sign-in"
        />
      ) : (
        <AuthUnavailableNotice />
      )}
    </AuthPageShell>
  );
}
