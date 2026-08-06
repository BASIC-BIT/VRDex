"use client";

import { useClerk } from "@clerk/nextjs";
import { useQuery } from "convex/react";
import Link from "next/link";
import { Component, type ReactNode } from "react";

import { api } from "@convex-generated-api";
import { Button, buttonVariants } from "@/components/ui/button";
import { Notice } from "@/components/ui/notice";
import { VerifiedTrustMark } from "@/components/ui/verified-trust-mark";
import { cn } from "@/lib/cn";
import { ownerProfileDestinationPath, profileClaimPath } from "@/lib/profile-claim";
import { AccountSignOutControl } from "./sign-out-control";

const convexUrl = process.env.NEXT_PUBLIC_CONVEX_URL;
const clerkConfigured = Boolean(process.env.NEXT_PUBLIC_CLERK_PUBLISHABLE_KEY);

function ConnectedAccountPanel() {
  const viewer = useQuery(api.accounts.viewer);
  const ownedProfiles = useQuery(api.profilePrivacy.listOwnedPrivacyProfilesForAccount);
  const { openUserProfile } = useClerk();

  if (viewer === undefined || ownedProfiles === undefined) {
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
          {/*
            Session replay records every route, and `maskAllInputs` only covers
            input values — a name or email rendered as ordinary text would be
            captured verbatim. `data-ph-no-capture` is the configured
            `maskTextSelector`, so marking the elements that render identity
            keeps the recording useful while masking the identity itself.
          */}
          <h2 className="text-2xl font-semibold" data-ph-no-capture>
            {viewer.user.name ?? viewer.user.email ?? "Your details"}
          </h2>
          <dl className="mt-4 grid gap-2 text-sm">
            <div className="flex flex-wrap items-baseline gap-x-3">
              <dt className="text-muted">Email</dt>
              <dd data-ph-no-capture>{viewer.user.email ?? "Not provided"}</dd>
            </div>
            <div className="flex flex-wrap items-baseline gap-x-3">
              <dt className="text-muted">Status</dt>
              <dd>{viewer.user.emailVerified ? "Verified" : "Verification required"}</dd>
            </div>
          </dl>
          {/* Privacy, connections, personalization and media kit used to start
              here, as four destinations that each asked which profile you meant
              on arrival. They hang off a profile now — see the Edit action on
              each row below — because that is the order the decision is
              actually made in. */}
          <div className="mt-5 flex flex-wrap gap-2">
            <AccountSignOutControl />
          </div>
        </div>

        <div className="lg:border-l lg:border-border lg:pl-8">
          <h2 className="text-lg font-semibold">Sign-in and security</h2>
          <p className="mt-3 text-sm leading-6 text-muted">
            Connect Google or Discord, change your password, and review signed-in
            devices. Linked accounts can use different email addresses.
          </p>
          <Button
            className="mt-4"
            type="button"
            variant="secondary"
            // Opens Clerk's full profile surface, which also exposes account
            // deletion when the instance allows it. VRDex has no reconciliation
            // for a deleted Clerk identity (#227): the `users` and `profileOwners`
            // rows would survive under an unreachable `clerkUserId`, and
            // re-registering provisions a different user that cannot manage them.
            // Self-service deletion must stay disabled on every Clerk instance
            // until #227 lands. That is an instance setting — Clerk's Backend API
            // does not expose it, so it cannot be asserted from here.
            onClick={() => openUserProfile()}
          >
            Manage sign-in methods
          </Button>
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
        {ownedProfiles && ownedProfiles.length > 0 ? (
          <ul className="mt-5 divide-y divide-border border-y border-border">
            {ownedProfiles.map((profile) => {
              const profilePath = ownerProfileDestinationPath(
                profile,
                profileClaimPath(profile.slug, "account"),
              );

              return (
                <li className="flex flex-wrap items-center justify-between gap-3 py-4" key={profile.profileId}>
                  <div className="flex items-center gap-2">
                    {/* This list includes profiles that are not publicly
                        readable — draft, suppressed, or opted out. With replay
                        on every route their display name is the identity of a
                        profile nobody outside the account can see, and
                        `maskAllInputs` does not cover rendered text. */}
                    <Link
                      className="font-medium underline underline-offset-4"
                      data-ph-no-capture
                      href={profilePath}
                    >
                      {profile.displayName}
                    </Link>
                    {profile.claimState === "claimed_verified" ? <VerifiedTrustMark /> : null}
                  </div>
                  <div className="flex flex-wrap gap-2">
                    {profile.hasPublicProfile ? (
                      <Link className={buttonVariants({ size: "sm", variant: "primary" })} href={profilePath}>
                        View profile
                      </Link>
                    ) : null}
                    {profile.claimState === "claimed_unverified" ? (
                      <Link
                        className={buttonVariants({ size: "sm", variant: "secondary" })}
                        href={profileClaimPath(profile.slug, "account")}
                      >
                        Verify with VRChat
                      </Link>
                    ) : null}
                    <Link
                      className={buttonVariants({ size: "sm", variant: "secondary" })}
                      href={`/account/privacy?profileId=${encodeURIComponent(profile.profileId)}`}
                    >
                      Edit
                    </Link>
                  </div>
                </li>
              );
            })}
          </ul>
        ) : (
          <Notice className="mt-5" variant="dashed">
            Open an unclaimed profile and choose <strong>Claim profile</strong>.
          </Notice>
        )}
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
  // `useClerk()` inside the connected panel asserts a ClerkProvider ancestor, and
  // the provider is only mounted when Clerk has credentials. Bail out here rather
  // than making that hook conditional.
  if (!convexUrl || !clerkConfigured) {
    return (
      <Notice className="leading-7" variant="dashed">
        Account details are temporarily unavailable. Try again shortly.
      </Notice>
    );
  }

  return (
    <AccountPanelErrorBoundary>
      <ConnectedAccountPanel />
    </AccountPanelErrorBoundary>
  );
}
