"use client";

import { useAuthActions } from "@convex-dev/auth/react";
import { useQuery } from "convex/react";
import Link from "next/link";
import { Component, type ReactNode } from "react";

import { api } from "@convex-generated-api";
import { buttonVariants, Button } from "@/components/ui/button";
import { Notice } from "@/components/ui/notice";
import { cn } from "@/lib/cn";

const convexUrl = process.env.NEXT_PUBLIC_CONVEX_URL;

function ConnectedAccountPanel() {
  const viewer = useQuery(api.accounts.viewer);
  const { signOut } = useAuthActions();

  if (viewer === undefined) {
    return <p className="text-sm text-muted">Loading account…</p>;
  }

  if (viewer === null) {
    return (
      <section className="border-t border-border py-8">
        <h2 className="text-2xl font-semibold">Not signed in</h2>
        <Link className={cn(buttonVariants({ size: "lg", variant: "primary" }), "mt-5")} href="/sign-in">
          Sign in
        </Link>
      </section>
    );
  }

  return (
    <div>
      <section className="grid gap-8 border-t border-border py-8 lg:grid-cols-[minmax(0,1fr)_minmax(18rem,0.7fr)]">
        <div>
          <h2 className="text-2xl font-semibold">{viewer.user.name ?? viewer.user.email ?? "Your details"}</h2>
          <dl className="mt-4 grid gap-2 text-sm">
            <div className="flex flex-wrap items-baseline gap-x-3">
              <dt className="text-muted">Email</dt>
              <dd>{viewer.user.email ?? "Not provided"}</dd>
            </div>
            <div className="flex flex-wrap items-baseline gap-x-3">
              <dt className="text-muted">Status</dt>
              <dd>{viewer.user.emailVerified ? "Verified" : "Verification required"}</dd>
            </div>
          </dl>
          <div className="mt-5 flex flex-wrap gap-2">
            <Link className={buttonVariants({ variant: "secondary" })} href="/account/privacy">Privacy controls</Link>
            <Link className={buttonVariants({ variant: "secondary" })} href="/account/appearance">Personalization</Link>
            <Button type="button" variant="ghost" onClick={() => void signOut()}>Sign out</Button>
          </div>
        </div>

        <div className="lg:border-l lg:border-border lg:pl-8">
          <h2 className="text-lg font-semibold">Sign-in methods</h2>
          <ul className="mt-4 divide-y divide-border border-y border-border text-sm">
            {viewer.linkedProviders.length === 0 ? (
              <li className="py-3 text-muted">No sign-in methods linked.</li>
            ) : viewer.linkedProviders.map((account) => (
              <li className="flex items-center justify-between gap-4 py-3" key={`${account.provider}:${account.providerAccountId}`}>
                <span className="font-medium capitalize">{account.provider}</span>
                <span className="text-muted">{account.emailVerified ? "Verified email" : "Connected"}</span>
              </li>
            ))}
          </ul>
        </div>
      </section>

      <section aria-labelledby="profiles-heading" className="border-t border-border py-8">
        <div className="grid gap-6 sm:grid-cols-[minmax(0,1fr)_auto] sm:items-end">
          <div>
            <h2 className="text-2xl font-semibold" id="profiles-heading">Your profiles</h2>
            <p className="mt-2 max-w-xl text-sm leading-6 text-muted">
              Claiming confirms control of a specific profile. Linking a sign-in method only changes how you access your account.
            </p>
          </div>
          <Link className={buttonVariants({ variant: "primary" })} href="/search">
            Find a profile
          </Link>
        </div>
        <Notice className="mt-5" variant="dashed">
          Open an unclaimed profile and choose <strong>Claim profile</strong>. Profiles you manage appear in personalization and privacy controls.
        </Notice>
      </section>
    </div>
  );
}

class AccountPanelErrorBoundary extends Component<{ children: ReactNode }, { hasError: boolean }> {
  state = { hasError: false };

  static getDerivedStateFromError() {
    return { hasError: true };
  }

  render() {
    return this.state.hasError ? (
      <Notice className="leading-7" variant="dashed">
        Account details are temporarily unavailable. Try again shortly.
      </Notice>
    ) : this.props.children;
  }
}

export function AccountPanel() {
  if (!convexUrl) {
    return (
      <Notice className="leading-7" variant="dashed">
        Account details are unavailable because the application backend is not configured.
      </Notice>
    );
  }

  return (
    <AccountPanelErrorBoundary>
      <ConnectedAccountPanel />
    </AccountPanelErrorBoundary>
  );
}
